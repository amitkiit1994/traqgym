"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requireWorker } from "@/lib/auth-guard";
import {
  requestRefund,
  processRefund,
  rejectRefund,
  listRefunds,
  getRefundDetail,
  getPendingRefundsCount,
  type RefundReason,
  type RefundMode,
  type RefundStatus,
  type RefundRow,
} from "@/lib/services/refund";

type ActionResult<T = undefined> =
  | { success: true; data?: T }
  | { success: false; error: string };

function unauthorized<T = undefined>(): ActionResult<T> {
  return { success: false, error: "Unauthorized" };
}

// ─── requestRefundAction (any worker) ──────────────────────────────────────
export async function requestRefundAction(params: {
  paymentId: number;
  amountRequested: number;
  reason: RefundReason;
  reasonDetail?: string;
  refundMode: RefundMode;
  proRataDays?: number;
  notes?: string;
}): Promise<ActionResult<{ refundId: number; approvalId: number }>> {
  let session;
  try {
    session = await requireWorker();
  } catch {
    return unauthorized();
  }

  const requestedById = parseInt(session.user.id, 10);
  const result = await requestRefund({
    paymentId: params.paymentId,
    amountRequested: params.amountRequested,
    reason: params.reason,
    reasonDetail: params.reasonDetail,
    refundMode: params.refundMode,
    requestedById,
    proRataDays: params.proRataDays,
    notes: params.notes,
  });

  if (!result.success) return { success: false, error: result.error };

  revalidatePath("/admin/refunds");
  revalidatePath("/admin/approvals");
  revalidateTag("sidebar-counts", "max");
  return {
    success: true,
    data: { refundId: result.refundId, approvalId: result.approvalId },
  };
}

// ─── processRefundAction (admin only) ─────────────────────────────────────
export async function processRefundAction(params: {
  refundId: number;
  pgRefundId?: string;
  processedAt?: string; // ISO string
}): Promise<
  ActionResult<{
    refundId: number;
    reversingPaymentId?: number;
    gstReversalAmount: number | null;
    alreadyProcessed?: boolean;
  }>
> {
  let session;
  try {
    session = await requireWorker(["admin"]);
  } catch {
    return unauthorized();
  }
  const processedById = parseInt(session.user.id, 10);

  const result = await processRefund({
    refundId: params.refundId,
    processedById,
    processedAt: params.processedAt ? new Date(params.processedAt) : undefined,
    pgRefundId: params.pgRefundId,
  });

  if (!result.success) return { success: false, error: result.error };

  revalidatePath("/admin/refunds");
  revalidatePath("/admin/approvals");
  revalidateTag("sidebar-counts", "max");

  return {
    success: true,
    data: {
      refundId: result.refundId,
      reversingPaymentId: result.reversingPaymentId,
      gstReversalAmount: result.gstReversalAmount,
      alreadyProcessed: result.alreadyProcessed,
    },
  };
}

// ─── rejectRefundAction (admin only) ──────────────────────────────────────
export async function rejectRefundAction(params: {
  refundId: number;
  decisionNote?: string;
}): Promise<ActionResult<{ refundId: number; alreadyDecided?: boolean }>> {
  let session;
  try {
    session = await requireWorker(["admin"]);
  } catch {
    return unauthorized();
  }
  const decidedById = parseInt(session.user.id, 10);

  const result = await rejectRefund({
    refundId: params.refundId,
    decidedById,
    decisionNote: params.decisionNote,
  });
  if (!result.success) return { success: false, error: result.error };

  revalidatePath("/admin/refunds");
  revalidatePath("/admin/approvals");
  revalidateTag("sidebar-counts", "max");

  return {
    success: true,
    data: { refundId: result.refundId, alreadyDecided: result.alreadyDecided },
  };
}

// ─── Read actions (any worker) ────────────────────────────────────────────
export async function listRefundsAction(opts?: {
  status?: RefundStatus;
  from?: string;
  to?: string;
}): Promise<
  | { success: true; data: RefundRow[] }
  | { success: false; error: string; data: RefundRow[] }
> {
  try {
    await requireWorker();
  } catch {
    return { success: false, error: "Unauthorized", data: [] };
  }
  const data = await listRefunds({
    status: opts?.status,
    from: opts?.from ? new Date(opts.from) : undefined,
    to: opts?.to ? new Date(opts.to) : undefined,
  });
  return { success: true, data };
}

export async function getRefundDetailAction(
  id: number
): Promise<ActionResult<RefundRow | null>> {
  try {
    await requireWorker();
  } catch {
    return unauthorized();
  }
  const data = await getRefundDetail(id);
  return { success: true, data };
}

export async function getPendingRefundsCountAction(): Promise<number> {
  try {
    await requireWorker();
  } catch {
    return 0;
  }
  return getPendingRefundsCount();
}
