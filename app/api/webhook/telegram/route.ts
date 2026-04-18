/**
 * Telegram webhook endpoint.
 *
 * Receives all updates from Telegram (text messages, voice notes, callback
 * queries from inline keyboards) and routes them appropriately:
 *
 *   1. /pair <code>          → pair this chatId with the gym (one owner only)
 *   2. text message          → invoke AI agent, send response back
 *   3. voice message         → download → Whisper → treat as text
 *   4. callback query        → dispatch insight action OR snooze
 *
 * Auth: a secret token sent by Telegram in the X-Telegram-Bot-Api-Secret-Token
 * header (configured at setWebhook time). Compared against either a setting
 * (`telegram_webhook_secret`) or env (`TELEGRAM_WEBHOOK_SECRET`).
 *
 * Owner gating: only the chatId stored in `gym_owner_telegram_chat_id` is
 * allowed to converse — random users who find the bot are silently ignored.
 *
 * Always returns 200 quickly. Telegram retries on non-2xx (which would create
 * duplicate processing).
 */

import { prisma } from "@/lib/prisma";
import { run } from "@openai/agents";
import type { AgentInputItem } from "@openai/agents";
import { createGymAgent } from "@/lib/ai/agent";
import type { AgentContext } from "@/lib/ai/system-prompt";
import { runInAiContext } from "@/lib/ai-context";
import { getSetting, setSetting } from "@/lib/services/settings";
import { executeInsightAction, snoozeInsight } from "@/lib/services/insight";
import {
  sendMessage,
  sendMessageWithButtons,
  editMessageText,
  answerCallbackQuery,
  getFile,
  downloadFile,
  transcribeVoice,
  derivePairingCode,
  escapeHtml,
} from "@/lib/channels/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OK = () => Response.json({ ok: true });

// ── Telegram update payload typing (subset we care about) ──────────────────
type TgUser = { id: number; first_name?: string; username?: string };
type TgChat = { id: number; type: string };
type TgVoice = { file_id: string; mime_type?: string; duration?: number };
type TgMessage = {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  voice?: TgVoice;
};
type TgCallbackQuery = {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
};
type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
};

// ── Resolve the owner chatId for the current gym (single-instance model) ───
async function getOwnerChatId(): Promise<string> {
  return (await getSetting("gym_owner_telegram_chat_id", "")).trim();
}

// ── PR 16 K.2: cheap heuristic language detection for incoming text ────────
// Devanagari range > 30% → "hi". Predominantly Latin → "en". Mixed → "hinglish".
// Returns null when string is empty or all whitespace/punctuation.
function detectLang(text: string): "en" | "hi" | "hinglish" | null {
  const stripped = text.replace(/[\s\d\p{P}\p{S}]/gu, "");
  if (stripped.length === 0) return null;
  let devanagari = 0;
  let latin = 0;
  for (const ch of stripped) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x0900 && code <= 0x097f) devanagari++;
    else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) latin++;
  }
  const total = devanagari + latin;
  if (total === 0) return null;
  const devRatio = devanagari / total;
  if (devRatio > 0.3) return "hi";
  // Heuristic for Hinglish: Latin script but contains a high-frequency Hindi
  // keyword. Conservative — returns "en" by default.
  const lower = text.toLowerCase();
  const HINGLISH_HINTS = [
    " hai",
    " kya",
    " kaise",
    " mein",
    " aur",
    " nahi",
    " karo",
    " batao",
    " thoda",
    " kitna",
    " kab",
    " kyun",
  ];
  for (const hint of HINGLISH_HINTS) {
    if (lower.includes(hint)) return "hinglish";
  }
  return "en";
}

