import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

/**
 * Fail-fast guard for INTERNAL_API_SECRET in production — same pattern as
 * NEXTAUTH_SECRET in lib/auth.ts. Throws at module-import time so the
 * deployment refuses to boot rather than silently exposing the v3-sync
 * endpoints with no auth (or with the .env.example placeholder).
 *
 * The internal API endpoints (/api/internal/v3-credentials, /api/internal/v3-sync)
 * return + accept secret data and are called by an off-host GitHub Action.
 * They use Bearer auth in lieu of a session.
 */
if (process.env.NODE_ENV === "production") {
  const secret = process.env.INTERNAL_API_SECRET ?? "";
  if (!secret) {
    throw new Error(
      "INTERNAL_API_SECRET is required in production. Generate one with `openssl rand -base64 32` and set it in your Vercel project's env vars."
    );
  }
  if (secret.toLowerCase().includes("change-me") || secret.length < 32) {
    throw new Error(
      "INTERNAL_API_SECRET appears to be the .env.example placeholder or too short. Generate a real secret with `openssl rand -base64 32`."
    );
  }
}

/**
 * Validates an incoming internal-API request's Authorization: Bearer header.
 * Returns null on success, an unauthorised JSON response otherwise.
 *
 * Uses timing-safe comparison to defeat timing side-channels.
 */
export function requireInternalSecret(req: NextRequest): NextResponse | null {
  // .trim() defends against trailing whitespace/newlines in env var value.
  // `echo "$X" | vercel env add` adds a trailing \n, baking it into the stored
  // secret. The header value is also trimmed for symmetry.
  const expected = process.env.INTERNAL_API_SECRET?.trim();
  if (!expected) {
    return NextResponse.json({ error: "INTERNAL_API_SECRET not configured" }, { status: 503 });
  }
  const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!provided) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
