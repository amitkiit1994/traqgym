/**
 * Earned Autonomy outcomes cron (nightly, 20:50 UTC = 02:20 IST, off-peak).
 *
 * The accountability half of the action loop — projections are promises and
 * this job checks them. For every executed/auto_executed proposal whose
 * clockspeed window has elapsed and that has not been measured yet:
 *
 *   renewal_reminder  hit = new Payment (or new MemberTicket) for the target
 *                     member within the window; rupees = actual payments.
 *   winback_message   hit = new active MemberTicket within 30 days;
 *                     rupees = what the returning member actually paid.
 *   dues_nudge        hit = ticket balanceDue decreased vs the balance
 *                     snapshotted at proposal time; rupees = the delta.
 *   enquiry_followup  hit = enquiry stage advanced (or converted) vs the
 *                     stage snapshotted at proposal time; rupees = payments
 *                     by the converted member within the window (0 for a
 *                     non-converting stage advance — honest under-credit).
 *   payment_followup  hit = payment received (Payment rows in window) or the
 *                     followup marked resolved; rupees = payments in window.
 *
 * Each measurement writes outcomeStatus + outcomeImpactInr + an AuditLog row
 * with the evidence. Then per action type: recompute outcomeHitRate /
 * calibrationPct / measuredCount, expire stale proposals, run the graduation
 * check (Insight suggestion — owner accepts via /autonomy notify <type>) and
 * the auto-demotion sweep (notify -> verify on calibration collapse or
 * execution failures — fail-toward-human, runs even when the kill-switch is
 * off).
 *
 * Measurement itself runs regardless of the kill-switch: it is read-only
 * bookkeeping on sends that already happened, not a new execution path.
 * Graduation SUGGESTIONS are skipped while autonomy is disabled (no point
 * inviting auto-mode for a loop the owner has off).
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCronSecret } from "@/lib/auth-cron";
import {
  MESSAGE_ACTION_TYPES,
  recordMeasuredOutcome,
  recomputeOutcomeStats,
  expireStaleProposals,
  checkGraduation,
  checkAutoDemotion,
  isAutonomyEnabled,
  DEFAULT_CLOCKSPEED_DAYS,
  type MessageActionType,
  type OutcomeVerdict,
} from "@/lib/services/action-loop";

export const dynamic = "force-dynamic";

// Enquiry pipeline order for "stage advanced" measurement. "lost" is never
// an advance; "converted" always is.
const ENQUIRY_STAGE_ORDER = [
  "new",
  "contacted",
  "tour_scheduled",
  "tour_done",
  "trial",
  "negotiation",
  "converted",
];

type Measurement = {
  status: OutcomeVerdict;
  impactInr: number;
  evidence: Record<string, unknown>;
};

async function measureRenewalReminder(p: {
  targetUserId: number | null;
  executedAt: Date;
  windowEnd: Date;
}): Promise<Measurement> {
  if (!p.targetUserId) {
    return { status: "unmeasurable", impactInr: 0, evidence: { reason: "no target user" } };
  }
  const payments = await prisma.payment.findMany({
    where: {
      userId: p.targetUserId,
      createdAt: { gt: p.executedAt, lte: p.windowEnd },
      amount: { gt: 0 },
    },
    select: { id: true, amount: true },
  });
  const paid = payments.reduce((s, x) => s + Number(x.amount), 0);
  if (paid > 0) {
    return {
      status: "hit",
      impactInr: paid,
      evidence: { paymentIds: payments.map((x) => x.id) },
    };
  }
  // Renewal recorded without a Payment row in the window (e.g. fully-comped
  // or back-dated): a new ticket still counts as a save, credited at what
  // was actually collected on it so far.
  const newTicket = await prisma.memberTicket.findFirst({
    where: {
      userId: p.targetUserId,
      createdAt: { gt: p.executedAt, lte: p.windowEnd },
      status: "active",
    },
    select: { id: true, amountPaid: true },
  });
  if (newTicket) {
    return {
      status: "hit",
      impactInr: Number(newTicket.amountPaid ?? 0),
      evidence: { newTicketId: newTicket.id },
    };
  }
  return { status: "miss", impactInr: 0, evidence: {} };
}

async function measureWinback(p: {
  targetUserId: number | null;
  executedAt: Date;
  windowEnd: Date;
}): Promise<Measurement> {
  if (!p.targetUserId) {
    return { status: "unmeasurable", impactInr: 0, evidence: { reason: "no target user" } };
  }
  const newTicket = await prisma.memberTicket.findFirst({
    where: {
      userId: p.targetUserId,
      createdAt: { gt: p.executedAt, lte: p.windowEnd },
      status: "active",
    },
    select: { id: true, amountPaid: true, totalAmount: true },
  });
  if (!newTicket) return { status: "miss", impactInr: 0, evidence: {} };
  const payments = await prisma.payment.findMany({
    where: {
      userId: p.targetUserId,
      createdAt: { gt: p.executedAt, lte: p.windowEnd },
      amount: { gt: 0 },
    },
    select: { id: true, amount: true },
  });
  const paid = payments.reduce((s, x) => s + Number(x.amount), 0);
  return {
    status: "hit",
    impactInr: paid > 0 ? paid : Number(newTicket.amountPaid ?? 0),
    evidence: { newTicketId: newTicket.id, paymentIds: payments.map((x) => x.id) },
  };
}

async function measureDuesNudge(p: {
  gymContext: unknown;
}): Promise<Measurement> {
  const ctx = (p.gymContext ?? {}) as {
    ticketId?: number;
    balanceDueAtProposal?: number;
  };
  if (!ctx.ticketId || ctx.balanceDueAtProposal === undefined) {
    return {
      status: "unmeasurable",
      impactInr: 0,
      evidence: { reason: "no ticketId/balance snapshot in gymContext" },
    };
  }
  const ticket = await prisma.memberTicket.findUnique({
    where: { id: ctx.ticketId },
    select: { id: true, balanceDue: true },
  });
  if (!ticket) {
    return { status: "unmeasurable", impactInr: 0, evidence: { reason: "ticket deleted" } };
  }
  const delta = ctx.balanceDueAtProposal - Number(ticket.balanceDue);
  if (delta > 0) {
    return {
      status: "hit",
      impactInr: delta,
      evidence: {
        ticketId: ticket.id,
        balanceAtProposal: ctx.balanceDueAtProposal,
        balanceNow: Number(ticket.balanceDue),
      },
    };
  }
  return {
    status: "miss",
    impactInr: 0,
    evidence: {
      ticketId: ticket.id,
      balanceAtProposal: ctx.balanceDueAtProposal,
      balanceNow: Number(ticket.balanceDue),
    },
  };
}

async function measureEnquiryFollowup(p: {
  gymContext: unknown;
  executedAt: Date;
  windowEnd: Date;
}): Promise<Measurement> {
  const ctx = (p.gymContext ?? {}) as {
    enquiryId?: number;
    stageAtProposal?: string;
  };
  if (!ctx.enquiryId) {
    return { status: "unmeasurable", impactInr: 0, evidence: { reason: "no enquiryId" } };
  }
  const enquiry = await prisma.enquiry.findUnique({
    where: { id: ctx.enquiryId },
    select: { id: true, stage: true, convertedUserId: true },
  });
  if (!enquiry) {
    return { status: "unmeasurable", impactInr: 0, evidence: { reason: "enquiry deleted" } };
  }
  const before = ENQUIRY_STAGE_ORDER.indexOf(ctx.stageAtProposal ?? "new");
  const after = ENQUIRY_STAGE_ORDER.indexOf(enquiry.stage);
  const converted = enquiry.convertedUserId !== null || enquiry.stage === "converted";
  const advanced =
    converted || (after > before && after >= 0 && enquiry.stage !== "lost");
  let impactInr = 0;
  let paymentIds: number[] = [];
  if (converted && enquiry.convertedUserId) {
    const payments = await prisma.payment.findMany({
      where: {
        userId: enquiry.convertedUserId,
        createdAt: { gt: p.executedAt, lte: p.windowEnd },
        amount: { gt: 0 },
      },
      select: { id: true, amount: true },
    });
    impactInr = payments.reduce((s, x) => s + Number(x.amount), 0);
    paymentIds = payments.map((x) => x.id);
  }
  return {
    status: advanced ? "hit" : "miss",
    impactInr,
    evidence: {
      enquiryId: enquiry.id,
      stageAtProposal: ctx.stageAtProposal ?? "new",
      stageNow: enquiry.stage,
      converted,
      paymentIds,
    },
  };
}

async function measurePaymentFollowup(p: {
  targetUserId: number | null;
  gymContext: unknown;
  executedAt: Date;
  windowEnd: Date;
}): Promise<Measurement> {
  const ctx = (p.gymContext ?? {}) as {
    followupId?: number;
    memberTicketId?: number | null;
  };
  if (!p.targetUserId) {
    return { status: "unmeasurable", impactInr: 0, evidence: { reason: "no target user" } };
  }
  const payments = await prisma.payment.findMany({
    where: {
      userId: p.targetUserId,
      createdAt: { gt: p.executedAt, lte: p.windowEnd },
      amount: { gt: 0 },
      ...(ctx.memberTicketId ? { memberTicketId: ctx.memberTicketId } : {}),
    },
    select: { id: true, amount: true },
  });
  const paid = payments.reduce((s, x) => s + Number(x.amount), 0);
  let resolved = false;
  if (ctx.followupId) {
    const fu = await prisma.paymentFollowup.findUnique({
      where: { id: ctx.followupId },
      select: { status: true, resolvedAt: true },
    });
    resolved = fu?.status === "resolved";
  }
  if (paid > 0 || resolved) {
    return {
      status: "hit",
      impactInr: paid, // resolved with 0 traced payments = honest 0-rupee hit
      evidence: { followupId: ctx.followupId ?? null, resolved, paymentIds: payments.map((x) => x.id) },
    };
  }
  return {
    status: "miss",
    impactInr: 0,
    evidence: { followupId: ctx.followupId ?? null, resolved: false },
  };
}

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  const now = new Date();
  const autonomyOn = await isAutonomyEnabled();

  // 1. Expire stale still-proposed rows (opportunity decayed).
  const expired = await expireStaleProposals();

  // 2. Measure executed proposals past their clockspeed window.
  const candidates = await prisma.actionProposal.findMany({
    where: {
      status: { in: ["executed", "auto_executed"] },
      outcomeMeasuredAt: null,
      executedAt: { not: null },
    },
    select: {
      id: true,
      actionType: true,
      targetUserId: true,
      executedAt: true,
      clockspeedDays: true,
      gymContext: true,
      projectedImpactInr: true,
    },
    orderBy: { executedAt: "asc" },
    take: 500,
  });

  let measured = 0;
  let hits = 0;
  let misses = 0;
  let unmeasurable = 0;
  const touchedTypes = new Set<string>();

  for (const c of candidates) {
    if (!c.executedAt) continue;
    const windowDays =
      c.clockspeedDays ??
      DEFAULT_CLOCKSPEED_DAYS[c.actionType as MessageActionType] ??
      7;
    const windowEnd = new Date(c.executedAt.getTime() + windowDays * 86_400_000);
    if (now < windowEnd) continue; // window still open — measure tomorrow+

    let m: Measurement;
    try {
      switch (c.actionType) {
        case "renewal_reminder":
          m = await measureRenewalReminder({
            targetUserId: c.targetUserId,
            executedAt: c.executedAt,
            windowEnd,
          });
          break;
        case "winback_message":
          m = await measureWinback({
            targetUserId: c.targetUserId,
            executedAt: c.executedAt,
            windowEnd,
          });
          break;
        case "dues_nudge":
          m = await measureDuesNudge({ gymContext: c.gymContext });
          break;
        case "enquiry_followup":
          m = await measureEnquiryFollowup({
            gymContext: c.gymContext,
            executedAt: c.executedAt,
            windowEnd,
          });
          break;
        case "payment_followup":
          m = await measurePaymentFollowup({
            targetUserId: c.targetUserId,
            gymContext: c.gymContext,
            executedAt: c.executedAt,
            windowEnd,
          });
          break;
        default:
          m = {
            status: "unmeasurable",
            impactInr: 0,
            evidence: { reason: `no measurer for ${c.actionType}` },
          };
      }
    } catch (err) {
      console.error(`[autonomy-outcomes] measurement error for proposal ${c.id}:`, err);
      continue; // leave unmeasured — retried tomorrow
    }

    const saved = await recordMeasuredOutcome({
      proposalId: c.id,
      status: m.status,
      impactInr: m.impactInr,
      evidence: {
        actionType: c.actionType,
        projectedImpactInr: c.projectedImpactInr,
        windowDays,
        ...m.evidence,
      },
    });
    if (saved.success) {
      measured++;
      touchedTypes.add(c.actionType);
      if (m.status === "hit") hits++;
      else if (m.status === "miss") misses++;
      else unmeasurable++;
    }
  }

  // 3. Recompute policy aggregates for every whitelisted type (cheap, keeps
  // /autonomy status fresh even when nothing was measured tonight).
  for (const actionType of MESSAGE_ACTION_TYPES) {
    await recomputeOutcomeStats(actionType);
  }

  // 4. Graduation engine (suggest, never auto-flip) — only while the loop is
  // on; the Insight tells the owner to accept via /autonomy notify <type>.
  const graduationQualified: string[] = [];
  if (autonomyOn) {
    for (const actionType of MESSAGE_ACTION_TYPES) {
      const g = await checkGraduation(actionType);
      if (g.qualifies) graduationQualified.push(actionType);
    }
  }

  // 5. Auto-demotion sweep (fail-toward-human — runs regardless of the
  // kill-switch so a disabled loop can't hide a bad notify policy).
  const demotions: Record<string, string> = {};
  for (const actionType of MESSAGE_ACTION_TYPES) {
    const reason = await checkAutoDemotion(actionType);
    if (reason) demotions[actionType] = reason;
  }

  return Response.json({
    success: true,
    expired,
    measured,
    hits,
    misses,
    unmeasurable,
    recomputedTypes: MESSAGE_ACTION_TYPES,
    graduationQualified,
    demotions,
  });
}
