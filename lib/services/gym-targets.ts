import { prisma } from "@/lib/prisma";

/** Helper to find a target by month/year/locationId (handles null locationId) */
async function findTarget(month: number, year: number, locationId?: number) {
  if (locationId) {
    return prisma.gymTarget.findUnique({
      where: { month_year_locationId: { month, year, locationId } },
    });
  }
  // Nullable locationId — use findFirst
  return prisma.gymTarget.findFirst({
    where: { month, year, locationId: null },
  });
}

export async function setTarget(data: {
  month: number;
  year: number;
  targetRevenue: number;
  targetNewMembers?: number;
  targetRenewals?: number;
  locationId?: number;
}) {
  try {
    const existing = await findTarget(data.month, data.year, data.locationId);

    let target;
    if (existing) {
      target = await prisma.gymTarget.update({
        where: { id: existing.id },
        data: {
          targetRevenue: data.targetRevenue,
          targetNewMembers: data.targetNewMembers ?? 0,
          targetRenewals: data.targetRenewals ?? 0,
        },
      });
    } else {
      target = await prisma.gymTarget.create({
        data: {
          month: data.month,
          year: data.year,
          targetRevenue: data.targetRevenue,
          targetNewMembers: data.targetNewMembers ?? 0,
          targetRenewals: data.targetRenewals ?? 0,
          locationId: data.locationId ?? null,
        },
      });
    }

    return { success: true as const, target };
  } catch (err) {
    console.error("[GymTargets] setTarget error:", err);
    return { success: false as const, error: "Failed to set target" };
  }
}

export async function getTarget(month: number, year: number, locationId?: number) {
  try {
    return await findTarget(month, year, locationId);
  } catch (err) {
    console.error("[GymTargets] getTarget error:", err);
    return null;
  }
}

export async function getTargetProgress(month: number, year: number, locationId?: number) {
  try {
    const target = await getTarget(month, year, locationId);

    // Calculate actual revenue for the month
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 1);

    const paymentWhere: Record<string, unknown> = {
      createdAt: { gte: monthStart, lt: monthEnd },
    };
    if (locationId) paymentWhere.locationId = locationId;

    const revenueResult = await prisma.payment.aggregate({
      where: paymentWhere,
      _sum: { amount: true },
    });
    const actualRevenue = revenueResult._sum.amount ? Number(revenueResult._sum.amount) : 0;

    // New members this month (users created in this month)
    const userWhere: Record<string, unknown> = {
      createdAt: { gte: monthStart, lt: monthEnd },
    };
    if (locationId) userWhere.locationId = locationId;
    const actualNewMembers = await prisma.user.count({ where: userWhere });

    // Renewals this month (MemberTickets created in this month)
    const ticketWhere: Record<string, unknown> = {
      buyDate: { gte: monthStart, lt: monthEnd },
    };
    if (locationId) ticketWhere.locationId = locationId;
    const actualRenewals = await prisma.memberTicket.count({ where: ticketWhere });

    const serializedTarget = target
      ? { ...target, targetRevenue: Number(target.targetRevenue) }
      : null;

    return {
      target: serializedTarget,
      actual: {
        revenue: actualRevenue,
        newMembers: actualNewMembers,
        renewals: actualRenewals,
      },
      progress: serializedTarget
        ? {
            revenuePercent: serializedTarget.targetRevenue > 0 ? Math.round((actualRevenue / serializedTarget.targetRevenue) * 100) : 0,
            newMembersPercent: serializedTarget.targetNewMembers > 0 ? Math.round((actualNewMembers / serializedTarget.targetNewMembers) * 100) : 0,
            renewalsPercent: serializedTarget.targetRenewals > 0 ? Math.round((actualRenewals / serializedTarget.targetRenewals) * 100) : 0,
          }
        : null,
    };
  } catch (err) {
    console.error("[GymTargets] getTargetProgress error:", err);
    return { target: null, actual: { revenue: 0, newMembers: 0, renewals: 0 }, progress: null };
  }
}
