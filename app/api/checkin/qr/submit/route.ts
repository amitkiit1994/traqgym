import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { verifyQrToken } from "@/lib/services/qr-token";
import { checkInViaQr } from "@/lib/services/qr-checkin";
import { getSetting } from "@/lib/services/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: {
    token?: unknown;
    mode?: unknown;
    phone?: unknown;
    force?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const enabled = (await getSetting("qr_checkin_enabled", "false")) === "true";
  if (!enabled) {
    return NextResponse.json(
      { success: false, error: "QR check-in is disabled" },
      { status: 403 },
    );
  }

  const token = typeof body.token === "string" ? body.token : "";
  const mode = body.mode === "phone" ? "phone" : body.mode === "session" ? "session" : null;

  if (!token || !mode) {
    return NextResponse.json(
      { success: false, error: "Missing token or mode" },
      { status: 400 },
    );
  }

  // Note: `force` (ignoreExpiry) is intentionally NOT honored on this
  // public route. Admin can only bypass expiry on the GET preview page,
  // not when actually writing attendance.
  const verified = verifyQrToken(token);
  if (!verified.ok) {
    const status = verified.reason === "missing_secret" ? 500 : 400;
    return NextResponse.json(
      { success: false, error: `Invalid token (${verified.reason})` },
      { status },
    );
  }

  if (mode === "session") {
    const session = await getServerSession(authOptions);
    const actorType = (session?.user as { actorType?: string } | undefined)?.actorType;
    if (!session || actorType !== "member") {
      return NextResponse.json(
        { success: false, error: "Not signed in as a member" },
        { status: 401 },
      );
    }
    const userId = Number((session.user as { id: string | number }).id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ success: false, error: "Invalid session" }, { status: 401 });
    }
    const result = await checkInViaQr({
      locationId: verified.locationId,
      userId,
      scanSource: "qr_lobby",
    });
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  }

  // mode === "phone"
  // TODO(PR 14.1): require OTP verification before honoring this path.
  // Existing OTP infrastructure was not present in the codebase at PR-14
  // time. For now this path is gated by a separate setting so an admin
  // must explicitly opt in.
  const phoneOnlyAllowed =
    (await getSetting("qr_checkin_allow_phone_only", "false")) === "true";
  if (!phoneOnlyAllowed) {
    return NextResponse.json(
      {
        success: false,
        error: "Phone-only check-in is disabled. Please sign in.",
      },
      { status: 403 },
    );
  }

  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (phone.length < 7) {
    return NextResponse.json({ success: false, error: "Invalid phone" }, { status: 400 });
  }

  const result = await checkInViaQr({
    locationId: verified.locationId,
    phone,
    scanSource: "qr_lobby",
  });
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