// ── PR 16 K.1: snooze ALL active insights until tomorrow 06:00 IST ─────────
async function snoozeAllUntilTomorrowMorning(snoozedById: number): Promise<{
  count: number;
  until: Date;
}> {
  // 06:00 IST tomorrow = previous-day 00:30 UTC.
  const now = new Date();
  // Compute "today's date" string in IST so date math is calendar-correct.
  const istNowParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const ymd = Object.fromEntries(istNowParts.map((p) => [p.type, p.value])) as {
    year: string;
    month: string;
    day: string;
  };
  // Tomorrow IST date
  const todayIstMidnightUtc = new Date(
    `${ymd.year}-${ymd.month}-${ymd.day}T00:00:00+05:30`
  );
  const tomorrow = new Date(todayIstMidnightUtc.getTime() + 24 * 60 * 60 * 1000);
  // 06:00 IST on that date.
  const until = new Date(tomorrow.getTime() + 6 * 60 * 60 * 1000);

  const result = await prisma.insight.updateMany({
    where: {
      dismissedAt: null,
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: until } }],
    },
    data: { snoozedUntil: until },
  });
  // Best-effort audit.
  await prisma.auditLog
    .create({
      data: {
        action: "telegram.snooze_all.today",
        status: "success",
        actorId: snoozedById,
        actorType: "worker",
        details: JSON.stringify({ count: result.count, until: until.toISOString() }),
      },
    })
    .catch(() => {});
  return { count: result.count, until };
}

// ── PR 16 K.6: parse the AMBIGUOUS:type=member;query=karan;count=4 sentinel
// the agent emits when a search returns multiple matches. Returns null if
// the reply does not contain the prefix.
type AmbiguousReply = {
  type: string;
  query: string;
  count: number;
};
function parseAmbiguousReply(text: string): AmbiguousReply | null {
  const idx = text.indexOf("AMBIGUOUS:");
  if (idx < 0) return null;
  // Tail after the prefix, until end-of-line.
  const tail = text.slice(idx + "AMBIGUOUS:".length).split(/\r?\n/)[0]?.trim() ?? "";
  if (!tail) return null;
  const parts = tail.split(";").map((p) => p.trim());
  const map: Record<string, string> = {};
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key && val) map[key] = val;
  }
  if (!map.type || !map.query) return null;
  const count = parseInt(map.count ?? "0", 10);
  return {
    type: map.type,
    query: map.query,
    count: Number.isFinite(count) && count > 0 ? count : 0,
  };
}

// ── PR 16 K.6: send a disambiguation question with inline-keyboard chips ───
async function sendDisambiguationPrompt(args: {
  chatId: number;
  amb: AmbiguousReply;
}): Promise<void> {
  const text = `\u{1F914} I found ${args.amb.count > 0 ? args.amb.count : "multiple"} matches for <b>"${escapeHtml(args.amb.query)}"</b>. Could you be more specific? Reply with the full name or phone, or send a new message.`;
  // We don't have the actual candidates here (only the count), so the
  // pragmatic prompt is a "Cancel" button + the natural-language hint above.
  // The agent will run again on the next user reply with the disambiguator.
  const buttons: Array<Array<{ text: string; callback_data: string }>> = [
    [
      {
        text: "Cancel",
        callback_data: JSON.stringify({ t: "amb_cancel" }),
      },
    ],
  ];
  await sendMessageWithButtons({
    chatId: args.chatId,
    text,
    buttons,
    parseMode: "HTML",
  });
}

