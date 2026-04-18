import { prisma } from "@/lib/prisma";

export type LocationRollupRow = {
  locationId: number;
  locationName: string;
  activeMembers: number;
  collectionsThisPeriod: number;
  expensesThisPeriod: number;
  netThisPeriod: number;
  compRatio: number; // 0-1, fraction of active members on complimentary plans (0 if not modeled)
  churnRatePct: number; // 0-100, percentage of active-at-start that expired without renewal
  avgTicketSize: number; // average payment amount this period
};

/**
 * Compute per-location rollup over a date range (inclusive of from, exclusive of to).
 *
 * Uses simple per-location queries for clarity over performance — fine for v1
 * since locations rarely exceed double digits per gym.
 */
export async function getMultiLocationRollup(params: {
  from: Date;
  to: Date;
}): Promise<LocationRollupRow[]> {
  const { from, to } = params;

  const locations = await prisma.location.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const rollups: LocationRollupRow[] = [];

  for (const loc of locations) {
    // R11: exclude non-cash-movement / reversing payment modes from
    // collections + avg-ticket-size so refunds don't inflate revenue and
    // transfer-in / comp passes don't pollute the average.
    const NON_COLLECTION_MODES = [
      "refund",
      "transfer_in",
      "transfer_out",
      "complimentary",
    ];

    const [
      activeMembers,
      activeCompMembers,
      collectionsAgg,
      expensesAgg,
      paymentCount,
      activeAtStart,
      expiredInPeriodCount,
    ] = await Promise.all([
      // Active members at "to" instant: users whose latest ticket at any location
      // for this location is still valid as of `to`. Approximation: count distinct
      // userIds with at least one MemberTicket at this location whose expireDate >= to.
      prisma.memberTicket
        .findMany({
          where: {
            locationId: loc.id,
            expireDate: { gte: to },
            buyDate: { lt: to },
          },
          distinct: ["userId"],
          select: { userId: true },
        })
        .then((rows) => rows.length),

      // R11: comp ratio = active complimentary tickets / total active tickets
      // for this location at `to`. We count tickets (not distinct users) on
      // both sides so the ratio is well-defined even when a user has multiple
      // active tickets.
      prisma.memberTicket.count({
        where: {
          locationId: loc.id,
          status: "active",
          isComplimentary: true,
          expireDate: { gte: to },
          buyDate: { lt: to },
        },
      }),

      prisma.payment.aggregate({
        where: {
          locationId: loc.id,
          createdAt: { gte: from, lt: to },
          paymentMode: { notIn: NON_COLLECTION_MODES },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),

      prisma.expense.aggregate({
        where: {
          locationId: loc.id,
          expenseDate: { gte: from, lt: to },
        },
        _sum: { amount: true },
      }),

      prisma.payment.count({
        where: {
          locationId: loc.id,
          createdAt: { gte: from, lt: to },
          paymentMode: { notIn: NON_COLLECTION_MODES },
        },
      }),

      // Members active at start of period
      prisma.memberTicket
        .findMany({
          where: {
            locationId: loc.id,
            expireDate: { gte: from },
            buyDate: { lt: from },
          },
          distinct: ["userId"],
          select: { userId: true },
        })
        .then((rows) => rows.map((r) => r.userId)),

      // Members whose latest ticket (at this location) expired during period and
      // who have no newer ticket — counted below from `activeAtStart` snapshot.
      Promise.resolve(0),
    ]);

    // Total active tickets for compRatio denominator (matches counter above).
    const totalActiveTicketCount = await prisma.memberTicket.count({
      where: {
        locationId: loc.id,
        status: "active",
        expireDate: { gte: to },
        buyDate: { lt: to },
      },
    });
    const compRatio =
      totalActiveTicketCount > 0
        ? Math.round((activeCompMembers / totalActiveTicketCount) * 1000) / 1000
        : 0;

    const collectionsThisPeriod = Number(collectionsAgg._sum.amount ?? 0);
    const expensesThisPeriod = Number(expensesAgg._sum.amount ?? 0);
    const netThisPeriod = collectionsThisPeriod - expensesThisPeriod;

    // Churn: of the users active at start, how many have NO ticket at this location
    // still valid at `to`?
    let churned = 0;
    if (activeAtStart.length > 0) {
      const stillActive = await prisma.memberTicket.findMany({
        where: {
          locationId: loc.id,
          userId: { in: activeAtStart },
          expireDate: { gte: to },
        },
        distinct: ["userId"],
        select: { userId: true },
      });
      const stillActiveSet = new Set(stillActive.map((r) => r.userId));
      churned = activeAtStart.filter((uid) => !stillActiveSet.has(uid)).length;
    }
    const churnRatePct =
      activeAtStart.length > 0
        ? Math.round((churned / activeAtStart.length) * 1000) / 10
        : 0;

    const avgTicketSize =
      paymentCount > 0
        ? Math.round((collectionsThisPeriod / paymentCount) * 100) / 100
        : 0;

    rollups.push({
      locationId: loc.id,
      locationName: loc.name,
      activeMembers,
      collectionsThisPeriod,
      expensesThisPeriod,
      netThisPeriod,
      compRatio,
      churnRatePct,
      avgTicketSize,
    });
  }

  return rollups;
}
