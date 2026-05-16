import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";

describe("crypto service", () => {
  beforeAll(() => {
    // Deterministic test key (32 bytes base64)
    process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  });

  it("round-trips a plaintext string", async () => {
    const { encrypt, decrypt } = await import("@/lib/services/crypto");
    const plaintext = "Robin@FFF2026";
    const ciphertext = encrypt(plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext).toMatch(/^enc:v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it("produces different ciphertext for same plaintext (random IV)", async () => {
    const { encrypt } = await import("@/lib/services/crypto");
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
  });

  it("isEncrypted detects ciphertext", async () => {
    const { encrypt, isEncrypted } = await import("@/lib/services/crypto");
    expect(isEncrypted("plaintext")).toBe(false);
    expect(isEncrypted("")).toBe(false);
    expect(isEncrypted(encrypt("foo"))).toBe(true);
  });

  it("decrypt throws on tampered ciphertext", async () => {
    const { encrypt, decrypt } = await import("@/lib/services/crypto");
    const ct = encrypt("secret");
    const tampered = ct.slice(0, -2) + "00";
    expect(() => decrypt(tampered)).toThrow();
  });

  it("throws clear error if DATA_ENCRYPTION_KEY missing", async () => {
    delete process.env.DATA_ENCRYPTION_KEY;
    // Reset module cache so loadKey runs again
    const mod = await import("@/lib/services/crypto?bust=" + Date.now());
    expect(() => mod.encrypt("x")).toThrow(/DATA_ENCRYPTION_KEY/);
    // Restore for other tests
    process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  });
});
