import { prisma } from "@/lib/prisma";

/**
 * Compute ISO week key like "2026-W16" for stable dedup.
 */
function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

export type ComparatorResult = {
  flagged: { locationId: number; locationName: string; pctDrop: number; thisMonthRevenue: number; lastMonthRevenue: number }[];
  notified: number;
  skipped: boolean;
  reason?: string;
};

/**
 * Multi-location comparator agent.
 *
 * Runs weekly (Mondays). For each active location, compares this month's
 * revenue (month-to-date) vs last month's revenue (full month). If a location
 * is more than 15% below its prior-month revenue (and prior-month > 0), an
 * in-app insight notification is sent to all admin workers.
 *
 * Dedup: title is prefixed with `[KEY:multi_loc:<isoWeek>:<locationId>]` so
 * re-runs in the same ISO week skip locations already flagged.
 */
export async function runMultiLocationComparator(now: Date = new Date()): Promise<ComparatorResult> {
  const weekKey = isoWeekKey(now);

  // This month start
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  // Last month range
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = thisMonthStart;

  const locations = await prisma.location.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  if (locations.length < 2) {
    return { flagged: [], notified: 0, skipped: true, reason: "Need at least 2 locations" };
  }

  const flagged: ComparatorResult["flagged"] = [];

  for (const loc of locations) {
    const [thisAgg, lastAgg] = await Promise.all([
      prisma.payment.aggregate({
        where: {
          locationId: loc.id,
          createdAt: { gte: thisMonthStart, lt: nextMonthStart },
        },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: {
          locationId: loc.id,
          createdAt: { gte: lastMonthStart, lt: lastMonthEnd },
        },
        _sum: { amount: true },
      }),
    ]);

    const thisRev = Number(thisAgg._sum.amount ?? 0);
    const lastRev = Number(lastAgg._sum.amount ?? 0);

    if (lastRev <= 0) continue;
    const pctDrop = Math.round(((lastRev - thisRev) / lastRev) * 100);
    if (pctDrop <= 15) continue;

    flagged.push({
      locationId: loc.id,
      locationName: loc.name,
      pctDrop,
      thisMonthRevenue: Math.round(thisRev),
      lastMonthRevenue: Math.round(lastRev),
    });
  }

  if (flagged.length === 0) {
    return { flagged: [], notified: 0, skipped: false };
  }

  const admins = await prisma.worker.findMany({
    where: { role: "admin", isActive: true },
    select: { id: true },
  });

  if (admins.length === 0) {
    return { flagged, notified: 0, skipped: true, reason: "No admin workers" };
  }

  let notified = 0;

  for (const f of flagged) {
    const titlePrefix = `[KEY:multi_loc:${weekKey}:${f.locationId}]`;
    const fullTitle = `${titlePrefix} ${f.locationName}: revenue down ${f.pctDrop}% MoM`;

    // Dedup: skip if any admin already received this exact title
    const existing = await prisma.inAppNotification.findFirst({
      where: { title: fullTitle },
      select: { id: true },
    });
    if (existing) continue;

    const message = `Month-to-date revenue ₹${f.thisMonthRevenue.toLocaleString("en-IN")} vs last month ₹${f.lastMonthRevenue.toLocaleString("en-IN")}.`;

    await prisma.inAppNotification.createMany({
      data: admins.map((a) => ({
        workerId: a.id,
        type: "insight",
        title: fullTitle,
        message,
        link: "/admin/reports/multi-location",
      })),
    });
    notified += admins.length;
  }

  return { flagged, notified, skipped: false };
}
