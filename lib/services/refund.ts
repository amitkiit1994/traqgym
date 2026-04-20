/**
 * Refund service.
 *
 * Models the lifecycle of a refund:
 *   1. requestRefund — staff or admin requests a refund against a Payment.
 *      Always creates a Refund row with status="pending" + a universal
 *      Approval row (so all refunds require admin approval).
 *   2. approveRefund — called by the approval dispatcher when an admin approves
 *      the request. Flips the Refund to status="approved". Does NOT process the
 *      money movement — that's a separate explicit step (manual cash handoff,
 *      bank transfer confirmation, or PG callback).
 *   3. processRefund — admin marks the refund as actually processed. Atomically
 *      stamps amountRefunded, processedAt, status="processed", inserts a
 *      reversing Payment row (negative amount, paymentMode="refund"), and
 *      computes the GST reversal (only for "regular" GST scheme).
 *   4. rejectRefund — flips a pending refund to status="rejected".
 *
 * All state transitions are idempotent — calling them twice is a no-op.
 */
import { Prisma, type Refund } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type RefundReason =
  | "quit"
  | "dissatisfied"
  | "duplicate_charge"
  | "medical"
  | "gym_closure"
  | "other";

export type RefundMode =
  | "cash"
  | "upi"
  | "bank_transfer"
  | "adjust_against_next_plan";

export type RefundStatus =
  | "pending"
  | "approved"
  | "processed"
  | "rejected"
  | "failed";

export type RequestRefundResult =
  | { success: true; refundId: number; approvalId: number }
  | { success: false; error: string };

export type ApproveRefundResult =
  | { success: true; refundId: number; alreadyDecided?: boolean }
  | { success: false; error: string };

export type ProcessRefundResult =
  | {
      success: true;
      refundId: number;
      reversingPaymentId?: number;
      gstReversalAmount: number | null;
      alreadyProcessed?: boolean;
    }
  | { success: false; error: string };

export type RejectRefundResult =
  | { success: true; refundId: number; alreadyDecided?: boolean }
  | { success: false; error: string };

