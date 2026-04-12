import { prisma } from "@/lib/prisma";

export type ChurnRiskResult = {
  score: number;
  level: "low" | "medium" | "high";
  reason: string;
};

function computeRisk(
  daysSinceLastVisit: number,
  daysUntilExpiry: number,
  last30: number,
  prev30: number
): ChurnRiskResult {
  let risk = 0;
  let topReason = "";
  let topWeight = 0;

  // Attendance recency
  if (daysSinceLastVisit > 14) {
    risk += 40;
    if (40 > topWeight) {
      topWeight = 40;
      topReason =
        daysSinceLastVisit >= 999
          ? "Never visited"
          : `No visit in ${daysSinceLastVisit} days`;
    }
  } else if (daysSinceLastVisit > 7) {
    risk += 20;
    if (20 > topWeight) {
      topWeight = 20;
      topReason = `No visit in ${daysSinceLastVisit} days`;
    }
  }

  // Ticket expiry
  if (daysUntilExpiry < 0) {
    risk += 30;
    if (30 > topWeight) {
      topWeight = 30;
      topReason = `Plan expired ${Math.abs(daysUntilExpiry)} days ago`;
    }
  } else if (daysUntilExpiry < 7) {
    risk += 25;
    if (25 > topWeight) {
      topWeight = 25;
      topReason = `Plan expires in ${daysUntilExpiry} days`;
    }
  } else if (daysUntilExpiry < 14) {
    risk += 15;
    if (15 > topWeight) {
      topWeight = 15;
      topReason = `Plan expires in ${daysUntilExpiry} days`;
    }
  }

  // Attendance trend
  if (prev30 > 2 && last30 < prev30 * 0.5) {
    const dropPct = Math.round((1 - last30 / prev30) * 100);
    risk += 30;
    if (30 >= topWeight) {
      topWeight = 30;
      topReason = `Attendance dropped ${dropPct}%`;
    }
  } else if (prev30 > 2 && last30 < prev30 * 0.7) {
    const dropPct = Math.round((1 - last30 / prev30) * 100);
    risk += 15;
    if (15 >= topWeight) {
      topWeight = 15;
      topReason = `Attendance dropped ${dropPct}%`;
    }
  }

  const level: ChurnRiskResult["level"] =
    risk <= 30 ? "low" : risk <= 60 ? "medium" : "high";

  return {
    score: risk,
    level,
    reason: topReason || "Regular member",
  };
}

export async function calculateChurnRisk(
  userId: number
): Promise<ChurnRiskResult> {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sixtyDaysAgo = new Date(today);
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const [lastAttendance, activeTicket, last30Count, prev30Count] =
    await Promise.all([
      prisma.attendanceLog.findFirst({
        where: { userId },
        orderBy: { checkIn: "desc" },
        select: { checkIn: true },
      }),
      prisma.memberTicket.findFirst({
        where: { userId, status: "active" },
        orderBy: { expireDate: "desc" },
        select: { expireDate: true },
      }),
      prisma.attendanceLog.count({
        where: {
          userId,
          checkIn: { gte: thirtyDaysAgo },
        },
      }),
      prisma.attendanceLog.count({
        where: {
          userId,
          checkIn: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
        },
      }),
    ]);

  const daysSinceLastVisit = lastAttendance
    ? Math.floor(
        (today.getTime() - lastAttendance.checkIn.getTime()) / 86400000
      )
    : 999;

  const daysUntilExpiry = activeTicket
    ? Math.floor(
        (activeTicket.expireDate.getTime() - today.getTime()) / 86400000
      )
    : -999;

  return computeRisk(daysSinceLastVisit, daysUntilExpiry, last30Count, prev30Count);
}

export async function calculateChurnRiskBatch(
  userIds: number[]
): Promise<Map<number, ChurnRiskResult>> {
  if (userIds.length === 0) return new Map();

  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sixtyDaysAgo = new Date(today);
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  // 1. Latest attendance per user (most recent checkIn)
  const latestAttendance = await prisma.attendanceLog.groupBy({
    by: ["userId"],
    where: { userId: { in: userIds } },
    _max: { checkIn: true },
  });
  const lastCheckInMap = new Map<number, Date>();
  for (const row of latestAttendance) {
    if (row.userId != null && row._max.checkIn) {
      lastCheckInMap.set(row.userId, row._max.checkIn);
    }
  }

  // 2. Active ticket with latest expireDate per user
  const activeTickets = await prisma.memberTicket.findMany({
    where: { userId: { in: userIds }, status: "active" },
    orderBy: { expireDate: "desc" },
    select: { userId: true, expireDate: true },
  });
  const expiryMap = new Map<number, Date>();
  for (const t of activeTickets) {
    // First one per user is the latest (ordered desc)
    if (!expiryMap.has(t.userId)) {
      expiryMap.set(t.userId, t.expireDate);
    }
  }

  // 3. Attendance count last 30 days per user
  const last30 = await prisma.attendanceLog.groupBy({
    by: ["userId"],
    where: {
      userId: { in: userIds },
      checkIn: { gte: thirtyDaysAgo },
    },
    _count: true,
  });
  const last30Map = new Map<number, number>();
  for (const row of last30) {
    if (row.userId != null) {
      last30Map.set(row.userId, row._count);
    }
  }

  // 4. Attendance count previous 30 days (30-60 days ago) per user
  const prev30 = await prisma.attendanceLog.groupBy({
    by: ["userId"],
    where: {
      userId: { in: userIds },
      checkIn: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
    },
    _count: true,
  });
  const prev30Map = new Map<number, number>();
  for (const row of prev30) {
    if (row.userId != null) {
      prev30Map.set(row.userId, row._count);
    }
  }

  // Compute scores
  const results = new Map<number, ChurnRiskResult>();
  for (const userId of userIds) {
    const lastCheckIn = lastCheckInMap.get(userId);
    const daysSinceLastVisit = lastCheckIn
      ? Math.floor((today.getTime() - lastCheckIn.getTime()) / 86400000)
      : 999;

    const expiry = expiryMap.get(userId);
    const daysUntilExpiry = expiry
      ? Math.floor((expiry.getTime() - today.getTime()) / 86400000)
      : -999;

    results.set(
      userId,
      computeRisk(
        daysSinceLastVisit,
        daysUntilExpiry,
        last30Map.get(userId) ?? 0,
        prev30Map.get(userId) ?? 0
      )
    );
  }

  return results;
}
