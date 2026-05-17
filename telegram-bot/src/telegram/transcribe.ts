/**
 * Voice-note → text using OpenAI Whisper. The Agents SDK doesn't expose
 * Whisper, so we call openai client directly. Cost: ~$0.006/min audio.
 */

import OpenAI from "openai";
import { toFile } from "openai/uploads";
import type { DownloadedFile } from "./get-file.js";

export interface TranscribeInput {
  apiKey: string;
  file: DownloadedFile;
  model?: string;   // default whisper-1
}

export async function transcribeAudio(input: TranscribeInput): Promise<string> {
  const client = new OpenAI({ apiKey: input.apiKey });
  const filename = input.file.filePath.split("/").pop() ?? "audio.ogg";
  const upload = await toFile(input.file.bytes, filename, {
    type: input.file.mimeType ?? "audio/ogg",
  });
  const result = await client.audio.transcriptions.create({
    file: upload,
    model: input.model ?? "whisper-1",
  });
  return result.text.trim();
}
