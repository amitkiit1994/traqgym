import { NextRequest, NextResponse } from "next/server";
import { verifyQrToken } from "@/lib/services/qr-token";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // PR 14 audit fix: mirror the Origin/Host check from the sibling
  // submit route (app/api/checkin/qr/submit/route.ts). Without this,
  // a malicious cross-origin page could probe valid QR tokens and
  // exfiltrate the resulting location name. This is a read-only
  // endpoint, so a missing Origin header is tolerated (some legitimate
  // server-to-server / curl callers omit it); but if Origin IS sent,
  // it MUST match the Host header.
  const originHeader = req.headers.get("origin");
  const hostHeader = req.headers.get("host") ?? "";
  if (originHeader) {
    let originHost = "";
    try {
      originHost = new URL(originHeader).host;
    } catch {
      return NextResponse.json(
        { ok: false, reason: "invalid_origin" },
        { status: 403 },
      );
    }
    if (originHost !== hostHeader) {
      return NextResponse.json(
        { ok: false, reason: "cross_origin" },
        { status: 403 },
      );
    }
  }

  let body: { token?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  const result = verifyQrToken(token);

  if (!result.ok) {
    return NextResponse.json(result, {
      status: result.reason === "missing_secret" ? 500 : 400,
    });
  }

  const location = await prisma.location.findUnique({
    where: { id: result.locationId },
    select: { id: true, name: true, isActive: true },
  });

  if (!location || !location.isActive) {
    return NextResponse.json(
      { ok: false, reason: "invalid" },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    locationId: location.id,
    locationName: location.name,
    expiresAt: result.expiresAt,
  });
}
