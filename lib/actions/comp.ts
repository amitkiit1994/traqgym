"use server";

import { revalidatePath } from "next/cache";
import { requireWorker } from "@/lib/auth-guard";
import {
  issueComp,
  convertCompToPaid,
  revokeComp,
  issueCompPass,
  revokeCompPass,
  convertCompPassToPaid,
  getActiveComps,
  getActiveCompPasses,
  getCompStats,
  type CompReason,
} from "@/lib/services/comp";

type ActionResult<T = undefined> =
  | { success: true; data?: T }
  | { success: false; error: string };

function unauthorized<T = undefined>(): ActionResult<T> {
  return { success: false, error: "Unauthorized" };
}

// ─── issueComp ────────────────────────────────────────────────────────────
export async function issueCompAction(params: {
  userId: number;
  planId: number;
  reason: CompReason;
  reasonDetail?: string;
  days?: number;
  approvedById?: number;
}): Promise<ActionResult<{ ticketId: number }>> {
  let session;
  try {
    session = await requireWorker(["admin"]);
  } catch {
    return unauthorized();
  }

  const issuedById = parseInt(session.user.id, 10);
  const result = await issueComp({
    userId: params.userId,
    planId: params.planId,
    reason: params.reason,
    reasonDetail: params.reasonDetail,
    days: params.days,
    issuedById,
    approvedById: params.approvedById,
  });

  if (!result.success) return { success: false, error: result.error };
  revalidatePath("/admin/comps");
  revalidatePath(`/admin/members/${params.userId}`);
  return { success: true, data: { ticketId: result.ticket.id } };
}

// ─── convertCompToPaid ────────────────────────────────────────────────────
export async function convertCompToPaidAction(params: {
  ticketId: number;
  newPlanId: number;
  paidAmount: number;
  paymentMode: string;
}): Promise<ActionResult<{ newTicketId: number }>> {
  let session;
  try {
    session = await requireWorker(["admin"]);
  } catch {
    return unauthorized();
  }

  const collectedById = parseInt(session.user.id, 10);
  const result = await convertCompToPaid({
    ticketId: params.ticketId,
    newPlanId: params.newPlanId,
    paidAmount: params.paidAmount,
    paymentMode: params.paymentMode,
    collectedById,
  });

  if (!result.success) return { success: false, error: result.error };
  revalidatePath("/admin/comps");
  return { success: true, data: { newTicketId: result.newTicketId } };
}

// ─── revokeComp ───────────────────────────────────────────────────────────
export async function revokeCompAction(params: {
  ticketId: number;
  reason: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requireWorker(["admin"]);
  } catch {
    return unauthorized();
  }

  const revokedById = parseInt(session.user.id, 10);
  const result = await revokeComp({
    ticketId: params.ticketId,
    reason: params.reason,
    revokedById,
  });

  if (!result.success) return { success: false, error: result.error };
  revalidatePath("/admin/comps");
  return { success: true };
}

// ─── issueCompPass ────────────────────────────────────────────────────────
export async function issueCompPassAction(params: {
  userId: number;
  reason: string;
  reasonDetail?: string;
  expiresAt: string; // ISO date
  approvedById?: number;
  notes?: string;
}): Promise<ActionResult<{ passId: number }>> {
  let session;
  try {
    session = await requireWorker(["admin"]);
  } catch {
    return unauthorized();
  }

  const issuedById = parseInt(session.user.id, 10);
  const expiresAt = new Date(params.expiresAt);
  if (isNaN(expiresAt.getTime())) {
    return { success: false, error: "Invalid expiresAt date" };
  }

  const result = await issueCompPass({
    userId: params.userId,
    reason: params.reason,
    reasonDetail: params.reasonDetail,
    expiresAt,
    issuedById,
    approvedById: params.approvedById,
    notes: params.notes,
  });

  if (!result.success) return { success: false, error: result.error };
  revalidatePath("/admin/comps");
  revalidatePath(`/admin/members/${params.userId}`);
  return { success: true, data: { passId: result.passId } };
}

// ─── revokeCompPass ───────────────────────────────────────────────────────
export async function revokeCompPassAction(params: {
  passId: number;
  reason: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requireWorker(["admin"]);
  } catch {
    return unauthorized();
  }

  const revokedById = parseInt(session.user.id, 10);
  const result = await revokeCompPass({
    passId: params.passId,
    reason: params.reason,
    revokedById,
  });

  if (!result.success) return { success: false, error: result.error };
  revalidatePath("/admin/comps");
  return { success: true };
}

// ─── convertCompPassToPaid ────────────────────────────────────────────────
export async function convertCompPassToPaidAction(params: {
  passId: number;
  planId: number;
  paidAmount: number;
  paymentMode: string;
}): Promise<ActionResult<{ ticketId: number }>> {
  let session;
  try {
    session = await requireWorker(["admin"]);
  } catch {
    return unauthorized();
  }

  const collectedById = parseInt(session.user.id, 10);
  const result = await convertCompPassToPaid({
    passId: params.passId,
    planId: params.planId,
    paidAmount: params.paidAmount,
    paymentMode: params.paymentMode,
    collectedById,
  });

  if (!result.success) return { success: false, error: result.error };
  revalidatePath("/admin/comps");
  return { success: true, data: { ticketId: result.ticketId } };
}

// ─── Read actions (any worker) ───────────────────────────────────────────
export async function getActiveCompsAction(opts?: { locationId?: number }) {
  try {
    await requireWorker();
  } catch {
    return { success: false as const, error: "Unauthorized", data: [] as Awaited<ReturnType<typeof getActiveComps>> };
  }
  const data = await getActiveComps(opts);
  return { success: true as const, data };
}

export async function getActiveCompPassesAction(opts?: {
  locationId?: number;
}) {
  try {
    await requireWorker();
  } catch {
    return { success: false as const, error: "Unauthorized", data: [] as Awaited<ReturnType<typeof getActiveCompPasses>> };
  }
  const data = await getActiveCompPasses(opts);
  return { success: true as const, data };
}

export async function getCompStatsAction(opts?: {
  from?: string;
  to?: string;
  locationId?: number;
}) {
  try {
    await requireWorker();
  } catch {
    return { success: false as const, error: "Unauthorized" };
  }
  const data = await getCompStats({
    from: opts?.from ? new Date(opts.from) : undefined,
    to: opts?.to ? new Date(opts.to) : undefined,
    locationId: opts?.locationId,
  });
  return { success: true as const, data };
}
