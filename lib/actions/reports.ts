"use server";

import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/auth-guard";
import { getIrregularMembers } from "@/lib/services/irregular-members";
import { getConversionFunnel } from "@/lib/services/conversion-funnel";

export async function getCollectionReport(date: string, locationId?: number) {
  try { await requireWorker(["admin"]); } catch { return []; }
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  const where: Record<string, unknown> = {
    createdAt: { gte: dayStart, lte: dayEnd },
    userId: { not: null },
    memberTicketId: { not: null },
  };
  if (locationId) where.locationId = locationId;

  const payments = await prisma.payment.findMany({
    where,
    include: {
      user: true,
      memberTicket: { include: { plan: true } },
      collectedBy: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return payments.map((p) => ({
    id: p.id,
    memberName: p.user ? `${p.user.firstname} ${p.user.lastname}` : "—",
    planName: p.memberTicket?.plan.name ?? "—",
    amount: Number(p.amount),
    paymentMode: p.paymentMode,
    upiReference: p.upiReference,
    collectedBy: `${p.collectedBy.firstname} ${p.collectedBy.lastname}`,
    time: p.createdAt.toISOString(),
  }));
}

export type MemberReportRow = {
  id: number;
  name: string;
  email: string;
  phone: string;
  location: string;
  plan: string;
  status: "active" | "expired" | "no_plan";
  expiry: string;
};

export type MemberReportResult = {
  rows: MemberReportRow[];
  totalCount: number;
  page: number;
  pageSize: number;
};

const MEMBER_REPORT_DEFAULT_PAGE_SIZE = 100;
const MEMBER_REPORT_MAX_PAGE_SIZE = 500;

export async function getMemberReport(
  status?: string,
  locationId?: number,
  page: number = 1,
  pageSize: number = MEMBER_REPORT_DEFAULT_PAGE_SIZE
): Promise<MemberReportResult> {
  try {
    await requireWorker(["admin"]);
  } catch {
    return { rows: [], totalCount: 0, page: 1, pageSize: MEMBER_REPORT_DEFAULT_PAGE_SIZE };
  }

  const safePage = Math.max(1, Math.floor(page) || 1);
  const safePageSize = Math.min(
    MEMBER_REPORT_MAX_PAGE_SIZE,
    Math.max(1, Math.floor(pageSize) || MEMBER_REPORT_DEFAULT_PAGE_SIZE)
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Push status filter into SQL when possible so we don't scan all users
  // and discard most of them in JS.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (locationId) where.locationId = locationId;

  if (status === "active") {
    where.memberTickets = {
      some: { expireDate: { gte: today }, status: "active" },
    };
  } else if (status === "expired") {
    where.memberTickets = { some: { expireDate: { lt: today } } };
    where.NOT = {
      memberTickets: { some: { expireDate: { gte: today }, status: "active" } },
    };
  } else if (status === "no_plan") {
    where.memberTickets = { none: {} };
  }

  const [users, totalCount] = await Promise.all([
    prisma.user.findMany({
      where,
      // Narrow the select to only the fields the report renders.
      select: {
        id: true,
        firstname: true,
        lastname: true,
        email: true,
        phone: true,
        location: { select: { name: true } },
        memberTickets: {
          orderBy: { expireDate: "desc" },
          take: 1,
          select: {
            expireDate: true,
            plan: { select: { name: true } },
          },
        },
      },
      orderBy: { id: "asc" },
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
    }),
    prisma.user.count({ where }),
  ]);

  const rows: MemberReportRow[] = users.map((u) => {
    let memberStatus: "active" | "expired" | "no_plan" = "no_plan";
    let planName = "-";
    let expiry = "-";
    if (u.memberTickets.length > 0) {
      const latest = u.memberTickets[0];
      planName = latest.plan.name;
      expiry = latest.expireDate.toISOString();
      memberStatus = new Date(latest.expireDate) >= today ? "active" : "expired";
    }
    return {
      id: u.id,
      name: `${u.firstname} ${u.lastname}`,
      email: u.email,
      phone: u.phone ?? "-",
      location: u.location?.name ?? "N/A",
      plan: planName,
      status: memberStatus,
      expiry,
    };
  });

  return { rows, totalCount, page: safePage, pageSize: safePageSize };
}

export async function getLoginHistory(fromDate: string, toDate: string) {
  try { await requireWorker(["admin"]); } catch { return []; }
  const from = new Date(fromDate);
  from.setHours(0, 0, 0, 0);
  const to = new Date(toDate);
  to.setHours(23, 59, 59, 999);

  const logs = await prisma.auditLog.findMany({
    where: {
      action: "login",
      createdAt: { gte: from, lte: to },
    },
    orderBy: { createdAt: "desc" },
  });

  return logs.map((l) => ({
    id: l.id,
    actorType: l.actorType ?? "-",
    details: l.details ?? "{}",
    createdAt: l.createdAt.toISOString(),
  }));
}

export async function getAttendanceReport(
  fromDate: string,
  toDate: string,
  locationId?: number
) {
  try { await requireWorker(["admin"]); } catch { return []; }
  const from = new Date(fromDate);
  from.setHours(0, 0, 0, 0);
  const to = new Date(toDate);
  to.setHours(23, 59, 59, 999);

  const where: Record<string, unknown> = {
    checkIn: { gte: from, lte: to },
    userId: { not: null },
  };
  if (locationId) where.locationId = locationId;

  const logs = await prisma.attendanceLog.findMany({
    where,
    include: {
      user: true,
      location: true,
    },
    orderBy: { checkIn: "desc" },
  });

  return logs.map((l) => ({
    id: l.id,
    date: l.attendanceDate.toISOString(),
    memberName: l.user ? `${l.user.firstname} ${l.user.lastname}` : "Unknown",
    checkIn: l.checkIn.toISOString(),
    checkOut: l.checkOut ? l.checkOut.toISOString() : null,
    source: l.source,
    location: l.location.name,
  }));
}

export async function getProfitLossReport(
  month: number,
  year: number,
  locationId?: number
) {
  try { await requireWorker(["admin"]); } catch { return { revenue: 0, expenses: 0, net: 0, revenueByMode: {} as Record<string, number>, expensesByCategory: {} as Record<string, number> }; }

  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59, 999);

  const paymentWhere: Record<string, unknown> = {
    createdAt: { gte: from, lte: to },
  };
  if (locationId) paymentWhere.locationId = locationId;

  const payments = await prisma.payment.findMany({ where: paymentWhere });

  const revenueByMode: Record<string, number> = {};
  let revenue = 0;
  for (const p of payments) {
    const amt = Number(p.amount);
    revenue += amt;
    revenueByMode[p.paymentMode] = (revenueByMode[p.paymentMode] ?? 0) + amt;
  }

  const expenseWhere: Record<string, unknown> = {
    expenseDate: { gte: from, lte: to },
  };
  if (locationId) expenseWhere.locationId = locationId;

  const expenseRows = await prisma.expense.findMany({ where: expenseWhere });

  const expensesByCategory: Record<string, number> = {};
  let expenses = 0;
  for (const e of expenseRows) {
    const amt = Number(e.amount);
    expenses += amt;
    expensesByCategory[e.category] = (expensesByCategory[e.category] ?? 0) + amt;
  }

  return { revenue, expenses, net: revenue - expenses, revenueByMode, expensesByCategory };
}

export async function getMembershipMatrix(locationId?: number) {
  try { await requireWorker(["admin"]); } catch { return []; }

  const groups = await prisma.memberTicket.groupBy({
    by: ["planId", "status"],
    _count: true,
    where: locationId ? { locationId } : {},
  });

  const plans = await prisma.ticketPlan.findMany();
  const planMap = new Map(plans.map((p) => [p.id, p.name]));

  const matrix: Record<number, { planName: string; active: number; cancelled: number; total: number }> = {};
  for (const g of groups) {
    if (!matrix[g.planId]) {
      matrix[g.planId] = { planName: planMap.get(g.planId) ?? `Plan #${g.planId}`, active: 0, cancelled: 0, total: 0 };
    }
    if (g.status === "active") matrix[g.planId].active += g._count;
    else if (g.status === "cancelled") matrix[g.planId].cancelled += g._count;
    matrix[g.planId].total += g._count;
  }

  return Object.values(matrix);
}

export async function getSourceAnalysis(locationId?: number) {
  try { await requireWorker(["admin"]); } catch { return []; }

  const filter: Record<string, unknown> = locationId ? { locationId } : {};

  const totalGroups = await prisma.enquiry.groupBy({
    by: ["source"],
    _count: true,
    where: filter,
  });

  const convertedGroups = await prisma.enquiry.groupBy({
    by: ["source"],
    _count: true,
    where: { ...filter, convertedUserId: { not: null } },
  });

  const convertedMap = new Map(convertedGroups.map((g) => [g.source, g._count]));

  return totalGroups.map((g) => {
    const total = g._count;
    const converted = convertedMap.get(g.source) ?? 0;
    return {
      source: g.source,
      total,
      converted,
      conversionRate: total > 0 ? Math.round((converted / total) * 10000) / 100 : 0,
    };
  });
}

export async function getIrregularMembersReport(daysThreshold: number = 7, locationId?: number) {
  try { await requireWorker(["admin"]); } catch { return []; }
  return getIrregularMembers(daysThreshold, locationId);
}

export async function getConversionFunnelReport(startDate?: string, endDate?: string, locationId?: number) {
  try { await requireWorker(["admin"]); } catch { return { stages: [], totalConversionRate: 0 }; }
  const params: { startDate?: Date; endDate?: Date; locationId?: number } = {};
  if (startDate) {
    params.startDate = new Date(startDate);
    params.startDate.setHours(0, 0, 0, 0);
  }
  if (endDate) {
    params.endDate = new Date(endDate);
    params.endDate.setHours(23, 59, 59, 999);
  }
  if (locationId) params.locationId = locationId;
  return getConversionFunnel(params);
}
