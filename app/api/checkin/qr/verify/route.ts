import { NextRequest, NextResponse } from "next/server";
import { verifyQrToken } from "@/lib/services/qr-token";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
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
