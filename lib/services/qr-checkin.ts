import { prisma } from "@/lib/prisma";
import { checkIn } from "@/lib/services/attendance";
import { getSetting } from "@/lib/services/settings";

export type QrCheckInResult =
  | { success: true; userId: number; userName: string; alreadyCheckedIn?: boolean }
  | { success: false; error: string };

/**
 * Authenticate-and-check-in via the QR lobby flow.
 *
 * The QR token alone never authenticates a user — it only proves the bearer
 * is at a particular location. The caller must supply either:
 *   - userId (from a member session), OR
 *   - phone (after phone+OTP verification at the route layer)
 *
 * Rate limit: at most one successful QR check-in per user per
 * `qr_checkin_rate_limit_hours` (default 4 hours).
 */
export async function checkInViaQr(params: {
  locationId: number;
  userId?: number;
  phone?: string;
  scanSource?: "qr_lobby";
}): Promise<QrCheckInResult> {
  const { locationId } = params;
  const scanSource = params.scanSource ?? "qr_lobby";

  if (!Number.isInteger(locationId) || locationId <= 0) {
    return { success: false, error: "Invalid location" };
  }

  if (!params.userId && !params.phone) {
    return { success: false, error: "Authentication required" };
  }
  if (params.userId && params.phone) {
    return { success: false, error: "Provide either userId or phone, not both" };
  }

  // Verify location exists and is active
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { id: true, isActive: true },
  });
  if (!location) return { success: false, error: "Location not found" };
  if (!location.isActive) return { success: false, error: "Location is inactive" };

  // Resolve user
  let user: { id: number; firstname: string; lastname: string; isActive: boolean } | null = null;
  if (params.userId) {
    user = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { id: true, firstname: true, lastname: true, isActive: true },
    });
  } else if (params.phone) {
    const phone = params.phone.trim();
    if (phone.length < 7) return { success: false, error: "Invalid phone number" };
    user = await prisma.user.findFirst({
      where: { phone },
      select: { id: true, firstname: true, lastname: true, isActive: true },
      orderBy: { id: "asc" },
    });
  }

  if (!user) return { success: false, error: "Member not found" };
  if (!user.isActive) return { success: false, error: "Member account is inactive" };

  // Rate limit: check most recent QR check-in for this user at THIS location.
  // Scoping by locationId keeps the rate-limit consistent with the daily
  // unique-per-(user, location) attendance constraint enforced by `checkIn`.
  // A multi-location member can still check in at a different branch within
  // the window; the per-location uniqueness invariant remains the second
  // line of defense against duplicate same-day rows.
  const rateLimitHoursSetting = await getSetting("qr_checkin_rate_limit_hours", "4");
  const rateLimitHours = Math.max(1, parseInt(rateLimitHoursSetting, 10) || 4);
  const since = new Date(Date.now() - rateLimitHours * 60 * 60 * 1000);

  const recent = await prisma.attendanceLog.findFirst({
    where: {
      userId: user.id,
      locationId,
      scanSource,
      createdAt: { gt: since },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true },
  });

  if (recent) {
    return {
      success: false,
      error: `Already checked in via QR within the last ${rateLimitHours} hours`,
    };
  }

  // Delegate to the canonical check-in service. It enforces the daily
  // unique-per-user/location invariant and membership validation.
  const result = await checkIn({
    userId: user.id,
    locationId,
    source: scanSource,
  });

  if (!result.success) {
    return { success: false, error: result.error };
  }

  // Best-effort: stamp scanSource on the freshly created (or existing) row.
  // The base service writes only `source`; we mirror it into `scanSource`
  // so reporting can distinguish QR-lobby check-ins from other sources.
  try {
    await prisma.attendanceLog.update({
      where: { id: result.id },
      data: { scanSource },
    });
  } catch {
    // Non-fatal: scanSource is an optional reporting hint.
  }

  return {
    success: true,
    userId: user.id,
    userName: `${user.firstname} ${user.lastname}`.trim(),
    alreadyCheckedIn: result.existing,
  };
}
