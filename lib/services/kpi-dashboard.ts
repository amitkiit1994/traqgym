import { prisma } from "@/lib/prisma";
import { todayIST } from "@/lib/utils/date";

export type MonthKPI = {
  month: string; // "YYYY-MM"
  revenue: number;
  newMembers: number;
  renewals: number;
  avgDailyAttendance: number;
  churnRate: number;
};

export async function getKPIData(months: number = 6, locationId?: number): Promise<MonthKPI[]> {
  const now = todayIST();
  const results: MonthKPI[] = [];

  for (let i = months - 1; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
    const monthLabel = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`;

    const locFilter: Record<string, unknown> = locationId ? { locationId } : {};

    const [revenueResult, newMembersCount, renewalsCount, attendanceCount, expiredNoRenewal, activeAtStart] = await Promise.all([
      // Total revenue
      prisma.payment.aggregate({
        where: { ...locFilter, createdAt: { gte: monthStart, lt: monthEnd } },
        _sum: { amount: true },
      }),
      // New members created this month
      prisma.user.count({
        where: { ...locFilter, createdAt: { gte: monthStart, lt: monthEnd } },
      }),
      // Renewals: tickets created this month for users who already had a previous ticket
      prisma.memberTicket.count({
        where: {
          ...locFilter,
          createdAt: { gte: monthStart, lt: monthEnd },
          user: {
            memberTickets: {
              some: {
                createdAt: { lt: monthStart },
              },
            },
          },
        },
      }),
      // Attendance logs this month (member only)
      prisma.attendanceLog.count({
        where: {
          ...locFilter,
          attendanceDate: { gte: monthStart, lt: monthEnd },
          userId: { not: null },
        },
      }),
      // Churn: tickets that expired this month with no renewal after
      prisma.memberTicket.count({
        where: {
          ...locFilter,
          expireDate: { gte: monthStart, lt: monthEnd },
          user: {
            memberTickets: {
              none: {
                createdAt: { gte: monthStart },
                expireDate: { gt: monthEnd },
              },
            },
          },
        },
      }),
      // Active tickets at start of month
      prisma.memberTicket.count({
        where: {
          ...locFilter,
          buyDate: { lt: monthStart },
          expireDate: { gte: monthStart },
        },
      }),
    ]);

    const revenue = revenueResult._sum.amount ? Number(revenueResult._sum.amount) : 0;
    const avgDailyAttendance = daysInMonth > 0 ? Math.round(attendanceCount / daysInMonth) : 0;
    const churnRate = activeAtStart > 0 ? Math.round((expiredNoRenewal / activeAtStart) * 10000) / 100 : 0;

    results.push({
      month: monthLabel,
      revenue,
      newMembers: newMembersCount,
      renewals: renewalsCount,
      avgDailyAttendance,
      churnRate,
    });
  }

  return results;
}
