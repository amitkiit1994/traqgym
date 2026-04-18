/**
 * Telegram Bot API channel — outbound message helpers + inbound utilities.
 *
 * All functions use a single global bot (configured via TELEGRAM_BOT_TOKEN env)
 * and call the HTTPS API directly via `fetch` — no SDK, no extra dependency.
 *
 * Design rules:
 *   - Never throw to the caller; always return a `{success, ...}` shape.
 *   - When the bot token is unset, every call gracefully no-ops with
 *     `{success:false, error:"no_token"}`. This keeps build/dev safe.
 *   - HTML parse_mode is preferred over MarkdownV2 (escaping rules in MarkdownV2
 *     are very finicky — HTML only requires escaping `<`, `>`, `&`).
 *   - Whisper voice transcription is opt-in via WHISPER_API_KEY; if missing the
 *     caller is told to set it.
 */

const TG_BASE = "https://api.telegram.org";

function token(): string | null {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  return t && t.length > 0 ? t : null;
}

type ApiResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };

async function callTelegram<T = unknown>(
  method: string,
  body: Record<string, unknown>
): Promise<ApiResult<T>> {
  const t = token();
  if (!t) {
    return { success: false, error: "no_token" };
  }
  try {
    const res = await fetch(`${TG_BASE}/bot${t}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: T;
      description?: string;
      error_code?: number;
    };
    if (!res.ok || json.ok === false) {
      const desc = json.description || `HTTP ${res.status}`;
      console.warn(`[telegram] ${method} failed:`, desc);
      return { success: false, error: desc };
    }
    return { success: true, data: json.result as T };
  } catch (err) {
    console.error(`[telegram] ${method} error:`, err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Inline keyboard typing ────────────────────────────────────────────────

export type InlineKeyboardButton = {
  text: string;
  /** JSON-encoded payload (we choose the shape — see webhook handler). */
  callback_data?: string;
  url?: string;
};

export type InlineKeyboardMarkup = {
  inline_keyboard: InlineKeyboardButton[][];
};

// ─── Outbound: sendMessage ─────────────────────────────────────────────────

export type SendMessageParams = {
  chatId: string | number;
  text: string;
  parseMode?: "HTML" | "MarkdownV2" | "Markdown";
  replyMarkup?: InlineKeyboardMarkup;
  disableWebPagePreview?: boolean;
};

export type SentMessage = {
  message_id: number;
  chat: { id: number };
  date: number;
  text?: string;
};

export async function sendMessage(
  params: SendMessageParams
): Promise<ApiResult<SentMessage>> {
  return callTelegram<SentMessage>("sendMessage", {
    chat_id: params.chatId,
    text: params.text,
    parse_mode: params.parseMode ?? "HTML",
    reply_markup: params.replyMarkup,
    disable_web_page_preview: params.disableWebPagePreview ?? true,
  });
}

export async function sendMessageWithButtons(params: {
  chatId: string | number;
  text: string;
  /** Each row is an array of buttons. */
  buttons: Array<Array<{ text: string; callback_data: string }>>;
  parseMode?: "HTML" | "MarkdownV2" | "Markdown";
}): Promise<ApiResult<SentMessage>> {
  return sendMessage({
    chatId: params.chatId,
    text: params.text,
    parseMode: params.parseMode ?? "HTML",
    replyMarkup: { inline_keyboard: params.buttons },
  });
}

// ─── Outbound: editMessageText (used for cross-channel sync) ───────────────

export async function editMessageText(params: {
  chatId: string | number;
  messageId: number;
  text: string;
  parseMode?: "HTML" | "MarkdownV2" | "Markdown";
  replyMarkup?: InlineKeyboardMarkup;
}): Promise<ApiResult<SentMessage>> {
  return callTelegram<SentMessage>("editMessageText", {
    chat_id: params.chatId,
    message_id: params.messageId,
    text: params.text,
    parse_mode: params.parseMode ?? "HTML",
    reply_markup: params.replyMarkup,
  });
}

// ─── answerCallbackQuery (dismisses Telegram client spinner) ───────────────

export async function answerCallbackQuery(params: {
  callbackQueryId: string;
  text?: string;
  showAlert?: boolean;
}): Promise<ApiResult<true>> {
  return callTelegram<true>("answerCallbackQuery", {
    callback_query_id: params.callbackQueryId,
    text: params.text,
    show_alert: params.showAlert ?? false,
  });
}

// ─── getFile + downloadFile (for voice transcription) ──────────────────────

type TgFile = {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
};

export async function getFile(params: {
  fileId: string;
}): Promise<ApiResult<TgFile>> {
  return callTelegram<TgFile>("getFile", { file_id: params.fileId });
}

export async function downloadFile(params: {
  filePath: string;
}): Promise<ApiResult<Buffer>> {
  const t = token();
  if (!t) return { success: false, error: "no_token" };
  try {
    const url = `${TG_BASE}/file/bot${t}/${params.filePath}`;
    const res = await fetch(url);
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` };
    }
    const ab = await res.arrayBuffer();
    return { success: true, data: Buffer.from(ab) };
  } catch (err) {
    console.error("[telegram] downloadFile error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Webhook setup helper (admin-only one-time) ────────────────────────────

export async function setWebhook(params: {
  url: string;
  secretToken?: string;
  allowedUpdates?: string[];
}): Promise<ApiResult<true>> {
  return callTelegram<true>("setWebhook", {
    url: params.url,
    secret_token: params.secretToken,
    allowed_updates: params.allowedUpdates ?? ["message", "callback_query"],
    drop_pending_updates: false,
  });
}

export async function deleteWebhook(): Promise<ApiResult<true>> {
  return callTelegram<true>("deleteWebhook", { drop_pending_updates: false });
}

export async function getWebhookInfo(): Promise<ApiResult<unknown>> {
  return callTelegram<unknown>("getWebhookInfo", {});
}

// ─── Voice transcription via OpenAI Whisper ────────────────────────────────

/**
 * Transcribe an audio buffer (Telegram voice notes are OGG/Opus) using
 * OpenAI's Whisper endpoint. Falls back to a plain message when the API key
 * is missing.
 *
 * Returns the transcript as a string, or an error message that's safe to send
 * back to the user.
 */
export async function transcribeVoice(params: {
  fileBuffer: Buffer;
  fileName?: string;
  /** ISO 639-1 language hint (optional). */
  lang?: string;
}): Promise<{ success: true; text: string } | { success: false; error: string }> {
  const apiKey = process.env.WHISPER_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      error:
        "Voice notes require WHISPER_API_KEY (or OPENAI_API_KEY) to be configured on the server.",
    };
  }
  try {
    const fileName = params.fileName ?? "voice.ogg";
    const blob = new Blob([new Uint8Array(params.fileBuffer)], { type: "audio/ogg" });
    const form = new FormData();
    form.append("file", blob, fileName);
    form.append("model", process.env.WHISPER_MODEL || "whisper-1");
    if (params.lang) form.append("language", params.lang);

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn("[telegram] whisper failed:", res.status, errText);
      return { success: false, error: `Whisper HTTP ${res.status}` };
    }
    const data = (await res.json()) as { text?: string };
    if (!data.text) return { success: false, error: "Whisper returned no text" };
    return { success: true, text: data.text };
  } catch (err) {
    console.error("[telegram] whisper error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Whisper call failed",
    };
  }
}

// ─── Helpers for HTML escaping ─────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─── Pairing-code derivation (stable per day, unguessable) ─────────────────
import crypto from "node:crypto";

/**
 * Derive a per-day pairing code for a gym. Stable for a given day, rotates
 * automatically at midnight UTC, unguessable without NEXTAUTH_SECRET.
 *
 * For single-gym deployments (which is how TraqGym instances run), the gymId
 * is just `1` — but we keep the parameter so multi-tenant variants work too.
 */
export function derivePairingCode(args: {
  gymId: number | string;
  date?: Date;
}): string {
  const date = args.date ?? new Date();
  const day = date.toISOString().slice(0, 10); // YYYY-MM-DD
  const secret =
    process.env.MANAGER_ACTION_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "telegram-pairing-fallback";
  return crypto
    .createHmac("sha256", secret)
    .update(`pair:${args.gymId}:${day}`)
    .digest("hex")
    .slice(0, 8);
}
