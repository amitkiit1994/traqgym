import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

export function requireCronSecret(req: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  // Vercel cron sends as ?secret=... or Authorization: Bearer <secret>
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("secret") ?? "";
  const fromHeader = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const provided = fromQuery || fromHeader;
  if (!provided) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
