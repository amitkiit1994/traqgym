import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  getCachedStats, getCachedProfitLoss, getCachedStaffPerformance, getCachedPreviousMonthStats,
  getDailyCollection, getCachedDailyPOSCollection, getCachedTodayCounts,
  getCachedTodayAnniversaries, getCachedUpcomingAnniversaries,
} from "@/lib/services/dashboard";
import { getRevenueForecast } from "@/lib/services/revenue-forecast";
import { getTargetProgress } from "@/lib/services/gym-targets";
import { getAnnouncements } from "@/lib/actions/announcements";
import { prisma } from "@/lib/prisma";
import { DashboardClient } from "./dashboard-client";
import { InsightCards } from "@/components/admin/insight-cards";
import { CashShiftBanner } from "@/components/admin/cash-shift-banner";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ locationId?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "worker") {
    redirect("/login");
  }

  const params = await searchParams;
  const locationId = params.locationId ? Number(params.locationId) : undefined;

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const emptyForecast: Awaited<ReturnType<typeof getRevenueForecast>> = {
    totalExpiring: 0,
    totalPotentialRevenue: 0,
    likely: { count: 0, revenue: 0 },
    atRisk: { count: 0, revenue: 0 },
    unlikely: { count: 0, revenue: 0 },
  };

  const [stats, profitLoss, announcements, staffPerf, prevStats, forecast, dailyCollection, posSales, todayCounts, targetProgress, todayAnniversariesRaw, upcomingAnniversariesRaw, overdueFollowupsCount] = await Promise.all([
    getCachedStats(locationId),
    getCachedProfitLoss(currentMonth, locationId),
    getAnnouncements("staff", locationId),
    getCachedStaffPerformance(monthStart.toISOString(), monthEnd.toISOString()),
    getCachedPreviousMonthStats(locationId),
    getRevenueForecast(locationId).catch((e) => { console.error("Revenue forecast failed:", e); return emptyForecast; }),
    getDailyCollection(locationId),
    getCachedDailyPOSCollection(locationId),
    getCachedTodayCounts(locationId),
    getTargetProgress(now.getMonth() + 1, now.getFullYear(), locationId),
    getCachedTodayAnniversaries(),
    getCachedUpcomingAnniversaries(7),
    (() => {
      const ninetyDaysAgo = new Date(now);
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      return prisma.paymentFollowup.count({
        where: {
          status: { in: ["pending", "contacted", "promised"] },
          dueDate: { gte: ninetyDaysAgo, lt: now },
          amountDue: { gt: 0 },
        },
      });
    })(),
  ]);
  const todayAnniversaries = todayAnniversariesRaw.map((u) => ({
    id: u.id,
    name: `${u.firstname} ${u.lastname}`,
    phone: u.phone || "-",
  }));

  const upcomingAnniversaries = upcomingAnniversariesRaw.map((u) => ({
    id: u.id,
    name: `${u.firstname} ${u.lastname}`,
    phone: u.phone || "-",
    daysUntil: Number(u.days_until),
  }));

  // Calculate days remaining in month
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysRemaining = lastDayOfMonth - now.getDate();

  const locations = await prisma.location.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <>
      <CashShiftBanner locationId={locationId} />
      <div className="px-4 pt-4 md:px-6"><InsightCards /></div>
      <DashboardClient
      stats={{
        activeMembers: stats.activeMembers,
        revenueThisMonth: stats.revenueThisMonth,
        expiringIn3Days: stats.expiringIn3Days.map((t) => ({
          id: t.id,
          userId: t.userId,
          userName: `${t.user.firstname} ${t.user.lastname}`,
          userEmail: t.user.email,
          planName: t.plan.name,
          planId: t.plan.id,
          locationId: t.locationId,
          expireDate: t.expireDate,
        })),
        todayCheckIns: stats.todayCheckIns,
        revenueChartData: stats.revenueChartData,
        totalMembers: stats.totalMembers,
        expiredMembers: stats.expiredMembers,
        cashThisMonth: stats.cashThisMonth,
        upiThisMonth: stats.upiThisMonth,
        currentlyInGym: stats.currentlyInGym,
        overdueMembers: stats.overdueMembers,
        overdueFollowupsCount,
        planDistribution: stats.planDistribution,
        todayBirthdays: stats.todayBirthdays,
        upcomingBirthdays: stats.upcomingBirthdays,
        profitLoss: profitLoss,
        announcements: announcements,
        attendanceChartData: stats.attendanceChartData,
        staffPerformance: staffPerf.staff
          .filter((s) => s.totalCollected > 0)
          .sort((a, b) => b.totalCollected - a.totalCollected)
          .slice(0, 5)
          .map((s) => ({ name: s.name, total: s.totalCollected, renewals: s.renewalCount })),
        dailyCollection: dailyCollection.byMode.total,
        posSales: posSales,
        todayCounts: todayCounts,
        todayAnniversaries: todayAnniversaries,
        upcomingAnniversaries: upcomingAnniversaries,
      }}
      forecast={forecast}
      previousMonthStats={prevStats}
      locations={locations}
      currentLocationId={locationId}
      targetProgress={{
        target: targetProgress.target ? { targetRevenue: targetProgress.target.targetRevenue, targetNewMembers: targetProgress.target.targetNewMembers, targetRenewals: targetProgress.target.targetRenewals } : null,
        actual: targetProgress.actual,
        progress: targetProgress.progress,
        daysRemaining: daysRemaining,
      }}
      workerId={Number(session.user.id)}
    />
    </>
  );
}
