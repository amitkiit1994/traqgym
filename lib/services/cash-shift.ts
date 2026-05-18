/**
 * Cash Shift service.
 *
 * Models a "drawer session" at a location:
 *   - openShift: starts a shift with an opening float (only one open shift per
 *     location at a time).
 *   - recordMovement: append a float top-up, withdrawal, expense, or bank
 *     deposit during the shift.
 *   - tagPaymentToOpenShift: helper meant to be called from the payment
 *     recording flow so that cash payments are auto-attributed to the open
 *     shift. (See note below — wiring is a separate PR.)
 *   - closeShift: atomically computes expected vs counted cash, the variance,
 *     and either closes the shift directly OR routes to the universal
 *     approval queue if the variance exceeds the threshold.
 *   - approveShiftVariance: dispatcher hook called when an admin approves a
 *     pending_approval shift via /admin/approvals.
 *
 * All multi-table writes are atomic transactions; all state transitions are
 * idempotent.
 */
import type { CashShift, CashShiftMovement, Worker } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ShiftStatus = "open" | "pending_approval" | "closed" | "voided";
export type ShiftMovementType =
  | "float_topup"
  | "cash_withdrawal"
  | "expense"
  | "deposit_to_bank";

export type OpenShiftResult =
  | { success: true; shift: CashShift }
  | { success: false; error: string };

export type RecordMovementResult =
  | { success: true; movement: CashShiftMovement }
  | { success: false; error: string };

export type CloseShiftResult =
  | {
      success: true;
      shiftId: number;
      status: ShiftStatus;
      closingExpected: number;
      variance: number;
      requiresApproval: boolean;
      approvalId?: number;
      alreadyClosed?: boolean;
    }
  | { success: false; error: string };

export type ApproveShiftVarianceResult =
  | { success: true; shiftId: number; alreadyDecided?: boolean }
  | { success: false; error: string };

export type ShiftRow = {
  id: number;
  locationId: number;
  locationName: string;
  openedById: number;
  openedByName: string;
  openedAt: Date;
  openingFloat: number;
  closedById: number | null;
  closedByName: string | null;
  closedAt: Date | null;
  closingExpected: number | null;
  closingCounted: number | null;
  variance: number | null;
  varianceReason: string | null;
  status: string;
  approvedById: number | null;
  approvedByName: string | null;
  approvedAt: Date | null;
  notes: string | null;
};

export type ShiftMovementRow = {
  id: number;
  shiftId: number;
  type: string;
  amount: number;
  reason: string;
  createdById: number;
  createdAt: Date;
};

const DEFAULT_VARIANCE_AUTO_APPROVE_MAX = 100;

export async function getVarianceAutoApproveMax(): Promise<number> {
  const v = await getSetting(
    "shift_variance_auto_approve_max",
    String(DEFAULT_VARIANCE_AUTO_APPROVE_MAX)
  );
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_VARIANCE_AUTO_APPROVE_MAX;
}

// ─────────────────────────────────────────────────────────────────────────────
// openShift
// ─────────────────────────────────────────────────────────────────────────────

