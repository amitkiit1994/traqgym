import { prisma } from "@/lib/prisma";

type AnomalyResult = {
  hasAnomaly: boolean;
  message: string | null;
  avgVisitsPerWeek: number;
  recentVisitsPerWeek: number;
  daysSinceLastVisit: number | null;
};

export async function detectAttendanceAnomaly(userId: number): Promise<AnomalyResult> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  // Count visits in different windows
  const [last7, last30, prev30, lastVisit] = await Promise.all([
    prisma.attendanceLog.count({ where: { userId, checkIn: { gte: sevenDaysAgo } } }),
    prisma.attendanceLog.count({ where: { userId, checkIn: { gte: thirtyDaysAgo } } }),
    prisma.attendanceLog.count({ where: { userId, checkIn: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } } }),
    prisma.attendanceLog.findFirst({ where: { userId }, orderBy: { checkIn: "desc" }, select: { checkIn: true } }),
  ]);

  const avgVisitsPerWeek = prev30 > 0 ? (prev30 / 4.3) : (last30 / 4.3);
  const recentVisitsPerWeek = last7;
  const daysSinceLastVisit = lastVisit ? Math.floor((now.getTime() - lastVisit.checkIn.getTime()) / (1000 * 60 * 60 * 24)) : null;

  // Check for anomalies
  if (daysSinceLastVisit !== null && daysSinceLastVisit > 14 && avgVisitsPerWeek > 1) {
    return { hasAnomaly: true, message: `No visit in ${daysSinceLastVisit} days (usually ${avgVisitsPerWeek.toFixed(1)}/week)`, avgVisitsPerWeek, recentVisitsPerWeek, daysSinceLastVisit };
  }

  if (prev30 > 2 && last30 < prev30 * 0.5) {
    const dropPct = Math.round((1 - last30 / prev30) * 100);
    return { hasAnomaly: true, message: `Attendance dropped ${dropPct}% this month`, avgVisitsPerWeek, recentVisitsPerWeek, daysSinceLastVisit };
  }

  if (prev30 > 2 && last7 === 0 && avgVisitsPerWeek > 1) {
    return { hasAnomaly: true, message: `No visits this week (usually ${avgVisitsPerWeek.toFixed(1)}/week)`, avgVisitsPerWeek, recentVisitsPerWeek, daysSinceLastVisit };
  }

  return { hasAnomaly: false, message: null, avgVisitsPerWeek, recentVisitsPerWeek, daysSinceLastVisit };
}
