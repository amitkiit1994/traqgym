/**
 * Telegram Bot API file-download helper.
 *
 * Telegram returns file references as `file_id`. To get the bytes you must
 * first call getFile({file_id}) to obtain a `file_path`, then GET
 * `https://api.telegram.org/file/bot<TOKEN>/<file_path>`.
 *
 * File URLs are temporary (~1 hour) — download to bytes immediately.
 */

export interface GetFileInput {
  token: string;
  fileId: string;
  fetch?: typeof fetch;
}

export interface DownloadedFile {
  bytes: Uint8Array;
  filePath: string;     // server-side path Telegram returned
  mimeType?: string;
  sizeBytes: number;
}

export async function downloadTelegramFile(input: GetFileInput): Promise<DownloadedFile> {
  const fetcher = input.fetch ?? globalThis.fetch;
  const infoRes = await fetcher(
    `https://api.telegram.org/bot${input.token}/getFile?file_id=${encodeURIComponent(input.fileId)}`,
  );
  if (!infoRes.ok) {
    throw new Error(`Telegram getFile failed: ${infoRes.status}`);
  }
  const info = (await infoRes.json()) as { ok: boolean; result?: { file_path?: string } };
  const filePath = info.result?.file_path;
  if (!info.ok || !filePath) {
    throw new Error(`Telegram getFile: no file_path returned for ${input.fileId}`);
  }
  const fileRes = await fetcher(`https://api.telegram.org/file/bot${input.token}/${filePath}`);
  if (!fileRes.ok) {
    throw new Error(`Telegram file download failed: ${fileRes.status}`);
  }
  const buf = new Uint8Array(await fileRes.arrayBuffer());
  return {
    bytes: buf,
    filePath,
    mimeType: fileRes.headers.get("content-type") ?? undefined,
    sizeBytes: buf.byteLength,
  };
}

/**
 * Convert downloaded bytes to a data URL the OpenAI Responses API can read
 * inline as an image — no public hosting needed.
 */
export function toDataUrl(file: DownloadedFile, mimeOverride?: string): string {
  const mime = mimeOverride ?? file.mimeType ?? "application/octet-stream";
  const b64 = Buffer.from(file.bytes).toString("base64");
  return `data:${mime};base64,${b64}`;
}
