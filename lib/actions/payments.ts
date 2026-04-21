"use server";

import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/auth-guard";
import type { Prisma } from "@prisma/client";

export type PaymentRow = {
  id: number;
  date: string; // ISO
  memberId: number | null;
  memberName: string;
  memberPhone: string | null;
  planName: string;
  amount: number;
  paymentMode: string;
  upiReference: string | null;
  paymentNote: string | null;
  collectedById: number;
  collectedBy: string;
  invoiceNumber: string | null;
  invoiceId: number | null;
  locationId: number | null;
  paymentStatus: string;
  isComplimentary: boolean;
  isRefund: boolean;
};

export type PaymentListResult = {
  rows: PaymentRow[];
  totalCount: number;
  totalAmount: number;
  page: number;
  pageSize: number;
  byMode: { mode: string; count: number; amount: number }[];
};

export type PaymentFilters = {
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
  mode?: string; // exact (case-insensitive) — empty string = all
  locationId?: number;
  collectedById?: number;
  q?: string;    // search member name/phone
  page?: number;
  pageSize?: number;
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export async function getPayments(filters: PaymentFilters = {}): Promise<PaymentListResult> {
  try {
    await requireWorker();
  } catch {
    return { rows: [], totalCount: 0, totalAmount: 0, page: 1, pageSize: DEFAULT_PAGE_SIZE, byMode: [] };
  }

  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(filters.pageSize ?? DEFAULT_PAGE_SIZE)));

  const where: Prisma.PaymentWhereInput = {};

  if (filters.from || filters.to) {
    const range: Prisma.DateTimeFilter = {};
    if (filters.from) {
      const d = new Date(filters.from);
      d.setHours(0, 0, 0, 0);
      range.gte = d;
    }
    if (filters.to) {
      const d = new Date(filters.to);
      d.setHours(23, 59, 59, 999);
      range.lte = d;
    }
    where.createdAt = range;
  }

  if (filters.mode && filters.mode.trim() !== "") {
    where.paymentMode = { equals: filters.mode.trim(), mode: "insensitive" };
  }

  if (filters.locationId) where.locationId = filters.locationId;
  if (filters.collectedById) where.collectedById = filters.collectedById;

  if (filters.q && filters.q.trim() !== "") {
    const q = filters.q.trim();
    where.user = {
      OR: [
        { firstname: { contains: q, mode: "insensitive" } },
        { lastname: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    };
  }

  const [totalCount, sumAgg, modeAgg, payments] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.aggregate({ where, _sum: { amount: true } }),
    prisma.payment.groupBy({
      by: ["paymentMode"],
      where,
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.payment.findMany({
      where,
      include: {
        user: { select: { id: true, firstname: true, lastname: true, phone: true } },
        memberTicket: { include: { plan: { select: { name: true } } } },
        collectedBy: { select: { id: true, firstname: true, lastname: true } },
        invoice: { select: { id: true, invoiceNumber: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const rows: PaymentRow[] = payments.map((p) => ({
    id: p.id,
    date: p.createdAt.toISOString(),
    memberId: p.user?.id ?? null,
    memberName: p.user ? `${p.user.firstname} ${p.user.lastname}` : "—",
    memberPhone: p.user?.phone ?? null,
    planName: p.memberTicket?.plan?.name ?? "—",
    amount: Number(p.amount),
    paymentMode: p.paymentMode,
    upiReference: p.upiReference,
    paymentNote: p.paymentNote,
    collectedById: p.collectedBy.id,
    collectedBy: `${p.collectedBy.firstname} ${p.collectedBy.lastname}`,
    invoiceNumber: p.invoice?.invoiceNumber ?? null,
    invoiceId: p.invoice?.id ?? null,
    locationId: p.locationId,
    paymentStatus: p.paymentStatus,
    isComplimentary: p.paymentMode.toLowerCase() === "complimentary",
    isRefund: Number(p.amount) < 0,
  }));

  const byMode = modeAgg
    .map((m) => ({
      mode: m.paymentMode,
      count: m._count._all,
      amount: Number(m._sum.amount ?? 0),
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    rows,
    totalCount,
    totalAmount: Number(sumAgg._sum.amount ?? 0),
    page,
    pageSize,
    byMode,
  };
}

export async function getPaymentModes(): Promise<string[]> {
  try {
    await requireWorker();
  } catch {
    return [];
  }
  const modes = await prisma.payment.findMany({
    distinct: ["paymentMode"],
    select: { paymentMode: true },
    orderBy: { paymentMode: "asc" },
  });
  return modes.map((m) => m.paymentMode).filter(Boolean);
}

export async function getPaymentCollectors(): Promise<{ id: number; name: string }[]> {
  try {
    await requireWorker();
  } catch {
    return [];
  }
  const workers = await prisma.worker.findMany({
    where: {
      isActive: true,
      paymentsCollected: { some: {} },
    },
    select: { id: true, firstname: true, lastname: true },
    orderBy: { firstname: "asc" },
  });
  return workers.map((w) => ({ id: w.id, name: `${w.firstname} ${w.lastname}` }));
}
