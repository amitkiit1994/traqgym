import { prisma } from "@/lib/prisma";
import { todayIST } from "@/lib/utils/date";

const IRREGULAR_MEMBERS_HARD_CAP = 500;

export async function getIrregularMembers(daysThreshold: number = 7, locationId?: number) {
  try {
    const now = todayIST();
    const cutoffDate = new Date(now);
    cutoffDate.setDate(cutoffDate.getDate() - daysThreshold);

    const where: Record<string, unknown> = {
      isActive: true,
      memberTickets: {
        some: {
          expireDate: { gte: now },
          status: "active",
        },
      },
    };
    if (locationId) where.locationId = locationId;

    // Push the "lastCheckIn < cutoff (or never)" filter into SQL.
    // Step 1: get the list of candidate active member userIds. We then
    //   compute their max(attendanceDate) in a single groupBy and filter
    //   in JS. This avoids the per-row correlated subquery the previous
    //   `attendanceLogs: { take: 1, orderBy desc }` include implied.
    const candidates = await prisma.user.findMany({
      where,
      select: { id: true },
      take: IRREGULAR_MEMBERS_HARD_CAP,
    });
    if (candidates.length === 0) return [];
    const candidateIds = candidates.map((c) => c.id);

    const lastVisits = await prisma.attendanceLog.groupBy({
      by: ["userId"],
      where: {
        userId: { in: candidateIds },
      },
      _max: { attendanceDate: true },
    });
    const lastVisitByUser = new Map<number, Date | null>();
    for (const row of lastVisits) {
      if (row.userId == null) continue;
      lastVisitByUser.set(row.userId, row._max.attendanceDate ?? null);
    }

    const irregularIds: number[] = [];
    for (const id of candidateIds) {
      const last = lastVisitByUser.get(id) ?? null;
      if (!last || last < cutoffDate) irregularIds.push(id);
    }
    if (irregularIds.length === 0) return [];

    // Step 2: hydrate just the irregular subset with the bits we render.
    const members = await prisma.user.findMany({
      where: { id: { in: irregularIds } },
      select: {
        id: true,
        firstname: true,
        lastname: true,
        phone: true,
        memberTickets: {
          where: {
            expireDate: { gte: now },
            status: "active",
          },
          orderBy: { expireDate: "desc" },
          take: 1,
          select: {
            expireDate: true,
            plan: { select: { name: true } },
          },
        },
      },
    });

    return members
      .map((m) => {
        const lastCheckIn = lastVisitByUser.get(m.id) ?? null;
        const daysSince = lastCheckIn
          ? Math.floor((now.getTime() - lastCheckIn.getTime()) / (1000 * 60 * 60 * 24))
          : null;

        return {
          id: m.id,
          name: `${m.firstname} ${m.lastname}`,
          phone: m.phone || "-",
          lastCheckIn: lastCheckIn?.toISOString() ?? null,
          daysSinceLastVisit: daysSince,
          activePlan: m.memberTickets[0]?.plan.name ?? "Unknown",
          planExpiry: m.memberTickets[0]?.expireDate.toISOString() ?? null,
        };
      })
      .sort((a, b) => (b.daysSinceLastVisit ?? 999) - (a.daysSinceLastVisit ?? 999));
  } catch (err) {
    console.error("[IrregularMembers] getIrregularMembers error:", err);
    return [];
  }
}
