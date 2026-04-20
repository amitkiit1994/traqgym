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
import { hashActionSnapshot } from "@/lib/ai/manager";

export type InsightSeverity = "critical" | "high" | "medium" | "low";

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Marker actions are dispatcher branches that DO NOT complete the destructive
 * work themselves — they only record intent (audit log + in-app notification +
 * approval request). The actual side-effect (write-off, etc.) still requires
 * a human approval step elsewhere.
 *
 * For these actions we MUST NOT auto-dismiss the insight after running them,
 * otherwise the insight vanishes from the dashboard while no real change has
 * occurred — the human loses visibility and the work silently disappears.
 *
 * Non-marker actions (e.g. `member.send_reminder`, `comp.convert_to_paid`)
 * complete the work in-line and SHOULD dismiss the insight on success.
 */
const MARKER_ACTIONS: ReadonlySet<string> = new Set([
  // No formal write-off pipeline yet — only logs intent + notifies admins.
  "ticket.flag_writeoff",
  // Records investigation signal only; the real conversion is `comp.convert`.
  "comp.investigate",
  // Pure navigation — opening a dashboard URL must not dismiss the insight.
  "navigate",
]);

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
  /**
   * PR 16 audit fix (CRITICAL): when the caller comes from a magic link,
   * the link's HMAC binds the action contents at sign-time via this hash.
   * If the live `Insight.suggestedActions[actionIndex]` no longer matches,
   * the action was edited after signing — refuse to execute. This blocks
   * a "bait and switch" where a benign action ("Send reminder") is
   * mutated into a destructive one ("Refund ₹50,000") before the click.
   *
   * Optional: callers without a magic link (dashboard click, API agent)
   * skip the check.
   */
  expectedActionHash?: string;
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

  if (
    !Number.isInteger(params.actionIndex) ||
    params.actionIndex < 0 ||
    params.actionIndex >= actions.length
  ) {
    return { success: false, error: "Action index out of bounds" };
  }

  const chosen = actions[params.actionIndex];
  if (!chosen || typeof chosen.action !== "string") {
    return { success: false, error: "Invalid action index" };
  }

  // PR 16 audit fix: verify args binding BEFORE we claim the insight, so a
  // mismatched hash doesn't dismiss a still-valid insight.
  if (params.expectedActionHash) {
    const liveHash = hashActionSnapshot({
      label: chosen.label ?? "",
      action: chosen.action,
      args: chosen.args ?? {},
    });
    if (liveHash !== params.expectedActionHash) {
      return {
        success: false,
        error:
          "Action contents have changed since the link was issued — open the dashboard to act on the current version.",
      };
    }
  }

  // R03/R06: Atomic claim. updateMany with dismissedAt: null guard means only
  // one concurrent caller wins. If count === 0, someone else already claimed
  // and ran (or is about to run) the side-effect — bail out cleanly.
  //
  // EXCEPTION: marker actions (see MARKER_ACTIONS) only record intent — they
  // do not complete the destructive work. Dismissing the insight would hide
  // it from the dashboard while no real change has occurred. For markers we
  // skip pre-dismissal entirely and let the side-effect run; the insight
  // stays active until a human acts on the resulting approval / notification.
  const isMarker = MARKER_ACTIONS.has(chosen.action);
  if (!isMarker) {
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
      // Each channel is wrapped in try/catch so a failure on one (e.g. WA)
      // does not abort the audit log write — we always record the per-channel
      // outcome regardless of which channels succeeded or failed.
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
      const results: Record<string, boolean> = {};
      const errors: Record<string, string> = {};

      try {
        await notifyUser({
          userId: user.id,
          type: "engagement_nudge",
          title: "We miss you at the gym!",
          message: "It's been a while — book your next session today.",
          link: "/member",
        });
        results.in_app = true;
      } catch (err) {
        results.in_app = false;
        errors.in_app = err instanceof Error ? err.message : "unknown";
      }

      if (user.phone) {
        try {
          await sendWhatsApp({
            recipient: user.phone,
            templateName: "member_engagement_reminder",
            variables: { name: user.firstname },
          });
          results.whatsapp = true;
        } catch (err) {
          results.whatsapp = false;
          errors.whatsapp = err instanceof Error ? err.message : "unknown";
        }
      }

      const channels = Object.keys(results).filter((c) => results[c]);
      const anySuccess = channels.length > 0;

      try {
        await prisma.auditLog.create({
          data: {
            action: "insight.action.member.send_reminder",
            status: anySuccess ? "success" : "failed",
            actorId: params.executedById,
            actorType: "worker",
            details: JSON.stringify({
              insightId: params.insightId,
              userId,
              reason,
              channels,
              results,
              ...(Object.keys(errors).length > 0 ? { errors } : {}),
            }),
          },
        });
      } catch {
        // Swallow audit-log write errors — never let logging failures mask
        // the underlying action outcome.
      }

      return { success: true, result: { userId, channels, results } };
    }

    case "member.send_recovery_message": {
      // Defaulted-ticket escalator. Best-effort WhatsApp + SMS + in-app.
      // Each channel is wrapped in try/catch so a single channel failure
      // (e.g. WA template rejected) does not abort the audit log write —
      // we always record the per-channel outcome regardless of which
      // channels succeeded or failed.
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

      const results: Record<string, boolean> = {};
      const errors: Record<string, string> = {};

      try {
        await notifyUser({
          userId: user.id,
          type: "payment_recovery",
          title: "Pending balance on your membership",
          message: "Please clear the outstanding amount to keep your access active.",
          link: "/member/invoices",
        });
        results.in_app = true;
      } catch (err) {
        results.in_app = false;
        errors.in_app = err instanceof Error ? err.message : "unknown";
      }

      if (user.phone) {
        try {
          await sendWhatsApp({
            recipient: user.phone,
            templateName: "payment_recovery_reminder",
            variables: { name: user.firstname, stage: String(stage) },
          });
          results.whatsapp = true;
        } catch (err) {
          results.whatsapp = false;
          errors.whatsapp = err instanceof Error ? err.message : "unknown";
        }
        try {
          await sendSms({
            recipient: user.phone,
            templateName: "payment_recovery_reminder",
            variables: { name: user.firstname },
          });
          results.sms = true;
        } catch (err) {
          results.sms = false;
          errors.sms = err instanceof Error ? err.message : "unknown";
        }
      }

      const channels = Object.keys(results).filter((c) => results[c]);
      const anySuccess = channels.length > 0;

      try {
        await prisma.auditLog.create({
          data: {
            action: "insight.action.member.send_recovery_message",
            status: anySuccess ? "success" : "failed",
            actorId: params.executedById,
            actorType: "worker",
            details: JSON.stringify({
              insightId: params.insightId,
              userId,
              ticketId,
              stage,
              channels,
              results,
              ...(Object.keys(errors).length > 0 ? { errors } : {}),
            }),
          },
        });
      } catch {
        // Swallow audit-log write errors — never let logging failures mask
        // the underlying action outcome.
      }

      return { success: true, result: { userId, ticketId, stage, channels, results } };
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

    case "navigate": {
      // Pure-navigation action — no server-side side-effect, just a redirect
      // hint. Used by briefing emails to deep-link the owner to a dashboard
      // route (e.g. /admin/insights). The email renderer prefers plain
      // anchors for these (no magic-link wrap), but legacy links already in
      // inboxes still resolve here.
      const href = str("href") ?? "/admin/dashboard";
      // Whitelist same-origin paths only — never trust the args to redirect
      // off-site.
      const safeHref = href.startsWith("/") && !href.startsWith("//")
        ? href
        : "/admin/dashboard";
      return { success: true, result: { redirect: safeHref } };
    }

    case "upgrade.send_offer": {
      const userId = num("userId");
      const recommendedPlanId = num("recommendedPlanId");
      const discountPct = num("discountPct") ?? 0;
      if (userId === null || recommendedPlanId === null) {
        return {
          success: false,
          error: "upgrade.send_offer requires userId, recommendedPlanId",
        };
      }
      if (discountPct < 0 || discountPct > 100) {
        return {
          success: false,
          error: "discountPct must be between 0 and 100",
        };
      }
      // Resolve user + plan, then dispatch a notification — this is an
      // outreach action, not a mutation against the membership.
      const [user, plan] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, firstname: true, lastname: true, phone: true },
        }),
        prisma.ticketPlan.findUnique({
          where: { id: recommendedPlanId },
          select: { id: true, name: true, price: true },
        }),
      ]);
      if (!user) return { success: false, error: "User not found" };
      if (!plan) return { success: false, error: "Recommended plan not found" };

      const planPrice = Number(plan.price ?? 0);
      const offerPrice = discountPct > 0
        ? Math.round(planPrice * (1 - discountPct / 100))
        : planPrice;

      const memberName = `${user.firstname ?? ""} ${user.lastname ?? ""}`.trim();
      const variables = {
        name: memberName,
        plan: plan.name,
        price: offerPrice.toLocaleString("en-IN"),
        ...(discountPct > 0 ? { discount: String(discountPct) } : {}),
      };

      let dispatched = false;
      if (user.phone) {
        try {
          await sendWhatsApp({
            recipient: user.phone,
            templateName: discountPct > 0 ? "upgrade_offer_discount" : "upgrade_offer",
            variables,
          });
          dispatched = true;
        } catch (err) {
          // Fall back to SMS if WA fails.
          try {
            await sendSms({
              recipient: user.phone,
              templateName: discountPct > 0 ? "upgrade_offer_discount" : "upgrade_offer",
              variables,
            });
            dispatched = true;
          } catch (smsErr) {
            return {
              success: false,
              error: `Outreach send failed (whatsapp + sms): ${smsErr instanceof Error ? smsErr.message : "unknown"}`,
            };
          }
        }
      }

      // In-app notification mirrors the offer for in-app users.
      await notifyUser({
        userId: user.id,
        type: "promo",
        title: `Upgrade to ${plan.name}`,
        message: discountPct > 0
          ? `Limited offer: upgrade to ${plan.name} for ₹${offerPrice.toLocaleString("en-IN")} (${discountPct}% off).`
          : `Try ${plan.name} for ₹${offerPrice.toLocaleString("en-IN")}.`,
        link: "/member/plans",
      });

      await prisma.auditLog.create({
        data: {
          action: "insight.action.upgrade.send_offer",
          status: "success",
          actorId: params.executedById,
          actorType: "worker",
          details: JSON.stringify({
            insightId: params.insightId,
            userId,
            recommendedPlanId,
            discountPct,
            offerPrice,
            dispatched,
          }),
        },
      });
      return { success: true, result: { userId, recommendedPlanId, dispatched } };
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