export type RefundRow = {
  id: number;
  paymentId: number;
  invoiceId: number | null;
  memberTicketId: number | null;
  userId: number | null;
  userName: string | null;
  amountRequested: number;
  amountRefunded: number;
  refundMode: string;
  reason: string;
  reasonDetail: string | null;
  status: string;
  requestedById: number;
  requestedByName: string;
  approvedById: number | null;
  approvedByName: string | null;
  approvedAt: Date | null;
  processedAt: Date | null;
  pgRefundId: string | null;
  gstReversalAmount: number | null;
  proRataDays: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// ─────────────────────────────────────────────────────────────────────────────
// requestRefund
// ─────────────────────────────────────────────────────────────────────────────

export async function requestRefund(params: {
  paymentId: number;
  amountRequested: number;
  reason: RefundReason;
  reasonDetail?: string;
  refundMode: RefundMode;
  requestedById: number;
  proRataDays?: number;
  notes?: string;
}): Promise<RequestRefundResult> {
  if (params.amountRequested <= 0) {
    return { success: false, error: "Refund amount must be > 0" };
  }

  const payment = await prisma.payment.findUnique({
    where: { id: params.paymentId },
    include: { invoice: true },
  });
  if (!payment) {
    return { success: false, error: "Payment not found" };
  }

  const paid = Number(payment.amount);
  if (params.amountRequested > paid) {
    return {
      success: false,
      error: `Refund amount ₹${params.amountRequested} exceeds payment amount ₹${paid}`,
    };
  }

  const requester = await prisma.worker.findUnique({
    where: { id: params.requestedById },
  });
  if (!requester) {
    return { success: false, error: "Requesting worker not found" };
  }

  // Check for an existing pending refund on this payment to inform the audit
  // log (purely informational — the cumulative-amount guard below is what
  // actually blocks duplicates / over-refunds).
  const existingPending = await prisma.refund.findFirst({
    where: { paymentId: params.paymentId, status: { in: ["pending", "approved"] } },
  });

  try {
    const refund = await prisma.$transaction(async (tx) => {
      // R04 guard: prevent stacked refunds that, in aggregate, exceed the
      // original payment. We must include refunds that have already been
      // PROCESSED (money already left the till) in addition to pending /
      // approved ones — otherwise a partial-processed refund leaves the door
      // open for a second request that, when also processed, exceeds the
      // payment amount. Run inside the txn to avoid races between
      // concurrent requestRefund calls (txn isolation serializes the read).
      const cumulativeAgg = await tx.refund.groupBy({
        by: ["status"],
        where: {
          paymentId: params.paymentId,
          status: { in: ["pending", "approved", "processed"] },
        },
        _sum: { amountRequested: true },
      });

      let alreadyProcessedTotal = 0;
      let alreadyPendingTotal = 0;
      for (const row of cumulativeAgg) {
        const sum = Number(row._sum.amountRequested ?? 0);
        if (row.status === "processed") {
          alreadyProcessedTotal += sum;
        } else {
          alreadyPendingTotal += sum;
        }
      }

      const cumulative =
        alreadyProcessedTotal + alreadyPendingTotal + params.amountRequested;
      if (cumulative > paid) {
        throw new Error(
          `Cumulative refund ₹${cumulative.toFixed(2)} (processed ₹${alreadyProcessedTotal.toFixed(
            2,
          )} + pending/approved ₹${alreadyPendingTotal.toFixed(
            2,
          )} + requested ₹${params.amountRequested.toFixed(
            2,
          )}) exceeds payment amount ₹${paid.toFixed(2)}`,
        );
      }

      const created = await tx.refund.create({
        data: {
          paymentId: params.paymentId,
          invoiceId: payment.invoice?.id ?? null,
          memberTicketId: payment.memberTicketId ?? null,
          amountRequested: params.amountRequested,
          amountRefunded: 0,
          refundMode: params.refundMode,
          reason: params.reason,
          reasonDetail: params.reasonDetail ?? null,
          status: "pending",
          requestedById: params.requestedById,
          proRataDays: params.proRataDays ?? null,
          notes: params.notes ?? null,
        },
      });

      await tx.auditLog.create({
        data: {
          action: "refund.request",
          status: "success",
          details: JSON.stringify({
            refundId: created.id,
            paymentId: params.paymentId,
            amountRequested: params.amountRequested,
            refundMode: params.refundMode,
            reason: params.reason,
            reasonDetail: params.reasonDetail ?? null,
            proRataDays: params.proRataDays ?? null,
            requestedById: params.requestedById,
            existingPendingRefundId: existingPending?.id ?? null,
          }),
          actorId: params.requestedById,
          actorType: "worker",
        },
      });

      return created;
    });

    // Route to the universal approval queue (lazy import to avoid cycle).
    const { requestApproval } = await import("@/lib/services/approvals");
    const approvalRes = await requestApproval({
      type: "refund",
      entityType: "Refund",
      entityId: refund.id,
      requestedById: params.requestedById,
      payload: {
        refundId: refund.id,
        paymentId: params.paymentId,
        amountRequested: params.amountRequested,
        refundMode: params.refundMode,
        reason: params.reason,
        reasonDetail: params.reasonDetail ?? null,
        proRataDays: params.proRataDays ?? null,
      },
      expiresInDays: 30,
    });

    if (!approvalRes.success) {
      return { success: false, error: approvalRes.error };
    }

    return {
      success: true,
      refundId: refund.id,
      approvalId: approvalRes.approvalId,
    };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to request refund",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// approveRefund — flips status to "approved". Does NOT move money.
// ─────────────────────────────────────────────────────────────────────────────

export async function approveRefund(
  refundId: number,
  approverId: number,
  note?: string
): Promise<ApproveRefundResult> {
  const refund = await prisma.refund.findUnique({ where: { id: refundId } });
  if (!refund) return { success: false, error: "Refund not found" };

  if (refund.status !== "pending") {
    return { success: true, refundId, alreadyDecided: true };
  }

  const approver = await prisma.worker.findUnique({
    where: { id: approverId },
  });
  if (!approver) return { success: false, error: "Approver not found" };

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      // Atomic conditional update — only flips if status is still "pending".
      // Two concurrent admins (one approving, one rejecting) cannot both win:
      // whichever transaction commits first sets status away from "pending",
      // and the other's updateMany matches 0 rows.
      const updated = await tx.refund.updateMany({
        where: { id: refundId, status: "pending" },
        data: {
          status: "approved",
          approvedById: approverId,
          approvedAt: new Date(),
          ...(note !== undefined ? { notes: note } : {}),
        },
      });

      if (updated.count !== 1) {
        // Lost the race — read the current state to report who decided it.
        const current = await tx.refund.findUnique({
          where: { id: refundId },
          select: {
            status: true,
            approvedById: true,
            approvedAt: true,
          },
        });
        return { raced: true as const, current };
      }

      await tx.auditLog.create({
        data: {
          action: "refund.approve",
          status: "success",
          details: JSON.stringify({
            refundId,
            approverId,
            note: note ?? null,
          }),
          actorId: approverId,
          actorType: "worker",
        },
      });

      return { raced: false as const };
    });

    if (outcome.raced) {
      const decidedBy = outcome.current?.approvedById ?? "unknown";
      const decidedAt = outcome.current?.approvedAt
        ? outcome.current.approvedAt.toISOString()
        : "unknown time";
      const status = outcome.current?.status ?? "unknown";
      return {
        success: false,
        error: `Refund #${refundId} was already decided (status="${status}") by worker ${decidedBy} at ${decidedAt}`,
      };
    }

    return { success: true, refundId };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to approve refund",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// processRefund — atomically stamp amountRefunded + reverse Payment + GST
// ─────────────────────────────────────────────────────────────────────────────

export async function processRefund(params: {
  refundId: number;
  processedById: number;
  processedAt?: Date;
  pgRefundId?: string;
}): Promise<ProcessRefundResult> {
  const refund = await prisma.refund.findUnique({
    where: { id: params.refundId },
    include: { payment: true },
  });
  if (!refund) return { success: false, error: "Refund not found" };

  if (refund.status === "processed") {
    return {
      success: true,
      refundId: refund.id,
      gstReversalAmount: refund.gstReversalAmount
        ? Number(refund.gstReversalAmount)
        : null,
      alreadyProcessed: true,
    };
  }

  if (refund.status !== "approved") {
    return {
      success: false,
      error: `Cannot process refund in status "${refund.status}"`,
    };
  }

  const processor = await prisma.worker.findUnique({
    where: { id: params.processedById },
  });
  if (!processor)
    return { success: false, error: "Processing worker not found" };

  // Compute GST reversal — only for "regular" scheme; "composition" has no
  // input tax to reverse.
  const gstScheme = (await getSetting("gym_gst_scheme", "none")).toLowerCase();
  const gstRateRaw = await getSetting("gym_gst_rate", "18");
  const gstRate = parseFloat(gstRateRaw);
  const safeGstRate = Number.isFinite(gstRate) && gstRate > 0 ? gstRate : 18;

  const amountRefunded = Number(refund.amountRequested);

  // Compute GST reversal in Decimal to avoid binary-float drift on paise.
  // Tax-inclusive total = base + tax, where tax = base * rate/100.
  //   => base = total / (1 + rate/100)
  //   => tax  = total - base   (guarantees base + tax === total exactly)
  let gstReversalAmount: number | null = null;
  let gstBaseAmount: number | null = null;
  if (gstScheme === "regular") {
    const total = new Prisma.Decimal(refund.amountRequested.toString());
    const divisor = new Prisma.Decimal(1).plus(
      new Prisma.Decimal(safeGstRate).div(100),
    );
    const baseAmountDec = total
      .div(divisor)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const taxAmountDec = total.minus(baseAmountDec);

    // Sanity check: base + tax must equal total exactly (no residual paise).
    if (!baseAmountDec.plus(taxAmountDec).equals(total)) {
      return {
        success: false,
        error: `GST split failed integrity check: base ${baseAmountDec.toString()} + tax ${taxAmountDec.toString()} != total ${total.toString()}`,
      };
    }

    gstReversalAmount = taxAmountDec.toNumber();
    gstBaseAmount = baseAmountDec.toNumber();
  }

  const processedAt = params.processedAt ?? new Date();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const fresh = await tx.refund.findUnique({
        where: { id: params.refundId },
      });
      if (!fresh || fresh.status !== "approved") {
        return { reversingPaymentId: undefined as number | undefined };
      }

      await tx.refund.update({
        where: { id: params.refundId },
        data: {
          status: "processed",
          amountRefunded,
          processedAt,
          pgRefundId: params.pgRefundId ?? null,
          gstReversalAmount,
        },
      });

      // Tag the reversing Payment to the currently-open CashShift at the
      // refund's location (if any). Mirrors how forward cash payments are
      // tagged so end-of-shift reconciliation includes refund outflows in the
      // expected-cash calculation. If no shift is open (refund processed
      // outside operating hours), shiftId stays null — explicit, not a bug.
      let openShiftId: number | null = null;
      if (refund.payment.locationId != null) {
        const openShift = await tx.cashShift.findFirst({
          where: { locationId: refund.payment.locationId, status: "open" },
          select: { id: true },
        });
        openShiftId = openShift?.id ?? null;
      }

      // Insert a reversing Payment row (negative amount, mode="refund").
      const reversing = await tx.payment.create({
        data: {
          userId: refund.payment.userId,
          memberTicketId: refund.payment.memberTicketId,
          locationId: refund.payment.locationId,
          amount: -Math.abs(amountRefunded),
          paymentMode: "refund",
          collectedById: params.processedById,
          paymentStatus: "full",
          paymentNote: `Refund #${refund.id} (${refund.reason}) via ${refund.refundMode}`,
          paymentFor: "refund",
          shiftId: openShiftId,
          baseAmount:
            gstBaseAmount != null ? -Math.abs(gstBaseAmount) : null,
          taxRate: gstReversalAmount != null ? safeGstRate : null,
          taxAmount: gstReversalAmount != null ? -gstReversalAmount : null,
          razorpayPaymentId: params.pgRefundId ?? null,
        },
      });

      await tx.auditLog.create({
        data: {
          action: "refund.process",
          status: "success",
          details: JSON.stringify({
            refundId: refund.id,
            paymentId: refund.paymentId,
            reversingPaymentId: reversing.id,
            amountRefunded,
            gstScheme,
            gstReversalAmount,
            pgRefundId: params.pgRefundId ?? null,
            processedById: params.processedById,
            shiftId: openShiftId,
          }),
          actorId: params.processedById,
          actorType: "worker",
        },
      });

      return { reversingPaymentId: reversing.id };
    });

    return {
      success: true,
      refundId: refund.id,
      reversingPaymentId: result.reversingPaymentId,
      gstReversalAmount,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to process refund",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// rejectRefund
// ─────────────────────────────────────────────────────────────────────────────

export async function rejectRefund(params: {
  refundId: number;
  decidedById: number;
  decisionNote?: string;
}): Promise<RejectRefundResult> {
  const refund = await prisma.refund.findUnique({
    where: { id: params.refundId },
  });
  if (!refund) return { success: false, error: "Refund not found" };

  if (refund.status !== "pending" && refund.status !== "approved") {
    return { success: true, refundId: refund.id, alreadyDecided: true };
  }

  const decider = await prisma.worker.findUnique({
    where: { id: params.decidedById },
  });
  if (!decider) return { success: false, error: "Deciding worker not found" };

  try {
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.refund.findUnique({
        where: { id: params.refundId },
      });
      if (!fresh) return;
      if (fresh.status !== "pending" && fresh.status !== "approved") return;

      await tx.refund.update({
        where: { id: params.refundId },
        data: {
          status: "rejected",
          notes: params.decisionNote ?? fresh.notes,
        },
      });

      await tx.auditLog.create({
        data: {
          action: "refund.reject",
          status: "success",
          details: JSON.stringify({
            refundId: refund.id,
            decidedById: params.decidedById,
            decisionNote: params.decisionNote ?? null,
          }),
          actorId: params.decidedById,
          actorType: "worker",
        },
      });
    });
    return { success: true, refundId: refund.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to reject refund",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// listRefunds / getRefundDetail
// ─────────────────────────────────────────────────────────────────────────────

export async function listRefunds(opts?: {
  status?: RefundStatus;
  from?: Date;
  to?: Date;
  limit?: number;
}): Promise<RefundRow[]> {
  const rows = await prisma.refund.findMany({
    where: {
      ...(opts?.status ? { status: opts.status } : {}),
      ...(opts?.from || opts?.to
        ? {
            createdAt: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
    },
    include: {
      requestedBy: { select: { id: true, firstname: true, lastname: true } },
      approvedBy: { select: { id: true, firstname: true, lastname: true } },
      payment: { select: { userId: true, user: { select: { firstname: true, lastname: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: opts?.limit ?? 200,
  });

  return rows.map((r) => mapRefundRow(r));
}

export async function getRefundDetail(id: number): Promise<RefundRow | null> {
  const r = await prisma.refund.findUnique({
    where: { id },
    include: {
      requestedBy: { select: { id: true, firstname: true, lastname: true } },
      approvedBy: { select: { id: true, firstname: true, lastname: true } },
      payment: {
        select: {
          userId: true,
          user: { select: { firstname: true, lastname: true } },
        },
      },
    },
  });
  if (!r) return null;
  return mapRefundRow(r);
}

type RefundQueryRow = Refund & {
  requestedBy: { id: number; firstname: string; lastname: string };
  approvedBy: { id: number; firstname: string; lastname: string } | null;
  // Payment.user/userId are nullable (POS sales have no member); the refund
  // mapper handles null via optional-chain on `r.payment?.user`.
  payment: {
    userId: number | null;
    user: { firstname: string; lastname: string } | null;
  };
};

function mapRefundRow(r: RefundQueryRow): RefundRow {
  return {
    id: r.id,
    paymentId: r.paymentId,
    invoiceId: r.invoiceId,
    memberTicketId: r.memberTicketId,
    userId: r.payment?.userId ?? null,
    userName: r.payment?.user
      ? `${r.payment.user.firstname} ${r.payment.user.lastname}`
      : null,
    amountRequested: Number(r.amountRequested),
    amountRefunded: Number(r.amountRefunded),
    refundMode: r.refundMode,
    reason: r.reason,
    reasonDetail: r.reasonDetail,
    status: r.status,
    requestedById: r.requestedById,
    requestedByName: `${r.requestedBy.firstname} ${r.requestedBy.lastname}`,
    approvedById: r.approvedById,
    approvedByName: r.approvedBy
      ? `${r.approvedBy.firstname} ${r.approvedBy.lastname}`
      : null,
    approvedAt: r.approvedAt,
    processedAt: r.processedAt,
    pgRefundId: r.pgRefundId,
    gstReversalAmount: r.gstReversalAmount
      ? Number(r.gstReversalAmount)
      : null,
    proRataDays: r.proRataDays,
    notes: r.notes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function getPendingRefundsCount(): Promise<number> {
  return prisma.refund.count({ where: { status: "pending" } });
}
