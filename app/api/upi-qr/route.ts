import QRCode from "qrcode";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateUpiUrl } from "@/lib/services/upi-qr";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const amount = searchParams.get("amount");
  const memberName = searchParams.get("memberName");
  const invoiceNumber = searchParams.get("invoiceNumber") ?? "PENDING";
  const memberIdRaw = searchParams.get("memberId");

  if (!amount || !memberName) {
    return Response.json({ error: "amount and memberName are required" }, { status: 400 });
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0 || parsedAmount > 1_000_000) {
    return Response.json({ error: "Invalid amount (must be > 0 and < 10,00,000)" }, { status: 400 });
  }

  // Scope by actor:
  //   - Member: can only generate QR for themselves
  //   - Worker: can generate for any member at their location (admin = anywhere)
  const actorType = (session.user as { actorType?: string }).actorType;
  if (actorType === "member") {
    const memberId = memberIdRaw ? parseInt(memberIdRaw, 10) : null;
    const sessionUserIdRaw = (session.user as { id?: string | number }).id;
    const sessionUserId =
      typeof sessionUserIdRaw === "number"
        ? sessionUserIdRaw
        : sessionUserIdRaw != null
          ? parseInt(String(sessionUserIdRaw), 10)
          : null;
    if (!memberId || memberId !== sessionUserId) {
      return Response.json(
        { error: "Members can only generate QR for their own account" },
        { status: 403 }
      );
    }
  } else if (actorType === "worker") {
    const role = (session.user as { role?: string }).role;
    const callerLocationId = (session.user as { locationId?: number | null }).locationId ?? null;
    const memberId = memberIdRaw ? parseInt(memberIdRaw, 10) : null;
    if (memberId && role !== "admin") {
      // Ensure target member is at caller's location
      const member = await prisma.user.findUnique({
        where: { id: memberId },
        select: { locationId: true },
      });
      if (!member || member.locationId !== callerLocationId) {
        return Response.json(
          { error: "Member not in your location" },
          { status: 403 }
        );
      }
    }
  } else {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const upiUrl = await generateUpiUrl({
      amount: parsedAmount,
      memberName,
      invoiceNumber,
    });
    const svg = await QRCode.toString(upiUrl, { type: "svg", margin: 2 });
    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