export async function openShift(params: {
  locationId: number;
  openedById: number;
  openingFloat: number;
}): Promise<OpenShiftResult> {
  if (params.openingFloat < 0) {
    return { success: false, error: "Opening float must be >= 0" };
  }

  const location = await prisma.location.findUnique({
    where: { id: params.locationId },
  });
  if (!location) return { success: false, error: "Location not found" };

  const opener = await prisma.worker.findUnique({
    where: { id: params.openedById },
  });
  if (!opener) return { success: false, error: "Opening worker not found" };
  if (!opener.isActive)
    return { success: false, error: "Opening worker is not active" };

  try {
    const shift = await prisma.$transaction(
      async (tx) => {
        // R01 fix: existence check + create must be inside the SAME serializable
        // txn to prevent two concurrent openShift calls from both passing the
        // pre-check and inserting two open shifts at the same location.
        const existingOpen = await tx.cashShift.findFirst({
          where: {
            locationId: params.locationId,
            status: { in: ["open", "pending_approval"] },
          },
        });
        if (existingOpen) {
          throw new Error(
            `Shift #${existingOpen.id} is already open at this location`
          );
        }

        const created = await tx.cashShift.create({
          data: {
            locationId: params.locationId,
            openedById: params.openedById,
            openingFloat: params.openingFloat,
            status: "open",
          },
        });

        await tx.auditLog.create({
          data: {
            action: "cash_shift.open",
            status: "success",
            details: JSON.stringify({
              shiftId: created.id,
              locationId: params.locationId,
              openedById: params.openedById,
              openingFloat: params.openingFloat,
            }),
            actorId: params.openedById,
            actorType: "worker",
          },
        });

        return created;
      },
      { isolationLevel: "Serializable" }
    );
    return { success: true, shift };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to open shift",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// recordMovement
// ─────────────────────────────────────────────────────────────────────────────

export async function recordMovement(params: {
  shiftId: number;
  type: ShiftMovementType;
  amount: number;
  reason: string;
  createdById: number;
}): Promise<RecordMovementResult> {
  if (params.amount <= 0) {
    return { success: false, error: "Movement amount must be > 0" };
  }
  if (!params.reason || params.reason.trim().length === 0) {
    return { success: false, error: "Movement reason is required" };
  }

  const shift = await prisma.cashShift.findUnique({
    where: { id: params.shiftId },
  });
  if (!shift) return { success: false, error: "Shift not found" };
  if (shift.status !== "open") {
    return { success: false, error: `Shift is ${shift.status}; movements only allowed on open shifts` };
  }

  const worker = await prisma.worker.findUnique({
    where: { id: params.createdById },
  });
  if (!worker) return { success: false, error: "Worker not found" };

  try {
    const movement = await prisma.$transaction(async (tx) => {
      const m = await tx.cashShiftMovement.create({
        data: {
          shiftId: params.shiftId,
          type: params.type,
          amount: params.amount,
          reason: params.reason.trim(),
          createdById: params.createdById,
        },
      });

      await tx.auditLog.create({
        data: {
          action: "cash_shift.movement",
          status: "success",
          details: JSON.stringify({
            movementId: m.id,
            shiftId: params.shiftId,
            type: params.type,
            amount: params.amount,
            reason: params.reason,
            createdById: params.createdById,
          }),
          actorId: params.createdById,
          actorType: "worker",
        },
      });

      return m;
    });
    return { success: true, movement };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to record movement",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// getOpenShiftFor
// ─────────────────────────────────────────────────────────────────────────────

export async function getOpenShiftFor(
  locationId: number
): Promise<CashShift | null> {
  return prisma.cashShift.findFirst({
    where: { locationId, status: "open" },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// tagPaymentToOpenShift — helper for the payment-recording flow.
//
// NOTE: To minimise blast radius this PR does NOT modify lib/services/renewal.ts
// or other payment-recording entrypoints. Future PR should call this helper
// inside the payment-recording flow (or a periodic backfill could call it
// against recent untagged cash payments).
// ─────────────────────────────────────────────────────────────────────────────

export async function tagPaymentToOpenShift(
  paymentId: number,
  locationId: number
): Promise<{ success: true; shiftId: number | null } | { success: false; error: string }> {
  const open = await getOpenShiftFor(locationId);
  if (!open) {
    return { success: true, shiftId: null };
  }
  try {
    await prisma.payment.update({
      where: { id: paymentId },
      data: { shiftId: open.id },
    });
    return { success: true, shiftId: open.id };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to tag payment to shift",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// closeShift
// ─────────────────────────────────────────────────────────────────────────────

export async function closeShift(params: {
  shiftId: number;
  closedById: number;
  closingCounted: number;
  varianceReason?: string;
  notes?: string;
}): Promise<CloseShiftResult> {
  if (params.closingCounted < 0) {
    return { success: false, error: "Closing counted must be >= 0" };
  }

  const shift = await prisma.cashShift.findUnique({
    where: { id: params.shiftId },
  });
  if (!shift) return { success: false, error: "Shift not found" };

  if (shift.status === "closed") {
    return {
      success: true,
      shiftId: shift.id,
      status: "closed",
      closingExpected: shift.closingExpected ? Number(shift.closingExpected) : 0,
      variance: shift.variance ? Number(shift.variance) : 0,
      requiresApproval: false,
      alreadyClosed: true,
    };
  }
  if (shift.status === "pending_approval") {
    return {
      success: true,
      shiftId: shift.id,
      status: "pending_approval",
      closingExpected: shift.closingExpected ? Number(shift.closingExpected) : 0,
      variance: shift.variance ? Number(shift.variance) : 0,
      requiresApproval: true,
      alreadyClosed: true,
    };
  }
  if (shift.status !== "open") {
    return { success: false, error: `Cannot close shift in status "${shift.status}"` };
  }

  const closer = await prisma.worker.findUnique({
    where: { id: params.closedById },
  });
  if (!closer) return { success: false, error: "Closing worker not found" };

  // Compute expected closing cash:
  //   openingFloat
  //     + sum(cash payments tagged to this shift)
  //     - sum(refunds processed during this shift's window where source payment was cash)
  //     + sum(float_topup)
  //     - sum(cash_withdrawal)
  //     - sum(deposit_to_bank)
  //     - sum(expense)

  const cashPayments = await prisma.payment.aggregate({
    where: {
      shiftId: shift.id,
      paymentMode: "cash",
    },
    _sum: { amount: true },
  });
  // Note: refunds inserted as reversing Payment rows (paymentMode="refund")
  // tagged to this shift will have negative amounts, so they will reduce the
  // sum naturally if tagged. We still include an explicit refund subtraction
  // for refunds processed during the shift window even if not tagged.
  const refundsInWindow = await prisma.payment.aggregate({
    where: {
      paymentMode: "refund",
      locationId: shift.locationId,
      createdAt: { gte: shift.openedAt },
      shiftId: null,
    },
    _sum: { amount: true },
  });

  const movementSums = await prisma.cashShiftMovement.groupBy({
    by: ["type"],
    where: { shiftId: shift.id },
    _sum: { amount: true },
  });

  const movementMap = new Map<string, number>();
  for (const m of movementSums) {
    movementMap.set(m.type, Number(m._sum.amount ?? 0));
  }

  const cashIn = Number(cashPayments._sum.amount ?? 0);
  // refundsInWindow gives a negative value already (reversing payment); subtract
  // its absolute value once. Add it as-is so negative numbers reduce expected.
  const refundsAdjustment = Number(refundsInWindow._sum.amount ?? 0);
  const floatTopup = movementMap.get("float_topup") ?? 0;
  const cashWithdrawal = movementMap.get("cash_withdrawal") ?? 0;
  const depositToBank = movementMap.get("deposit_to_bank") ?? 0;
  const expense = movementMap.get("expense") ?? 0;

  const closingExpected =
    Number(shift.openingFloat) +
    cashIn +
    refundsAdjustment +
    floatTopup -
    cashWithdrawal -
    depositToBank -
    expense;

  const variance = +(params.closingCounted - closingExpected).toFixed(2);
  const absVariance = Math.abs(variance);
  const threshold = await getVarianceAutoApproveMax();
  // Boundary semantics — QA fix:
  //   Use `absVariance >= threshold` (greater-or-equal). A variance equal to
  //   the threshold (e.g. ±₹100 with default = 100) MUST route through the
  //   approval queue, not auto-close silently. Effective auto-approve range
  //   is the half-open interval [0, threshold). If product policy ever flips
  //   back to "exactly at threshold auto-closes", switch to `>` and update
  //   the setting label to clarify.
  const requiresApproval = absVariance >= threshold;

  try {
    let newStatus: ShiftStatus;
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.cashShift.findUnique({
        where: { id: shift.id },
      });
      if (!fresh || fresh.status !== "open") return;

      newStatus = requiresApproval ? "pending_approval" : "closed";
      await tx.cashShift.update({
        where: { id: shift.id },
        data: {
          closedById: params.closedById,
          closedAt: requiresApproval ? null : new Date(),
          closingExpected,
          closingCounted: params.closingCounted,
          variance,
          varianceReason: params.varianceReason ?? null,
          notes: params.notes ?? fresh.notes,
          status: newStatus,
        },
      });

      await tx.auditLog.create({
        data: {
          action: "cash_shift.close",
          status: "success",
          // R23 fix: persist threshold and absVariance into audit details so
          // disputes can show which threshold applied at close time, even if
          // the setting changes later.
          details: JSON.stringify({
            shiftId: shift.id,
            closedById: params.closedById,
            openingFloat: Number(shift.openingFloat),
            cashIn,
            refundsAdjustment,
            floatTopup,
            cashWithdrawal,
            depositToBank,
            expense,
            closingExpected,
            closingCounted: params.closingCounted,
            variance,
            absVariance,
            varianceThreshold: threshold,
            thresholdSettingKey: "shift_variance_auto_approve_max",
            requiresApproval,
            newStatus,
          }),
          actorId: params.closedById,
          actorType: "worker",
        },
      });
    });

    let approvalId: number | undefined;
    if (requiresApproval) {
      const { requestApproval } = await import("@/lib/services/approvals");
      const ar = await requestApproval({
        type: "cash_shift_variance",
        entityType: "CashShift",
        entityId: shift.id,
        requestedById: params.closedById,
        payload: {
          shiftId: shift.id,
          locationId: shift.locationId,
          openingFloat: Number(shift.openingFloat),
          closingExpected,
          closingCounted: params.closingCounted,
          variance,
          absVariance,
          varianceThreshold: threshold,
          varianceReason: params.varianceReason ?? null,
        },
        expiresInDays: 14,
      });
      if (ar.success) approvalId = ar.approvalId;
    }

    return {
      success: true,
      shiftId: shift.id,
      status: requiresApproval ? "pending_approval" : "closed",
      closingExpected,
      variance,
      requiresApproval,
      approvalId,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to close shift",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// approveShiftVariance — dispatcher target for type="cash_shift_variance"
// ─────────────────────────────────────────────────────────────────────────────

export async function approveShiftVariance(
  shiftId: number,
  approverId: number,
  note?: string
): Promise<ApproveShiftVarianceResult> {
  const shift = await prisma.cashShift.findUnique({ where: { id: shiftId } });
  if (!shift) return { success: false, error: "Shift not found" };

  if (shift.status === "closed") {
    return { success: true, shiftId, alreadyDecided: true };
  }
  if (shift.status !== "pending_approval") {
    return {
      success: false,
      error: `Cannot approve variance for shift in status "${shift.status}"`,
    };
  }

  const approver = await prisma.worker.findUnique({ where: { id: approverId } });
  if (!approver) return { success: false, error: "Approver not found" };

  try {
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.cashShift.findUnique({ where: { id: shiftId } });
      if (!fresh || fresh.status !== "pending_approval") return;

      await tx.cashShift.update({
        where: { id: shiftId },
        data: {
          status: "closed",
          approvedById: approverId,
          approvedAt: new Date(),
          closedAt: fresh.closedAt ?? new Date(),
          notes: note ? `${fresh.notes ?? ""}\nApproval note: ${note}`.trim() : fresh.notes,
        },
      });

      await tx.auditLog.create({
        data: {
          action: "cash_shift.variance_approve",
          status: "success",
          details: JSON.stringify({
            shiftId,
            approverId,
            note: note ?? null,
            variance: fresh.variance ? Number(fresh.variance) : null,
          }),
          actorId: approverId,
          actorType: "worker",
        },
      });
    });
    return { success: true, shiftId };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to approve shift variance",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// listOpenShifts / listClosedShifts / getShiftDetail
// ─────────────────────────────────────────────────────────────────────────────

type ShiftQueryRow = CashShift & {
  location: { name: string };
  openedBy: Pick<Worker, "id" | "firstname" | "lastname">;
  closedBy: Pick<Worker, "id" | "firstname" | "lastname"> | null;
  approvedBy: Pick<Worker, "id" | "firstname" | "lastname"> | null;
};

function mapShift(s: ShiftQueryRow): ShiftRow {
  return {
    id: s.id,
    locationId: s.locationId,
    locationName: s.location?.name ?? "",
    openedById: s.openedById,
    openedByName: `${s.openedBy.firstname} ${s.openedBy.lastname}`,
    openedAt: s.openedAt,
    openingFloat: Number(s.openingFloat),
    closedById: s.closedById,
    closedByName: s.closedBy
      ? `${s.closedBy.firstname} ${s.closedBy.lastname}`
      : null,
    closedAt: s.closedAt,
    closingExpected:
      s.closingExpected != null ? Number(s.closingExpected) : null,
    closingCounted:
      s.closingCounted != null ? Number(s.closingCounted) : null,
    variance: s.variance != null ? Number(s.variance) : null,
    varianceReason: s.varianceReason,
    status: s.status,
    approvedById: s.approvedById,
    approvedByName: s.approvedBy
      ? `${s.approvedBy.firstname} ${s.approvedBy.lastname}`
      : null,
    approvedAt: s.approvedAt,
    notes: s.notes,
  };
}

export async function listOpenShifts(opts?: {
  locationId?: number;
}): Promise<ShiftRow[]> {
  const rows = await prisma.cashShift.findMany({
    where: {
      status: { in: ["open", "pending_approval"] },
      ...(opts?.locationId ? { locationId: opts.locationId } : {}),
    },
    include: {
      location: { select: { name: true } },
      openedBy: { select: { id: true, firstname: true, lastname: true } },
      closedBy: { select: { id: true, firstname: true, lastname: true } },
      approvedBy: { select: { id: true, firstname: true, lastname: true } },
    },
    orderBy: { openedAt: "desc" },
  });
  return rows.map(mapShift);
}

export async function listClosedShifts(opts?: {
  locationId?: number;
  from?: Date;
  to?: Date;
  limit?: number;
}): Promise<ShiftRow[]> {
  const rows = await prisma.cashShift.findMany({
    where: {
      status: "closed",
      ...(opts?.locationId ? { locationId: opts.locationId } : {}),
      ...(opts?.from || opts?.to
        ? {
            closedAt: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
    },
    include: {
      location: { select: { name: true } },
      openedBy: { select: { id: true, firstname: true, lastname: true } },
      closedBy: { select: { id: true, firstname: true, lastname: true } },
      approvedBy: { select: { id: true, firstname: true, lastname: true } },
    },
    orderBy: { closedAt: "desc" },
    take: opts?.limit ?? 200,
  });
  return rows.map(mapShift);
}

export async function listPendingApprovalShifts(): Promise<ShiftRow[]> {
  const rows = await prisma.cashShift.findMany({
    where: { status: "pending_approval" },
    include: {
      location: { select: { name: true } },
      openedBy: { select: { id: true, firstname: true, lastname: true } },
      closedBy: { select: { id: true, firstname: true, lastname: true } },
      approvedBy: { select: { id: true, firstname: true, lastname: true } },
    },
    orderBy: { closedAt: "desc" },
  });
  return rows.map(mapShift);
}

export async function getShiftDetail(id: number): Promise<
  | (ShiftRow & {
      movements: ShiftMovementRow[];
    })
  | null
> {
  const s = await prisma.cashShift.findUnique({
    where: { id },
    include: {
      location: { select: { name: true } },
      openedBy: { select: { id: true, firstname: true, lastname: true } },
      closedBy: { select: { id: true, firstname: true, lastname: true } },
      approvedBy: { select: { id: true, firstname: true, lastname: true } },
      movements: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!s) return null;
  const base = mapShift(s);
  return {
    ...base,
    movements: s.movements.map((m) => ({
      id: m.id,
      shiftId: m.shiftId,
      type: m.type,
      amount: Number(m.amount),
      reason: m.reason,
      createdById: m.createdById,
      createdAt: m.createdAt,
    })),
  };
}

export async function getOpenShiftsCount(): Promise<number> {
  return prisma.cashShift.count({
    where: { status: { in: ["open", "pending_approval"] } },
  });
}

/**
 * Whether the dashboard should show the "no open shift but cash collected
 * today" banner. Returns the data the banner needs (cash payment count)
 * along with a `shouldShow` flag; banner renders nothing when false.
 */
export async function getCashShiftBannerState(locationId?: number): Promise<{
  shouldShow: boolean;
  todayCashCount: number;
}> {
  const today = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const [openShift, todayCashCount] = await Promise.all([
    prisma.cashShift.findFirst({
      where: { status: "open", ...(locationId ? { locationId } : {}) },
      select: { id: true },
    }),
    prisma.payment.count({
      where: {
        // Case-insensitive — payment_mode is free-text and arrives as
        // cash/Cash/CASH/etc. from various source systems.
        paymentMode: { equals: "cash", mode: "insensitive" },
        createdAt: { gte: dayStart },
        ...(locationId ? { locationId } : {}),
      },
    }),
  ]);

  return {
    shouldShow: !openShift && todayCashCount > 0,
    todayCashCount,
  };
}
