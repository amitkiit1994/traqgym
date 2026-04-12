import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkIn } from "@/lib/services/attendance";
import { todayIST } from "@/lib/utils/date";
import { getSetting } from "@/lib/services/settings";

// Simple in-memory rate limiter: phone -> last check-in timestamp
const recentCheckins = new Map<string, number>();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { phone, locationId } = body;

    if (!phone || !locationId) {
      return NextResponse.json(
        { error: "Phone and locationId are required" },
        { status: 400 }
      );
    }

    // Rate limit: same phone can't check in twice within cooldown period
    const cooldownSetting = await getSetting("checkin_cooldown_seconds", "60");
    const cooldownMs = parseInt(cooldownSetting, 10) * 1000;
    const now = Date.now();
    const lastCheckin = recentCheckins.get(phone);
    if (lastCheckin && now - lastCheckin < cooldownMs) {
      return NextResponse.json(
        { error: "Already checked in recently. Please wait a moment." },
        { status: 429 }
      );
    }

    // Validate locationId
    const parsedLocationId = parseInt(String(locationId), 10);
    if (isNaN(parsedLocationId)) {
      return NextResponse.json(
        { error: "Invalid locationId" },
        { status: 400 }
      );
    }
    const location = await prisma.location.findUnique({ where: { id: parsedLocationId } });
    if (!location || !location.isActive) {
      return NextResponse.json(
        { error: "Location not found or inactive" },
        { status: 400 }
      );
    }

    // Look up member by phone
    const user = await prisma.user.findFirst({
      where: { phone: phone.trim() },
    });

    if (!user) {
      return NextResponse.json(
        { error: "Member not found" },
        { status: 404 }
      );
    }

    // Get membership status for display
    const latestTicket = await prisma.memberTicket.findFirst({
      where: { userId: user.id },
      orderBy: { expireDate: "desc" },
    });

    // Check in
    const result = await checkIn({
      userId: user.id,
      locationId: parsedLocationId,
      source: "kiosk",
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Check-in failed" },
        { status: 403 }
      );
    }

    // Record for rate limiting
    recentCheckins.set(phone, now);

    // Clean up old entries periodically
    if (recentCheckins.size > 1000) {
      for (const [key, ts] of recentCheckins) {
        if (now - ts > 120_000) recentCheckins.delete(key);
      }
    }

    const todayDate = todayIST();

    // Determine membership status
    let membershipStatus = "none";
    if (latestTicket) {
      if (latestTicket.expireDate >= todayDate) {
        membershipStatus = "active";
      } else {
        const graceSetting = await prisma.gymSettings.findUnique({ where: { key: "grace_period_days" } });
        const graceDays = graceSetting ? parseInt(graceSetting.value, 10) : 0;
        const graceDate = new Date(todayDate);
        graceDate.setDate(graceDate.getDate() - graceDays);
        membershipStatus = latestTicket.expireDate >= graceDate ? "grace" : "expired";
      }
    }

    return NextResponse.json({
      success: true,
      memberName: `${user.firstname} ${user.lastname}`,
      checkInTime: new Date().toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      existing: result.existing,
      membershipStatus,
      expiryDate: latestTicket?.expireDate?.toISOString() || null,
    });
  } catch (err: any) {
    console.error("[Kiosk Check-in Error]", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
