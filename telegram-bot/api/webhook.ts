import type { AgentInputItem } from "@openai/agents";
import { loadConfig, type Config } from "../src/config.js";
import { isAllowed, checkSecretToken } from "../src/auth.js";
import { createRateLimiter } from "../src/rate-limit.js";
import { sendTelegramMessage, withTypingIndicator } from "../src/telegram/send-message.js";
import { downloadTelegramFile, toDataUrl } from "../src/telegram/get-file.js";
import { transcribeAudio } from "../src/telegram/transcribe.js";
import { handleSlashCommand } from "../src/commands.js";
import { BlobStoreRegistry } from "../src/data/blob-store.js";
import { createAllowlistStore } from "../src/data/allowlist-store.js";
import { createGithubDispatcher } from "../src/github-dispatch.js";
import { runLlm } from "../src/llm.js";
import { keepConversationalOnly } from "../src/history.js";

// Cap on base64-encoded image payloads (roughly 4MB base64 = 3MB raw).
// Larger photos blow up OpenAI vision cost AND can exceed the API's
// per-message input limit, producing a confusing BadRequest the user
// can't act on.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

// Idempotency window: Telegram retries unanswered webhook deliveries for
// ~75 seconds. Without this, a cold-start + LLM run that brushes 60s can
// trigger a duplicate that re-spends OpenAI credits, double-fires GitHub
// dispatch, and confuses the conversation history. Bounded FIFO keeps
// memory tiny (200 × ~24-byte numbers = <5KB).
//
// LIMITATION: This is per-Vercel-container only — Vercel routes by load,
// not sticky session, so two warm containers can each treat the same
// retry as "first seen" and double-process it. For the current owner-only
// bot the failure mode is rare (need a 60s+ LLM run AND a retry routed
// to a different warm container). If /approve grows past ~5 active
// users, move dedup to Vercel KV / Upstash Redis. Same scaling threshold
// as rate-limit.ts.
const DEDUP_MAX = 200;
const seenUpdateIds: number[] = [];
const seenUpdateSet = new Set<number>();
function rememberUpdate(id: number): boolean {
  if (seenUpdateSet.has(id)) return false;
  seenUpdateSet.add(id);
  seenUpdateIds.push(id);
  if (seenUpdateIds.length > DEDUP_MAX) {
    const evicted = seenUpdateIds.shift();
    if (evicted !== undefined) seenUpdateSet.delete(evicted);
  }
  return true;
}

// Lazy config: throwing at module top-level produces a 500 from Vercel
// BEFORE the secret-token check runs, which makes Telegram retry the
// same update for up to an hour. Wrapping config in a lazy cache lets
// the handler return a clean 200 with a logged error instead.
interface WebhookDeps {
  config: Config;
  rateLimiter: ReturnType<typeof createRateLimiter>;
  blobRegistry: BlobStoreRegistry;
  allowlistStore: ReturnType<typeof createAllowlistStore>;
  dispatcher: ReturnType<typeof createGithubDispatcher>;
}
let cachedDeps: WebhookDeps | null = null;
let cachedConfigError: Error | null = null;

function getDeps(): WebhookDeps {
  if (cachedConfigError) throw cachedConfigError;
  if (cachedDeps) return cachedDeps;
  try {
    const config = loadConfig();
    const deps: WebhookDeps = {
      config,
      rateLimiter: createRateLimiter({ windowMs: 60_000, max: 20 }),
      blobRegistry: new BlobStoreRegistry(config.blobBaseUrl),
      allowlistStore: createAllowlistStore({
        url: `${config.blobBaseUrl}/allowlist.json`,
        token: config.blobReadWriteToken,
      }),
      dispatcher: createGithubDispatcher({
        pat: config.githubPat,
        repo: config.githubRepo,
        workflow: "refresh-export.yml",
      }),
    };
    // OpenAI Agents SDK auto-reads OPENAI_API_KEY from env.
    process.env.OPENAI_API_KEY = config.openaiApiKey;
    cachedDeps = deps;
    return deps;
  } catch (e) {
    cachedConfigError = e as Error;
    throw e;
  }
}

// Per-chat conversation history. In-memory means it resets on each Vercel
// cold start, which is fine for a low-volume 2-user bot: warm container
// keeps memory for the active conversation, cold start drops history but
// next message rebuilds it. Capped to last MAX_HISTORY items to bound
// token cost and memory.
const MAX_HISTORY = 30;
const RESET_KEYWORDS = /^\s*\/(reset|new|forget)\b/i;
const historyByChat = new Map<number, AgentInputItem[]>();

