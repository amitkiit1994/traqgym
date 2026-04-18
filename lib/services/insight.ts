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
  agent?: string;
  limit?: number;
}): Promise<Insight[]> {
  const now = new Date();
  const rows = await prisma.insight.findMany({
    where: {
      dismissedAt: null,
      AND: [
        {
          OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: now } }],
        },
        opts?.severity ? { severity: opts.severity } : {},
        opts?.agent ? { agent: opts.agent } : {},
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
 */
export async function executeInsightAction(params: {
  insightId: number;
  actionIndex: number;
  executedById: number;
}): Promise<
  { success: true; result?: unknown } | { success: false; error: string }
> {
  const insight = await prisma.insight.findUnique({
    where: { id: params.insightId },
    select: { id: true, suggestedActions: true, dismissedAt: true },
  });
  if (!insight) return { success: false, error: "Insight not found" };
  if (insight.dismissedAt)
    return { success: false, error: "Cannot act on a dismissed insight" };

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
