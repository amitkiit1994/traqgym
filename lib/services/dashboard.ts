import { prisma } from "@/lib/prisma";
import { todayIST } from "@/lib/utils/date";
import { unstable_cache } from "next/cache";

export async function getStats(locationId?: number) {
  const where = locationId ? { locationId } : {};
  const now = todayIST();

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const threeDaysFromNow = new Date(now);
  threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

  const todayStart = new Date(now);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const sevenDaysAgoDate = new Date(now);
  sevenDaysAgoDate.setDate(sevenDaysAgoDate.getDate() - 7);

  const todayMonth = now.getMonth() + 1;
  const todayDay = now.getDate();
  const thisYear = now.getFullYear();

  // Run all independent queries in parallel
  const [
    activeMembers, revenueResult, expiringIn3Days, todayCheckIns,
    attendanceLogs, recentPayments, totalMembers, expiredMembers,
    cashResult, upiResult, currentlyInGymLogs, overdueUsers,
    planDistRaw
  ] = await Promise.all([
    // Active members
    prisma.user.count({
      where: {
        ...where,
        memberTickets: {
          some: {
            expireDate: { gte: now },
          },
        },
      },
    }),
    // Revenue this month
    prisma.payment.aggregate({
      where: {
        ...where,
        createdAt: { gte: monthStart, lt: monthEnd },
      },
      _sum: { amount: true },
    }),
    // Expiring in 3 days
    prisma.memberTicket.findMany({
      where: {
        ...(locationId ? { locationId } : {}),
        expireDate: { gte: now, lte: threeDaysFromNow },
      },
      include: {
        user: { select: { firstname: true, lastname: true, email: true } },
        plan: { select: { id: true, name: true } },
      },
      orderBy: { expireDate: "asc" },
    }),
    // Today's check-ins
    prisma.attendanceLog.count({
      where: {
        ...where,
        attendanceDate: { gte: todayStart, lt: todayEnd },
        userId: { not: null },
      },
    }),
    // Attendance chart data (last 30 days)
    prisma.attendanceLog.findMany({
      where: {
        ...where,
        attendanceDate: { gte: thirtyDaysAgo },
        userId: { not: null },
      },
      select: { attendanceDate: true },
    }),
    // Revenue chart data (last 7 days)
    prisma.payment.findMany({
      where: {
        ...where,
        createdAt: { gte: sevenDaysAgo },
      },
      select: { amount: true, paymentMode: true, createdAt: true },
    }),
    // Total members
    prisma.user.count({ where }),
    // Expired members
    prisma.user.count({
      where: {
        ...where,
        memberTickets: {
          some: {},
        },
        NOT: {
          memberTickets: {
            some: {
              expireDate: { gte: now },
            },
          },
        },
      },
    }),
    // Cash this month
    prisma.payment.aggregate({
      where: {
        ...where,
        createdAt: { gte: monthStart, lt: monthEnd },
        paymentMode: "Cash",
      },
      _sum: { amount: true },
    }),
    // UPI this month
    prisma.payment.aggregate({
      where: {
        ...where,
        createdAt: { gte: monthStart, lt: monthEnd },
        paymentMode: "UPI",
      },
      _sum: { amount: true },
    }),
    // Currently in gym
    prisma.attendanceLog.findMany({
      where: {
        ...where,
        attendanceDate: { gte: todayStart, lt: todayEnd },
        userId: { not: null },
        checkOut: null,
      },
      include: {
        user: { select: { firstname: true, lastname: true } },
      },
    }),
    // Overdue members
    prisma.user.findMany({
      where: {
        ...where,
        memberTickets: {
          some: {},
        },
        NOT: {
          memberTickets: {
            some: {
              expireDate: { gte: sevenDaysAgoDate },
            },
          },
        },
      },
      include: {
        memberTickets: {
          orderBy: { expireDate: "desc" },
          take: 1,
          include: { plan: { select: { id: true, name: true } } },
        },
      },
      take: 50,
    }),
    // Plan distribution
    prisma.memberTicket.groupBy({
      by: ["planId"],
      where: {
        ...(locationId ? { locationId } : {}),
        expireDate: { gte: now },
      },
      _count: { id: true },
    }),
  ]);

  // Birthday queries (raw SQL, separate Promise.all)
  const [todayBirthdaysRaw, upcomingBirthdaysRaw] = await Promise.all([
    prisma.$queryRaw<
      { id: number; firstname: string; lastname: string; phone: string | null }[]
    >`
      SELECT id, firstname, lastname, phone
      FROM "User"
      WHERE birthdate IS NOT NULL
        AND EXTRACT(MONTH FROM birthdate) = ${todayMonth}
        AND EXTRACT(DAY FROM birthdate) = ${todayDay}
    `,
    prisma.$queryRaw<
      { id: number; firstname: string; lastname: string; phone: string | null; days_until: number }[]
    >`
      WITH birthdays AS (
        SELECT id, firstname, lastname, phone,
          CASE
            WHEN EXTRACT(MONTH FROM birthdate) = 2 AND EXTRACT(DAY FROM birthdate) = 29
              AND NOT (${thisYear}::int % 4 = 0 AND (${thisYear}::int % 100 != 0 OR ${thisYear}::int % 400 = 0))
              THEN MAKE_DATE(${thisYear}::int, 3, 1)
            ELSE MAKE_DATE(${thisYear}::int, EXTRACT(MONTH FROM birthdate)::int, EXTRACT(DAY FROM birthdate)::int)
          END as this_year_bd,
          CASE
            WHEN EXTRACT(MONTH FROM birthdate) = 2 AND EXTRACT(DAY FROM birthdate) = 29
              AND NOT (${thisYear + 1}::int % 4 = 0 AND (${thisYear + 1}::int % 100 != 0 OR ${thisYear + 1}::int % 400 = 0))
              THEN MAKE_DATE(${thisYear + 1}::int, 3, 1)
            ELSE MAKE_DATE(${thisYear + 1}::int, EXTRACT(MONTH FROM birthdate)::int, EXTRACT(DAY FROM birthdate)::int)
          END as next_year_bd
        FROM "User"
        WHERE birthdate IS NOT NULL
      )
      SELECT id, firstname, lastname, phone,
        CASE
          WHEN this_year_bd > CURRENT_DATE THEN this_year_bd - CURRENT_DATE
          ELSE next_year_bd - CURRENT_DATE
        END as days_until
      FROM birthdays
      WHERE CASE
          WHEN this_year_bd > CURRENT_DATE THEN this_year_bd - CURRENT_DATE
          ELSE next_year_bd - CURRENT_DATE
        END BETWEEN 1 AND 7
      ORDER BY days_until
    `,
  ]);

  const todayBirthdays = todayBirthdaysRaw.map((u) => ({
    id: u.id,
    name: `${u.firstname} ${u.lastname}`,
    phone: u.phone || "-",
  }));

  const upcomingBirthdays = upcomingBirthdaysRaw.map((u) => ({
    id: u.id,
    name: `${u.firstname} ${u.lastname}`,
    phone: u.phone || "-",
    daysUntil: Number(u.days_until),
  }));

  // Process revenue
  const revenueThisMonth = revenueResult._sum.amount
    ? Number(revenueResult._sum.amount)
    : 0;
  const cashThisMonth = cashResult._sum.amount
    ? Number(cashResult._sum.amount)
    : 0;
  const upiThisMonth = upiResult._sum.amount
    ? Number(upiResult._sum.amount)
    : 0;

  // Process attendance chart
  const attendanceMap = new Map<string, number>();
  for (const log of attendanceLogs) {
    const key = log.attendanceDate.toISOString().split("T")[0];
    attendanceMap.set(key, (attendanceMap.get(key) || 0) + 1);
  }

  const attendanceChartData: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split("T")[0];
    attendanceChartData.push({ date: key, count: attendanceMap.get(key) || 0 });
  }

  // Process revenue chart
  const revenueChartMap = new Map<
    string,
    { cash: number; upi: number; other: number }
  >();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split("T")[0];
    revenueChartMap.set(key, { cash: 0, upi: 0, other: 0 });
  }

  for (const p of recentPayments) {
    const key = p.createdAt.toISOString().split("T")[0];
    const entry = revenueChartMap.get(key);
    if (!entry) continue;
    const amt = Number(p.amount);
    const mode = p.paymentMode.toLowerCase();
    if (mode === "cash") entry.cash += amt;
    else if (mode === "upi") entry.upi += amt;
    else entry.other += amt;
  }

  const revenueChartData = Array.from(revenueChartMap.entries()).map(
    ([date, vals]) => ({
      date,
      cash: vals.cash,
      upi: vals.upi,
      other: vals.other,
    })
  );

  // Process currently in gym
  const currentlyInGym = currentlyInGymLogs.map((log) => ({
    name: `${log.user!.firstname} ${log.user!.lastname}`,
    checkInTime: log.checkIn.toISOString(),
  }));

  // Process overdue members
  const overdueMembers = overdueUsers.map((u) => ({
    userId: u.id,
    name: `${u.firstname} ${u.lastname}`,
    phone: u.phone || "-",
    expiredSince: u.memberTickets[0].expireDate.toISOString(),
    lastPlan: u.memberTickets[0].plan.name,
    lastPlanId: u.memberTickets[0].plan.id,
  }));

  // Plan distribution: depends on planDistRaw
  const planIds = planDistRaw.map((p) => p.planId);
  const plans = await prisma.ticketPlan.findMany({
    where: { id: { in: planIds } },
    select: { id: true, name: true },
  });
  const planNameMap = new Map(plans.map((p) => [p.id, p.name]));

  const planDistribution = planDistRaw.map((p) => ({
    planName: planNameMap.get(p.planId) || "Unknown",
    activeCount: p._count.id,
  }));

  // Serialize expiringIn3Days for cache compatibility (Dates → strings)
  const serializedExpiring = expiringIn3Days.map((t) => ({
    id: t.id,
    userId: t.userId,
    locationId: t.locationId,
    expireDate: t.expireDate.toISOString(),
    user: { firstname: t.user.firstname, lastname: t.user.lastname, email: t.user.email },
    plan: { id: t.plan.id, name: t.plan.name },
  }));

  return {
    activeMembers,
    revenueThisMonth,
    expiringIn3Days: serializedExpiring,
    todayCheckIns,
    attendanceChartData,
    revenueChartData,
    totalMembers,
    expiredMembers,
    cashThisMonth,
    upiThisMonth,
    currentlyInGym,
    overdueMembers,
    planDistribution,
    todayBirthdays,
    upcomingBirthdays,
  };
}

