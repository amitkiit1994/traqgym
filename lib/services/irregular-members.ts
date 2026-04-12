import { prisma } from "@/lib/prisma";
import { todayIST } from "@/lib/utils/date";

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

    // Get active members with their latest attendance
    const members = await prisma.user.findMany({
      where,
      select: {
        id: true,
        firstname: true,
        lastname: true,
        phone: true,
        attendanceLogs: {
          orderBy: { attendanceDate: "desc" },
          take: 1,
          select: { attendanceDate: true },
        },
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
      .filter((m) => {
        if (m.attendanceLogs.length === 0) return true; // never checked in
        return m.attendanceLogs[0].attendanceDate < cutoffDate;
      })
      .map((m) => {
        const lastCheckIn = m.attendanceLogs[0]?.attendanceDate;
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
