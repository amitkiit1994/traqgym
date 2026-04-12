"use server";

import { requireWorker } from "@/lib/auth-guard";
import {
  createFollowup,
  getFollowups,
  updateFollowup,
  assignFollowup,
  getOverdueFollowups,
} from "@/lib/services/payment-followup";

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
  return createFollowup({
    ...data,
    dueDate: new Date(data.dueDate),
  });
}

export async function getFollowupsAction(filters?: {
  status?: string;
  assignedToId?: number;
  priority?: string;
  locationId?: number;
}) {
  try { await requireWorker(); } catch { return []; }
  const followups = await getFollowups(filters);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return followups.map((f: any) => ({
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
  }));
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
  return updateFollowup(id, {
    ...data,
    nextFollowupAt: data.nextFollowupAt ? new Date(data.nextFollowupAt) : undefined,
    lastContactedAt: data.status === "contacted" ? new Date() : undefined,
  });
}

export async function assignFollowupAction(id: number, workerId: number) {
  try { await requireWorker(); } catch { return { success: false as const, error: "Unauthorized" }; }
  return assignFollowup(id, workerId);
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