export async function getPreviousMonthStats(locationId?: number) {
  const where = locationId ? { locationId } : {};
  const now = todayIST();

  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  // Active members at end of previous month (had ticket expiring after prev month end)
  const activeMembers = await prisma.user.count({
    where: {
      ...where,
      memberTickets: {
        some: {
          expireDate: { gte: prevMonthEnd },
          createdAt: { lt: prevMonthEnd },
        },
      },
    },
  });

  // Revenue for previous month
  const revenueResult = await prisma.payment.aggregate({
    where: {
      ...where,
      createdAt: { gte: prevMonthStart, lt: prevMonthEnd },
    },
    _sum: { amount: true },
  });
  const revenue = revenueResult._sum.amount
    ? Number(revenueResult._sum.amount)
    : 0;

  return { activeMembers, revenue };
}

export async function getDailyCollection(locationId?: number) {
  const todayStart = todayIST();
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const where: Record<string, unknown> = {
    createdAt: { gte: todayStart, lt: todayEnd },
  };
  if (locationId) where.locationId = locationId;

  const payments = await prisma.payment.findMany({
    where,
    select: {
      amount: true,
      paymentMode: true,
      collectedById: true,
      collectedBy: { select: { firstname: true, lastname: true } },
    },
  });

  let cash = 0;
  let upi = 0;
  let card = 0;
  let cheque = 0;
  let total = 0;

  const staffMap = new Map<number, { name: string; total: number }>();

  for (const p of payments) {
    const amt = Number(p.amount);
    total += amt;
    const mode = p.paymentMode.toLowerCase();
    if (mode === "cash") cash += amt;
    else if (mode === "upi") upi += amt;
    else if (mode === "card") card += amt;
    else if (mode === "cheque") cheque += amt;

    const existing = staffMap.get(p.collectedById);
    if (existing) {
      existing.total += amt;
    } else {
      staffMap.set(p.collectedById, {
        name: `${p.collectedBy.firstname} ${p.collectedBy.lastname}`,
        total: amt,
      });
    }
  }

  return {
    byMode: { cash, upi, card, cheque, total },
    byStaff: Array.from(staffMap.values()),
  };
}

