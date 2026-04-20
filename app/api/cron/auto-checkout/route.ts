import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import { requireCronSecret } from "@/lib/auth-cron";
import { istCalendarFor, istDayBoundsUtc } from "@/lib/utils/date-ist";

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  const enabled = await getSetting("cron_auto_checkout_enabled", "true");
  if (enabled !== "true") {
    return Response.json({ success: true, skipped: true, reason: "Cron disabled in settings" });
  }

  const now = new Date();
  // Cron schedule is `0 23 * * *` UTC = 04:30 IST the FOLLOWING calendar day.
  // We auto-close the previous IST day's still-open attendance logs, not the
  // current IST day's (which has barely started). Subtract one IST day so the
  // closing-time lookup, weekday, and attendance-window all anchor to the
  // gym-day that just ended. Date.UTC handles negative day rollover.
  const istNow = istCalendarFor(now);
  const istCal = { year: istNow.year, month: istNow.month, day: istNow.day - 1 };
  // istCalendarFor returns 0-indexed month; build a Date in UTC to derive weekday.
  const istWeekdayProbe = new Date(Date.UTC(istCal.year, istCal.month, istCal.day));
  const dayOfWeek = istWeekdayProbe.getUTCDay(); // 0=Sunday in IST

  // 1. Get closing times per location for today's (IST) day of week
  const openingHours = await prisma.openingHour.findMany({
    where: { dayOfWeek, isClosed: false },
  });

  const closingTimeByLocation = new Map<number, string>();
  for (const oh of openingHours) {
    closingTimeByLocation.set(oh.locationId, oh.closeTime);
  }

  // 2. Find all open attendance logs (checkOut IS NULL) for today's IST day.
  // attendanceDate is stored as IST midnight (which is 18:30 UTC of the prior day).
  const { startUtc: todayStartUtc, endUtc: todayEndUtc } = istDayBoundsUtc(istCal);
  const openLogs = await prisma.attendanceLog.findMany({
    where: {
      attendanceDate: {
        gte: todayStartUtc,
        lt: todayEndUtc,
      },
      checkOut: null,
    },
  });

  let closed = 0;

  // 3. Update each with the location's closing time.
  // Build the checkOut instant by adding HH:MM (IST wall-clock) to the IST midnight start.
  for (const log of openLogs) {
    const closeTimeStr = closingTimeByLocation.get(log.locationId);
    if (!closeTimeStr) continue;

    // Parse closeTime (format: "HH:MM" or "HH:MM:SS")
    const parts = closeTimeStr.split(":");
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);

    // todayStartUtc represents IST midnight; offset by IST wall-clock hours/minutes.
    const checkOut = new Date(
      todayStartUtc.getTime() + hours * 3600000 + minutes * 60000
    );

    await prisma.attendanceLog.update({
      where: { id: log.id },
      data: { checkOut },
    });

    closed++;
  }

  return Response.json({ success: true, closed });
}
