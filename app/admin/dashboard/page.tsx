import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getCachedStats, getCachedProfitLoss, getCachedStaffPerformance, getCachedPreviousMonthStats } from "@/lib/services/dashboard";
import { getRevenueForecast } from "@/lib/services/revenue-forecast";
import { getAnnouncements } from "@/lib/actions/announcements";
import { prisma } from "@/lib/prisma";
import { DashboardClient } from "./dashboard-client";

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

  const [stats, profitLoss, announcements, staffPerf, prevStats, forecast] = await Promise.all([
    getCachedStats(locationId),
    getCachedProfitLoss(currentMonth, locationId),
    getAnnouncements("staff", locationId),
    getCachedStaffPerformance(monthStart, monthEnd),
    getCachedPreviousMonthStats(locationId),
    getRevenueForecast(locationId),
  ]);
  const locations = await prisma.location.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
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
          expireDate: t.expireDate.toISOString(),
        })),
        todayCheckIns: stats.todayCheckIns,
        revenueChartData: stats.revenueChartData,
        totalMembers: stats.totalMembers,
        expiredMembers: stats.expiredMembers,
        cashThisMonth: stats.cashThisMonth,
        upiThisMonth: stats.upiThisMonth,
        currentlyInGym: stats.currentlyInGym,
        overdueMembers: stats.overdueMembers,
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
      }}
      forecast={forecast}
      previousMonthStats={prevStats}
      locations={locations}
      currentLocationId={locationId}
    />
  );
}
