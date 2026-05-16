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
      throw new Error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
    }
  }
}
