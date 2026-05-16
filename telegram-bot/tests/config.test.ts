import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const validEnv = {
    TELEGRAM_BOT_TOKEN: "tok",
    TELEGRAM_ALLOWED_CHAT_IDS: "123,456",
    WEBHOOK_SECRET: "secret",
    GOOGLE_API_KEY: "ai-key",
    BLOB_READ_WRITE_TOKEN: "blob-tok",
    BLOB_LATEST_URL: "https://example.com/csv/latest.json",
  };

  it("parses comma-separated chat IDs into number set", () => {
    const cfg = loadConfig(validEnv);
    expect(cfg.allowedChatIds.has(123)).toBe(true);
    expect(cfg.allowedChatIds.has(456)).toBe(true);
    expect(cfg.allowedChatIds.size).toBe(2);
  });

  it("defaults GEMINI_MODEL to gemini-2.5-flash", () => {
    const cfg = loadConfig(validEnv);
    expect(cfg.geminiModel).toBe("gemini-2.5-flash");
  });

  it("respects GEMINI_MODEL override", () => {
    const cfg = loadConfig({ ...validEnv, GEMINI_MODEL: "gemini-2.5-pro" });
    expect(cfg.geminiModel).toBe("gemini-2.5-pro");
  });

  it("throws if TELEGRAM_BOT_TOKEN missing", () => {
    const { TELEGRAM_BOT_TOKEN, ...env } = validEnv;
    expect(() => loadConfig(env)).toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it("throws if BLOB_LATEST_URL is not a URL", () => {
    expect(() => loadConfig({ ...validEnv, BLOB_LATEST_URL: "not a url" }))
      .toThrow(/BLOB_LATEST_URL/);
  });

  it("throws on non-numeric chat ID", () => {
    expect(() => loadConfig({ ...validEnv, TELEGRAM_ALLOWED_CHAT_IDS: "abc,123" }))
      .toThrow(/TELEGRAM_ALLOWED_CHAT_IDS/);
  });
});
