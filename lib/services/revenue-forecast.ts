import { prisma } from "@/lib/prisma";

export type RevenueForecastResult = {
  totalExpiring: number;
  totalPotentialRevenue: number;
  likely: { count: number; revenue: number };
  atRisk: { count: number; revenue: number };
  unlikely: { count: number; revenue: number };
};

export async function getRevenueForecast(
  locationId?: number
): Promise<RevenueForecastResult> {
  const now = new Date();
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const expiringTickets = await prisma.memberTicket.findMany({
    where: {
      status: "active",
      expireDate: { gte: now, lte: thirtyDaysLater },
      ...(locationId ? { locationId } : {}),
    },
    include: {
      user: { select: { id: true, firstname: true, lastname: true } },
      plan: { select: { price: true } },
    },
  });

  const userIds = expiringTickets.map((t) => t.userId);

  const latestAttendance = await prisma.attendanceLog.groupBy({
    by: ["userId"],
    where: { userId: { in: userIds } },
    _max: { checkIn: true },
  });

  const lastVisitMap = new Map(
    latestAttendance.map((a) => [a.userId, a._max.checkIn])
  );

  let likelyCount = 0,
    likelyRevenue = 0;
  let atRiskCount = 0,
    atRiskRevenue = 0;
  let unlikelyCount = 0,
    unlikelyRevenue = 0;

  for (const ticket of expiringTickets) {
    const price = Number(ticket.plan.price);
    const lastVisit = lastVisitMap.get(ticket.userId);
    const daysSinceVisit = lastVisit
      ? Math.floor(
          (now.getTime() - lastVisit.getTime()) / (1000 * 60 * 60 * 24)
        )
      : 999;

    if (daysSinceVisit <= 7) {
      likelyCount++;
      likelyRevenue += price;
    } else if (daysSinceVisit <= 30) {
      atRiskCount++;
      atRiskRevenue += price;
    } else {
      unlikelyCount++;
      unlikelyRevenue += price;
    }
  }

  return {
    totalExpiring: expiringTickets.length,
    totalPotentialRevenue: likelyRevenue + atRiskRevenue + unlikelyRevenue,
    likely: { count: likelyCount, revenue: likelyRevenue },
    atRisk: { count: atRiskCount, revenue: atRiskRevenue },
    unlikely: { count: unlikelyCount, revenue: unlikelyRevenue },
  };
}