// ── Resolve a system worker for tool execution attribution ─────────────────
async function resolveSystemWorkerId(): Promise<number | null> {
  const admin = await prisma.worker.findFirst({
    where: { role: "admin", isActive: true },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (admin) return admin.id;
  const any = await prisma.worker.findFirst({
    where: { isActive: true },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return any?.id ?? null;
}

// ── Find or create the AiConversation for this telegram chat ───────────────
async function findOrCreateTelegramConversation(args: {
  chatId: string;
  telegramUserId?: string;
  workerId: number;
}): Promise<number> {
  const existing = await prisma.aiConversation.findFirst({
    where: { channel: "telegram", telegramChatId: args.chatId },
    orderBy: { id: "desc" },
  });
  if (existing) return existing.id;
  const created = await prisma.aiConversation.create({
    data: {
      workerId: args.workerId,
      channel: "telegram",
      telegramChatId: args.chatId,
      telegramUserId: args.telegramUserId,
      title: `Telegram ${args.chatId}`,
    },
  });
  return created.id;
}

// ── Pairing flow handler (called for /pair <code>) ─────────────────────────
async function handlePairCommand(params: {
  chatId: number;
  telegramUserId?: string;
  text: string;
}): Promise<Response> {
  const code = params.text.replace(/^\/pair(@\w+)?\s*/i, "").trim().toLowerCase();
  if (!code) {
    await sendMessage({
      chatId: params.chatId,
      text:
        "Usage: <code>/pair &lt;code&gt;</code>\nGet your pairing code from the gym Settings &rarr; Telegram page.",
      parseMode: "HTML",
    });
    return OK();
  }
  // Single-instance: gymId fixed at 1 (we don't have a Gym model — instances
  // are physically separate deployments).
  const expected = derivePairingCode({ gymId: 1 });
  if (code !== expected.toLowerCase()) {
    await sendMessage({
      chatId: params.chatId,
      text: "\u274C Invalid pairing code. Codes rotate daily — check Settings &rarr; Telegram.",
    });
    return OK();
  }

  await setSetting("gym_owner_telegram_chat_id", String(params.chatId));
  if (params.telegramUserId) {
    await setSetting("gym_owner_telegram_user_id", params.telegramUserId);
  }
  await sendMessage({
    chatId: params.chatId,
    text:
      "\u2705 Paired successfully. You'll receive your morning briefing here, and you can ask me anything about the gym.",
  });
  // Audit
  await prisma.auditLog.create({
    data: {
      action: "telegram.pair",
      status: "success",
      actorId: null,
      actorType: "system",
      details: JSON.stringify({ chatId: params.chatId, userId: params.telegramUserId }),
    },
  }).catch(() => {});
  return OK();
}

// ── /start command handler (greeting + pair instructions) ──────────────────
async function handleStartCommand(chatId: number): Promise<Response> {
  const ownerChatId = await getOwnerChatId();
  if (ownerChatId === String(chatId)) {
    await sendMessage({
      chatId,
      text:
        "\u{1F44B} Welcome back! You're already paired. Send a message to chat with the gym AI, or just wait for the morning briefing.",
    });
  } else {
    await sendMessage({
      chatId,
      text:
        "\u{1F44B} Hi! To use this bot you need a pairing code from your TraqGym Settings &rarr; Telegram page, then send <code>/pair &lt;code&gt;</code>.",
      parseMode: "HTML",
    });
  }
  return OK();
}

// ── Process a (text or transcribed) message via the AI agent ───────────────
async function processAgentMessage(args: {
  chatId: number;
  text: string;
  telegramUserId?: string;
}): Promise<void> {
  const systemWorkerId = await resolveSystemWorkerId();
  if (systemWorkerId === null) {
    await sendMessage({
      chatId: args.chatId,
      text: "\u26A0\uFE0F No active admin worker available to attribute this action.",
    });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    await sendMessage({
      chatId: args.chatId,
      text:
        "\u26A0\uFE0F AI is not configured (OPENAI_API_KEY missing). I can still deliver briefings and run actions.",
    });
    return;
  }

  const conversationId = await findOrCreateTelegramConversation({
    chatId: String(args.chatId),
    telegramUserId: args.telegramUserId,
    workerId: systemWorkerId,
  });

  // PR 16 K.2 — detect language of incoming text and persist on the
  // conversation row. The morning-briefing runner reads this when the owner
  // selected `gym_owner_lang=auto`.
  const detected = detectLang(args.text);
  if (detected) {
    await prisma.aiConversation
      .update({
        where: { id: conversationId },
        data: { detectedLang: detected },
      })
      .catch((err) =>
        console.warn("[telegram-webhook] detectedLang update failed:", err)
      );
  }

  // Save user message.
  await prisma.aiMessage.create({
    data: { conversationId, role: "user", content: args.text },
  });

  // Build last-10-messages context window for continuity.
  const history = await prisma.aiMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  history.reverse();

  const inputItems: AgentInputItem[] = history.map((m) => {
    if (m.role === "user") {
      return { role: "user" as const, content: m.content };
    }
    return {
      role: "assistant" as const,
      status: "completed" as const,
      content: [{ type: "output_text" as const, text: m.content }],
    };
  });

  // Build agent context (admin role since this is the gym owner channel).
  const location = await prisma.location.findFirst({ where: { isActive: true } });
  const gymName =
    process.env.NEXT_PUBLIC_GYM_NAME || process.env.GYM_NAME || "TraqGym";
  const ownerName = (await getSetting("gym_owner_name", "Owner")).trim() || "Owner";
  const context: AgentContext = {
    gymName,
    locationName: location?.name || gymName,
    locationId: location?.id ?? null,
    workerName: `${ownerName} (Telegram)`,
    role: "admin",
    workerId: systemWorkerId,
  };

  const agent = createGymAgent(context);

  let output = "";
  try {
    await runInAiContext({ workerId: systemWorkerId, role: "admin" }, async () => {
      const result = await run(agent, inputItems);
      output = (result.finalOutput ?? "").toString();
    });
  } catch (err) {
    console.error("[telegram-webhook] agent run error:", err);
    output = "Sorry, the AI ran into an error. Try again or check logs.";
  }

  // Persist assistant message.
  await prisma.aiMessage.create({
    data: {
      conversationId,
      role: "assistant",
      content: output.slice(0, 16000),
    },
  });

  if (output.trim().length === 0) {
    output = "(no response)";
  }

  // PR 16 K.6 — if the agent emitted the AMBIGUOUS sentinel, intercept and
  // send a disambiguation prompt instead of the raw text.
  const amb = parseAmbiguousReply(output);
  if (amb) {
    await sendDisambiguationPrompt({ chatId: args.chatId, amb });
    return;
  }

  // HTML-escape so any < or & in the agent output doesn't break parse_mode.
  await sendMessage({
    chatId: args.chatId,
    text: escapeHtml(output).slice(0, 4000),
    parseMode: "HTML",
  });
}

// ── Callback query dispatcher (insight_action / snooze) ────────────────────
async function handleCallbackQuery(cq: TgCallbackQuery): Promise<Response> {
  // Always answer the callback first to dismiss the spinner.
  if (!cq.data) {
    await answerCallbackQuery({ callbackQueryId: cq.id, text: "Empty callback" });
    return OK();
  }

  // Owner gate (same as text messages).
  const ownerChatId = await getOwnerChatId();
  const fromChatId = cq.message?.chat.id;
  if (!fromChatId || (ownerChatId && String(fromChatId) !== ownerChatId)) {
    await answerCallbackQuery({
      callbackQueryId: cq.id,
      text: "Not authorized.",
      showAlert: true,
    });
    return OK();
  }

  let payload: { t?: string; i?: number; a?: number; h?: number };
  try {
    payload = JSON.parse(cq.data);
  } catch {
    await answerCallbackQuery({
      callbackQueryId: cq.id,
      text: "Malformed action.",
    });
    return OK();
  }

  const systemWorkerId = await resolveSystemWorkerId();
  if (systemWorkerId === null) {
    await answerCallbackQuery({
      callbackQueryId: cq.id,
      text: "No worker available to attribute action.",
      showAlert: true,
    });
    return OK();
  }

  if (payload.t === "insight_action" && typeof payload.i === "number") {
    const insightId = payload.i;
    const actionIndex = typeof payload.a === "number" ? payload.a : 0;

    // Replay protection: if already dismissed, just acknowledge.
    const insight = await prisma.insight.findUnique({
      where: { id: insightId },
      select: { id: true, title: true, dismissedAt: true },
    });
    if (!insight) {
      await answerCallbackQuery({
        callbackQueryId: cq.id,
        text: "Insight not found.",
      });
      return OK();
    }
    if (insight.dismissedAt) {
      await answerCallbackQuery({
        callbackQueryId: cq.id,
        text: "Already done.",
      });
      // Cross-channel sync: edit the original message text.
      if (cq.message) {
        await editMessageText({
          chatId: fromChatId,
          messageId: cq.message.message_id,
          text: `\u2705 <b>${escapeHtml(insight.title)}</b>\n<i>Already done</i>`,
          parseMode: "HTML",
        });
      }
      return OK();
    }

    const result = await executeInsightAction({
      insightId,
      actionIndex,
      executedById: systemWorkerId,
    });

    if (!result.success) {
      await answerCallbackQuery({
        callbackQueryId: cq.id,
        text: `Failed: ${result.error.slice(0, 180)}`,
        showAlert: true,
      });
      return OK();
    }

    // Dismiss insight (idempotency for future clicks across channels).
    await prisma.insight
      .update({
        where: { id: insightId },
        data: { dismissedAt: new Date(), dismissedById: systemWorkerId },
      })
      .catch(() => {});

    // Audit + cross-channel sync.
    await prisma.auditLog
      .create({
        data: {
          action: "telegram.insight_action.execute",
          status: "success",
          actorId: systemWorkerId,
          actorType: "worker",
          details: JSON.stringify({
            insightId,
            actionIndex,
            via: "telegram_callback",
          }),
        },
      })
      .catch(() => {});

    await answerCallbackQuery({
      callbackQueryId: cq.id,
      text: "Done \u2713",
    });

    if (cq.message) {
      await editMessageText({
        chatId: fromChatId,
        messageId: cq.message.message_id,
        text: `\u2705 <b>${escapeHtml(insight.title)}</b>\n<i>Done via Telegram</i>`,
        parseMode: "HTML",
      });
    }
    return OK();
  }

  if (payload.t === "snooze" && typeof payload.i === "number") {
    const insightId = payload.i;
    const hours = typeof payload.h === "number" ? payload.h : 168;
    const until = new Date(Date.now() + hours * 60 * 60 * 1000);
    const result = await snoozeInsight({
      insightId,
      until,
      snoozedById: systemWorkerId,
    });
    if (!result.success) {
      await answerCallbackQuery({
        callbackQueryId: cq.id,
        text: `Failed: ${result.error.slice(0, 180)}`,
        showAlert: true,
      });
      return OK();
    }
    const insight = await prisma.insight.findUnique({
      where: { id: insightId },
      select: { title: true },
    });
    await answerCallbackQuery({
      callbackQueryId: cq.id,
      text: `Snoozed for ${Math.round(hours / 24)}d`,
    });
    if (cq.message) {
      await editMessageText({
        chatId: fromChatId,
        messageId: cq.message.message_id,
        text: `\u23F8 <b>${escapeHtml(insight?.title ?? `Insight #${insightId}`)}</b>\n<i>Snoozed for ${Math.round(hours / 24)} day(s)</i>`,
        parseMode: "HTML",
      });
    }
    return OK();
  }

  // PR 16 K.6: cancel a pending disambiguation prompt — just close the
  // spinner and clear the message so the owner isn't stuck on it.
  if (payload.t === "amb_cancel") {
    await answerCallbackQuery({
      callbackQueryId: cq.id,
      text: "Cancelled",
    });
    if (cq.message) {
      await editMessageText({
        chatId: fromChatId,
        messageId: cq.message.message_id,
        text: "<i>Cancelled. Send a new message to try again.</i>",
        parseMode: "HTML",
      });
    }
    return OK();
  }

  await answerCallbackQuery({
    callbackQueryId: cq.id,
    text: "Unknown action.",
  });
  return OK();
}

// ── Process a voice note: download + Whisper + treat as text ───────────────
async function handleVoiceMessage(args: {
  chatId: number;
  voice: TgVoice;
  telegramUserId?: string;
}): Promise<void> {
  const fileInfo = await getFile({ fileId: args.voice.file_id });
  if (!fileInfo.success || !fileInfo.data.file_path) {
    await sendMessage({
      chatId: args.chatId,
      text: "\u26A0\uFE0F Couldn't fetch your voice note.",
    });
    return;
  }
  const buf = await downloadFile({ filePath: fileInfo.data.file_path });
  if (!buf.success) {
    await sendMessage({
      chatId: args.chatId,
      text: "\u26A0\uFE0F Couldn't download your voice note.",
    });
    return;
  }
  const tx = await transcribeVoice({ fileBuffer: buf.data, fileName: "voice.ogg" });
  if (!tx.success) {
    await sendMessage({ chatId: args.chatId, text: `\u26A0\uFE0F ${tx.error}` });
    return;
  }
  // Echo transcription so the user sees what we heard, then process.
  await sendMessage({
    chatId: args.chatId,
    text: `\u{1F3A4} <i>${escapeHtml(tx.text).slice(0, 500)}</i>`,
    parseMode: "HTML",
  });
  await processAgentMessage({
    chatId: args.chatId,
    text: tx.text,
    telegramUserId: args.telegramUserId,
  });
}

// ── Main POST handler ──────────────────────────────────────────────────────
export async function POST(request: Request) {
  // Webhook secret check.
  const presented = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  const expected =
    (await getSetting("telegram_webhook_secret", "")) ||
    process.env.TELEGRAM_WEBHOOK_SECRET ||
    "";
  if (expected && presented !== expected) {
    return Response.json({ ok: false, error: "bad_secret" }, { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  // ── Callback query (inline keyboard click) ───────────────────────────────
  if (update.callback_query) {
    return handleCallbackQuery(update.callback_query);
  }

  const msg = update.message;
  if (!msg) return OK();

  const chatId = msg.chat.id;
  const telegramUserId = msg.from?.id ? String(msg.from.id) : undefined;

  // ── /start ───────────────────────────────────────────────────────────────
  if (msg.text && /^\/start(@\w+)?\b/i.test(msg.text)) {
    return handleStartCommand(chatId);
  }

  // ── /pair <code> ─────────────────────────────────────────────────────────
  if (msg.text && /^\/pair(@\w+)?\b/i.test(msg.text)) {
    return handlePairCommand({
      chatId,
      telegramUserId,
      text: msg.text,
    });
  }

  // ── Owner gate for all other interactions ────────────────────────────────
  const ownerChatId = await getOwnerChatId();
  if (!ownerChatId || ownerChatId !== String(chatId)) {
    // Silently drop. Don't even acknowledge — discourages random scanning.
    console.log(
      `[telegram-webhook] ignoring message from unauthorized chatId=${chatId}`
    );
    return OK();
  }

  // ── PR 16 K.1: /snooze today ─────────────────────────────────────────────
  // Snoozes ALL active insights until tomorrow 06:00 IST. Only the paired
  // owner chat can use this (gated above).
  if (msg.text && /^\/snooze(@\w+)?\s+today\b/i.test(msg.text.trim())) {
    const systemWorkerId = await resolveSystemWorkerId();
    if (systemWorkerId === null) {
      await sendMessage({
        chatId,
        text: "\u26A0\uFE0F No active worker available to attribute the snooze.",
      });
      return OK();
    }
    try {
      const { count, until } = await snoozeAllUntilTomorrowMorning(systemWorkerId);
      const istUntil = until.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        day: "numeric",
        month: "short",
      });
      await sendMessage({
        chatId,
        text:
          count > 0
            ? `\u23F8 Snoozed <b>${count}</b> active insight${count === 1 ? "" : "s"} until <b>${escapeHtml(istUntil)}</b> IST.`
            : `\u2705 Nothing active to snooze right now.`,
        parseMode: "HTML",
      });
    } catch (err) {
      console.error("[telegram-webhook] snooze today error:", err);
      await sendMessage({
        chatId,
        text: "\u26A0\uFE0F Snooze failed. Try again or use the dashboard.",
      });
    }
    return OK();
  }

  // ── Voice message ────────────────────────────────────────────────────────
  if (msg.voice) {
    // Process asynchronously so we return 200 quickly.
    handleVoiceMessage({ chatId, voice: msg.voice, telegramUserId }).catch(
      (err) => console.error("[telegram-webhook] voice error:", err)
    );
    return OK();
  }

  // ── Plain text → AI agent ────────────────────────────────────────────────
  if (msg.text) {
    processAgentMessage({
      chatId,
      text: msg.text,
      telegramUserId,
    }).catch((err) => console.error("[telegram-webhook] agent error:", err));
    return OK();
  }

  // Unknown message type — ignore.
  return OK();
}
