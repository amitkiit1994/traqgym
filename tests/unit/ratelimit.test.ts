import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { rateLimit, _resetRateLimits, getRequestIp } from "@/lib/services/ratelimit";

describe("rateLimit", () => {
  beforeEach(() => {
    _resetRateLimits();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the limit", () => {
    const key = "user:1";
    for (let i = 0; i < 4; i++) {
      const r = rateLimit({ key, limit: 5, windowMs: 60_000 });
      expect(r.ok).toBe(true);
    }
    // 5th request still allowed (limit = 5)
    const r5 = rateLimit({ key, limit: 5, windowMs: 60_000 });
    expect(r5.ok).toBe(true);
    expect(r5.remaining).toBe(0);
  });

  it("blocks once the limit is reached", () => {
    const key = "user:2";
    for (let i = 0; i < 5; i++) {
      const r = rateLimit({ key, limit: 5, windowMs: 60_000 });
      expect(r.ok).toBe(true);
    }
    const blocked = rateLimit({ key, limit: 5, windowMs: 60_000 });
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    // And remains blocked on subsequent calls within the window
    const blockedAgain = rateLimit({ key, limit: 5, windowMs: 60_000 });
    expect(blockedAgain.ok).toBe(false);
  });

  it("resets after the window expires", () => {
    vi.useFakeTimers();
    const t0 = new Date("2026-05-17T00:00:00Z").getTime();
    vi.setSystemTime(t0);

    const key = "user:3";
    for (let i = 0; i < 5; i++) {
      rateLimit({ key, limit: 5, windowMs: 60_000 });
    }
    expect(rateLimit({ key, limit: 5, windowMs: 60_000 }).ok).toBe(false);

    // Advance past the window
    vi.setSystemTime(t0 + 61_000);
    const r = rateLimit({ key, limit: 5, windowMs: 60_000 });
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(4);
  });
});

describe("getRequestIp", () => {
  it("prefers the first entry of x-forwarded-for", () => {
    const req = new Request("https://example.com", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(getRequestIp(req)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip then cf-connecting-ip then unknown", () => {
    const req1 = new Request("https://example.com", {
      headers: { "x-real-ip": "9.9.9.9" },
    });
    expect(getRequestIp(req1)).toBe("9.9.9.9");

    const req2 = new Request("https://example.com", {
      headers: { "cf-connecting-ip": "8.8.8.8" },
    });
    expect(getRequestIp(req2)).toBe("8.8.8.8");

    const req3 = new Request("https://example.com");
    expect(getRequestIp(req3)).toBe("unknown");
  });
});