export async function getStaffPerformance(monthStart: Date, monthEnd: Date) {
  const [workers, paymentsByWorker, attendance] = await Promise.all([
    prisma.worker.findMany({
      where: { isActive: true },
      select: { id: true, firstname: true, lastname: true, role: true },
    }),
    prisma.payment.groupBy({
      by: ["collectedById", "paymentMode"],
      where: { createdAt: { gte: monthStart, lt: monthEnd } },
      _sum: { amount: true },
      _count: { id: true },
    }),
    prisma.attendanceLog.findMany({
      where: {
        attendanceDate: { gte: monthStart, lt: monthEnd },
        userId: { not: null },
        workerId: null,
      },
      select: { id: true },
    }),
  ]);

  // Build a map from the groupBy results
  const workerStatsMap = new Map<number, { cash: number; upi: number; count: number }>();
  for (const row of paymentsByWorker) {
    const existing = workerStatsMap.get(row.collectedById) || { cash: 0, upi: 0, count: 0 };
    const amt = Number(row._sum.amount || 0);
    const mode = row.paymentMode.toLowerCase();
    if (mode === "cash") existing.cash += amt;
    else if (mode === "upi") existing.upi += amt;
    existing.count += row._count.id;
    workerStatsMap.set(row.collectedById, existing);
  }

  const result = workers.map((w) => {
    const s = workerStatsMap.get(w.id) || { cash: 0, upi: 0, count: 0 };
    return {
      id: w.id,
      name: `${w.firstname} ${w.lastname}`,
      role: w.role,
      renewalCount: s.count,
      cashCollected: s.cash,
      upiCollected: s.upi,
      totalCollected: s.cash + s.upi,
    };
  });

  const totalCheckIns = attendance.length;

  return { staff: result, totalCheckIns };
}

