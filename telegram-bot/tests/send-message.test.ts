import { describe, it, expect, vi } from "vitest";
import { chunkText, sendTelegramMessage, sendChatAction, withTypingIndicator } from "../src/telegram/send-message.js";

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

describe("sendChatAction", () => {
  it("POSTs sendChatAction with the right body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    await sendChatAction({ token: "TOK", chatId: 42, action: "typing", fetch: fetchMock });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/botTOK/sendChatAction",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ chat_id: 42, action: "typing" });
  });
  it("does not throw if fetch fails (best-effort)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(
      sendChatAction({ token: "TOK", chatId: 1, action: "typing", fetch: fetchMock }),
    ).resolves.toBeUndefined();
  });
});

describe("withTypingIndicator", () => {
  it("fires immediately and clears interval on resolve", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const result = await withTypingIndicator(
      "TOK", 1,
      async () => "done",
      fetchMock,
    );
    expect(result).toBe("done");
    // At least 1 immediate call before resolution.
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
  it("clears interval even when inner fn throws", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    await expect(
      withTypingIndicator("TOK", 1, async () => { throw new Error("boom"); }, fetchMock),
    ).rejects.toThrow("boom");
  });
});
