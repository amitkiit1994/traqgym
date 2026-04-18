import { prisma } from "@/lib/prisma";
import { todayIST } from "@/lib/utils/date";

export type UsageSegment = "heavy" | "moderate" | "light";

export type MemberUsageRow = {
  userId: number;
  name: string;
  phone: string;
  plan: string;
  totalVisits: number;
  membershipDays: number;
  usagePercent: number;
  segment: UsageSegment;
};

export type MemberUsageResult = {
  segments: { heavy: number; moderate: number; light: number };
  members: MemberUsageRow[];
};

function getSegment(usagePercent: number): UsageSegment {
  if (usagePercent > 70) return "heavy";
  if (usagePercent >= 30) return "moderate";
  return "light";
}

export async function getMemberUsage(locationId?: number): Promise<MemberUsageResult> {
  const now = todayIST();
  const locFilter: Record<string, unknown> = locationId ? { locationId } : {};

  // Get all users with an active ticket. Drop the `_count.attendanceLogs`
  // include — it was computed (full COUNT) and never used.
  const users = await prisma.user.findMany({
    where: {
      ...locFilter,
      memberTickets: {
        some: {
          expireDate: { gte: now },
          status: "active",
        },
      },
    },
    include: {
      memberTickets: {
        where: { expireDate: { gte: now }, status: "active" },
        orderBy: { buyDate: "asc" },
        take: 1,
        include: { plan: { select: { name: true } } },
      },
    },
  });

  // Pre-aggregate attendance for all users in one shot so we don't fire one
  // count() query per user. We have to apply per-user (buyDate..endDate)
  // bounds in JS, but the cost of fetching the rows once is tiny compared to
  // N round-trips.
  const userIds = users.map((u) => u.id);
  const periodBounds = new Map<number, { from: Date; to: Date }>();
  let earliestFrom: Date | null = null;
  let latestTo: Date | null = null;
  for (const u of users) {
    const ticket = u.memberTickets[0];
    if (!ticket) continue;
    const from = new Date(ticket.buyDate);
    const to = new Date(ticket.expireDate) < now ? new Date(ticket.expireDate) : now;
    periodBounds.set(u.id, { from, to });
    if (!earliestFrom || from < earliestFrom) earliestFrom = from;
    if (!latestTo || to > latestTo) latestTo = to;
  }

  const attendanceByUser = new Map<number, Date[]>();
  if (userIds.length > 0 && earliestFrom && latestTo) {
    const attendanceRows = await prisma.attendanceLog.findMany({
      where: {
        userId: { in: userIds },
        attendanceDate: { gte: earliestFrom, lte: latestTo },
      },
      select: { userId: true, attendanceDate: true },
    });
    for (const row of attendanceRows) {
      if (row.userId == null) continue;
      const arr = attendanceByUser.get(row.userId);
      if (arr) arr.push(row.attendanceDate);
      else attendanceByUser.set(row.userId, [row.attendanceDate]);
    }
  }

  const segments = { heavy: 0, moderate: 0, light: 0 };
  const members: MemberUsageRow[] = [];

  for (const u of users) {
    const ticket = u.memberTickets[0];
    if (!ticket) continue;

    const bounds = periodBounds.get(u.id);
    if (!bounds) continue;
    const { from: buyDate, to: endDate } = bounds;
    const membershipDays = Math.max(1, Math.ceil((endDate.getTime() - buyDate.getTime()) / (1000 * 60 * 60 * 24)));

    // Count this user's attendance dates within the ticket period from the
    // pre-fetched bucket — no DB round-trip per user.
    const dates = attendanceByUser.get(u.id);
    let totalVisits = 0;
    if (dates) {
      for (const d of dates) {
        if (d >= buyDate && d <= endDate) totalVisits++;
      }
    }

    const usagePercent = Math.round((totalVisits / membershipDays) * 10000) / 100;
    const segment = getSegment(usagePercent);
    segments[segment]++;

    members.push({
      userId: u.id,
      name: `${u.firstname} ${u.lastname}`,
      phone: u.phone ?? "-",
      plan: ticket.plan.name,
      totalVisits,
      membershipDays,
      usagePercent,
      segment,
    });
  }

  // Sort by usage ascending (least usage first)
  members.sort((a, b) => a.usagePercent - b.usagePercent);

  return { segments, members };
}
