/**
 * Webhook handler integration: exercises the full request → response path
 * with mocked OpenAI + Telegram so no live messages get sent and no
 * tokens get spent. Covers the failure modes the silent-failure-hunter
 * flagged across the audit loop.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";

// Stub env BEFORE the handler imports loadConfig.
const ORIGINAL_ENV = { ...process.env };
beforeAll(() => {
  process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";
  process.env.TELEGRAM_ALLOWED_CHAT_IDS = "100,200";
  process.env.WEBHOOK_SECRET = "test-webhook-secret";
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.BLOB_READ_WRITE_TOKEN = "blob-rw-test";
  process.env.BLOB_BASE_URL = "https://pp7z5lebia3tfhxs.public.blob.vercel-storage.com";
});
afterAll(() => { process.env = ORIGINAL_ENV; });

// Mock the modules with side effects (Telegram + OpenAI). The webhook
// will exercise EVERYTHING up to those boundaries.
const sentMessages: { chatId: number; text: string }[] = [];
vi.mock("../../src/telegram/send-message.js", async () => {
  const actual = await vi.importActual<any>("../../src/telegram/send-message.js");
  return {
    ...actual,
    sendTelegramMessage: vi.fn(async ({ chatId, text }: { chatId: number; text: string }) => {
      sentMessages.push({ chatId, text });
    }),
    withTypingIndicator: async <T>(_t: string, _c: number, fn: () => Promise<T>) => fn(),
  };
});
vi.mock("../../src/llm.js", () => ({
  runLlm: vi.fn(async (_input: any) => ({
    text: "stub LLM answer",
    toolCalls: 1,
    snapshotDates: { freeform: "2026-05-18", egym: "2026-05-18" },
    history: [],
  })),
}));
vi.mock("@vercel/blob", () => ({
  put: vi.fn().mockResolvedValue({ url: "https://blob.example/allowlist.json" }),
}));

const handler = (await import("../../api/webhook.js")).default;

function mockReqRes(opts: {
  method?: string;
  secret?: string | undefined;
  body?: any;
}) {
  const req: any = {
    method: opts.method ?? "POST",
    headers: opts.secret !== undefined
      ? { "x-telegram-bot-api-secret-token": opts.secret }
      : {},
    body: opts.body ?? {},
  };
  let status = 0;
  const res: any = {
    status(s: number) { status = s; return res; },
    end() {},
    json(_v: any) {},
  };
  return { req, res, getStatus: () => status };
}

beforeEach(() => { sentMessages.length = 0; });

describe("webhook: method + auth gate", () => {
  it("rejects GET with 405", async () => {
    const { req, res, getStatus } = mockReqRes({ method: "GET" });
    await handler(req, res);
    expect(getStatus()).toBe(405);
  });

  it("rejects missing secret with 401", async () => {
    const { req, res, getStatus } = mockReqRes({});
    await handler(req, res);
    expect(getStatus()).toBe(401);
  });

  it("rejects wrong secret with 401", async () => {
    const { req, res, getStatus } = mockReqRes({ secret: "wrong" });
    await handler(req, res);
    expect(getStatus()).toBe(401);
  });

  it("accepts correct secret + empty body with 200 (no message to ignore)", async () => {
    const { req, res, getStatus } = mockReqRes({ secret: "test-webhook-secret", body: {} });
    await handler(req, res);
    expect(getStatus()).toBe(200);
    expect(sentMessages).toEqual([]);
  });
});

describe("webhook: update_id idempotency (round-1 fix)", () => {
  it("processes update once, drops the duplicate", async () => {
    const update = {
      update_id: 999_111,
      message: {
        chat: { id: 100, type: "private" },
        from: { first_name: "Robin" },
        text: "/ping",
      },
    };
    const r1 = mockReqRes({ secret: "test-webhook-secret", body: update });
    await handler(r1.req, r1.res);
    expect(r1.getStatus()).toBe(200);
    expect(sentMessages.length).toBeGreaterThanOrEqual(1);
    const firstCount = sentMessages.length;

    const r2 = mockReqRes({ secret: "test-webhook-secret", body: update });
    await handler(r2.req, r2.res);
    expect(r2.getStatus()).toBe(200);
    expect(sentMessages.length).toBe(firstCount); // no additional sends
  });
});

describe("webhook: authorization (env owner vs unauthorized)", () => {
  it("env owner can ask questions", async () => {
    const { req, res, getStatus } = mockReqRes({
      secret: "test-webhook-secret",
      body: {
        update_id: Date.now() + 1,
        message: {
          chat: { id: 100, type: "private" },
          from: { first_name: "Robin" },
          text: "how much last month?",
        },
      },
    });
    await handler(req, res);
    expect(getStatus()).toBe(200);
    expect(sentMessages.some(m => m.chatId === 100)).toBe(true);
    expect(sentMessages.some(m => m.text.includes("stub LLM answer"))).toBe(true);
  });

  it("unauthorized chat gets clear NOT-AUTHORIZED message with their chat id", async () => {
    const { req, res, getStatus } = mockReqRes({
      secret: "test-webhook-secret",
      body: {
        update_id: Date.now() + 2,
        message: {
          chat: { id: 7777, type: "private" },
          from: { first_name: "Stranger" },
          text: "hi",
        },
      },
    });
    await handler(req, res);
    expect(getStatus()).toBe(200);
    const msg = sentMessages.find(m => m.chatId === 7777);
    expect(msg).toBeDefined();
    expect(msg!.text).toContain("Not authorized");
    expect(msg!.text).toContain("7777");
  });
});

describe("webhook: ignores non-message updates without doing anything", () => {
  it("update with no message → 200, no Telegram calls", async () => {
    const { req, res, getStatus } = mockReqRes({
      secret: "test-webhook-secret",
      body: { update_id: Date.now() + 3 /* no message field */ },
    });
    await handler(req, res);
    expect(getStatus()).toBe(200);
    expect(sentMessages).toEqual([]);
  });

  it("message with no text/voice/photo → 200, no Telegram calls", async () => {
    const { req, res, getStatus } = mockReqRes({
      secret: "test-webhook-secret",
      body: {
        update_id: Date.now() + 4,
        message: {
          chat: { id: 100, type: "private" },
          from: { first_name: "Robin" },
          document: { file_id: "x" },
        },
      },
    });
    await handler(req, res);
    expect(getStatus()).toBe(200);
    expect(sentMessages).toEqual([]);
  });
});

