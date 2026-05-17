import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { todayIST, istCalendar, istMidnight } from "@/lib/utils/date";
import { unstable_cache } from "next/cache";

export async function getStats(locationId?: number) {
  const where = locationId ? { locationId } : {};
  const now = todayIST();
  const ist = istCalendar();

  const monthStart = istMidnight(ist.year, ist.month, 1);
  const monthEnd = istMidnight(ist.year, ist.month + 1, 1);

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

  const todayMonth = ist.month + 1;
  const todayDay = ist.day;
  const thisYear = ist.year;

  // Run all independent queries in parallel
  const [
    activeMembers, revenueResult, expiringIn3Days, todayCheckIns,
    attendanceLogs, recentPayments, totalMembers, expiredMembers,
    cashResult, upiResult, currentlyInGymLogs, overdueUsers,
    planDistRaw
  ] = await Promise.all([
    // Active members
    // C4: only count currently-usable tickets — exclude cancelled, expired, upgraded, renewed.
    // Also exclude members whose ticket is currently frozen (freeze does not flip ticket.status).
    prisma.user.count({
      where: {
        ...where,
        memberTickets: {
          some: {
            status: "active",
            expireDate: { gte: now },
          },
        },
        NOT: {
          freezes: {
            some: {
              status: "active",
              freezeStart: { lte: now },
              freezeEnd: { gte: now },
            },
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
    // Expiring in 3 days — only active tickets (exclude already-renewed/cancelled).
    prisma.memberTicket.findMany({
      where: {
        ...(locationId ? { locationId } : {}),
        status: "active",
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
    // Cash this month — M6: canonical lowercase + case-insensitive match
    prisma.payment.aggregate({
      where: {
        ...where,
        createdAt: { gte: monthStart, lt: monthEnd },
        paymentMode: { equals: "cash", mode: "insensitive" },
      },
      _sum: { amount: true },
    }),
    // UPI this month — M6: canonical lowercase + case-insensitive match
    prisma.payment.aggregate({
      where: {
        ...where,
        createdAt: { gte: monthStart, lt: monthEnd },
        paymentMode: { equals: "upi", mode: "insensitive" },
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
    // Overdue members — surface ALL expired members (M4: removed 90-day floor)
    prisma.user.findMany({
      where: {
        ...where,
        memberTickets: {
          some: {
            expireDate: { lt: sevenDaysAgoDate },
          },
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
        AND id IN (SELECT "userId" FROM "MemberTicket" WHERE "expireDate" >= CURRENT_DATE)
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
          AND id IN (SELECT "userId" FROM "MemberTicket" WHERE "expireDate" >= CURRENT_DATE)
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
  const ist = istCalendar();

  const prevMonthEnd = istMidnight(ist.year, ist.month, 1);
  const prevMonthStart = istMidnight(ist.year, ist.month - 1, 1);

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
    // C1: exclude complimentary payments from daily collection totals + staff breakdown
    NOT: { paymentMode: { equals: "complimentary", mode: "insensitive" } },
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
      // M7: defensive null-coalesce — POS sale paths recently became more permissive
      const firstname = p.collectedBy?.firstname ?? "Unknown";
      const lastname = p.collectedBy?.lastname ?? "";
      staffMap.set(p.collectedById, {
        name: `${firstname} ${lastname}`.trim(),
        total: amt,
      });
    }
  }

  return {
    byMode: { cash, upi, card, cheque, total },
    byStaff: Array.from(staffMap.values()),
  };
}

/**
 * Total collections in an arbitrary date range — broken down per day, by
 * payment mode, and by PT vs non-PT plan. Used by the AI agent's
 * `get_collections_in_range` tool to answer "how much did we collect from X
 * to Y?" questions.
 *
 * Range is inclusive on both ends (whole days).
 * Complimentary payments are EXCLUDED (matches getDailyCollection behaviour).
 */
export async function getCollectionsInRange(
  fromInclusive: Date,
  toInclusive: Date,
  locationId?: number,
) {
  const endExclusive = new Date(toInclusive);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  const where: Record<string, unknown> = {
    createdAt: { gte: fromInclusive, lt: endExclusive },
    NOT: { paymentMode: { equals: "complimentary", mode: "insensitive" } },
  };
  if (locationId) where.locationId = locationId;

  const payments = await prisma.payment.findMany({
    where,
    select: {
      amount: true,
      paymentMode: true,
      createdAt: true,
      memberTicket: { select: { plan: { select: { name: true } } } },
    },
  });

  let total = 0;
  let cash = 0;
  let upi = 0;
  let card = 0;
  let cheque = 0;
  let other = 0;
  let ptTotal = 0;
  let ptCount = 0;

  const byDay = new Map<string, { date: string; total: number; pt: number; nonPt: number; count: number }>();

  for (const p of payments) {
    const amt = Number(p.amount);
    total += amt;
    const day = p.createdAt.toISOString().slice(0, 10);
    const entry = byDay.get(day) ?? { date: day, total: 0, pt: 0, nonPt: 0, count: 0 };
    entry.total += amt;
    entry.count += 1;

    const planName = (p.memberTicket?.plan?.name ?? "").trim();
    const isPt = /\bP(?:T|OT)\b|\bOPT\b/i.test(planName);
    if (isPt) {
      ptTotal += amt;
      ptCount += 1;
      entry.pt += amt;
    } else {
      entry.nonPt += amt;
    }
    byDay.set(day, entry);

    const mode = p.paymentMode.toLowerCase();
    if (mode === "cash") cash += amt;
    else if (mode === "upi" || mode === "gpay") upi += amt;
    else if (mode === "card" || mode.includes("credit") || mode.includes("debit")) card += amt;
    else if (mode === "cheque") cheque += amt;
    else other += amt;
  }

  return {
    range: {
      from: fromInclusive.toISOString().slice(0, 10),
      to: toInclusive.toISOString().slice(0, 10),
    },
    transactionCount: payments.length,
    total,
    byMode: { cash, upi, card, cheque, other },
    pt: { total: ptTotal, count: ptCount },
    nonPt: { total: total - ptTotal, count: payments.length - ptCount },
    byDay: Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/**
 * Memberships that expired within the given inclusive date range.
 * Returns count + sum-of-paid value + per-plan breakdown.
 * Used by AI tool get_expired_memberships_in_range.
 */
export async function getExpiredMembershipsInRange(
  fromInclusive: Date,
  toInclusive: Date,
  locationId?: number,
) {
  const endExclusive = new Date(toInclusive);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  const where: Record<string, unknown> = {
    expireDate: { gte: fromInclusive, lt: endExclusive },
  };
  if (locationId) where.locationId = locationId;

  const tickets = await prisma.memberTicket.findMany({
    where,
    select: {
      id: true,
      expireDate: true,
      totalAmount: true,
      amountPaid: true,
      plan: { select: { name: true } },
      user: { select: { id: true, firstname: true, lastname: true, phone: true } },
    },
    orderBy: { expireDate: "desc" },
  });

  let totalPaid = 0;
  let totalBilled = 0;
  const byPlan = new Map<string, { plan: string; count: number; paid: number; billed: number }>();

  for (const t of tickets) {
    const paid = Number(t.amountPaid);
    const billed = Number(t.totalAmount);
    totalPaid += paid;
    totalBilled += billed;
    const planName = t.plan?.name ?? "(no plan)";
    const entry = byPlan.get(planName) ?? { plan: planName, count: 0, paid: 0, billed: 0 };
    entry.count += 1;
    entry.paid += paid;
    entry.billed += billed;
    byPlan.set(planName, entry);
  }

  return {
    range: {
      from: fromInclusive.toISOString().slice(0, 10),
      to: toInclusive.toISOString().slice(0, 10),
    },
    count: tickets.length,
    totalPaid,
    totalBilled,
    byPlan: Array.from(byPlan.values()).sort((a, b) => b.paid - a.paid),
    sample: tickets.slice(0, 20).map((t) => ({
      memberId: t.user?.id,
      name: t.user ? `${t.user.firstname} ${t.user.lastname}` : null,
      phone: t.user?.phone,
      plan: t.plan?.name,
      expiredOn: t.expireDate.toISOString().slice(0, 10),
      paid: Number(t.amountPaid),
    })),
  };
}

/**
 * PT plan revenue split by trainer over a date range.
 * "PT" plans = plan names containing PT or OPT (case-insensitive whole-word).
 * Returns each trainer's total PT collections from member payments tied to PT plans.
 * Used by AI tool get_pt_revenue_by_trainer.
 */
export async function getPTRevenueByTrainer(
  fromInclusive: Date,
  toInclusive: Date,
  locationId?: number,
) {
  const endExclusive = new Date(toInclusive);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  const where: Record<string, unknown> = {
    createdAt: { gte: fromInclusive, lt: endExclusive },
    NOT: { paymentMode: { equals: "complimentary", mode: "insensitive" } },
  };
  if (locationId) where.locationId = locationId;

  const payments = await prisma.payment.findMany({
    where,
    select: {
      amount: true,
      trainerId: true,
      trainer: { select: { id: true, firstname: true, lastname: true } },
      memberTicket: {
        select: { plan: { select: { name: true } } },
      },
    },
  });

  const byTrainer = new Map<
    number | null,
    { trainerId: number | null; name: string; ptTotal: number; ptCount: number }
  >();
  let totalPt = 0;
  let totalPtCount = 0;

  for (const p of payments) {
    const planName = (p.memberTicket?.plan?.name ?? "").trim();
    if (!/\bP(?:T|OT)\b|\bOPT\b/i.test(planName)) continue;
    const amt = Number(p.amount);
    totalPt += amt;
    totalPtCount += 1;
    const t = p.trainer;
    const key = t?.id ?? null;
    const entry =
      byTrainer.get(key) ?? {
        trainerId: key,
        name: t ? `${t.firstname} ${t.lastname}`.trim() : "(no trainer)",
        ptTotal: 0,
        ptCount: 0,
      };
    entry.ptTotal += amt;
    entry.ptCount += 1;
    byTrainer.set(key, entry);
  }

  return {
    range: {
      from: fromInclusive.toISOString().slice(0, 10),
      to: toInclusive.toISOString().slice(0, 10),
    },
    totalPtRevenue: totalPt,
    totalPtTransactions: totalPtCount,
    byTrainer: Array.from(byTrainer.values()).sort((a, b) => b.ptTotal - a.ptTotal),
  };
}

export async function getStaffPerformance(monthStart: Date, monthEnd: Date) {
  const [workers, paymentsByWorker, distinctTicketRows, attendance] = await Promise.all([
    prisma.worker.findMany({
      where: { isActive: true },
      select: { id: true, firstname: true, lastname: true, role: true },
    }),
    prisma.payment.groupBy({
      by: ["collectedById", "paymentMode"],
      where: { createdAt: { gte: monthStart, lt: monthEnd } },
      _sum: { amount: true },
    }),
    // M2: renewal count must be DISTINCT memberTicketId per worker — partial
    // payments share a memberTicketId so raw payment-row counts double-count.
    prisma.$queryRaw<Array<{ collectedById: number; cnt: bigint }>>(Prisma.sql`
      SELECT "collectedById", COUNT(DISTINCT "memberTicketId")::bigint AS cnt
      FROM "Payment"
      WHERE "createdAt" >= ${monthStart}
        AND "createdAt" < ${monthEnd}
        AND "memberTicketId" IS NOT NULL
      GROUP BY "collectedById"
    `),
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
    // M5: use Prisma.Decimal.toNumber() for the conventional precision-aware path
    const amt = (row._sum.amount ?? new Prisma.Decimal(0)).toNumber();
    const mode = row.paymentMode.toLowerCase();
    if (mode === "cash") existing.cash += amt;
    else if (mode === "upi") existing.upi += amt;
    workerStatsMap.set(row.collectedById, existing);
  }
  // Apply distinct-ticket counts (M2)
  for (const row of distinctTicketRows) {
    const existing = workerStatsMap.get(row.collectedById) || { cash: 0, upi: 0, count: 0 };
    existing.count = Number(row.cnt);
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
  const monthStart = istMidnight(year, mon - 1, 1);
  const monthEnd = istMidnight(year, mon, 1);

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

export async function getDailyPOSCollection(locationId?: number) {
  const todayStart = todayIST();
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const where: Record<string, unknown> = {
    createdAt: { gte: todayStart, lt: todayEnd },
  };
  if (locationId) where.locationId = locationId;

  const result = await prisma.sale.aggregate({
    where,
    _sum: { totalAmount: true },
  });

  return Number(result._sum.totalAmount || 0);
}

export async function getTodayCounts(locationId?: number) {
  const now = todayIST();
  const todayStart = new Date(now);
  // M1: use exclusive end (start + 24h) for clean half-open interval semantics
  const todayEndExclusive = new Date(todayStart.getTime() + 86400000);

  const [prospects, followups, renewals, newMembers] = await Promise.all([
    prisma.enquiry.count({
      where: {
        createdAt: { gte: todayStart, lt: todayEndExclusive },
        ...(locationId ? { locationId } : {}),
      },
    }),
    prisma.enquiryFollowup.count({
      where: { createdAt: { gte: todayStart, lt: todayEndExclusive } },
    }),
    prisma.memberTicket.count({
      where: {
        buyDate: { gte: todayStart, lt: todayEndExclusive },
        ...(locationId ? { locationId } : {}),
      },
    }),
    prisma.user.count({
      where: { createdAt: { gte: todayStart, lt: todayEndExclusive } },
    }),
  ]);

  return { prospects, followups, renewals, newMembers };
}

export async function getFinancialSplit(locationId?: number) {
  const locFilter = locationId ? { locationId } : {};

  const all = await prisma.memberTicket.aggregate({
    // C3: exclude complimentary tickets from billed/received/due totals
    where: { status: { not: "cancelled" }, isComplimentary: false, ...locFilter },
    _sum: { totalAmount: true, amountPaid: true },
  });

  const billed = Number(all._sum.totalAmount || 0);
  const received = Number(all._sum.amountPaid || 0);
  return {
    billed,
    received,
    due: billed - received,
  };
}

export async function getTodayAnniversaries() {
  const ist = istCalendar();
  const todayMonth = ist.month + 1;
  const todayDay = ist.day;

  return prisma.$queryRaw<
    { id: number; firstname: string; lastname: string; phone: string | null }[]
  >`
    SELECT id, firstname, lastname, phone
    FROM "User"
    WHERE "anniversaryDate" IS NOT NULL
      AND EXTRACT(MONTH FROM "anniversaryDate") = ${todayMonth}
      AND EXTRACT(DAY FROM "anniversaryDate") = ${todayDay}
      AND id IN (SELECT "userId" FROM "MemberTicket" WHERE "expireDate" >= CURRENT_DATE)
  `;
}

export async function getUpcomingAnniversaries(days: number = 7) {
  const thisYear = istCalendar().year;

  return prisma.$queryRaw<
    { id: number; firstname: string; lastname: string; phone: string | null; days_until: number }[]
  >`
    WITH anniversaries AS (
      SELECT id, firstname, lastname, phone,
        CASE
          WHEN EXTRACT(MONTH FROM "anniversaryDate") = 2 AND EXTRACT(DAY FROM "anniversaryDate") = 29
            AND NOT (${thisYear}::int % 4 = 0 AND (${thisYear}::int % 100 != 0 OR ${thisYear}::int % 400 = 0))
            THEN MAKE_DATE(${thisYear}::int, 3, 1)
          ELSE MAKE_DATE(${thisYear}::int, EXTRACT(MONTH FROM "anniversaryDate")::int, EXTRACT(DAY FROM "anniversaryDate")::int)
        END as this_year_ann,
        CASE
          WHEN EXTRACT(MONTH FROM "anniversaryDate") = 2 AND EXTRACT(DAY FROM "anniversaryDate") = 29
            AND NOT (${thisYear + 1}::int % 4 = 0 AND (${thisYear + 1}::int % 100 != 0 OR ${thisYear + 1}::int % 400 = 0))
            THEN MAKE_DATE(${thisYear + 1}::int, 3, 1)
          ELSE MAKE_DATE(${thisYear + 1}::int, EXTRACT(MONTH FROM "anniversaryDate")::int, EXTRACT(DAY FROM "anniversaryDate")::int)
        END as next_year_ann
      FROM "User"
      WHERE "anniversaryDate" IS NOT NULL
        AND id IN (SELECT "userId" FROM "MemberTicket" WHERE "expireDate" >= CURRENT_DATE)
    )
    SELECT id, firstname, lastname, phone,
      CASE
        WHEN this_year_ann > CURRENT_DATE THEN this_year_ann - CURRENT_DATE
        ELSE next_year_ann - CURRENT_DATE
      END as days_until
    FROM anniversaries
    WHERE CASE
        WHEN this_year_ann > CURRENT_DATE THEN this_year_ann - CURRENT_DATE
        ELSE next_year_ann - CURRENT_DATE
      END BETWEEN 1 AND ${days}
    ORDER BY days_until
  `;
}

/**
 * Revenue chart data for an arbitrary date range.
 * For ranges >30 days: aggregate by week. For >90 days: by month.
 */
export async function getRevenueChartData(
  startDate: Date,
  endDate: Date,
  locationId?: number
) {
  const where = locationId ? { locationId } : {};
  const payments = await prisma.payment.findMany({
    where: {
      ...where,
      createdAt: { gte: startDate, lt: endDate },
    },
    select: { amount: true, paymentMode: true, createdAt: true },
  });

  const diffDays = Math.ceil(
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Determine bucketing: daily / weekly / monthly
  type Bucket = { cash: number; upi: number; other: number };
  const bucketMap = new Map<string, Bucket>();

  const getKey = (d: Date): string => {
    if (diffDays > 90) {
      // Monthly
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    } else if (diffDays > 30) {
      // Weekly — ISO week start (Monday)
      const day = new Date(d);
      const dow = day.getDay();
      const diff = dow === 0 ? -6 : 1 - dow;
      day.setDate(day.getDate() + diff);
      return day.toISOString().split("T")[0];
    }
    return d.toISOString().split("T")[0];
  };

  // Pre-fill buckets
  const cursor = new Date(startDate);
  while (cursor < endDate) {
    const key = getKey(cursor);
    if (!bucketMap.has(key)) {
      bucketMap.set(key, { cash: 0, upi: 0, other: 0 });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const p of payments) {
    const key = getKey(p.createdAt);
    let entry = bucketMap.get(key);
    if (!entry) {
      entry = { cash: 0, upi: 0, other: 0 };
      bucketMap.set(key, entry);
    }
    const amt = Number(p.amount);
    const mode = p.paymentMode.toLowerCase();
    if (mode === "cash") entry.cash += amt;
    else if (mode === "upi") entry.upi += amt;
    else entry.other += amt;
  }

  return Array.from(bucketMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({
      date,
      cash: vals.cash,
      upi: vals.upi,
      other: vals.other,
    }));
}

/**
 * Monthly revenue trend for the last N months.
 *
 * Sprint 3 perf: was N months × 6 queries = 72 sequential round-trips for the
 * default 12-month window. Rewritten to issue 4 raw bucketed queries (window
 * sums + per-month buckets via PostgreSQL `date_trunc`) totalling 4
 * round-trips regardless of N. On E-GYM (~14k payments) the old path
 * dominated dashboard cold-load latency; the new path is constant-time and
 * pushes the heavy lifting (group + sum) into the DB where indexes apply.
 */
export async function getMonthlyRevenueTrend(months: number = 12, locationId?: number) {
  const ist = istCalendar();
  const windowStart = istMidnight(ist.year, ist.month - (months - 1), 1);
  const windowEnd = istMidnight(ist.year, ist.month + 1, 1);

  type Bucket = { month: string; cash: number; upi: number; other: number; renewals: number; newMembers: number; expenses: number };
  const bucketMap = new Map<string, Bucket>();
  for (let i = 0; i < months; i++) {
    const m = ist.month - (months - 1) + i;
    // Normalize month into a year/month pair; JS Date constructor handles overflow.
    const norm = new Date(Date.UTC(ist.year, m, 1));
    const key = `${norm.getUTCFullYear()}-${String(norm.getUTCMonth() + 1).padStart(2, "0")}`;
    bucketMap.set(key, { month: key, cash: 0, upi: 0, other: 0, renewals: 0, newMembers: 0, expenses: 0 });
  }

  // Run all 4 bucketed queries in parallel. Each does a single index range
  // scan + group, replacing what used to be N×6 separate round-trips.
  // date_trunc applied to the IST-shifted timestamp so payments at IST-midnight
  // boundary land in the correct calendar month (matches IST window above).
  const locClause = (col: string) =>
    locationId ? Prisma.sql`AND "${Prisma.raw(col)}" = ${locationId}` : Prisma.empty;

  const [paymentRows, expenseRows, renewalRows, newMemberRows] = await Promise.all([
    prisma.$queryRaw<Array<{ month: Date; mode: string; total: number }>>(Prisma.sql`
      SELECT date_trunc('month', "createdAt" AT TIME ZONE 'Asia/Kolkata') AS month,
             "paymentMode" AS mode,
             COALESCE(SUM("amount"), 0)::float8 AS total
      FROM "Payment"
      WHERE "createdAt" >= ${windowStart} AND "createdAt" < ${windowEnd}
      ${locClause("locationId")}
      GROUP BY 1, 2
    `),
    prisma.$queryRaw<Array<{ month: Date; total: number }>>(Prisma.sql`
      SELECT date_trunc('month', "expenseDate" AT TIME ZONE 'Asia/Kolkata') AS month,
             COALESCE(SUM("amount"), 0)::float8 AS total
      FROM "Expense"
      WHERE "expenseDate" >= ${windowStart} AND "expenseDate" < ${windowEnd}
      ${locClause("locationId")}
      GROUP BY 1
    `),
    prisma.$queryRaw<Array<{ month: Date; cnt: number }>>(Prisma.sql`
      SELECT date_trunc('month', "buyDate" AT TIME ZONE 'Asia/Kolkata') AS month,
             COUNT(*)::int AS cnt
      FROM "MemberTicket"
      WHERE "buyDate" >= ${windowStart} AND "buyDate" < ${windowEnd}
      ${locClause("locationId")}
      GROUP BY 1
    `),
    prisma.$queryRaw<Array<{ month: Date; cnt: number }>>(Prisma.sql`
      SELECT date_trunc('month', "createdAt" AT TIME ZONE 'Asia/Kolkata') AS month,
             COUNT(*)::int AS cnt
      FROM "User"
      WHERE "createdAt" >= ${windowStart} AND "createdAt" < ${windowEnd}
      GROUP BY 1
    `),
  ]);

  // date_trunc result is timestamp WITHOUT TZ representing IST wall clock.
  // node-postgres reads it as if it were UTC. getUTCFullYear/Month return the
  // IST calendar fields directly.
  const monthKey = (d: Date) => {
    const dt = new Date(d);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
  };

  for (const r of paymentRows) {
    const b = bucketMap.get(monthKey(r.month));
    if (!b) continue;
    const mode = (r.mode ?? "").toLowerCase();
    if (mode === "cash") b.cash += Number(r.total);
    else if (mode === "upi") b.upi += Number(r.total);
    else b.other += Number(r.total);
  }
  for (const r of expenseRows) {
    const b = bucketMap.get(monthKey(r.month));
    if (b) b.expenses = Number(r.total);
  }
  for (const r of renewalRows) {
    const b = bucketMap.get(monthKey(r.month));
    if (b) b.renewals = Number(r.cnt);
  }
  for (const r of newMemberRows) {
    const b = bucketMap.get(monthKey(r.month));
    if (b) b.newMembers = Number(r.cnt);
  }

  return Array.from(bucketMap.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((b) => {
      const revenue = b.cash + b.upi + b.other;
      return {
        month: b.month,
        revenue,
        expenses: b.expenses,
        net: revenue - b.expenses,
        cash: b.cash,
        upi: b.upi,
        renewals: b.renewals,
        newMembers: b.newMembers,
      };
    });
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

export const getCachedDailyPOSCollection = unstable_cache(
  async (locationId?: number) => getDailyPOSCollection(locationId),
  ["dashboard-daily-pos"],
  { tags: ["dashboard", "pos"], revalidate: 60 }
);

export const getCachedTodayCounts = unstable_cache(
  async (locationId?: number) => getTodayCounts(locationId),
  ["dashboard-today-counts"],
  { tags: ["dashboard", "members", "enquiries"], revalidate: 60 }
);

export const getCachedFinancialSplit = unstable_cache(
  async (locationId?: number) => getFinancialSplit(locationId),
  ["dashboard-financial-split"],
  { tags: ["dashboard", "payments"], revalidate: 60 }
);

export const getCachedTodayAnniversaries = unstable_cache(
  async () => getTodayAnniversaries(),
  ["dashboard-today-anniversaries"],
  { tags: ["dashboard", "members"], revalidate: 300 }
);

export const getCachedUpcomingAnniversaries = unstable_cache(
  async (days: number) => getUpcomingAnniversaries(days),
  ["dashboard-upcoming-anniversaries"],
  { tags: ["dashboard", "members"], revalidate: 300 }
);
