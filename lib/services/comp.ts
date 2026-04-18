/**
 * Complimentary access service.
 *
 * Models two distinct concepts:
 *   1. Comp (MemberTicket.isComplimentary=true) — a real plan-backed ticket
 *      issued for free (trial, influencer, family, compensation, etc.).
 *   2. CompPass — a lightweight informal pass with NO plan. Just "I'm letting
 *      this person in for N days while they figure out money/decide to join".
 *
 * Both flows write atomic transactions (MemberTicket/Pass + Payment + AuditLog).
 */

import type { MemberTicket } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import { todayIST } from "@/lib/utils/date";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type CompReason =
  | "trial"
  | "influencer"
  | "family"
  | "compensation"
  | "owner_friend"
  | "money_crunch"
  | "other";

export type IssueCompResult =
  | { success: true; ticket?: MemberTicket; approvalRequested?: boolean; approvalId?: number }
  | { success: false; error: string };

export type IssueCompPassResult =
  | { success: true; passId?: number; approvalRequested?: boolean; approvalId?: number }
  | { success: false; error: string };

export type RevokeResult =
  | { success: true }
  | { success: false; error: string };

export type ConvertResult =
  | { success: true; newTicketId: number }
  | { success: false; error: string };

export type ConvertCompPassResult =
  | { success: true; ticketId: number }
  | { success: false; error: string };

export type ActiveComp = {
  ticketId: number;
  userId: number;
  userName: string;
  userPhone: string | null;
  planId: number;
  planName: string;
  reason: string | null;
  reasonDetail: string | null;
  buyDate: Date;
  expireDate: Date;
  compExpiresAt: Date | null;
  issuedById: number | null;
  issuedByName: string | null;
  approvedById: number | null;
  approvedByName: string | null;
  locationId: number | null;
  visitsSinceIssue: number;
  daysActive: number;
};

export type ActiveCompPass = {
  passId: number;
  userId: number;
  userName: string;
  userPhone: string | null;
  reason: string;
  reasonDetail: string | null;
  startsAt: Date;
  expiresAt: Date;
  issuedById: number;
  issuedByName: string;
  approvedById: number | null;
  approvedByName: string | null;
  notes: string | null;
  visitsSinceIssue: number;
  daysActive: number;
};