/**
 * Translate a thrown error into a user-facing string that NAMES the cause.
 * Returns { text, resetMemory } — if resetMemory is true, drop this chat's
 * history before sending so the next message starts clean.
 */
function describeError(e: unknown): { text: string; resetMemory: boolean } {
  const err = e as Error & { status?: number; code?: string };
  const msg = err?.message ?? String(e);
  const name = err?.name ?? "Error";
  const status = err?.status;

  // History pairing corruption — clear memory and tell user.
  // Covers the older "tool_call not found" and the gpt-5 reasoning-pairing 400
  // ("function_call … was provided without its required 'reasoning' item").
  // We strip scratchpad before persisting, so this should not fire — but keep
  // it as defense-in-depth in case the SDK ever leaks an unpaired item.
  if (/No tool call found for function call output/i.test(msg) ||
      /tool_call.*not found/i.test(msg) ||
      /function_call.*required.*reasoning/i.test(msg) ||
      /reasoning.*required.*following item/i.test(msg)) {
    return {
      text: "Lost the conversation thread (tool-call pairing broke in OpenAI). I've cleared this chat's memory — ask again and I'll start fresh.",
      resetMemory: true,
    };
  }

  // OpenAI-specific errors.
  if (status === 429 || /rate.?limit|quota/i.test(msg)) {
    return {
      text: "OpenAI is rate-limiting us. Wait ~30 seconds and try again.",
      resetMemory: false,
    };
  }
  if (status === 401 || /invalid.*api.*key|incorrect.*api.*key|authentication/i.test(msg)) {
    return {
      text: "OpenAI rejected the API key — the operator needs to update OPENAI_API_KEY.",
      resetMemory: false,
    };
  }
  if (status === 402 || /insufficient.*quota|billing/i.test(msg)) {
    return {
      text: "OpenAI account has no credit. The operator needs to top up the billing.",
      resetMemory: false,
    };
  }
  if (status === 503 || status === 502 || /overloaded|service.*unavailable/i.test(msg)) {
    return {
      text: "OpenAI is overloaded. Try again in a minute.",
      resetMemory: false,
    };
  }
  if (status === 400 && /BadRequest/i.test(name)) {
    return {
      text: `OpenAI rejected the request: ${msg.slice(0, 200)}. Try /reset and rephrase.`,
      resetMemory: false,
    };
  }
  if (/MaxTurnsExceeded/i.test(name)) {
    return {
      text: "I ran out of analysis budget on this one. Narrow the question (e.g. \"just the total\").",
      resetMemory: false,
    };
  }

  // Vercel Blob / snapshot fetch failures.
  if (/latest\.json fetch failed/i.test(msg)) {
    return {
      text: `Couldn't read the data snapshot from storage (${msg.slice(0, 100)}). The operator needs to check the storage backend.`,
      resetMemory: false,
    };
  }
  if (/Unknown CSV:/i.test(msg)) {
    return {
      text: `Snapshot is missing a CSV: ${msg.slice(0, 200)}`,
      resetMemory: false,
    };
  }
  if (/CSV .* fetch failed/i.test(msg)) {
    return {
      text: `Couldn't fetch a CSV blob: ${msg.slice(0, 200)}. Snapshot may be partial.`,
      resetMemory: false,
    };
  }

  // Telegram send failures bubble back here if the user's outbound send fails.
  if (/Telegram sendMessage failed/i.test(msg)) {
    return {
      text: `Telegram API rejected my reply: ${msg.slice(0, 200)}.`,
      resetMemory: false,
    };
  }

  // Network / timeout.
  if (/ETIMEDOUT|ECONNRESET|ENOTFOUND|fetch failed/i.test(msg)) {
    return {
      text: `Network error reaching upstream (${msg.slice(0, 100)}). Try again in 30s.`,
      resetMemory: false,
    };
  }

  // Last-resort: name the class + short message so we never say "something broke".
  return {
    text: `Internal error (${name}): ${msg.slice(0, 200)}. The operator will see this in the logs.`,
    resetMemory: false,
  };
}

interface TgPhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramUpdate {
  update_id?: number;
  message?: {
    chat: { id: number; type: string };
    from?: { first_name?: string; username?: string };
    text?: string;
    caption?: string;                     // present on photo/document messages
    voice?: { file_id: string; mime_type?: string; duration?: number };
    photo?: TgPhotoSize[];                // array of resolutions; last = largest
    document?: { file_id: string; mime_type?: string; file_name?: string };
  };
}

