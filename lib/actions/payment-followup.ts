"use server";

import { requireWorker } from "@/lib/auth-guard";
import { revalidateTag } from "next/cache";
import {
  createFollowup,
  getFollowups,
  updateFollowup,
  assignFollowup,
  getOverdueFollowups,
  scoreFollowupRelevance,
  suggestAction,
} from "@/lib/services/payment-followup";
import { prisma } from "@/lib/prisma";

export async function createFollowupAction(data: {
  userId: number;
  memberTicketId?: number;
  amountDue: number;
  dueDate: string;
  assignedToId?: number;
  priority?: string;
  notes?: string;
}) {
  try { await requireWorker(); } catch { return { success: false as const, error: "Unauthorized" }; }
  const result = await createFollowup({
    ...data,
    dueDate: new Date(data.dueDate),
  });
  revalidateTag("sidebar-counts", "max");
  return result;
}

export async function getFollowupsAction(filters?: {
  status?: string;
  assignedToId?: number;
  priority?: string;
  locationId?: number;
  showArchived?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}) {
  try { await requireWorker(); } catch { return { data: [], total: 0, totalDue: 0, overdueCount: 0 }; }
  const { items, total, totalDue: grandTotalDue } = await getFollowups(filters);

  // Count overdue pending items (independent of current filters) for the page chip
  const overdueCount = await prisma.paymentFollowup.count({
    where: {
      status: "pending",
      dueDate: { lt: new Date() },
      amountDue: { gt: 0 },
    },
  });

  // Batch check active tickets for all users in this page
  const userIds = [...new Set(items.map((f) => f.userId))];
  const now = new Date();
  const activeTickets = userIds.length > 0
    ? await prisma.memberTicket.findMany({
        where: { userId: { in: userIds }, expireDate: { gte: now }, status: "active" },
        select: { userId: true },
      })
    : [];
  const activeUserIds = new Set(activeTickets.map((t) => t.userId));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = items.map((f: any) => {
    const hasActiveTicket = activeUserIds.has(f.userId);
    const relevance = scoreFollowupRelevance({
      dueDate: f.dueDate,
      amountDue: f.amountDue,
      status: f.status,
      lastContactedAt: f.lastContactedAt,
      hasActiveTicket,
    });
    const suggestion = suggestAction({
      dueDate: f.dueDate,
      amountDue: f.amountDue,
      status: f.status,
      lastContactedAt: f.lastContactedAt,
      hasActiveTicket,
    });
    return {
      id: f.id,
      userId: f.userId,
      memberName: `${f.user.firstname} ${f.user.lastname}`,
      phone: f.user.phone || "-",
      memberTicketId: f.memberTicketId,
      amountDue: Number(f.amountDue),
      dueDate: f.dueDate.toISOString(),
      assignedTo: f.assignedTo ? { id: f.assignedTo.id, name: `${f.assignedTo.firstname} ${f.assignedTo.lastname}` } : null,
      status: f.status,
      priority: f.priority,
      notes: f.notes,
      lastContactedAt: f.lastContactedAt?.toISOString() ?? null,
      nextFollowupAt: f.nextFollowupAt?.toISOString() ?? null,
      resolvedAt: f.resolvedAt?.toISOString() ?? null,
      createdAt: f.createdAt.toISOString(),
      relevance,
      suggestion,
    };
  });
  return { data, total, totalDue: grandTotalDue, overdueCount };
}

export async function updateFollowupAction(
  id: number,
  data: {
    status?: string;
    notes?: string;
    nextFollowupAt?: string;
    priority?: string;
  }
) {
  try { await requireWorker(); } catch { return { success: false as const, error: "Unauthorized" }; }
  const result = await updateFollowup(id, {
    ...data,
    nextFollowupAt: data.nextFollowupAt ? new Date(data.nextFollowupAt) : undefined,
    lastContactedAt: data.status === "contacted" ? new Date() : undefined,
  });
  revalidateTag("sidebar-counts", "max");
  return result;
}

export async function assignFollowupAction(id: number, workerId: number) {
  try { await requireWorker(); } catch { return { success: false as const, error: "Unauthorized" }; }
  const result = await assignFollowup(id, workerId);
  revalidateTag("sidebar-counts", "max");
  return result;
}

export async function getOverdueFollowupsAction(locationId?: number) {
  try { await requireWorker(); } catch { return []; }
  const followups = await getOverdueFollowups(locationId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return followups.map((f: any) => ({
    id: f.id,
    userId: f.userId,
    memberName: `${f.user.firstname} ${f.user.lastname}`,
    phone: f.user.phone || "-",
    amountDue: Number(f.amountDue),
    dueDate: f.dueDate.toISOString(),
    assignedTo: f.assignedTo ? { id: f.assignedTo.id, name: `${f.assignedTo.firstname} ${f.assignedTo.lastname}` } : null,
    status: f.status,
    priority: f.priority,
  }));
}
