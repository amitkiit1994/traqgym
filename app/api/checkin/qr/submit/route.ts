import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { verifyQrToken } from "@/lib/services/qr-token";
import { checkInViaQr } from "@/lib/services/qr-checkin";
import { getSetting } from "@/lib/services/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // PR 14 audit fix (HIGH): CSRF guard. This route accepts JSON POST and
  // (in session mode) writes attendance against the caller's NextAuth
  // cookie — i.e., it is a state-changing authenticated endpoint. Without
  // an Origin/Host check, a malicious page could trigger drive-by check-ins
  // for any signed-in member who scanned a QR earlier. Reject any cross-
  // origin POST.
  const originHeader = req.headers.get("origin");
  const hostHeader = req.headers.get("host") ?? "";
  if (originHeader) {
    let originHost = "";
    try {
      originHost = new URL(originHeader).host;
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid Origin" },
        { status: 403 },
      );
    }
    if (originHost !== hostHeader) {
      return NextResponse.json(
        { success: false, error: "Cross-origin request rejected" },
        { status: 403 },
      );
    }
  }

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
  // PR 14 audit fix (CRITICAL): hard-disabled in code path.
  //
  // The phone-only flow was previously gated only by the
  // `qr_checkin_allow_phone_only` setting. That setting still has effect
  // elsewhere (UI hints, admin status panel), but the API will refuse
  // the path entirely until a real OTP service ships (tracked as PR 14.1).
  // Without OTP, anyone with a member's phone number could mark them
  // present from the QR — i.e., free attendance fraud / false alibi.
  return NextResponse.json(
    {
      success: false,
      error: "Phone-only check-in is not available. Please sign in.",
    },
    { status: 503 },
  );
}
