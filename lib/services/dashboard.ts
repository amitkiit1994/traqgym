import { prisma } from "@/lib/prisma";
import { todayIST } from "@/lib/utils/date";

export async function getStats(locationId?: number) {
  const where = locationId ? { locationId } : {};
  const now = todayIST();

  // Active members: users who have a non-expired MemberTicket
  const activeMembers = await prisma.user.count({
    where: {
      ...where,
      memberTickets: {
        some: {
          expireDate: { gte: now },
        },
      },
    },
  });

  // Revenue this month
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const revenueResult = await prisma.payment.aggregate({
    where: {
      ...where,
      createdAt: { gte: monthStart, lt: monthEnd },
    },
    _sum: { amount: true },
  });
  const revenueThisMonth = revenueResult._sum.amount
    ? Number(revenueResult._sum.amount)
    : 0;

  // Expiring in 3 days
  const threeDaysFromNow = new Date(now);
  threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

  const expiringIn3Days = await prisma.memberTicket.findMany({
    where: {
      ...(locationId ? { locationId } : {}),
      expireDate: { gte: now, lte: threeDaysFromNow },
    },
    include: {
      user: { select: { firstname: true, lastname: true, email: true } },
      plan: { select: { id: true, name: true } },
    },
    orderBy: { expireDate: "asc" },
  });

  // Today's check-ins
  const todayStart = new Date(now);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const todayCheckIns = await prisma.attendanceLog.count({
    where: {
      ...where,
      attendanceDate: { gte: todayStart, lt: todayEnd },
      userId: { not: null },
    },
  });

  // Attendance chart data (last 30 days)
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const attendanceLogs = await prisma.attendanceLog.findMany({
    where: {
      ...where,
      attendanceDate: { gte: thirtyDaysAgo },
      userId: { not: null },
    },
    select: { attendanceDate: true },
  });

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

  // Revenue chart data (last 7 days by payment mode)
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const recentPayments = await prisma.payment.findMany({
    where: {
      ...where,
      createdAt: { gte: sevenDaysAgo },
    },
    select: { amount: true, paymentMode: true, createdAt: true },
  });

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

  // Total members
  const totalMembers = await prisma.user.count({ where });

  // Expired members: users whose latest ticket is expired and have no active ticket
  const expiredMembers = await prisma.user.count({
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
  });

  // Cash vs UPI this month
  const cashResult = await prisma.payment.aggregate({
    where: {
      ...where,
      createdAt: { gte: monthStart, lt: monthEnd },
      paymentMode: "Cash",
    },
    _sum: { amount: true },
  });
  const cashThisMonth = cashResult._sum.amount
    ? Number(cashResult._sum.amount)
    : 0;

  const upiResult = await prisma.payment.aggregate({
    where: {
      ...where,
      createdAt: { gte: monthStart, lt: monthEnd },
      paymentMode: "UPI",
    },
    _sum: { amount: true },
  });
  const upiThisMonth = upiResult._sum.amount
    ? Number(upiResult._sum.amount)
    : 0;

  // Currently in gym: checked in today, no checkOut
  const currentlyInGymLogs = await prisma.attendanceLog.findMany({
    where: {
      ...where,
      attendanceDate: { gte: todayStart, lt: todayEnd },
      userId: { not: null },
      checkOut: null,
    },
    include: {
      user: { select: { firstname: true, lastname: true } },
    },
  });

  const currentlyInGym = currentlyInGymLogs.map((log) => ({
    name: `${log.user!.firstname} ${log.user!.lastname}`,
    checkInTime: log.checkIn.toISOString(),
  }));

  // Overdue members: expired > 7 days ago, no renewal
  const sevenDaysAgoDate = new Date(now);
  sevenDaysAgoDate.setDate(sevenDaysAgoDate.getDate() - 7);

  const overdueUsers = await prisma.user.findMany({
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
  });

  const overdueMembers = overdueUsers.map((u) => ({
    userId: u.id,
    name: `${u.firstname} ${u.lastname}`,
    phone: u.phone || "-",
    expiredSince: u.memberTickets[0].expireDate.toISOString(),
    lastPlan: u.memberTickets[0].plan.name,
    lastPlanId: u.memberTickets[0].plan.id,
  }));

  // Plan distribution: active tickets grouped by plan
  const planDistRaw = await prisma.memberTicket.groupBy({
    by: ["planId"],
    where: {
      ...(locationId ? { locationId } : {}),
      expireDate: { gte: now },
    },
    _count: { id: true },
  });

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

  // Birthdays
  const allUsersWithBirthday = await prisma.user.findMany({
    where: { birthdate: { not: null } },
    select: { id: true, firstname: true, lastname: true, phone: true, birthdate: true },
  });

  const todayMonth = now.getMonth() + 1;
  const todayDay = now.getDate();

  const todayBirthdays = allUsersWithBirthday
    .filter((u) => {
      const bd = u.birthdate!;
      return bd.getMonth() + 1 === todayMonth && bd.getDate() === todayDay;
    })
    .map((u) => ({
      id: u.id,
      name: `${u.firstname} ${u.lastname}`,
      phone: u.phone || "-",
    }));

  const upcomingBirthdays: { id: number; name: string; phone: string; daysUntil: number }[] = [];
  const thisYear = now.getFullYear();
  const todayOnly = new Date(thisYear, now.getMonth(), now.getDate());

  for (const u of allUsersWithBirthday) {
    const bd = u.birthdate!;
    let nextBd = new Date(thisYear, bd.getMonth(), bd.getDate());
    if (nextBd <= todayOnly) {
      nextBd = new Date(thisYear + 1, bd.getMonth(), bd.getDate());
    }
    const diffMs = nextBd.getTime() - todayOnly.getTime();
    const daysUntil = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (daysUntil > 0 && daysUntil <= 7) {
      upcomingBirthdays.push({
        id: u.id,
        name: `${u.firstname} ${u.lastname}`,
        phone: u.phone || "-",
        daysUntil,
      });
    }
  }
  upcomingBirthdays.sort((a, b) => a.daysUntil - b.daysUntil);

  return {
    activeMembers,
    revenueThisMonth,
    expiringIn3Days,
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
  const workers = await prisma.worker.findMany({
    where: { isActive: true },
    select: { id: true, firstname: true, lastname: true, role: true },
  });

  const payments = await prisma.payment.findMany({
    where: { createdAt: { gte: monthStart, lt: monthEnd } },
    select: {
      collectedById: true,
      amount: true,
      paymentMode: true,
      memberTicket: { select: { id: true } },
    },
  });

  const attendance = await prisma.attendanceLog.findMany({
    where: {
      attendanceDate: { gte: monthStart, lt: monthEnd },
      userId: { not: null },
      workerId: null,
    },
    select: { id: true },
  });

  const result = workers.map((w) => {
    const workerPayments = payments.filter((p) => p.collectedById === w.id);
    const cashTotal = workerPayments
      .filter((p) => p.paymentMode.toLowerCase() === "cash")
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const upiTotal = workerPayments
      .filter((p) => p.paymentMode.toLowerCase() === "upi")
      .reduce((sum, p) => sum + Number(p.amount), 0);

    return {
      id: w.id,
      name: `${w.firstname} ${w.lastname}`,
      role: w.role,
      renewalCount: workerPayments.length,
      cashCollected: cashTotal,
      upiCollected: upiTotal,
      totalCollected: cashTotal + upiTotal,
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