export async function getUpgradeStats(dateRange?: { from: string; to: string }, locationId?: number) {
  const where: Record<string, unknown> = {
    action: { contains: "upgrade" },
    status: "success",
  };

  if (dateRange) {
    where.createdAt = {
      gte: new Date(dateRange.from),
      lt: new Date(dateRange.to),
    };
  }

  const logs = await prisma.auditLog.findMany({
    where,
    select: { id: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  // Group by month
  const monthMap = new Map<string, number>();
  for (const log of logs) {
    const key = `${log.createdAt.getFullYear()}-${String(log.createdAt.getMonth() + 1).padStart(2, "0")}`;
    monthMap.set(key, (monthMap.get(key) || 0) + 1);
  }

  const trends = Array.from(monthMap.entries()).map(([month, count]) => ({ month, count }));

  return {
    count: logs.length,
    trends,
  };
}

export async function getProfitLoss(month: string, locationId?: number) {
  const [year, mon] = month.split("-").map(Number);
  const monthStart = new Date(year, mon - 1, 1);
  const monthEnd = new Date(year, mon, 1);

  const where: Record<string, unknown> = {};
  if (locationId) where.locationId = locationId;

  // Revenue from payments
  const revenueResult = await prisma.payment.aggregate({
    where: {
      ...where,
      createdAt: { gte: monthStart, lt: monthEnd },
    },
    _sum: { amount: true },
  });
  const revenue = revenueResult._sum.amount ? Number(revenueResult._sum.amount) : 0;

  // Expenses
  const expenseResult = await prisma.expense.aggregate({
    where: {
      ...where,
      expenseDate: { gte: monthStart, lt: monthEnd },
    },
    _sum: { amount: true },
  });
  const expenses = expenseResult._sum.amount ? Number(expenseResult._sum.amount) : 0;

  return {
    revenue,
    expenses,
    netProfitLoss: revenue - expenses,
  };
}

// --- Cached wrappers ---

export const getCachedStats = unstable_cache(
  async (locationId?: number) => getStats(locationId),
  ["dashboard-stats"],
  { tags: ["dashboard", "members", "payments", "attendance"], revalidate: 60 }
);

export const getCachedPreviousMonthStats = unstable_cache(
  async (locationId?: number) => getPreviousMonthStats(locationId),
  ["dashboard-previous-month-stats"],
  { tags: ["dashboard", "payments"], revalidate: 300 }
);

export const getCachedProfitLoss = unstable_cache(
  async (month: string, locationId?: number) => getProfitLoss(month, locationId),
  ["dashboard-profit-loss"],
  { tags: ["dashboard", "payments"], revalidate: 60 }
);

export const getCachedStaffPerformance = unstable_cache(
  async (monthStartISO: string, monthEndISO: string) =>
    getStaffPerformance(new Date(monthStartISO), new Date(monthEndISO)),
  ["dashboard-staff-performance"],
  { tags: ["dashboard", "payments"], revalidate: 120 }
);
