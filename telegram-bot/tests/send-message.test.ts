import { describe, it, expect, vi } from "vitest";
import { chunkText, sendTelegramMessage } from "../src/telegram/send-message.js";

describe("chunkText", () => {
  it("returns single chunk for short text", () => {
    expect(chunkText("hi", 3500)).toEqual(["hi"]);
  });
  it("splits long text into chunks", () => {
    const s = "x".repeat(7000);
    const chunks = chunkText(s, 3500);
    expect(chunks.length).toBe(2);
    expect(chunks.every(c => c.length <= 3500)).toBe(true);
  });
  it("splits on paragraph boundary when possible", () => {
    const s = "para1\n\n" + "x".repeat(3490) + "\n\npara3";
    const chunks = chunkText(s, 3500);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]!.startsWith("para1")).toBe(true);
  });
});

describe("sendTelegramMessage", () => {
  it("POSTs to sendMessage URL with token + chat id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    await sendTelegramMessage({
      token: "TOKEN", chatId: 42, text: "hello", fetch: fetchMock,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/botTOKEN/sendMessage",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ chat_id: 42, text: "hello" });
  });
  it("sends multiple messages when text > limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    await sendTelegramMessage({
      token: "TOK", chatId: 1, text: "x".repeat(7000), fetch: fetchMock,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