export type CompStats = {
  activeCompCount: number;
  activeCompPassCount: number;
  compRatio: number;
  topIssuers: Array<{ workerId: number; workerName: string; count: number }>;
  topConsumers: Array<{ userId: number; userName: string; visits: number }>;
  staleComps: Array<{
    ticketId: number;
    userName: string;
    daysSinceLastVisit: number;
  }>;
  conversionCandidates: Array<{
    ticketId: number;
    userName: string;
    visitsLast30d: number;
  }>;
  revenueLeakEstimateInRupees: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_COMP_AUTO_APPROVE_DAYS = 7;

export async function getCompAutoApproveDaysMax(): Promise<number> {
  const v = await getSetting(
    "comp_auto_approve_days_max",
    String(DEFAULT_COMP_AUTO_APPROVE_DAYS)
  );
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_COMP_AUTO_APPROVE_DAYS;
}

// ─────────────────────────────────────────────────────────────────────────────
// issueComp — a comp on a real plan
// ─────────────────────────────────────────────────────────────────────────────

export async function issueComp(params: {
  userId: number;
  planId: number;
  reason: CompReason;
  reasonDetail?: string;
  days?: number;
  issuedById: number;
  approvedById?: number;
}): Promise<IssueCompResult> {
  // 1. Validate user
  const user = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!user) return { success: false, error: "User not found" };

  // 2. Validate plan
  const plan = await prisma.ticketPlan.findUnique({
    where: { id: params.planId },
  });
  if (!plan) return { success: false, error: "Plan not found" };

  // 3. Validate issuer
  const issuer = await prisma.worker.findUnique({
    where: { id: params.issuedById },
  });
  if (!issuer) return { success: false, error: "Issuing worker not found" };
  if (!issuer.isActive)
    return { success: false, error: "Issuing worker is not active" };

  // 4. Validate approver if provided
  if (params.approvedById) {
    const approver = await prisma.worker.findUnique({
      where: { id: params.approvedById },
    });
    if (!approver) return { success: false, error: "Approver not found" };
  }

  // 5. Resolve days
  const days = params.days ?? plan.expireDays;
  if (!days || days <= 0)
    return { success: false, error: "Comp duration must be > 0 days" };

  // 6. Approval gate — route to universal approval queue
  const maxAutoDays = await getCompAutoApproveDaysMax();
  if (days > maxAutoDays && !params.approvedById) {
    const { requestApproval } = await import("@/lib/services/approvals");
    const approvalRes = await requestApproval({
      type: "comp",
      entityType: "MemberTicket",
      requestedById: params.issuedById,
      payload: {
        userId: params.userId,
        planId: params.planId,
        reason: params.reason,
        reasonDetail: params.reasonDetail ?? null,
        days,
        issuedById: params.issuedById,
      },
      expiresInDays: 30,
    });
    if (!approvalRes.success) {
      return { success: false, error: approvalRes.error };
    }
    return { success: true, approvalRequested: true, approvalId: approvalRes.approvalId };
  }

  // 7. Idempotency: same userId + planId + issuedById + isComplimentary in last 60s
  const sixtySecondsAgo = new Date(Date.now() - 60_000);
  const recentDuplicate = await prisma.memberTicket.findFirst({
    where: {
      userId: params.userId,
      planId: params.planId,
      compIssuedById: params.issuedById,
      isComplimentary: true,
      createdAt: { gte: sixtySecondsAgo },
    },
  });
  if (recentDuplicate) {
    return { success: true, ticket: recentDuplicate };
  }

  // 8. Compute dates
  const today = todayIST();
  const buyDate = new Date();
  const expireDate = new Date(today);
  expireDate.setDate(expireDate.getDate() + days);

  // 9. Resolve a sensible locationId — prefer user's, fall back to issuer's.
  const locationId = user.locationId ?? issuer.locationId ?? null;

  // 10. Atomic transaction
  try {
    const result = await prisma.$transaction(async (tx) => {
      const ticket = await tx.memberTicket.create({
        data: {
          userId: params.userId,
          planId: params.planId,
          locationId,
          buyDate,
          expireDate,
          occasions: plan.occasions,
          status: "active",
          isTrial: plan.isTrial,
          totalAmount: 0,
          amountPaid: 0,
          balanceDue: 0,
          isComplimentary: true,
          compReason: params.reason,
          compIssuedById: params.issuedById,
          compApprovedById: params.approvedById ?? null,
          compExpiresAt: expireDate,
        },
      });

      await tx.payment.create({
        data: {
          userId: params.userId,
          memberTicketId: ticket.id,
          locationId,
          amount: 0,
          paymentMode: "complimentary",
          collectedById: params.issuedById,
          oldExpiryDate: null,
          newExpiryDate: expireDate,
          paymentStatus: "full",
          paymentNote: params.reasonDetail
            ? `comp:${params.reason}:${params.reasonDetail}`
            : `comp:${params.reason}`,
          paymentFor: "complimentary",
        },
      });

      await tx.auditLog.create({
        data: {
          action: "comp.issue",
          status: "success",
          details: JSON.stringify({
            ticketId: ticket.id,
            userId: params.userId,
            planId: params.planId,
            planName: plan.name,
            reason: params.reason,
            reasonDetail: params.reasonDetail ?? null,
            days,
            expireDate: expireDate.toISOString(),
            issuedById: params.issuedById,
            approvedById: params.approvedById ?? null,
          }),
          actorId: params.issuedById,
          actorType: "worker",
        },
      });

      return ticket;
    });

    return { success: true, ticket: result };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to issue comp",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// convertCompToPaid — turn an active comp ticket into a real paid ticket
// ─────────────────────────────────────────────────────────────────────────────

export async function convertCompToPaid(params: {
  ticketId: number;
  newPlanId: number;
  paidAmount: number;
  paymentMode: string;
  collectedById: number;
}): Promise<ConvertResult> {
  const oldTicket = await prisma.memberTicket.findUnique({
    where: { id: params.ticketId },
  });
  if (!oldTicket) return { success: false, error: "Ticket not found" };
  if (!oldTicket.isComplimentary)
    return { success: false, error: "Ticket is not a complimentary ticket" };
  if (oldTicket.status !== "active")
    return { success: false, error: "Comp ticket is not active" };

  const newPlan = await prisma.ticketPlan.findUnique({
    where: { id: params.newPlanId },
  });
  if (!newPlan) return { success: false, error: "New plan not found" };
  if (!newPlan.isActive)
    return { success: false, error: "New plan is not active" };

  const collector = await prisma.worker.findUnique({
    where: { id: params.collectedById },
  });
  if (!collector) return { success: false, error: "Collector not found" };
  if (!collector.isActive)
    return { success: false, error: "Collector is not active" };

  if (params.paidAmount < 0)
    return { success: false, error: "Paid amount must be >= 0" };

  const today = todayIST();
  const newExpiry = new Date(today);
  newExpiry.setDate(newExpiry.getDate() + newPlan.expireDays);

  const totalAmount = Number(newPlan.price);
  const amountPaid = Number(params.paidAmount);
  const balanceDue = Math.max(0, totalAmount - amountPaid);
  const paymentStatus =
    amountPaid >= totalAmount
      ? "full"
      : amountPaid > 0
        ? "partial"
        : "advance";

  try {
    const result = await prisma.$transaction(async (tx) => {
      const newTicket = await tx.memberTicket.create({
        data: {
          userId: oldTicket.userId,
          planId: params.newPlanId,
          locationId: oldTicket.locationId,
          buyDate: new Date(),
          expireDate: newExpiry,
          occasions: newPlan.occasions,
          status: "active",
          totalAmount,
          amountPaid,
          balanceDue,
        },
      });

      await tx.payment.create({
        data: {
          userId: oldTicket.userId,
          memberTicketId: newTicket.id,
          locationId: oldTicket.locationId,
          amount: amountPaid,
          paymentMode: params.paymentMode,
          collectedById: params.collectedById,
          oldExpiryDate: oldTicket.expireDate,
          newExpiryDate: newExpiry,
          paymentStatus,
          paymentFor: "comp_conversion",
        },
      });

      await tx.memberTicket.update({
        where: { id: oldTicket.id },
        data: {
          status: "converted",
          compConvertedToPaidAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          action: "comp.convert",
          status: "success",
          details: JSON.stringify({
            oldTicketId: oldTicket.id,
            newTicketId: newTicket.id,
            userId: oldTicket.userId,
            newPlanId: params.newPlanId,
            newPlanName: newPlan.name,
            paidAmount: amountPaid,
            paymentMode: params.paymentMode,
            balanceDue,
            collectedById: params.collectedById,
          }),
          actorId: params.collectedById,
          actorType: "worker",
        },
      });

      return newTicket;
    });

    return { success: true, newTicketId: result.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to convert comp",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// revokeComp
// ─────────────────────────────────────────────────────────────────────────────

export async function revokeComp(params: {
  ticketId: number;
  reason: string;
  revokedById: number;
}): Promise<RevokeResult> {
  const ticket = await prisma.memberTicket.findUnique({
    where: { id: params.ticketId },
  });
  if (!ticket) return { success: false, error: "Ticket not found" };
  if (!ticket.isComplimentary)
    return { success: false, error: "Ticket is not a complimentary ticket" };
  if (ticket.status !== "active")
    return { success: false, error: "Comp ticket is not active" };

  const revoker = await prisma.worker.findUnique({
    where: { id: params.revokedById },
  });
  if (!revoker) return { success: false, error: "Revoking worker not found" };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.memberTicket.update({
        where: { id: params.ticketId },
        data: {
          status: "cancelled",
          cancelledAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          action: "comp.revoke",
          status: "success",
          details: JSON.stringify({
            ticketId: params.ticketId,
            userId: ticket.userId,
            reason: params.reason,
            revokedById: params.revokedById,
          }),
          actorId: params.revokedById,
          actorType: "worker",
        },
      });
    });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to revoke comp",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// issueCompPass — informal "I'm letting them in" pass with no plan
// ─────────────────────────────────────────────────────────────────────────────

export async function issueCompPass(params: {
  userId: number;
  reason: string;
  reasonDetail?: string;
  expiresAt: Date;
  issuedById: number;
  approvedById?: number;
  notes?: string;
}): Promise<IssueCompPassResult> {
  const user = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!user) return { success: false, error: "User not found" };

  const issuer = await prisma.worker.findUnique({
    where: { id: params.issuedById },
  });
  if (!issuer) return { success: false, error: "Issuing worker not found" };
  if (!issuer.isActive)
    return { success: false, error: "Issuing worker is not active" };

  if (params.approvedById) {
    const approver = await prisma.worker.findUnique({
      where: { id: params.approvedById },
    });
    if (!approver) return { success: false, error: "Approver not found" };
  }

  const startsAt = new Date();
  if (params.expiresAt <= startsAt)
    return { success: false, error: "expiresAt must be in the future" };

  const days = Math.ceil(
    (params.expiresAt.getTime() - startsAt.getTime()) / (24 * 60 * 60 * 1000)
  );
  const maxAutoDays = await getCompAutoApproveDaysMax();
  if (days > maxAutoDays && !params.approvedById) {
    const { requestApproval } = await import("@/lib/services/approvals");
    const approvalRes = await requestApproval({
      type: "comp_pass",
      entityType: "CompPass",
      requestedById: params.issuedById,
      payload: {
        userId: params.userId,
        reason: params.reason,
        reasonDetail: params.reasonDetail ?? null,
        expiresAt: params.expiresAt.toISOString(),
        issuedById: params.issuedById,
        notes: params.notes ?? null,
      },
      expiresInDays: 30,
    });
    if (!approvalRes.success) {
      return { success: false, error: approvalRes.error };
    }
    return { success: true, approvalRequested: true, approvalId: approvalRes.approvalId };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const pass = await tx.compPass.create({
        data: {
          userId: params.userId,
          reason: params.reason,
          reasonDetail: params.reasonDetail ?? null,
          startsAt,
          expiresAt: params.expiresAt,
          issuedById: params.issuedById,
          approvedById: params.approvedById ?? null,
          status: "active",
          notes: params.notes ?? null,
        },
      });

      await tx.auditLog.create({
        data: {
          action: "comp_pass.issue",
          status: "success",
          details: JSON.stringify({
            passId: pass.id,
            userId: params.userId,
            reason: params.reason,
            reasonDetail: params.reasonDetail ?? null,
            expiresAt: params.expiresAt.toISOString(),
            days,
            issuedById: params.issuedById,
            approvedById: params.approvedById ?? null,
          }),
          actorId: params.issuedById,
          actorType: "worker",
        },
      });

      return pass;
    });

    return { success: true, passId: result.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to issue comp pass",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// revokeCompPass
// ─────────────────────────────────────────────────────────────────────────────

export async function revokeCompPass(params: {
  passId: number;
  reason: string;
  revokedById: number;
}): Promise<RevokeResult> {
  const pass = await prisma.compPass.findUnique({ where: { id: params.passId } });
  if (!pass) return { success: false, error: "Comp pass not found" };
  if (pass.status !== "active")
    return { success: false, error: "Comp pass is not active" };

  const revoker = await prisma.worker.findUnique({
    where: { id: params.revokedById },
  });
  if (!revoker) return { success: false, error: "Revoking worker not found" };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.compPass.update({
        where: { id: params.passId },
        data: {
          status: "revoked",
          revokedAt: new Date(),
          revokedById: params.revokedById,
          revokeReason: params.reason,
        },
      });

      await tx.auditLog.create({
        data: {
          action: "comp_pass.revoke",
          status: "success",
          details: JSON.stringify({
            passId: params.passId,
            userId: pass.userId,
            reason: params.reason,
            revokedById: params.revokedById,
          }),
          actorId: params.revokedById,
          actorType: "worker",
        },
      });
    });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to revoke comp pass",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// convertCompPassToPaid — turn an informal pass into a real paid ticket
// ─────────────────────────────────────────────────────────────────────────────

export async function convertCompPassToPaid(params: {
  passId: number;
  planId: number;
  paidAmount: number;
  paymentMode: string;
  collectedById: number;
}): Promise<ConvertCompPassResult> {
  const pass = await prisma.compPass.findUnique({ where: { id: params.passId } });
  if (!pass) return { success: false, error: "Comp pass not found" };
  if (pass.status !== "active")
    return { success: false, error: "Comp pass is not active" };

  const plan = await prisma.ticketPlan.findUnique({
    where: { id: params.planId },
  });
  if (!plan) return { success: false, error: "Plan not found" };
  if (!plan.isActive)
    return { success: false, error: "Plan is not active" };

  const collector = await prisma.worker.findUnique({
    where: { id: params.collectedById },
  });
  if (!collector) return { success: false, error: "Collector not found" };
  if (!collector.isActive)
    return { success: false, error: "Collector is not active" };

  if (params.paidAmount < 0)
    return { success: false, error: "Paid amount must be >= 0" };

  const user = await prisma.user.findUnique({ where: { id: pass.userId } });
  if (!user) return { success: false, error: "User not found" };

  const today = todayIST();
  const newExpiry = new Date(today);
  newExpiry.setDate(newExpiry.getDate() + plan.expireDays);

  const totalAmount = Number(plan.price);
  const amountPaid = Number(params.paidAmount);
  const balanceDue = Math.max(0, totalAmount - amountPaid);
  const paymentStatus =
    amountPaid >= totalAmount
      ? "full"
      : amountPaid > 0
        ? "partial"
        : "advance";

  const locationId = user.locationId ?? collector.locationId ?? null;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const ticket = await tx.memberTicket.create({
        data: {
          userId: pass.userId,
          planId: params.planId,
          locationId,
          buyDate: new Date(),
          expireDate: newExpiry,
          occasions: plan.occasions,
          status: "active",
          totalAmount,
          amountPaid,
          balanceDue,
        },
      });

      await tx.payment.create({
        data: {
          userId: pass.userId,
          memberTicketId: ticket.id,
          locationId,
          amount: amountPaid,
          paymentMode: params.paymentMode,
          collectedById: params.collectedById,
          newExpiryDate: newExpiry,
          paymentStatus,
          paymentFor: "comp_pass_conversion",
        },
      });

      await tx.compPass.update({
        where: { id: params.passId },
        data: {
          status: "converted",
          convertedTicketId: ticket.id,
        },
      });

      await tx.auditLog.create({
        data: {
          action: "comp_pass.convert",
          status: "success",
          details: JSON.stringify({
            passId: params.passId,
            ticketId: ticket.id,
            userId: pass.userId,
            planId: params.planId,
            planName: plan.name,
            paidAmount: amountPaid,
            paymentMode: params.paymentMode,
            balanceDue,
            collectedById: params.collectedById,
          }),
          actorId: params.collectedById,
          actorType: "worker",
        },
      });

      return ticket;
    });
    return { success: true, ticketId: result.id };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to convert comp pass",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Read helpers — getActiveComps / getActiveCompPasses
// ─────────────────────────────────────────────────────────────────────────────

export async function getActiveComps(opts?: {
  locationId?: number;
}): Promise<ActiveComp[]> {
  const today = todayIST();
  const tickets = await prisma.memberTicket.findMany({
    where: {
      isComplimentary: true,
      status: "active",
      expireDate: { gte: today },
      ...(opts?.locationId ? { locationId: opts.locationId } : {}),
    },
    include: {
      user: {
        select: { id: true, firstname: true, lastname: true, phone: true },
      },
      plan: { select: { id: true, name: true } },
      compIssuer: { select: { id: true, firstname: true, lastname: true } },
      compApprover: { select: { id: true, firstname: true, lastname: true } },
    },
    orderBy: { buyDate: "desc" },
  });

  if (tickets.length === 0) return [];

  // Count visits since each ticket's buyDate.
  // Single query: fetch all attendance for these userIds since the earliest
  // ticket buyDate, then bucket per-user and apply each ticket's buyDate cutoff
  // in JS. Replaces N count() queries with one findMany.
  const userIds = Array.from(new Set(tickets.map((t) => t.userId)));
  const minBuyDate = tickets.reduce(
    (acc, t) => (t.buyDate < acc ? t.buyDate : acc),
    tickets[0].buyDate
  );
  const attendanceRows = await prisma.attendanceLog.findMany({
    where: {
      userId: { in: userIds },
      checkIn: { gte: minBuyDate },
    },
    select: { userId: true, checkIn: true },
  });
  const attendanceByUser = new Map<number, Date[]>();
  for (const row of attendanceRows) {
    if (row.userId == null) continue;
    const arr = attendanceByUser.get(row.userId);
    if (arr) arr.push(row.checkIn);
    else attendanceByUser.set(row.userId, [row.checkIn]);
  }
  const visitCounts = new Map<number, number>();
  for (const t of tickets) {
    const checkIns = attendanceByUser.get(t.userId);
    if (!checkIns) {
      visitCounts.set(t.id, 0);
      continue;
    }
    let n = 0;
    for (const c of checkIns) if (c >= t.buyDate) n++;
    visitCounts.set(t.id, n);
  }

  return tickets.map((t) => ({
    ticketId: t.id,
    userId: t.userId,
    userName: `${t.user.firstname} ${t.user.lastname}`,
    userPhone: t.user.phone,
    planId: t.planId,
    planName: t.plan.name,
    reason: t.compReason,
    reasonDetail: null,
    buyDate: t.buyDate,
    expireDate: t.expireDate,
    compExpiresAt: t.compExpiresAt,
    issuedById: t.compIssuedById,
    issuedByName: t.compIssuer
      ? `${t.compIssuer.firstname} ${t.compIssuer.lastname}`
      : null,
    approvedById: t.compApprovedById,
    approvedByName: t.compApprover
      ? `${t.compApprover.firstname} ${t.compApprover.lastname}`
      : null,
    locationId: t.locationId,
    visitsSinceIssue: visitCounts.get(t.id) ?? 0,
    daysActive: Math.max(
      1,
      Math.floor(
        (today.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000)
      )
    ),
  }));
}

export async function getActiveCompPasses(opts?: {
  locationId?: number;
}): Promise<ActiveCompPass[]> {
  const today = todayIST();
  const passes = await prisma.compPass.findMany({
    where: {
      status: "active",
      expiresAt: { gte: today },
      ...(opts?.locationId
        ? { user: { locationId: opts.locationId } }
        : {}),
    },
    include: {
      user: {
        select: { id: true, firstname: true, lastname: true, phone: true },
      },
      issuedBy: { select: { id: true, firstname: true, lastname: true } },
      approvedBy: { select: { id: true, firstname: true, lastname: true } },
    },
    orderBy: { startsAt: "desc" },
  });

  if (passes.length === 0) return [];

  // Single query: fetch all attendance for these userIds since earliest startsAt,
  // bucket per-user, and apply each pass's startsAt cutoff in JS.
  const passUserIds = Array.from(new Set(passes.map((p) => p.userId)));
  const minStartsAt = passes.reduce(
    (acc, p) => (p.startsAt < acc ? p.startsAt : acc),
    passes[0].startsAt
  );
  const passAttendanceRows = await prisma.attendanceLog.findMany({
    where: {
      userId: { in: passUserIds },
      checkIn: { gte: minStartsAt },
    },
    select: { userId: true, checkIn: true },
  });
  const passAttendanceByUser = new Map<number, Date[]>();
  for (const row of passAttendanceRows) {
    if (row.userId == null) continue;
    const arr = passAttendanceByUser.get(row.userId);
    if (arr) arr.push(row.checkIn);
    else passAttendanceByUser.set(row.userId, [row.checkIn]);
  }
  const visitCounts = new Map<number, number>();
  for (const p of passes) {
    const checkIns = passAttendanceByUser.get(p.userId);
    if (!checkIns) {
      visitCounts.set(p.id, 0);
      continue;
    }
    let n = 0;
    for (const c of checkIns) if (c >= p.startsAt) n++;
    visitCounts.set(p.id, n);
  }

  return passes.map((p) => ({
    passId: p.id,
    userId: p.userId,
    userName: `${p.user.firstname} ${p.user.lastname}`,
    userPhone: p.user.phone,
    reason: p.reason,
    reasonDetail: p.reasonDetail,
    startsAt: p.startsAt,
    expiresAt: p.expiresAt,
    issuedById: p.issuedById,
    issuedByName: `${p.issuedBy.firstname} ${p.issuedBy.lastname}`,
    approvedById: p.approvedById,
    approvedByName: p.approvedBy
      ? `${p.approvedBy.firstname} ${p.approvedBy.lastname}`
      : null,
    notes: p.notes,
    visitsSinceIssue: visitCounts.get(p.id) ?? 0,
    daysActive: Math.max(
      1,
      Math.floor(
        (today.getTime() - p.startsAt.getTime()) / (24 * 60 * 60 * 1000)
      )
    ),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// getCompStats — aggregate metrics for the comp auditor + admin dashboard
// ─────────────────────────────────────────────────────────────────────────────

export async function getCompStats(opts?: {
  from?: Date;
  to?: Date;
  locationId?: number;
}): Promise<CompStats> {
  const today = todayIST();
  const from = opts?.from ?? new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = opts?.to ?? today;
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);

  // 1. Active comps + comp passes
  const activeCompsRaw = await prisma.memberTicket.findMany({
    where: {
      isComplimentary: true,
      status: "active",
      expireDate: { gte: today },
      ...(opts?.locationId ? { locationId: opts.locationId } : {}),
    },
    include: {
      user: { select: { id: true, firstname: true, lastname: true } },
      plan: { select: { price: true } },
      compIssuer: { select: { id: true, firstname: true, lastname: true } },
    },
  });

  const activePasses = await prisma.compPass.findMany({
    where: {
      status: "active",
      expiresAt: { gte: today },
      ...(opts?.locationId
        ? { user: { locationId: opts.locationId } }
        : {}),
    },
    include: {
      issuedBy: { select: { id: true, firstname: true, lastname: true } },
      user: { select: { id: true, firstname: true, lastname: true } },
    },
  });

  // 2. Total active members (any active, non-expired ticket — comp or paid)
  const totalActiveMembers = await prisma.memberTicket.count({
    where: {
      status: "active",
      expireDate: { gte: today },
      ...(opts?.locationId ? { locationId: opts.locationId } : {}),
    },
  });

  const activeCompCount = activeCompsRaw.length;
  const activeCompPassCount = activePasses.length;
  const compRatio =
    totalActiveMembers > 0
      ? (activeCompCount + activeCompPassCount) / totalActiveMembers
      : 0;

  // 3. Top issuers (within `from..to` window) — combine comp ticket issuers + comp pass issuers
  const compIssuerCounts = new Map<
    number,
    { workerId: number; workerName: string; count: number }
  >();

  const ticketsInWindow = await prisma.memberTicket.findMany({
    where: {
      isComplimentary: true,
      buyDate: { gte: from, lte: to },
      ...(opts?.locationId ? { locationId: opts.locationId } : {}),
    },
    include: {
      compIssuer: { select: { id: true, firstname: true, lastname: true } },
    },
  });
  for (const t of ticketsInWindow) {
    if (!t.compIssuer) continue;
    const wid = t.compIssuer.id;
    const cur = compIssuerCounts.get(wid);
    if (cur) {
      cur.count += 1;
    } else {
      compIssuerCounts.set(wid, {
        workerId: wid,
        workerName: `${t.compIssuer.firstname} ${t.compIssuer.lastname}`,
        count: 1,
      });
    }
  }

  const passesInWindow = await prisma.compPass.findMany({
    where: {
      startsAt: { gte: from, lte: to },
      ...(opts?.locationId
        ? { user: { locationId: opts.locationId } }
        : {}),
    },
    include: {
      issuedBy: { select: { id: true, firstname: true, lastname: true } },
    },
  });
  for (const p of passesInWindow) {
    const wid = p.issuedBy.id;
    const cur = compIssuerCounts.get(wid);
    if (cur) {
      cur.count += 1;
    } else {
      compIssuerCounts.set(wid, {
        workerId: wid,
        workerName: `${p.issuedBy.firstname} ${p.issuedBy.lastname}`,
        count: 1,
      });
    }
  }

  const topIssuers = Array.from(compIssuerCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // 4. Top consumers — visits in last 30d, restricted to users with active comps/passes
  const compUserIds = new Set<number>([
    ...activeCompsRaw.map((t) => t.userId),
    ...activePasses.map((p) => p.userId),
  ]);

  const userNameById = new Map<number, string>();
  for (const t of activeCompsRaw)
    userNameById.set(t.userId, `${t.user.firstname} ${t.user.lastname}`);
  for (const p of activePasses)
    userNameById.set(p.userId, `${p.user.firstname} ${p.user.lastname}`);

  const topConsumers: Array<{
    userId: number;
    userName: string;
    visits: number;
  }> = [];
  if (compUserIds.size > 0) {
    const visits = await prisma.attendanceLog.groupBy({
      by: ["userId"],
      where: {
        userId: { in: Array.from(compUserIds) },
        checkIn: { gte: thirtyDaysAgo },
      },
      _count: { _all: true },
    });
    for (const row of visits) {
      if (!row.userId) continue;
      topConsumers.push({
        userId: row.userId,
        userName: userNameById.get(row.userId) ?? `User #${row.userId}`,
        visits: row._count._all,
      });
    }
    topConsumers.sort((a, b) => b.visits - a.visits);
  }

  // 5. Stale comps — active comp tickets whose user has no visit in 14 days
  const staleComps: Array<{
    ticketId: number;
    userName: string;
    daysSinceLastVisit: number;
  }> = [];
  for (const t of activeCompsRaw) {
    const lastVisit = await prisma.attendanceLog.findFirst({
      where: { userId: t.userId },
      orderBy: { checkIn: "desc" },
      select: { checkIn: true },
    });
    const lastVisitDate = lastVisit?.checkIn ?? t.buyDate;
    const days = Math.floor(
      (today.getTime() - lastVisitDate.getTime()) / (24 * 60 * 60 * 1000)
    );
    if (days >= 14) {
      staleComps.push({
        ticketId: t.id,
        userName: `${t.user.firstname} ${t.user.lastname}`,
        daysSinceLastVisit: days,
      });
    }
  }
  staleComps.sort((a, b) => b.daysSinceLastVisit - a.daysSinceLastVisit);

  // 6. Conversion candidates — comps with >= 8 visits in last 30d (high engagement, ripe for paid)
  const conversionCandidates: Array<{
    ticketId: number;
    userName: string;
    visitsLast30d: number;
  }> = [];
  for (const t of activeCompsRaw) {
    const v = await prisma.attendanceLog.count({
      where: {
        userId: t.userId,
        checkIn: { gte: fourteenDaysAgo },
      },
    });
    if (v >= 8) {
      conversionCandidates.push({
        ticketId: t.id,
        userName: `${t.user.firstname} ${t.user.lastname}`,
        visitsLast30d: v,
      });
    }
  }
  conversionCandidates.sort((a, b) => b.visitsLast30d - a.visitsLast30d);

  // 7. Revenue leak — sum of plan prices of active comps (i.e. what we'd have collected)
  const revenueLeakEstimateInRupees = activeCompsRaw.reduce(
    (acc, t) => acc + Number(t.plan.price ?? 0),
    0
  );

  return {
    activeCompCount,
    activeCompPassCount,
    compRatio,
    topIssuers,
    topConsumers: topConsumers.slice(0, 5),
    staleComps,
    conversionCandidates,
    revenueLeakEstimateInRupees,
  };
}
