import { createHmac, timingSafeEqual } from "crypto";

/**
 * QR token format:
 *   base64url(`${locationId}.${expiresAt}.${signatureHex}`)
 * where signature = HMAC-SHA256("${locationId}.${expiresAt}", QR_TOKEN_SECRET)
 *
 * Tokens carry no user identity. They prove only that the bearer is at
 * `locationId` and that the token has not expired. Authentication of the
 * member must still happen via session or phone+OTP at the check-in step.
 */

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(input: string): string | null {
  try {
    // Restore padding
    const pad = input.length % 4;
    const padded = pad === 0 ? input : input + "=".repeat(4 - pad);
    const std = padded.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(std, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function getSecret(): string | null {
  const secret = process.env.QR_TOKEN_SECRET;
  if (!secret || secret.trim().length === 0) return null;
  return secret;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function signQrToken(payload: { locationId: number; expiresAt: number }): string {
  const secret = getSecret();
  if (!secret) {
    throw new Error("QR_TOKEN_SECRET environment variable is not set");
  }
  if (!Number.isInteger(payload.locationId) || payload.locationId <= 0) {
    throw new Error("Invalid locationId");
  }
  if (!Number.isInteger(payload.expiresAt) || payload.expiresAt <= 0) {
    throw new Error("Invalid expiresAt");
  }
  const body = `${payload.locationId}.${payload.expiresAt}`;
  const sig = sign(body, secret);
  return base64UrlEncode(`${body}.${sig}`);
}

export type VerifyResult =
  | { ok: true; locationId: number; expiresAt: number }
  | { ok: false; reason: "invalid" | "expired" | "missing_secret" };

export function verifyQrToken(token: string, opts?: { ignoreExpiry?: boolean }): VerifyResult {
  const secret = getSecret();
  if (!secret) return { ok: false, reason: "missing_secret" };
  if (!token || typeof token !== "string") return { ok: false, reason: "invalid" };

  const decoded = base64UrlDecode(token);
  if (!decoded) return { ok: false, reason: "invalid" };

  const parts = decoded.split(".");
  if (parts.length !== 3) return { ok: false, reason: "invalid" };

  const [locStr, expStr, sigHex] = parts;
  const locationId = Number(locStr);
  const expiresAt = Number(expStr);
  if (!Number.isInteger(locationId) || locationId <= 0) return { ok: false, reason: "invalid" };
  if (!Number.isInteger(expiresAt) || expiresAt <= 0) return { ok: false, reason: "invalid" };

  const expected = sign(`${locationId}.${expiresAt}`, secret);
  // Constant-time compare. Lengths must match for timingSafeEqual.
  if (sigHex.length !== expected.length) return { ok: false, reason: "invalid" };
  const a = Buffer.from(sigHex, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || a.length === 0) return { ok: false, reason: "invalid" };
  if (!timingSafeEqual(a, b)) return { ok: false, reason: "invalid" };

  if (!opts?.ignoreExpiry && Date.now() > expiresAt) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, locationId, expiresAt };
}
