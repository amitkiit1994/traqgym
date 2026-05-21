/**
 * Voice-note → English text using OpenAI Whisper's translations endpoint.
 * `translations` always returns English regardless of spoken language —
 * this is the authoritative fix for the LLM mirroring Hindi/Devanagari
 * back to the operator. Cost: ~$0.006/min audio.
 */

import OpenAI from "openai";
import { toFile } from "openai/uploads";
import type { DownloadedFile } from "./get-file.js";

export interface TranscribeInput {
  apiKey: string;
  file: DownloadedFile;
  // The translations endpoint only supports whisper-1; the gpt-4o
  // transcribe models do NOT accept translation requests. Narrow the
  // type so a caller can't accidentally pass an unsupported model and
  // hit a 400 at runtime.
  model?: "whisper-1";
}

export async function transcribeAudio(input: TranscribeInput): Promise<string> {
  const client = new OpenAI({ apiKey: input.apiKey });
  const filename = input.file.filePath.split("/").pop() ?? "audio.ogg";
  const upload = await toFile(input.file.bytes, filename, {
    type: input.file.mimeType ?? "audio/ogg",
  });
  const result = await client.audio.translations.create({
    file: upload,
    model: input.model ?? "whisper-1",
  });
  return result.text.trim();
}
