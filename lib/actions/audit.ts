"use server";

import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/auth-guard";

export async function getAuditLogs(
  fromDate?: string,
  toDate?: string,
  action?: string,
  page?: number,
  pageSize?: number,
) {
  try { await requireWorker(["admin"]); } catch { return { logs: [], total: 0 }; }
  const pg = page ?? 1;
  const ps = pageSize ?? 25;
  const skip = (pg - 1) * ps;

  const where: Record<string, unknown> = {};

  if (fromDate || toDate) {
    const dateFilter: Record<string, Date> = {};
    if (fromDate) dateFilter.gte = new Date(fromDate);
    if (toDate) {
      const end = new Date(toDate);
      end.setDate(end.getDate() + 1);
      dateFilter.lt = end;
    }
    where.createdAt = dateFilter;
  }

  if (action) {
    where.action = { contains: action, mode: "insensitive" };
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: ps,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    logs: logs.map((l) => ({
      id: l.id,
      action: l.action,
      status: l.status,
      details: l.details,
      actorId: l.actorId,
      actorType: l.actorType,
      createdAt: l.createdAt.toISOString(),
    })),
    total,
  };
}