export default async function handler(req: any, res: any) {
  const started = Date.now();
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  // Resolve config lazily. A misconfigured deploy throws here; we return
  // 200 with a logged error instead of letting Vercel return 500 (which
  // Telegram interprets as transient and retries forever).
  let deps: ReturnType<typeof getDeps>;
  try {
    deps = getDeps();
  } catch (e) {
    console.error("[webhook] config init failed; returning 200 to suppress Telegram retry storm", e);
    res.status(200).end();
    return;
  }
  const { config, rateLimiter, blobRegistry, allowlistStore, dispatcher } = deps;

  const tokenHeader = req.headers["x-telegram-bot-api-secret-token"];
  if (
    !checkSecretToken(
      typeof tokenHeader === "string" ? tokenHeader : undefined,
      config.webhookSecret,
    )
  ) {
    res.status(401).end();
    return;
  }

  const update = req.body as TelegramUpdate;
  // Idempotency: Telegram retries on >75s response. Drop duplicates.
  if (typeof update?.update_id === "number" && !rememberUpdate(update.update_id)) {
    res.status(200).end();
    return;
  }
  const msg = update?.message;
  if (!msg) {
    res.status(200).end();
    return;
  }
  // Accept text OR voice OR photo (with optional caption). Document upload
  // is treated as no-op for now.
  if (!msg.text && !msg.voice && !(msg.photo && msg.photo.length > 0)) {
    res.status(200).end();
    return;
  }

  const chatId = msg.chat.id;
  const firstName = msg.from?.first_name ?? "there";
  // Resolve final text + optional image data URLs from whichever input shape
  // arrived. Voice → transcribe; photo → attach image; text → as-is.
  let text = msg.text ?? msg.caption ?? "";
  const imageUrls: string[] = [];
  let inputKind: "text" | "voice" | "photo" = "text";

  // Combine env owner-set with the dynamic /approve-d set.
  let dynamicApproved: Set<number> = new Set();
  let allowlistReadFailed = false;
  try {
    const al = await allowlistStore.read();
    dynamicApproved = new Set(al.approved.map((e: { chatId: number }) => e.chatId));
  } catch (e) {
    allowlistReadFailed = true;
    console.warn("allowlist read failed", e);
  }
  const isOwner = isAllowed(chatId, config.allowedChatIds);
  const isApproved = isOwner || dynamicApproved.has(chatId);
  // If the env owner set is empty AND the dynamic allowlist failed to
  // load (or is empty), every user is silently locked out — the bot is
  // effectively down. Surface this as a distinct log so the operator
  // can fix the misconfig.
  if (config.allowedChatIds.size === 0 && dynamicApproved.size === 0) {
    console.error(
      `[bot] LOCKOUT: TELEGRAM_ALLOWED_CHAT_IDS is empty and dynamic allowlist is ${
        allowlistReadFailed ? "unreachable" : "empty"
      } — every user will be rejected. Fix env or restore allowlist.json.`
    );
  }

  if (!isApproved) {
    await sendTelegramMessage({
      token: config.telegramBotToken,
      chatId,
      text: `Not authorized. Your chat id is ${chatId} — forward this to the bot owner to get approved.`,
    });
    res.status(200).end();
    return;
  }

  if (!rateLimiter.check(chatId)) {
    await sendTelegramMessage({
      token: config.telegramBotToken,
      chatId,
      text: "Slow down a sec — try again in a moment.",
    });
    res.status(200).end();
    return;
  }

  // Voice → Whisper. Replace text with the transcription. An empty
  // transcript means Whisper heard silence / noise / non-speech; tell
  // the user explicitly rather than feeding the literal placeholder
  // "(empty voice transcription)" into the LLM (where it'd produce a
  // confused answer the user can't act on).
  if (msg.voice) {
    try {
      inputKind = "voice";
      const file = await downloadTelegramFile({ token: config.telegramBotToken, fileId: msg.voice.file_id });
      const transcript = (await transcribeAudio({ apiKey: config.openaiApiKey, file })).trim();
      if (transcript === "") {
        await sendTelegramMessage({
          token: config.telegramBotToken,
          chatId,
          text: "I couldn't hear anything in your voice note — please retry or type your question.",
        });
        res.status(200).end();
        return;
      }
      text = transcript;
    } catch (e) {
      await sendTelegramMessage({
        token: config.telegramBotToken,
        chatId,
        text: `Couldn't transcribe voice message: ${(e as Error).message}`,
      });
      res.status(200).end();
      return;
    }
  }

  // Photo → attach the largest resolution that fits MAX_IMAGE_BYTES.
  // Telegram's photo array is small→large; pick the largest whose declared
  // file_size fits, or fall back to the smallest if even that exceeds the
  // cap (vision API will still likely refuse — we surface a clear message).
  if (msg.photo && msg.photo.length > 0) {
    try {
      inputKind = "photo";
      const sorted = [...msg.photo].sort(
        (a, b) => (b.file_size ?? b.width * b.height) - (a.file_size ?? a.width * a.height),
      );
      const pick =
        sorted.find(s => (s.file_size ?? 0) > 0 && (s.file_size ?? 0) <= MAX_IMAGE_BYTES)
        ?? sorted[sorted.length - 1]!;
      const file = await downloadTelegramFile({ token: config.telegramBotToken, fileId: pick.file_id });
      if (file.bytes.byteLength > MAX_IMAGE_BYTES) {
        await sendTelegramMessage({
          token: config.telegramBotToken,
          chatId,
          text: `Image is too large (${(file.bytes.byteLength / 1024 / 1024).toFixed(1)}MB > ${MAX_IMAGE_BYTES / 1024 / 1024}MB). Resize and resend.`,
        });
        res.status(200).end();
        return;
      }
      imageUrls.push(toDataUrl(file, file.mimeType ?? "image/jpeg"));
      if (!text) text = "Look at this image and tell me what's relevant given the gym data.";
    } catch (e) {
      await sendTelegramMessage({
        token: config.telegramBotToken,
        chatId,
        text: `Couldn't process image: ${(e as Error).message}`,
      });
      res.status(200).end();
      return;
    }
  }

  // /reset, /new, /forget — clear conversation memory before handling.
  if (RESET_KEYWORDS.test(text)) {
    historyByChat.delete(chatId);
    await sendTelegramMessage({
      token: config.telegramBotToken,
      chatId,
      text: "Cleared. Start fresh.",
    });
    res.status(200).end();
    return;
  }

  try {
    const slash = await handleSlashCommand({
      text,
      chatId,
      firstName,
      registry: blobRegistry,
      dispatchRefresh: dispatcher,
      allowlistStore,
      isOwner,
    });

    let reply: string;
    let toolCalls = 0;
    let snapshotInfo = "";
    if (slash !== null) {
      reply = slash;
    } else {
      // Show "typing..." in Telegram while the LLM works.
      const llm = await withTypingIndicator(
        config.telegramBotToken,
        chatId,
        () => runLlm({
          question: text,
          model: config.openaiModel,
          registry: blobRegistry,
          history: historyByChat.get(chatId) ?? [],
          imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
        }),
      );
      reply = llm.text;
      toolCalls = llm.toolCalls;
      snapshotInfo = Object.entries(llm.snapshotDates).map(([g, d]) => `${g}=${d}`).join(",");
      // Persist only conversational turns (user + assistant text). Scratchpad
      // (reasoning, function_call, function_call_output) is dropped — replaying
      // it across turns trips the Responses API's reasoning↔function_call
      // pairing constraint on gpt-5. The model can re-derive tool calls fresh
      // on the next turn from the user-visible exchange.
      const conversational = keepConversationalOnly(llm.history);
      const trimmed = conversational.slice(-MAX_HISTORY);
      historyByChat.set(chatId, trimmed);
    }

    await sendTelegramMessage({
      token: config.telegramBotToken,
      chatId,
      text: reply,
    });

    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      chat_id: chatId,
      input_kind: inputKind,
      q: text.slice(0, 200),
      n_images: imageUrls.length,
      n_tool_calls: toolCalls,
      model: config.openaiModel,
      latency_ms: Date.now() - started,
      snapshots: snapshotInfo,
      answer_preview: reply.slice(0, 200),
    }));
    res.status(200).end();
  } catch (e) {
    console.error("webhook error", e);
    const { text: errorText, resetMemory } = describeError(e);
    if (resetMemory) {
      historyByChat.delete(chatId);
    }
    try {
      await sendTelegramMessage({
        token: config.telegramBotToken,
        chatId,
        text: errorText,
      });
    } catch (sendErr) {
      // If even the error message fails to send, log so Amit can see it.
      console.error("error sending error message", sendErr);
    }
    res.status(200).end();
  }
}
