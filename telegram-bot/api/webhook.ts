import type { AgentInputItem } from "@openai/agents";
import { loadConfig } from "../src/config.js";
import { isAllowed, checkSecretToken } from "../src/auth.js";
import { createRateLimiter } from "../src/rate-limit.js";
import { sendTelegramMessage } from "../src/telegram/send-message.js";
import { handleSlashCommand } from "../src/commands.js";
import { createBlobStore } from "../src/data/blob-store.js";
import { createAllowlistStore } from "../src/data/allowlist-store.js";
import { createGithubDispatcher } from "../src/github-dispatch.js";
import { runLlm } from "../src/llm.js";

const config = loadConfig();
const rateLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });

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
  if (/No tool call found for function call output/i.test(msg) ||
      /tool_call.*not found/i.test(msg)) {
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
      text: "OpenAI rejected the API key — Amit needs to update OPENAI_API_KEY in Vercel envs.",
      resetMemory: false,
    };
  }
  if (status === 402 || /insufficient.*quota|billing/i.test(msg)) {
    return {
      text: "OpenAI account has no credit. Amit needs to top up at platform.openai.com/billing.",
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
      text: `Couldn't read the CSV snapshot from storage (${msg.slice(0, 100)}). Amit needs to check the Vercel Blob store.`,
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
    text: `Internal error (${name}): ${msg.slice(0, 200)}. Amit will see this in the logs.`,
    resetMemory: false,
  };
}

const blobStore = createBlobStore({ latestUrl: config.blobLatestUrl });
// Allowlist lives alongside latest.json in the same Blob store.
const allowlistUrl = config.blobLatestUrl.replace(/\/csv\/latest\.json$/, "/allowlist.json");
const allowlistStore = createAllowlistStore({
  url: allowlistUrl,
  token: config.blobReadWriteToken,
});
const dispatcher = createGithubDispatcher({
  pat: config.githubPat,
  repo: config.githubRepo,
  workflow: "refresh-export.yml",
});

// OpenAI Agents SDK auto-reads OPENAI_API_KEY from env.
process.env.OPENAI_API_KEY = config.openaiApiKey;

interface TelegramUpdate {
  message?: {
    chat: { id: number; type: string };
    from?: { first_name?: string; username?: string };
    text?: string;
  };
}

export default async function handler(req: any, res: any) {
  const started = Date.now();
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

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
  const msg = update?.message;
  if (!msg || !msg.text) {
    res.status(200).end();
    return;
  }

  const chatId = msg.chat.id;
  const firstName = msg.from?.first_name ?? "there";
  const text = msg.text;

  // Combine env owner-set with the dynamic /approve-d set.
  let dynamicApproved: Set<number> = new Set();
  try {
    const al = await allowlistStore.read();
    dynamicApproved = new Set(al.approved.map((e: { chatId: number }) => e.chatId));
  } catch (e) {
    console.warn("allowlist read failed", e);
  }
  const isOwner = isAllowed(chatId, config.allowedChatIds);
  const isApproved = isOwner || dynamicApproved.has(chatId);

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
      store: blobStore,
      dispatchRefresh: dispatcher,
      allowlistStore,
      isOwner,
    });

    let reply: string;
    let toolCalls = 0;
    let snapshotDate = "?";
    if (slash !== null) {
      reply = slash;
    } else {
      const llm = await runLlm({
        question: text,
        model: config.openaiModel,
        store: blobStore,
        history: historyByChat.get(chatId) ?? [],
      });
      reply = llm.text;
      toolCalls = llm.toolCalls;
      snapshotDate = llm.snapshotDate;
      // Persist updated history, capped to last MAX_HISTORY items.
      const trimmed = llm.history.slice(-MAX_HISTORY);
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
      q: text.slice(0, 200),
      n_tool_calls: toolCalls,
      model: config.openaiModel,
      latency_ms: Date.now() - started,
      snapshot_date: snapshotDate,
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
