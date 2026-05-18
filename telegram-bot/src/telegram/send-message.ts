import { redactSecrets } from "../redact.js";

export const TELEGRAM_MAX_MESSAGE = 3500;

export function chunkText(text: string, max = TELEGRAM_MAX_MESSAGE): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < 200) cut = rest.lastIndexOf("\n", max);
    if (cut < 200) cut = rest.lastIndexOf(" ", max);
    if (cut < 200) cut = max;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) out.push(rest);
  return out;
}

export interface SendMessageInput {
  token: string;
  chatId: number;
  text: string;
  fetch?: typeof fetch;
}

export interface SendChatActionInput {
  token: string;
  chatId: number;
  action: "typing" | "upload_document";
  fetch?: typeof fetch;
}

/**
 * Tells Telegram to show a "typing..." indicator in the chat. Lasts ~5 seconds
 * client-side, so for longer waits call again every 4s.
 */
export async function sendChatAction(input: SendChatActionInput): Promise<void> {
  const fetcher = input.fetch ?? globalThis.fetch;
  const url = `https://api.telegram.org/bot${input.token}/sendChatAction`;
  // Best-effort: never throw — typing is cosmetic, not critical.
  try {
    await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: input.chatId, action: input.action }),
    });
  } catch {
    // ignore
  }
}

/**
 * Wrap an async operation with a periodic "typing..." indicator. Fires
 * immediately and then every 4s until the inner promise resolves/rejects.
 */
export async function withTypingIndicator<T>(
  token: string,
  chatId: number,
  fn: () => Promise<T>,
  fetcher?: typeof fetch,
): Promise<T> {
  const ping = () => sendChatAction({ token, chatId, action: "typing", fetch: fetcher });
  // Fire-and-forget the first ping. .catch suppresses any rejection so it
  // can't surface as an unhandled-rejection warning when the function
  // context tears down before the inflight request resolves.
  void ping().catch(() => {});
  const interval = setInterval(ping, 4000);
  try {
    return await fn();
  } finally {
    clearInterval(interval);
  }
}

export async function sendTelegramMessage(input: SendMessageInput): Promise<void> {
  const fetcher = input.fetch ?? globalThis.fetch;
  const url = `https://api.telegram.org/bot${input.token}/sendMessage`;
  const chunks = chunkText(input.text);
  for (const chunk of chunks) {
    const res = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: input.chatId, text: chunk }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Telegram sendMessage failed: ${res.status} ${redactSecrets(body).slice(0, 200)}`,
      );
    }
  }
}