describe("webhook: /reset clears history and responds", () => {
  it("/reset → clears, replies 'Cleared'", async () => {
    const { req, res, getStatus } = mockReqRes({
      secret: "test-webhook-secret",
      body: {
        update_id: Date.now() + 5,
        message: {
          chat: { id: 100, type: "private" },
          from: { first_name: "Robin" },
          text: "/reset",
        },
      },
    });
    await handler(req, res);
    expect(getStatus()).toBe(200);
    expect(sentMessages.some(m => m.text.toLowerCase().includes("cleared"))).toBe(true);
  });
});

describe("webhook: auto-retries on gpt-5 reasoning-pairing crash", () => {
  // Round-5 regression: when the LLM call throws the "message ↔ reasoning"
  // 400, the handler must wipe history and retry once silently so the
  // owner gets an answer, not a scary "lost the thread" message.
  it("first call throws reasoning-pairing 400 → second call (empty history) succeeds", async () => {
    const llmMod: any = await import("../../src/llm.js");
    llmMod.runLlm.mockReset();
    const reasoningErr = new Error(
      "400 Item 'msg_091c7b53e90b933e006a0b69b9632c81909d6ab23f7e302740' of type 'message' was provided without its required 'reasoning' item: 'rs_091c7b53e90b933e006a0b69b1d404819096e9fd6a415bc7ea'",
    );
    llmMod.runLlm
      .mockImplementationOnce(async () => { throw reasoningErr; })
      .mockImplementationOnce(async () => ({
        text: "retry answer",
        toolCalls: 1,
        snapshotDates: {},
        history: [],
      }));
    const { req, res, getStatus } = mockReqRes({
      secret: "test-webhook-secret",
      body: {
        update_id: Date.now() + 10,
        message: {
          chat: { id: 100, type: "private" },
          from: { first_name: "Robin" },
          text: "what's the april number?",
        },
      },
    });
    await handler(req, res);
    expect(getStatus()).toBe(200);
    // User sees the retry answer, NOT the "lost the thread" message.
    expect(sentMessages.some(m => m.text === "retry answer")).toBe(true);
    expect(sentMessages.some(m => m.text.includes("Lost the conversation"))).toBe(false);
    // runLlm called twice: original (failed) + retry with empty history.
    expect(llmMod.runLlm).toHaveBeenCalledTimes(2);
    const retryCall = llmMod.runLlm.mock.calls[1][0];
    expect(retryCall.history).toEqual([]);
  });

  it("when even the retry fails, falls through to the named user-facing error", async () => {
    const llmMod: any = await import("../../src/llm.js");
    llmMod.runLlm.mockReset();
    const reasoningErr = new Error(
      "Item 'msg_xxx' was provided without its required 'reasoning' item: 'rs_yyy'",
    );
    llmMod.runLlm
      .mockImplementationOnce(async () => { throw reasoningErr; })
      .mockImplementationOnce(async () => { throw reasoningErr; });
    const { req, res, getStatus } = mockReqRes({
      secret: "test-webhook-secret",
      body: {
        update_id: Date.now() + 11,
        message: {
          chat: { id: 100, type: "private" },
          from: { first_name: "Robin" },
          text: "another question",
        },
      },
    });
    await handler(req, res);
    expect(getStatus()).toBe(200);
    // User sees the friendly memory-cleared message — not the raw "msg_..."
    // OpenAI error.
    const sent = sentMessages[sentMessages.length - 1]!;
    expect(sent.text).toContain("Lost the conversation");
    expect(sent.text).not.toContain("msg_");
    expect(sent.text).not.toContain("rs_");
  });
});

describe("webhook: ping always returns pong", () => {
  it("/ping from authorized owner returns pong", async () => {
    const { req, res } = mockReqRes({
      secret: "test-webhook-secret",
      body: {
        update_id: Date.now() + 6,
        message: {
          chat: { id: 200, type: "private" },
          from: { first_name: "Robin" },
          text: "/ping",
        },
      },
    });
    await handler(req, res);
    expect(sentMessages.some(m => m.text === "pong")).toBe(true);
  });
});
