/**
 * Insight service — read/dismiss/snooze/execute actions for AI-agent insights.
 *
 * Insights live in the `Insight` table. Active = not dismissed AND not currently
 * snoozed. The action dispatcher is whitelist-only (no eval, no dynamic require).
 */

import type { Insight } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  convertCompToPaid,
  revokeComp,
  convertCompPassToPaid,
  revokeCompPass,
} from "@/lib/services/comp";
import { send as sendWhatsApp } from "@/lib/channels/whatsapp";
import { send as sendSms } from "@/lib/channels/sms";
import { notifyUser, notifyWorkersByRole } from "@/lib/services/in-app-notification";

export type InsightSeverity = "critical" | "high" | "medium" | "low";

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ─── listActiveInsights ────────────────────────────────────────────────────
export async function listActiveInsights(opts?: {
  severity?: InsightSeverity;
  /** PR 8: minimum severity, inclusive (e.g. "high" → critical + high). */
  minSeverity?: InsightSeverity;
  agent?: string;
  /** PR 8: only insights created on/after this timestamp. */
  since?: Date;
  limit?: number;
}): Promise<Insight[]> {
  const now = new Date();

  // Compute allowed severities for minSeverity filter.
  let severityFilter: { in: string[] } | { equals: string } | undefined;
  if (opts?.severity) {
    severityFilter = { equals: opts.severity };
  } else if (opts?.minSeverity) {
    const minRank = SEVERITY_RANK[opts.minSeverity] ?? 99;
    const allowed = Object.entries(SEVERITY_RANK)
      .filter(([, rank]) => rank <= minRank)
      .map(([sev]) => sev);
    severityFilter = { in: allowed };
  }

  const rows = await prisma.insight.findMany({
    where: {
      dismissedAt: null,
      AND: [
        {
          OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: now } }],
        },
        severityFilter ? { severity: severityFilter } : {},
        opts?.agent ? { agent: opts.agent } : {},
        opts?.since ? { createdAt: { gte: opts.since } } : {},
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  // Sort by severity (critical first), then by createdAt desc (already sorted).
  rows.sort((a, b) => {
    const sa = SEVERITY_RANK[a.severity] ?? 99;
    const sb = SEVERITY_RANK[b.severity] ?? 99;
    if (sa !== sb) return sa - sb;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  if (opts?.limit && opts.limit > 0) {
    return rows.slice(0, opts.limit);
  }
  return rows;
}

// ─── dismissInsight ────────────────────────────────────────────────────────
export async function dismissInsight(params: {
  insightId: number;
  dismissedById: number;
  reason?: string;
}): Promise<{ success: true } | { success: false; error: string }> {
  const insight = await prisma.insight.findUnique({
    where: { id: params.insightId },
    select: { id: true, dismissedAt: true },
  });
  if (!insight) return { success: false, error: "Insight not found" };
  if (insight.dismissedAt)
    return { success: false, error: "Insight already dismissed" };

  const worker = await prisma.worker.findUnique({
    where: { id: params.dismissedById },
    select: { id: true, isActive: true },
  });
  if (!worker) return { success: false, error: "Worker not found" };

  try {
    await prisma.insight.update({
      where: { id: params.insightId },
      data: {
        dismissedAt: new Date(),
        dismissedById: params.dismissedById,
      },
    });

    if (params.reason) {
      await prisma.auditLog.create({
        data: {
          action: "insight.dismiss",
          status: "success",
          details: JSON.stringify({
            insightId: params.insightId,
            reason: params.reason,
          }),
          actorId: params.dismissedById,
          actorType: "worker",
        },
      });
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to dismiss insight",
    };
  }
}

// ─── snoozeInsight ─────────────────────────────────────────────────────────
export async function snoozeInsight(params: {
  insightId: number;
  until: Date;
  snoozedById: number;
}): Promise<{ success: true } | { success: false; error: string }> {
  if (!(params.until instanceof Date) || isNaN(params.until.getTime())) {
    return { success: false, error: "Invalid snooze date" };
  }
  if (params.until.getTime() <= Date.now()) {
    return { success: false, error: "Snooze date must be in the future" };
  }

  const insight = await prisma.insight.findUnique({
    where: { id: params.insightId },
    select: { id: true, dismissedAt: true },
  });
  if (!insight) return { success: false, error: "Insight not found" };
  if (insight.dismissedAt)
    return { success: false, error: "Cannot snooze a dismissed insight" };

  const worker = await prisma.worker.findUnique({
    where: { id: params.snoozedById },
    select: { id: true },
  });
  if (!worker) return { success: false, error: "Worker not found" };

  try {
    await prisma.insight.update({
      where: { id: params.insightId },
      data: { snoozedUntil: params.until },
    });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to snooze insight",
    };
  }
}

// ─── executeInsightAction ──────────────────────────────────────────────────
/**
 * Whitelist-only action dispatcher. Maps `action` strings to existing service
 * functions. NO eval, NO dynamic dispatch, NO arbitrary code.
 *
 * R03/R06 fix: Atomic claim-then-execute pattern. We perform the dismissal
 * FIRST as a conditional updateMany (where dismissedAt: null). If 0 rows
 * are affected, another caller (different magic-link click, dashboard, or
 * Telegram callback) already claimed it — we return { alreadyDone: true }
 * so the caller can render an "Already done" response instead of running
 * the side-effect twice.
 *
 * If the side-effect later fails, we leave the insight dismissed (tradeoff:
 * we prevent double-execution but a failed action is not retried via the
 * same magic link — caller surfaces the error and the operator can re-act
 * via the dashboard).
 */
export async function executeInsightAction(params: {
  insightId: number;
  actionIndex: number;
  executedById: number;
}): Promise<
  | { success: true; result?: unknown; alreadyDone?: boolean }
  | { success: false; error: string }
> {
  const insight = await prisma.insight.findUnique({
    where: { id: params.insightId },
    select: { id: true, suggestedActions: true, dismissedAt: true },
  });
  if (!insight) return { success: false, error: "Insight not found" };
  if (insight.dismissedAt) {
    // Already dismissed before we even attempted the claim.
    return { success: true, alreadyDone: true };
  }

  const actions = insight.suggestedActions as
    | Array<{ label?: string; action?: string; args?: Record<string, unknown> }>
    | null;
  if (!Array.isArray(actions) || actions.length === 0) {
    return { success: false, error: "Insight has no suggested actions" };
  }

  const chosen = actions[params.actionIndex];
  if (!chosen || typeof chosen.action !== "string") {
    return { success: false, error: "Invalid action index" };
  }

  // R03/R06: Atomic claim. updateMany with dismissedAt: null guard means only
  // one concurrent caller wins. If count === 0, someone else already claimed
  // and ran (or is about to run) the side-effect — bail out cleanly.
  const claim = await prisma.insight.updateMany({
    where: { id: params.insightId, dismissedAt: null },
    data: {
      dismissedAt: new Date(),
      dismissedById: params.executedById,
    },
  });
  if (claim.count === 0) {
    // Lost the race to another concurrent caller.
    return { success: true, alreadyDone: true };
  }

  const args = (chosen.args ?? {}) as Record<string, unknown>;

  // Helpers ────────────────────────────────────────────────────────────────
  const num = (k: string): number | null => {
    const v = args[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  const str = (k: string): string | null => {
    const v = args[k];
    return typeof v === "string" ? v : null;
  };

  // Whitelist dispatcher ───────────────────────────────────────────────────
  switch (chosen.action) {
    case "comp.convert": {
      const ticketId = num("ticketId");
      const newPlanId = num("newPlanId");
      const paidAmount = num("paidAmount");
      const paymentMode = str("paymentMode");
      if (
        ticketId === null ||
        newPlanId === null ||
        paidAmount === null ||
        !paymentMode
      ) {
        return {
          success: false,
          error: "comp.convert requires ticketId, newPlanId, paidAmount, paymentMode",
        };
      }
      const result = await convertCompToPaid({
        ticketId,
        newPlanId,
        paidAmount,
        paymentMode,
        collectedById: params.executedById,
      });
      if (!result.success) return { success: false, error: result.error };
      return { success: true, result };
    }

    case "comp.revoke": {
      const ticketId = num("ticketId");
      const reason = str("reason");
      if (ticketId === null || !reason) {
        return {
          success: false,
          error: "comp.revoke requires ticketId, reason",
        };
      }
      const result = await revokeComp({
        ticketId,
        reason,
        revokedById: params.executedById,
      });
      if (!result.success) return { success: false, error: result.error };
      return { success: true, result };
    }

    case "comp_pass.convert": {
      const passId = num("passId");
      const planId = num("planId");
      const paidAmount = num("paidAmount");
      const paymentMode = str("paymentMode");
      if (
        passId === null ||
        planId === null ||
        paidAmount === null ||
        !paymentMode
      ) {
        return {
          success: false,
          error:
            "comp_pass.convert requires passId, planId, paidAmount, paymentMode",
        };
      }
      const result = await convertCompPassToPaid({
        passId,
        planId,
        paidAmount,
        paymentMode,
        collectedById: params.executedById,
      });
      if (!result.success) return { success: false, error: result.error };
      return { success: true, result };
    }

    case "comp_pass.revoke": {
      const passId = num("passId");
      const reason = str("reason");
      if (passId === null || !reason) {
        return {
          success: false,
          error: "comp_pass.revoke requires passId, reason",
        };
      }
      const result = await revokeCompPass({
        passId,
        reason,
        revokedById: params.executedById,
      });
      if (!result.success) return { success: false, error: result.error };
      return { success: true, result };
    }

    // ── PR 4: insight-driven member nudges ───────────────────────────────────
    case "member.send_reminder": {
      // Silent-churn / engagement nudge. Best-effort WhatsApp + in-app.
      const userId = num("userId");
      if (userId === null) {
        return { success: false, error: "member.send_reminder requires userId" };
      }
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, firstname: true, phone: true },
      });
      if (!user) return { success: false, error: "User not found" };

      const reason = str("reason") ?? "engagement_nudge";
      const channels: string[] = ["in_app"];
      await notifyUser({
        userId: user.id,
        type: "engagement_nudge",
        title: "We miss you at the gym!",
        message: "It's been a while — book your next session today.",
        link: "/member",
      });
      if (user.phone) {
        await sendWhatsApp({
          recipient: user.phone,
          templateName: "member_engagement_reminder",
          variables: { name: user.firstname },
        });
        channels.push("whatsapp");
      }
      await prisma.auditLog.create({
        data: {
          action: "insight.action.member.send_reminder",
          status: "success",
          actorId: params.executedById,
          actorType: "worker",
          details: JSON.stringify({
            insightId: params.insightId,
            userId,
            reason,
            channels,
          }),
        },
      });
      return { success: true, result: { userId, channels } };
    }

    case "member.send_recovery_message": {
      // Defaulted-ticket escalator. Best-effort WhatsApp + SMS + in-app.
      const userId = num("userId");
      const ticketId = num("ticketId");
      const stage = num("stage") ?? 1;
      if (userId === null) {
        return {
          success: false,
          error: "member.send_recovery_message requires userId",
        };
      }
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, firstname: true, phone: true },
      });
      if (!user) return { success: false, error: "User not found" };

      const channels: string[] = ["in_app"];
      await notifyUser({
        userId: user.id,
        type: "payment_recovery",
        title: "Pending balance on your membership",
        message: "Please clear the outstanding amount to keep your access active.",
        link: "/member/invoices",
      });
      if (user.phone) {
        await sendWhatsApp({
          recipient: user.phone,
          templateName: "payment_recovery_reminder",
          variables: { name: user.firstname, stage: String(stage) },
        });
        channels.push("whatsapp");
        await sendSms({
          recipient: user.phone,
          templateName: "payment_recovery_reminder",
          variables: { name: user.firstname },
        });
        channels.push("sms");
      }
      await prisma.auditLog.create({
        data: {
          action: "insight.action.member.send_recovery_message",
          status: "success",
          actorId: params.executedById,
          actorType: "worker",
          details: JSON.stringify({
            insightId: params.insightId,
            userId,
            ticketId,
            stage,
            channels,
          }),
        },
      });
      return { success: true, result: { userId, ticketId, stage, channels } };
    }

    case "ticket.flag_writeoff": {
      // No formal write-off pipeline yet (slated for a future PR). For now
      // record intent in AuditLog + surface to admins via in-app notification
      // so it is visible without losing the action.
      const ticketId = num("ticketId");
      const reason = str("reason") ?? "default_escalation";
      if (ticketId === null) {
        return {
          success: false,
          error: "ticket.flag_writeoff requires ticketId",
        };
      }
      const ticket = await prisma.memberTicket.findUnique({
        where: { id: ticketId },
        select: { id: true, userId: true, balanceDue: true },
      });
      if (!ticket) return { success: false, error: "Ticket not found" };

      // TODO: when PR 2's approval pipeline lands, wire this to enqueue a
      // formal write-off approval request instead of just logging intent.
      await prisma.auditLog.create({
        data: {
          action: "insight.action.ticket.flag_writeoff",
          status: "intent_recorded",
          actorId: params.executedById,
          actorType: "worker",
          details: JSON.stringify({
            insightId: params.insightId,
            ticketId,
            reason,
            balanceDue: ticket.balanceDue?.toString(),
            note: "Approval pipeline not yet implemented; intent logged.",
          }),
        },
      });
      await notifyWorkersByRole({
        role: "admin",
        type: "ticket_writeoff_flagged",
        title: `Ticket #${ticketId} flagged for write-off`,
        message: `Reason: ${reason}. Approval pipeline pending — review manually.`,
        link: `/admin/balance-due`,
      });
      return {
        success: true,
        result: { ticketId, intentRecorded: true, note: "writeoff_pending_pipeline" },
      };
    }

    case "comp.investigate": {
      // Marker action used by the comp-leakage-investigator's "Convert to paid"
      // suggestion. The actual conversion uses comp.convert; this stub records
      // that an admin chose to act on the investigation so the manager ranker
      // can learn from the signal.
      const ticketId = num("ticketId");
      const kind = str("kind") ?? "review";
      if (ticketId === null) {
        return { success: false, error: "comp.investigate requires ticketId" };
      }
      await prisma.auditLog.create({
        data: {
          action: "insight.action.comp.investigate",
          status: "success",
          actorId: params.executedById,
          actorType: "worker",
          details: JSON.stringify({
            insightId: params.insightId,
            ticketId,
            kind,
          }),
        },
      });
      return { success: true, result: { ticketId, kind, recorded: true } };
    }

    default:
      return {
        success: false,
        error: `Unknown action: ${chosen.action}`,
      };
  }
}

// ─── getInsightStats ───────────────────────────────────────────────────────
export async function getInsightStats(): Promise<{
  total: number;
  bySeverity: Record<string, number>;
  byAgent: Record<string, number>;
}> {
  const now = new Date();
  const rows = await prisma.insight.findMany({
    where: {
      dismissedAt: null,
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: now } }],
    },
    select: { severity: true, agent: true },
  });

  const bySeverity: Record<string, number> = {};
  const byAgent: Record<string, number> = {};
  for (const r of rows) {
    bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
    byAgent[r.agent] = (byAgent[r.agent] ?? 0) + 1;
  }

  return { total: rows.length, bySeverity, byAgent };
}
