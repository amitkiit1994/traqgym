/**
 * Live production smoke test: hits the deployed bot HTTP endpoints.
 * Run after every deploy. Does NOT send actual Telegram messages or call
 * OpenAI — only verifies the auth + routing layer behaves correctly.
 */
import { describe, it, expect } from "vitest";

const PROD_URL = "https://freeform-telegram-bot.vercel.app";
const T = 30_000;

describe("prod smoke: webhook auth + routing", () => {
  it("GET /api/webhook → 405 Method Not Allowed", async () => {
    const r = await fetch(`${PROD_URL}/api/webhook`);
    expect(r.status).toBe(405);
  }, T);

  it("POST /api/webhook without secret → 401", async () => {
    const r = await fetch(`${PROD_URL}/api/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(401);
  }, T);

  it("POST /api/webhook with WRONG secret → 401", async () => {
    const r = await fetch(`${PROD_URL}/api/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "WRONG_SECRET_VALUE_THAT_SHOULD_NOT_MATCH",
      },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(401);
  }, T);

  it("POST /api/webhook with correct secret + empty body → 200 (acknowledges silently)", async () => {
    const secret = process.env.WEBHOOK_SECRET;
    if (!secret) {
      console.warn("skipping correct-secret test: WEBHOOK_SECRET not set in env");
      return;
    }
    const r = await fetch(`${PROD_URL}/api/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": secret,
      },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(200);
  }, T);
});

describe("prod smoke: digest endpoint auth", () => {
  it("GET /api/digest without auth → 401", async () => {
    const r = await fetch(`${PROD_URL}/api/digest`);
    expect(r.status).toBe(401);
  }, T);

  it("POST /api/digest with WRONG bearer → 401", async () => {
    const r = await fetch(`${PROD_URL}/api/digest`, {
      method: "POST",
      headers: { authorization: "Bearer WRONG_TOKEN" },
    });
    expect(r.status).toBe(401);
  }, T);

  it("PUT /api/digest → 405", async () => {
    const r = await fetch(`${PROD_URL}/api/digest`, { method: "PUT" });
    expect(r.status).toBe(405);
  }, T);
});

describe("prod smoke: blob is reachable", () => {
  it("FFF latest.json → 200 + valid JSON pointer", async () => {
    const r = await fetch("https://pp7z5lebia3tfhxs.public.blob.vercel-storage.com/csv/freeform/latest.json");
    expect(r.status).toBe(200);
    const json = await r.json() as { snapshot_date: string; blob_urls: Record<string, string> };
    expect(json.snapshot_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(json.blob_urls)).toContain("payments");
  }, T);

  it("EGYM latest.json → 200 + valid JSON pointer", async () => {
    const r = await fetch("https://pp7z5lebia3tfhxs.public.blob.vercel-storage.com/csv/egym/latest.json");
    expect(r.status).toBe(200);
    const json = await r.json() as { snapshot_date: string; blob_urls: Record<string, string> };
    expect(json.snapshot_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(json.blob_urls)).toContain("payments");
  }, T);
});
