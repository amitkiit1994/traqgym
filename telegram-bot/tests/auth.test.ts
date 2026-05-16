import { describe, it, expect } from "vitest";
import { isAllowed, checkSecretToken } from "../src/auth.js";
import { createRateLimiter } from "../src/rate-limit.js";

describe("isAllowed", () => {
  const allowed = new Set([1, 2]);
  it("permits ids in the set", () => { expect(isAllowed(1, allowed)).toBe(true); });
  it("rejects ids not in set", () => { expect(isAllowed(99, allowed)).toBe(false); });
});

describe("checkSecretToken", () => {
  it("passes when header matches", () => { expect(checkSecretToken("abc", "abc")).toBe(true); });
  it("fails when mismatch", () => { expect(checkSecretToken("abc", "xyz")).toBe(false); });
  it("fails when undefined", () => { expect(checkSecretToken(undefined, "abc")).toBe(false); });
});

describe("createRateLimiter", () => {
  it("allows first N calls", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
    expect(limiter.check(1)).toBe(true);
    expect(limiter.check(1)).toBe(true);
    expect(limiter.check(1)).toBe(true);
    expect(limiter.check(1)).toBe(false);
  });
  it("isolates per chat id", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
    expect(limiter.check(1)).toBe(true);
    expect(limiter.check(1)).toBe(false);
    expect(limiter.check(2)).toBe(true);
  });
  it("resets after window passes", async () => {
    const limiter = createRateLimiter({ windowMs: 50, max: 1 });
    expect(limiter.check(1)).toBe(true);
    expect(limiter.check(1)).toBe(false);
    await new Promise(r => setTimeout(r, 80));
    expect(limiter.check(1)).toBe(true);
  });
});
