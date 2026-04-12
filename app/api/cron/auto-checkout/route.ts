import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";

export async function GET(request: Request) {
  const secret = request.headers.get("x-cron-secret") || new URL(request.url).searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET && process.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const enabled = await getSetting("cron_auto_checkout_enabled", "true");
  if (enabled !== "true") {
    return Response.json({ success: true, skipped: true, reason: "Cron disabled in settings" });
  }

  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sunday

  // 1. Get closing times per location for today's day of week
  const openingHours = await prisma.openingHour.findMany({
    where: { dayOfWeek, isClosed: false },
  });

  const closingTimeByLocation = new Map<number, string>();
  for (const oh of openingHours) {
    closingTimeByLocation.set(oh.locationId, oh.closeTime);
  }

  // 2. Find all open attendance logs (checkOut IS NULL) for today
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const openLogs = await prisma.attendanceLog.findMany({
    where: {
      attendanceDate: today,
      checkOut: null,
    },
  });

  let closed = 0;

  // 3. Update each with the location's closing time
  for (const log of openLogs) {
    const closeTimeStr = closingTimeByLocation.get(log.locationId);
    if (!closeTimeStr) continue;

    // Parse closeTime (format: "HH:MM" or "HH:MM:SS")
    const parts = closeTimeStr.split(":");
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);

    const checkOut = new Date(today);
    checkOut.setHours(hours, minutes, 0, 0);

    await prisma.attendanceLog.update({
      where: { id: log.id },
      data: { checkOut },
    });

    closed++;
  }

  return Response.json({ success: true, closed });
}
