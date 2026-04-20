"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requireWorker } from "@/lib/auth-guard";
import {
  approveRequest,
  rejectRequest,
  listPending,
  getPendingCount,
  type ApprovalType,
  type ApprovalStatus,
  type ApprovalRow,
} from "@/lib/services/approvals";

type ActionResult<T = undefined> =
  | { success: true; data?: T }
  | { success: false; error: string };

function unauthorized<T = undefined>(): ActionResult<T> {
  return { success: false, error: "Unauthorized" };
}

// ─── approveRequestAction ────────────────────────────────────────────────
export async function approveRequestAction(params: {
  approvalId: number;
  note?: string;
}): Promise<ActionResult<{ alreadyDecided?: boolean }>> {
  let session;
  try {
    session = await requireWorker(["admin"]);
  } catch {
    return unauthorized();
  }

  const decidedById = parseInt(session.user.id, 10);
  const result = await approveRequest({
    approvalId: params.approvalId,
    decidedById,
    note: params.note,
  });

  if (!result.success) return { success: false, error: result.error };

  revalidatePath("/admin/approvals");
  revalidatePath("/admin");
  revalidateTag("sidebar-counts", "max");
  return {
    success: true,
    data: { alreadyDecided: result.alreadyDecided ?? false },
  };
}

// ─── rejectRequestAction ─────────────────────────────────────────────────
export async function rejectRequestAction(params: {
  approvalId: number;
  note?: string;
}): Promise<ActionResult<{ alreadyDecided?: boolean }>> {
  let session;
  try {
    session = await requireWorker(["admin"]);
  } catch {
    return unauthorized();
  }

  const decidedById = parseInt(session.user.id, 10);
  const result = await rejectRequest({
    approvalId: params.approvalId,
    decidedById,
    note: params.note,
  });

  if (!result.success) return { success: false, error: result.error };

  revalidatePath("/admin/approvals");
  revalidatePath("/admin");
  revalidateTag("sidebar-counts", "max");
  return {
    success: true,
    data: { alreadyDecided: result.alreadyDecided ?? false },
  };
}

// ─── listPendingAction (any worker can view) ─────────────────────────────
export async function listPendingAction(opts?: {
  type?: ApprovalType;
  status?: ApprovalStatus;
}): Promise<
  | { success: true; data: ApprovalRow[] }
  | { success: false; error: string; data: ApprovalRow[] }
> {
  try {
    await requireWorker();
  } catch {
    return { success: false, error: "Unauthorized", data: [] };
  }
  const data = await listPending(opts);
  return { success: true, data };
}

export async function getPendingApprovalsCountAction(): Promise<number> {
  try {
    await requireWorker();
  } catch {
    return 0;
  }
  return getPendingCount();
}
