/**
 * Universal approval queue service.
 *
 * Manages a single queue of approval requests across the app — comp issuance,
 * comp passes, freeze, extension, refunds, over-threshold discounts, etc.
 *
 * Flow:
 *   - A caller (typically another service like comp.issueComp) calls
 *     requestApproval(...) when a threshold is breached.
 *   - An admin reviews /admin/approvals and calls approveRequest / rejectRequest.
 *   - approveRequest is idempotent and dispatches to the underlying service
 *     based on `type`.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ApprovalType =
  | "comp"
  | "comp_pass"
  | "freeze"
  | "extension"
  | "refund"
  | "cash_shift_variance"
  | "discount_over_threshold";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";

export type RequestApprovalResult =
  | { success: true; approvalId: number }
  | { success: false; error: string };

export type ApproveRequestResult =
  | { success: true; result?: unknown; alreadyDecided?: boolean }
  | { success: false; error: string };

export type RejectRequestResult =
  | { success: true; alreadyDecided?: boolean }
  | { success: false; error: string };

export type ApprovalRow = {
  id: number;
  type: string;
  entityType: string;
  entityId: number | null;
  payloadJson: unknown;
  status: string;
  requestedById: number;
  requestedByName: string;
  decidedById: number | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  expiresAt: Date | null;
  createdAt: Date;
};

// ─────────────────────────────────────────────────────────────────────────────
// requestApproval
// ─────────────────────────────────────────────────────────────────────────────

export async function requestApproval(params: {
  type: ApprovalType;
  entityType: string;
  entityId?: number;
  requestedById: number;
  payload: Record<string, unknown>;
  expiresInDays?: number;
}): Promise<RequestApprovalResult> {
  const requester = await prisma.worker.findUnique({
    where: { id: params.requestedById },
  });
  if (!requester) {
    return { success: false, error: "Requesting worker not found" };
  }

  const expiresAt = params.expiresInDays
    ? new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const approval = await tx.approval.create({
        data: {
          type: params.type,
          entityType: params.entityType,
          entityId: params.entityId ?? null,
          payloadJson: params.payload as Prisma.InputJsonValue,
          status: "pending",
          requestedById: params.requestedById,
          expiresAt,
        },
      });

      await tx.auditLog.create({
        data: {
          action: "approval.request",
          status: "success",
          details: JSON.stringify({
            approvalId: approval.id,
            type: params.type,
            entityType: params.entityType,
            entityId: params.entityId ?? null,
            requestedById: params.requestedById,
            expiresAt: expiresAt?.toISOString() ?? null,
          }),
          actorId: params.requestedById,
          actorType: "worker",
        },
      });

      return approval;
    });

    return { success: true, approvalId: result.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to request approval",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// approveRequest — idempotent
// ─────────────────────────────────────────────────────────────────────────────

export async function approveRequest(params: {
  approvalId: number;
  decidedById: number;
  note?: string;
}): Promise<ApproveRequestResult> {
  const approval = await prisma.approval.findUnique({
    where: { id: params.approvalId },
  });
  if (!approval) {
    return { success: false, error: "Approval not found" };
  }

  // Idempotency: if already decided, return success without re-execution.
  if (approval.status !== "pending") {
    return { success: true, alreadyDecided: true };
  }

  // Reject expired approvals — never dispatch underlying mutation.
  if (approval.expiresAt && approval.expiresAt.getTime() < Date.now()) {
    await prisma.approval.update({
      where: { id: params.approvalId },
      data: {
        status: "expired",
        decidedAt: new Date(),
        decisionNote: "Auto-rejected at approval time: request expired",
      },
    });
    return { success: false, error: "Approval request has expired" };
  }

  const decider = await prisma.worker.findUnique({
    where: { id: params.decidedById },
  });
  if (!decider) {
    return { success: false, error: "Deciding worker not found" };
  }

  const payload = (approval.payloadJson ?? {}) as Record<string, unknown>;

  try {
    // Step 1: atomically claim the approval. The conditional updateMany
    // returns count===1 only for the single caller that actually flipped
    // pending -> approved; any concurrent caller sees count===0 and must
    // NOT dispatch (otherwise dispatch fires twice on race).
    const claimed = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.approval.updateMany({
        where: { id: params.approvalId, status: "pending" },
        data: {
          status: "approved",
          decidedById: params.decidedById,
          decidedAt: new Date(),
          decisionNote: params.note ?? null,
        },
      });

      if (updateResult.count === 1) {
        await tx.auditLog.create({
          data: {
            action: "approval.approve",
            status: "success",
            details: JSON.stringify({
              approvalId: approval.id,
              type: approval.type,
              entityType: approval.entityType,
              entityId: approval.entityId,
              decidedById: params.decidedById,
              note: params.note ?? null,
            }),
            actorId: params.decidedById,
            actorType: "worker",
          },
        });
      }

      return updateResult.count === 1;
    });

    // Step 2: if we didn't win the race, treat as idempotent success — DO
    // NOT dispatch (the winner is doing/has done that work).
    if (!claimed) {
      return { success: true, alreadyDecided: true };
    }

    // Step 3: dispatch to the underlying service to actually apply the change.
    const dispatchResult = await dispatchApproval({
      type: approval.type as ApprovalType,
      payload,
      decidedById: params.decidedById,
      approvalId: approval.id,
    });

    // If dispatch produced an entityId, link it back onto the approval row.
    if (
      dispatchResult &&
      typeof dispatchResult === "object" &&
      "entityId" in dispatchResult &&
      typeof (dispatchResult as { entityId?: unknown }).entityId === "number"
    ) {
      await prisma.approval.update({
        where: { id: approval.id },
        data: { entityId: (dispatchResult as { entityId: number }).entityId },
      });
    }

    return { success: true, result: dispatchResult };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to approve request",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// rejectRequest — idempotent
// ─────────────────────────────────────────────────────────────────────────────

export async function rejectRequest(params: {
  approvalId: number;
  decidedById: number;
  note?: string;
}): Promise<RejectRequestResult> {
  const approval = await prisma.approval.findUnique({
    where: { id: params.approvalId },
  });
  if (!approval) {
    return { success: false, error: "Approval not found" };
  }

  if (approval.status !== "pending") {
    return { success: true, alreadyDecided: true };
  }

  const decider = await prisma.worker.findUnique({
    where: { id: params.decidedById },
  });
  if (!decider) {
    return { success: false, error: "Deciding worker not found" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.approval.findUnique({
        where: { id: params.approvalId },
      });
      if (!fresh || fresh.status !== "pending") return;

      await tx.approval.update({
        where: { id: params.approvalId },
        data: {
          status: "rejected",
          decidedById: params.decidedById,
          decidedAt: new Date(),
          decisionNote: params.note ?? null,
        },
      });

      await tx.auditLog.create({
        data: {
          action: "approval.reject",
          status: "success",
          details: JSON.stringify({
            approvalId: approval.id,
            type: approval.type,
            entityType: approval.entityType,
            entityId: approval.entityId,
            decidedById: params.decidedById,
            note: params.note ?? null,
          }),
          actorId: params.decidedById,
          actorType: "worker",
        },
      });
    });

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to reject request",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// dispatchApproval — internal type-specific executor
// ─────────────────────────────────────────────────────────────────────────────

async function dispatchApproval(params: {
  type: ApprovalType;
  payload: Record<string, unknown>;
  decidedById: number;
  approvalId: number;
}): Promise<unknown> {
  const { type, payload, decidedById } = params;

  if (type === "comp") {
    const { issueComp } = await import("@/lib/services/comp");
    const res = await issueComp({
      userId: payload.userId as number,
      planId: payload.planId as number,
      reason: payload.reason as
        | "trial"
        | "influencer"
        | "family"
        | "compensation"
        | "owner_friend"
        | "money_crunch"
        | "other",
      reasonDetail: (payload.reasonDetail as string | null) ?? undefined,
      days: payload.days as number | undefined,
      issuedById: payload.issuedById as number,
      approvedById: decidedById,
    });
    if (res.success && res.ticket) {
      return { entityId: res.ticket.id, ticket: res.ticket };
    }
    return res;
  }

  if (type === "comp_pass") {
    const { issueCompPass } = await import("@/lib/services/comp");
    const expiresAtRaw = payload.expiresAt;
    const expiresAt = typeof expiresAtRaw === "string" ? new Date(expiresAtRaw) : new Date();
    const res = await issueCompPass({
      userId: payload.userId as number,
      reason: payload.reason as string,
      reasonDetail: (payload.reasonDetail as string | null) ?? undefined,
      expiresAt,
      issuedById: payload.issuedById as number,
      approvedById: decidedById,
      notes: (payload.notes as string | null) ?? undefined,
    });
    if (res.success && res.passId) {
      return { entityId: res.passId, passId: res.passId };
    }
    return res;
  }

  if (type === "refund") {
    const { approveRefund } = await import("@/lib/services/refund");
    const refundId = (payload.refundId as number | undefined) ?? undefined;
    if (!refundId) {
      return { dispatched: false, error: "Refund approval payload missing refundId" };
    }
    const res = await approveRefund(refundId, decidedById);
    if (res.success) {
      return { entityId: refundId, refundId, alreadyDecided: res.alreadyDecided ?? false };
    }
    return res;
  }

  if (type === "cash_shift_variance") {
    const { approveShiftVariance } = await import("@/lib/services/cash-shift");
    const shiftId = (payload.shiftId as number | undefined) ?? undefined;
    if (!shiftId) {
      return {
        dispatched: false,
        error: "Cash shift variance approval payload missing shiftId",
      };
    }
    const res = await approveShiftVariance(shiftId, decidedById);
    if (res.success) {
      return { entityId: shiftId, shiftId, alreadyDecided: res.alreadyDecided ?? false };
    }
    return res;
  }

  // Other types (freeze, extension, discount_over_threshold) are
  // accepted as approved but downstream PRs will wire actual dispatchers.
  return { dispatched: false, note: `No dispatcher wired for type "${type}" yet` };
}

// ─────────────────────────────────────────────────────────────────────────────
// listPending / counts
// ─────────────────────────────────────────────────────────────────────────────

export async function listPending(opts?: {
  type?: ApprovalType;
  status?: ApprovalStatus;
  limit?: number;
}): Promise<ApprovalRow[]> {
  const where: Prisma.ApprovalWhereInput = {
    status: opts?.status ?? "pending",
    ...(opts?.type ? { type: opts.type } : {}),
  };

  const rows = await prisma.approval.findMany({
    where,
    include: {
      requestedBy: { select: { id: true, firstname: true, lastname: true } },
      decidedBy: { select: { id: true, firstname: true, lastname: true } },
    },
    orderBy: { createdAt: "desc" },
    take: opts?.limit ?? 200,
  });

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    entityType: r.entityType,
    entityId: r.entityId,
    payloadJson: r.payloadJson,
    status: r.status,
    requestedById: r.requestedById,
    requestedByName: `${r.requestedBy.firstname} ${r.requestedBy.lastname}`,
    decidedById: r.decidedById,
    decidedByName: r.decidedBy
      ? `${r.decidedBy.firstname} ${r.decidedBy.lastname}`
      : null,
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
  }));
}

export async function getPendingCount(): Promise<number> {
  return prisma.approval.count({ where: { status: "pending" } });
}
