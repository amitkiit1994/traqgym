/**
 * Earned Autonomy action loop — the verify-then-graduate register.
 *
 * Philosophy (Accelerating Autonomy paper + JioMart OS pattern):
 *   - Agents produce ACTIONS, not insights: a concrete instruction plus the
 *     three numbers — likelihood, projected impact in rupees, clockspeed-days.
 *   - Humans VERIFY, not operate: approve / reject (+reason) via Telegram.
 *   - Every verification is a training signal. Reject reasons become boundary
 *     conditions injected into agent prompts (getBoundaryConditions).
 *   - Autonomy graduates per action-type (verify -> notify) only when earned:
 *     >=20 decisions AND >95% approval AND >=10 measured outcomes AND
 *     calibration >=70%. Even then we NEVER auto-flip — the graduation check
 *     writes an Insight; the owner accepts via /autonomy notify <type>.
 *   - Outcomes are MEASURED (app/api/cron/autonomy-outcomes): realized rupees
 *     vs projection per proposal; calibration feeds graduation AND
 *     auto-demotion (notify -> verify on calibration collapse or execution
 *     failures — fail-toward-human).
 *   - Kill-switch: GymSettings `autonomy_enabled` (default "false"), checked
 *     by every producer, the executor, and the approve path. Per-type kill:
 *     AutonomyPolicy.mode = "off" via /autonomy off <type>.
 *   - Money-out NEVER auto: executeAction dispatches a message-only whitelist.
 *     Anything touching Payment/Refund/Comp/discounts stays in the existing
 *     Approval workflow and is structurally unreachable from this loop.
 *
 * Service-layer rules (.claude/rules/services.md): plain functions, explicit
 * params, `{ success, error }` returns, no raw Prisma errors to callers.
 */

import { prisma } from "@/lib/prisma";
import { getSetting, setSetting } from "@/lib/services/settings";
import { dispatch, markSent, markFailed } from "@/lib/services/notification";
import { notifyUser } from "@/lib/services/in-app-notification";
import { log as auditLog } from "@/lib/services/audit";
import { send as sendWhatsApp } from "@/lib/channels/whatsapp";
import { send as sendSMS } from "@/lib/channels/sms";
import { upsertInsight } from "@/lib/agents/_shared";
import { istStartOfDay } from "@/lib/agents/_helpers";

// ─── Whitelist: message-only action types ───────────────────────────────────
// Adding an action type here is a code change, not a config flag — that is
// deliberate. Money-out can never enter this list (see executeAction).
export const MESSAGE_ACTION_TYPES = [
  "renewal_reminder",
  "winback_message",
  "dues_nudge",
  "enquiry_followup",
  "payment_followup",
] as const;
export type MessageActionType = (typeof MESSAGE_ACTION_TYPES)[number];

export function isMessageActionType(t: string): t is MessageActionType {
  return (MESSAGE_ACTION_TYPES as readonly string[]).includes(t);
}

/** Default clockspeed (days until the opportunity decays) per action type.
 *  Also the outcome-measurement window for the autonomy-outcomes cron. */
export const DEFAULT_CLOCKSPEED_DAYS: Record<MessageActionType, number> = {
  renewal_reminder: 7,
  winback_message: 30,
  dues_nudge: 14,
  enquiry_followup: 7,
  payment_followup: 7,
};

// Graduation gate (per action-type): suggest notify mode only after ALL of:
// >=20 decisions, >95% approval, >=10 measured outcomes, calibration >=70%,
// and no demotion in the last 30 days. Never auto-flips — writes an Insight;
// the owner accepts via `/autonomy notify <type>` on Telegram.
const GRADUATION_MIN_DECISIONS = 20;
const GRADUATION_MIN_APPROVAL_RATE = 0.95;
const GRADUATION_MIN_MEASURED = 10;
const GRADUATION_MIN_CALIBRATION_PCT = 70;
const GRADUATION_DEMOTION_COOLDOWN_DAYS = 30;

// Auto-demotion (notify -> verify), fail-toward-human. ANY of:
// calibration <50% over >=10 measured outcomes, or execution failure rate
// >20% over the last 20 execution attempts.
const DEMOTION_MAX_CALIBRATION_PCT = 50;
const DEMOTION_MIN_MEASURED = 10;
const DEMOTION_FAILURE_RATE = 0.2;
const DEMOTION_FAILURE_WINDOW = 20;
const DEMOTION_FAILURE_MIN_ATTEMPTS = 5;

// Boundary-condition lookback for prompt injection.
const BOUNDARY_LOOKBACK_DAYS = 90;
const BOUNDARY_MAX_REASONS = 10;

// Reject-reason capture marker (Telegram "reply with the reason" flow).
const PENDING_REJECT_KEY = "autonomy_pending_reject";
const PENDING_REJECT_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ─── Kill-switch ─────────────────────────────────────────────────────────────

/** Global kill-switch. Default OFF — the loop does nothing until the owner
 *  sets GymSettings `autonomy_enabled` = "true". Checked everywhere. */
export async function isAutonomyEnabled(): Promise<boolean> {
  try {
    return (await getSetting("autonomy_enabled", "false")) === "true";
  } catch {
    return false; // fail closed
  }
}

// ─── Per-type policy mode ────────────────────────────────────────────────────

/** Current mode for an action type: "verify" (default), "notify", or "off". */
export async function getPolicyMode(actionType: string): Promise<string> {
  try {
    const policy = await prisma.autonomyPolicy.findUnique({
      where: { actionType },
      select: { mode: true },
    });
    return policy?.mode ?? "verify";
  } catch {
    return "verify"; // table missing / DB hiccup — default to human-in-loop
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type CreateProposalInput = {
  actionType: MessageActionType;
  sourceAgent: string;
  targetUserId?: number;
  /** For enquiry-targeted actions (enquiry_followup): the Enquiry id. Stored
   *  in gymContext and used for dedupe + executor phone resolution. */
  targetEnquiryId?: number;
  title: string;
  /** Owner-readable: exactly what happens if approved. */
  instruction: string;
  /** Execution params: { templateName, variables, messageText }. */
  params: {
    templateName: string;
    variables?: Record<string, string>;
    messageText: string;
  };
  likelihood?: number; // 0-1
  projectedImpactInr?: number;
  clockspeedDays?: number;
  gymContext?: Record<string, unknown>;
  insightId?: number;
};

export type ProposalSummary = {
  id: number;
  actionType: string;
  targetUserId: number | null;
  title: string;
  instruction: string;
  likelihood: number | null;
  projectedImpactInr: number | null;
  clockspeedDays: number | null;
  status: string;
  createdAt: Date;
};

// ─── createProposal ──────────────────────────────────────────────────────────

/**
 * Create an ActionProposal. Idempotent per (actionType, target) within the
 * clockspeed window: re-running a producer cron does not stack duplicate
 * proposals for the same member/enquiry while the previous one is still live.
 *
 * Mode handling:
 *   - policy mode "off"     -> no proposal at all (owner killed this type);
 *   - policy mode "verify"  -> proposal awaits the owner's Telegram decision;
 *   - policy mode "notify"  -> auto-executes immediately (earned autonomy) and
 *                              shows as a "Done (auto)" line in the register;
 *   - opts.forceAuto        -> auto-executes regardless of mode. Used ONLY by
 *                              the legacy direct-send cron capture (those
 *                              paths were already autonomous before this loop
 *                              existed; routing them here makes the unearned
 *                              autonomy visible and measured).
 */
export async function createProposal(
  input: CreateProposalInput,
  opts?: { forceAuto?: boolean }
): Promise<
  | { success: true; id: number; skipped: boolean; autoExecuted: boolean }
  | { success: false; error: string }
> {
  if (!(await isAutonomyEnabled())) {
    return { success: false, error: "autonomy_disabled" };
  }
  if (!isMessageActionType(input.actionType)) {
    return { success: false, error: `Unsupported actionType: ${input.actionType}` };
  }
  const mode = await getPolicyMode(input.actionType);
  if (mode === "off") {
    return { success: false, error: "action_type_off" };
  }
  try {
    const windowDays =
      input.clockspeedDays ?? DEFAULT_CLOCKSPEED_DAYS[input.actionType];
    // "rejected" is deliberately part of the dedupe set: within the window the
    // owner's "no" owns the target — neither a re-proposal nor the legacy
    // auto-capture path may touch that member again until the window lapses.
    // "failed" and "expired" are excluded so sends can be retried / re-raised.
    const liveStatuses = [
      "proposed",
      "approved",
      "executed",
      "auto_executed",
      "rejected",
    ];
    const windowStart = new Date(Date.now() - windowDays * 86_400_000);
    if (input.targetUserId) {
      const existing = await prisma.actionProposal.findFirst({
        where: {
          actionType: input.actionType,
          targetUserId: input.targetUserId,
          status: { in: liveStatuses },
          createdAt: { gte: windowStart },
        },
        select: { id: true },
      });
      if (existing) {
        return { success: true, id: existing.id, skipped: true, autoExecuted: false };
      }
    } else if (input.targetEnquiryId) {
      const existing = await prisma.actionProposal.findFirst({
        where: {
          actionType: input.actionType,
          status: { in: liveStatuses },
          createdAt: { gte: windowStart },
          gymContext: { path: ["enquiryId"], equals: input.targetEnquiryId },
        },
        select: { id: true },
      });
      if (existing) {
        return { success: true, id: existing.id, skipped: true, autoExecuted: false };
      }
    }
    const gymContext = {
      ...(input.gymContext ?? {}),
      ...(input.targetEnquiryId ? { enquiryId: input.targetEnquiryId } : {}),
    };
    const row = await prisma.actionProposal.create({
      data: {
        actionType: input.actionType,
        sourceAgent: input.sourceAgent,
        targetUserId: input.targetUserId ?? null,
        title: input.title,
        instruction: input.instruction,
        params: input.params as never,
        likelihood: input.likelihood ?? null,
        projectedImpactInr: input.projectedImpactInr ?? null,
        clockspeedDays: windowDays,
        gymContext: gymContext as never,
        insightId: input.insightId ?? null,
      },
      select: { id: true },
    });
    await auditLog({
      action: "autonomy.proposal.create",
      status: "success",
      actorType: "system",
      details: JSON.stringify({
        proposalId: row.id,
        actionType: input.actionType,
        sourceAgent: input.sourceAgent,
        targetUserId: input.targetUserId ?? null,
        targetEnquiryId: input.targetEnquiryId ?? null,
        projectedImpactInr: input.projectedImpactInr ?? null,
        clockspeedDays: windowDays,
        mode: opts?.forceAuto ? "legacy_capture" : mode,
      }),
    }).catch(() => {});

    // notify mode (earned) or legacy capture (unearned but pre-existing):
    // execute immediately, no buttons. Failures flip the row to "failed" and
    // count toward auto-demotion — never thrown to the producer.
    if (opts?.forceAuto || mode === "notify") {
      const auto = await autoExecuteProposal(row.id);
      return { success: true, id: row.id, skipped: false, autoExecuted: auto.success };
    }
    return { success: true, id: row.id, skipped: false, autoExecuted: false };
  } catch (err) {
    console.error("[action-loop] createProposal error:", err);
    return { success: false, error: "Could not create proposal" };
  }
}

/**
 * Auto-execute a still-proposed proposal (notify mode / legacy capture).
 * Atomic claim (proposed -> approved) so duplicate cron runs and replicas
 * stay single-execution, then the same message-only executor finishes the
 * row as "auto_executed". No approvals counter is touched — auto execution
 * is not an owner decision and must not feed the graduation gate.
 */
export async function autoExecuteProposal(
  proposalId: number
): Promise<{ success: true } | { success: false; error: string }> {
  if (!(await isAutonomyEnabled())) {
    return { success: false, error: "autonomy_disabled" };
  }
  try {
    const claimed = await prisma.actionProposal.updateMany({
      where: { id: proposalId, status: "proposed" },
      data: { status: "approved", decidedAt: new Date() },
    });
    if (claimed.count === 0) {
      return { success: false, error: "Proposal already handled" };
    }
    const exec = await executeAction(proposalId, { finalStatus: "auto_executed" });
    if (!exec.success) {
      await prisma.actionProposal
        .updateMany({
          where: { id: proposalId, status: "approved" },
          data: { status: "failed" },
        })
        .catch(() => {});
      await auditLog({
        action: "autonomy.proposal.auto_execute",
        status: "failed",
        actorType: "system",
        details: JSON.stringify({ proposalId, error: exec.error }),
      }).catch(() => {});
      return { success: false, error: exec.error };
    }
    await auditLog({
      action: "autonomy.proposal.auto_execute",
      status: "success",
      actorType: "system",
      details: JSON.stringify({ proposalId }),
    }).catch(() => {});
    return { success: true };
  } catch (err) {
    console.error("[action-loop] autoExecuteProposal error:", err);
    return { success: false, error: "Auto-execution failed" };
  }
}

// ─── decideProposal ──────────────────────────────────────────────────────────

/**
 * Record the owner's verification of a proposal.
 *
 * Approve: atomically claims the row (status must still be "proposed" — the
 * same updateMany claim-guard pattern as executeInsightAction), executes the
 * action through the message-only executor, then updates policy stats and
 * runs the graduation check. Reject: claims the row, records the optional
 * reason (the Telegram flow usually attaches it afterwards via
 * setRejectReason), updates stats.
 *
 * Approval requires the kill-switch ON (no execution while disabled).
 * Rejection is always allowed — recording a "no" is safe and is signal.
 */
export async function decideProposal(
  id: number,
  workerId: number,
  approve: boolean,
  reason?: string
): Promise<
  | { success: true; status: string; alreadyDecided?: boolean; executionError?: string }
  | { success: false; error: string }
> {
  try {
    if (approve && !(await isAutonomyEnabled())) {
      return { success: false, error: "autonomy_disabled" };
    }

    // Atomic claim: only one decider wins, duplicate taps become no-ops.
    const claimed = await prisma.actionProposal.updateMany({
      where: { id, status: "proposed" },
      data: {
        status: approve ? "approved" : "rejected",
        decidedById: workerId,
        decidedAt: new Date(),
        rejectReason: !approve && reason ? reason.slice(0, 2000) : undefined,
      },
    });
    if (claimed.count === 0) {
      const row = await prisma.actionProposal.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!row) return { success: false, error: "Proposal not found" };
      return { success: true, status: row.status, alreadyDecided: true };
    }

    const proposal = await prisma.actionProposal.findUnique({ where: { id } });
    if (!proposal) return { success: false, error: "Proposal not found" };

    // Policy stats — one decision counted per proposal.
    await prisma.autonomyPolicy.upsert({
      where: { actionType: proposal.actionType },
      create: {
        actionType: proposal.actionType,
        approvals: approve ? 1 : 0,
        rejections: approve ? 0 : 1,
      },
      update: approve
        ? { approvals: { increment: 1 } }
        : { rejections: { increment: 1 } },
    });

    await auditLog({
      action: approve ? "autonomy.proposal.approve" : "autonomy.proposal.reject",
      status: "success",
      actorId: workerId,
      actorType: "worker",
      details: JSON.stringify({
        proposalId: id,
        actionType: proposal.actionType,
        reason: reason ?? null,
      }),
    }).catch(() => {});

    let executionError: string | undefined;
    let finalStatus = approve ? "approved" : "rejected";

    if (approve) {
      const exec = await executeAction(id);
      if (exec.success) {
        finalStatus = "executed";
      } else {
        executionError = exec.error;
        finalStatus = "failed";
        // Keep the DB status consistent with what we report: an approved
        // proposal whose execution failed is "failed", not silently
        // "approved" (executeAction only flips it on thrown errors).
        await prisma.actionProposal
          .updateMany({
            where: { id, status: "approved" },
            data: { status: "failed" },
          })
          .catch(() => {});
        await auditLog({
          action: "autonomy.proposal.execute",
          status: "failed",
          actorType: "system",
          details: JSON.stringify({ proposalId: id, error: exec.error }),
        }).catch(() => {});
      }
    }

    // Graduation check after every decision — writes an Insight suggestion
    // when the gate is met; the human flips the switch.
    await checkGraduation(proposal.actionType).catch(() => {});

    return { success: true, status: finalStatus, executionError };
  } catch (err) {
    console.error("[action-loop] decideProposal error:", err);
    return { success: false, error: "Could not record decision" };
  }
}

/** Attach a reject reason after the fact (Telegram "reply with the reason"). */
export async function setRejectReason(
  proposalId: number,
  reason: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const updated = await prisma.actionProposal.updateMany({
      where: { id: proposalId, status: "rejected" },
      data: { rejectReason: reason.slice(0, 2000) },
    });
    if (updated.count === 0) {
      return { success: false, error: "Proposal not found or not rejected" };
    }
    await auditLog({
      action: "autonomy.proposal.reject_reason",
      status: "success",
      actorType: "worker",
      details: JSON.stringify({ proposalId, reason: reason.slice(0, 500) }),
    }).catch(() => {});
    return { success: true };
  } catch (err) {
    console.error("[action-loop] setRejectReason error:", err);
    return { success: false, error: "Could not save reason" };
  }
}

// ─── executeAction (message-only whitelist) ──────────────────────────────────

/**
 * Execute an approved proposal. Supports ONLY the message-only whitelist —
 * it sends the target a message through the same plumbing the existing
 * reminder crons and bulk-notify use:
 *
 *   Member-targeted (renewal_reminder, winback_message, dues_nudge,
 *   payment_followup):
 *   1. dispatch() -> NotificationLog row (unique per user+template+day, so
 *      re-execution is idempotent),
 *   2. WhatsApp / SMS via lib/channels per the `notification_channel`
 *      setting (these gracefully dev-log when MSG91 is not configured),
 *   3. an InAppNotification for the member — the honest fallback so the
 *      member always sees the message in-app even with no SMS/WhatsApp
 *      credentials. (Members are not on the gym Telegram bot — that channel
 *      is the OWNER verify surface, not a member channel.)
 *
 *   Enquiry-targeted (enquiry_followup): leads have no User row, so the
 *   phone comes from Enquiry and the execution record is an AiProactiveLog
 *   row (targetType "enquiry") — the same log the legacy lead-followup cron
 *   writes. No in-app fallback exists for non-members; that is a channel
 *   gap, not silently papered over.
 *
 * `opts.finalStatus` distinguishes owner-approved execution ("executed",
 * default) from notify-mode / legacy-capture execution ("auto_executed").
 *
 * Money-out is structurally unreachable: there is no branch here that can
 * touch Payment, Refund, CompPass, discounts or payroll.
 */
export async function executeAction(
  proposalId: number,
  opts?: { finalStatus?: "executed" | "auto_executed" }
): Promise<{ success: true; detail: string } | { success: false; error: string }> {
  if (!(await isAutonomyEnabled())) {
    return { success: false, error: "autonomy_disabled" };
  }
  const finalStatus = opts?.finalStatus ?? "executed";
  try {
    const proposal = await prisma.actionProposal.findUnique({
      where: { id: proposalId },
    });
    if (!proposal) return { success: false, error: "Proposal not found" };
    if (!isMessageActionType(proposal.actionType)) {
      return {
        success: false,
        error: `actionType "${proposal.actionType}" is not in the message-only whitelist`,
      };
    }
    if (proposal.status !== "approved") {
      return { success: false, error: `Proposal is ${proposal.status}, not approved` };
    }

    const params = (proposal.params ?? {}) as {
      templateName?: string;
      variables?: Record<string, string>;
      messageText?: string;
    };
    const templateName = params.templateName ?? `action_${proposal.actionType}`;
    const messageText = params.messageText ?? proposal.instruction;
    const channel = await getSetting("notification_channel", "whatsapp");
    const channelResults: Record<string, string> = {};

    if (proposal.targetUserId) {
      // ── Member-targeted send ────────────────────────────────────────────
      const user = await prisma.user.findUnique({
        where: { id: proposal.targetUserId },
        select: { id: true, firstname: true, lastname: true, phone: true },
      });
      if (!user) return { success: false, error: "Target member not found" };

      // NotificationLog idempotency row — same dedupe the reminder crons use.
      const logged = await dispatch({
        userId: user.id,
        templateName: `action_${proposal.actionType}`,
        channel,
        recipient: user.phone ?? undefined,
        deliveryDate: istStartOfDay(),
      });

      if (!logged.skipped) {
        try {
          if (user.phone && (channel === "whatsapp" || channel === "both")) {
            const r = await sendWhatsApp({
              recipient: user.phone,
              templateName,
              variables: params.variables ?? { name: user.firstname, message: messageText },
            });
            channelResults.whatsapp = r.success ? (r.mode ?? "sent") : `failed: ${"error" in r ? r.error : "unknown"}`;
          }
          if (user.phone && (channel === "sms" || channel === "both")) {
            const r = await sendSMS({
              recipient: user.phone,
              templateName,
              variables: params.variables ?? { name: user.firstname, message: messageText },
            });
            channelResults.sms = r.success ? (r.mode ?? "sent") : `failed: ${"error" in r ? r.error : "unknown"}`;
          }
          if (!user.phone) {
            channelResults.phone = "missing — in-app only";
          }
          await markSent(logged.id);
        } catch (err) {
          await markFailed(logged.id, err instanceof Error ? err.message : "send failed").catch(() => {});
          return { success: false, error: "Channel send failed" };
        }
      } else {
        channelResults.notificationLog = "skipped (already messaged today)";
      }

      // In-app fallback — always, so the member sees it regardless of MSG91.
      await notifyUser({
        userId: user.id,
        type: proposal.actionType,
        title: proposal.title,
        message: messageText,
      }).catch(() => {});
    } else if (proposal.actionType === "enquiry_followup") {
      // ── Enquiry-targeted send (lead, no User row) ───────────────────────
      const ctx = (proposal.gymContext ?? {}) as { enquiryId?: number };
      if (!ctx.enquiryId) {
        return { success: false, error: "Proposal has no target enquiry" };
      }
      const enquiry = await prisma.enquiry.findUnique({
        where: { id: ctx.enquiryId },
        select: { id: true, name: true, phone: true },
      });
      if (!enquiry) return { success: false, error: "Target enquiry not found" };
      if (!enquiry.phone) return { success: false, error: "Enquiry has no phone" };

      const firstName = enquiry.name.split(" ")[0] || enquiry.name;
      try {
        if (channel === "whatsapp" || channel === "both") {
          const r = await sendWhatsApp({
            recipient: enquiry.phone,
            templateName,
            variables: params.variables ?? { name: firstName, message: messageText },
          });
          channelResults.whatsapp = r.success ? (r.mode ?? "sent") : `failed: ${"error" in r ? r.error : "unknown"}`;
        }
        if (channel === "sms" || channel === "both") {
          const r = await sendSMS({
            recipient: enquiry.phone,
            templateName,
            variables: params.variables ?? { name: firstName, message: messageText },
          });
          channelResults.sms = r.success ? (r.mode ?? "sent") : `failed: ${"error" in r ? r.error : "unknown"}`;
        }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Channel send failed",
        };
      }
      // Execution record — same log surface the legacy lead-followup cron
      // uses, so admin AI Activity shows these sends in one place.
      await prisma.aiProactiveLog
        .create({
          data: {
            feature: "enquiry_followup",
            targetType: "enquiry",
            targetId: enquiry.id,
            channel,
            content: messageText.slice(0, 2000),
            tokensUsed: 0,
            status: "sent",
          },
        })
        .catch(() => {});
    } else {
      return { success: false, error: "Proposal has no target member" };
    }

    await prisma.actionProposal.update({
      where: { id: proposal.id },
      data: { status: finalStatus, executedAt: new Date() },
    });
    await prisma.autonomyPolicy
      .upsert({
        where: { actionType: proposal.actionType },
        create: { actionType: proposal.actionType, executedCount: 1 },
        update: { executedCount: { increment: 1 } },
      })
      .catch(() => {});

    const detail = JSON.stringify({ channel, ...channelResults });
    await auditLog({
      action: "autonomy.proposal.execute",
      status: "success",
      actorType: "system",
      details: JSON.stringify({
        proposalId: proposal.id,
        userId: proposal.targetUserId,
        finalStatus,
        ...channelResults,
      }),
    }).catch(() => {});

    return { success: true, detail };
  } catch (err) {
    console.error("[action-loop] executeAction error:", err);
    await prisma.actionProposal
      .updateMany({ where: { id: proposalId, status: "approved" }, data: { status: "failed" } })
      .catch(() => {});
    return { success: false, error: "Execution failed" };
  }
}

// ─── Outcome measurement (called by app/api/cron/autonomy-outcomes) ──────────

export type OutcomeVerdict = "hit" | "miss" | "unmeasurable";

/**
 * Record the measured outcome of an executed/auto-executed proposal. The
 * outcomes cron computes the verdict + realized rupees per action type
 * (spec section 4); this function persists it and audit-logs the evidence.
 * Policy aggregates are refreshed separately via recomputeOutcomeStats so a
 * batch of measurements does one recompute per action type.
 */
export async function recordMeasuredOutcome(params: {
  proposalId: number;
  status: OutcomeVerdict;
  impactInr: number;
  evidence?: Record<string, unknown>;
}): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const updated = await prisma.actionProposal.updateMany({
      where: {
        id: params.proposalId,
        status: { in: ["executed", "auto_executed"] },
        outcomeMeasuredAt: null,
      },
      data: {
        outcomeStatus: params.status,
        outcomeImpactInr: Math.round(params.impactInr),
        outcomeMeasuredAt: new Date(),
      },
    });
    if (updated.count === 0) {
      return { success: false, error: "Proposal not measurable (wrong status or already measured)" };
    }
    await auditLog({
      action: "autonomy.outcome.measure",
      status: "success",
      actorType: "system",
      details: JSON.stringify({
        proposalId: params.proposalId,
        outcomeStatus: params.status,
        outcomeImpactInr: Math.round(params.impactInr),
        ...(params.evidence ?? {}),
      }),
    }).catch(() => {});
    return { success: true };
  } catch (err) {
    console.error("[action-loop] recordMeasuredOutcome error:", err);
    return { success: false, error: "Could not record outcome" };
  }
}

/**
 * Recompute an action type's outcome aggregates from ActionProposal rows:
 *   - outcomeHitRate: hits / (hits + misses) — unmeasurable rows excluded;
 *   - calibrationPct: 100 * sum(realized) / sum(projected) over measured rows
 *     that carried a projection (the spec's promises-vs-reality number);
 *   - measuredCount: hits + misses.
 */
export async function recomputeOutcomeStats(actionType: string): Promise<void> {
  try {
    const measured = await prisma.actionProposal.findMany({
      where: {
        actionType,
        outcomeMeasuredAt: { not: null },
        outcomeStatus: { in: ["hit", "miss"] },
      },
      select: {
        outcomeStatus: true,
        outcomeImpactInr: true,
        projectedImpactInr: true,
      },
    });
    const hits = measured.filter((m) => m.outcomeStatus === "hit").length;
    const measuredCount = measured.length;
    const outcomeHitRate = measuredCount > 0 ? hits / measuredCount : null;

    const withProjection = measured.filter((m) => m.projectedImpactInr !== null);
    const projectedSum = withProjection.reduce(
      (s, m) => s + (m.projectedImpactInr ?? 0),
      0
    );
    const realizedSum = withProjection.reduce(
      (s, m) => s + (m.outcomeImpactInr ?? 0),
      0
    );
    const calibrationPct =
      projectedSum > 0
        ? Math.min(999, Math.round((100 * realizedSum) / projectedSum))
        : null;

    await prisma.autonomyPolicy.upsert({
      where: { actionType },
      create: {
        actionType,
        outcomeHitRate,
        calibrationPct,
        measuredCount,
      },
      update: {
        outcomeHitRate,
        calibrationPct,
        measuredCount,
      },
    });
  } catch (err) {
    console.error("[action-loop] recomputeOutcomeStats error:", err);
  }
}

/** Flip stale still-proposed rows past their clockspeed window to "expired".
 *  The opportunity decayed; an expired proposal is neither approval nor
 *  rejection and never feeds the graduation stats. */
export async function expireStaleProposals(): Promise<number> {
  try {
    const open = await prisma.actionProposal.findMany({
      where: { status: "proposed" },
      select: { id: true, clockspeedDays: true, createdAt: true },
    });
    const now = Date.now();
    const staleIds = open
      .filter(
        (p) =>
          now - p.createdAt.getTime() > (p.clockspeedDays ?? 7) * 86_400_000
      )
      .map((p) => p.id);
    if (staleIds.length === 0) return 0;
    const r = await prisma.actionProposal.updateMany({
      where: { id: { in: staleIds }, status: "proposed" },
      data: { status: "expired" },
    });
    if (r.count > 0) {
      await auditLog({
        action: "autonomy.proposal.expire",
        status: "success",
        actorType: "system",
        details: JSON.stringify({ expired: r.count, ids: staleIds.slice(0, 50) }),
      }).catch(() => {});
    }
    return r.count;
  } catch (err) {
    console.error("[action-loop] expireStaleProposals error:", err);
    return 0;
  }
}

// ─── Boundary conditions (reject reasons -> prompt constraints) ──────────────

/**
 * The reject-reason library for one action type: distinct reasons from the
 * last 90 days, newest first. These are the owner's corrections — injected
 * into agent prompts as hard constraints.
 */
export async function getBoundaryConditions(actionType: string): Promise<string[]> {
  try {
    const rows = await prisma.actionProposal.findMany({
      where: {
        actionType,
        status: "rejected",
        rejectReason: { not: null },
        decidedAt: { gte: new Date(Date.now() - BOUNDARY_LOOKBACK_DAYS * 86_400_000) },
      },
      orderBy: { decidedAt: "desc" },
      select: { rejectReason: true },
      take: 50,
    });
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rows) {
      const reason = (r.rejectReason ?? "").trim();
      if (!reason || seen.has(reason.toLowerCase())) continue;
      seen.add(reason.toLowerCase());
      out.push(reason);
      if (out.length >= BOUNDARY_MAX_REASONS) break;
    }
    return out;
  } catch {
    // Table missing (migration not applied) or DB hiccup — no constraints.
    return [];
  }
}

/**
 * Aggregate boundary conditions across all v1 action types, formatted as
 * prompt lines ("[renewal_reminder] too pushy for family-plan members").
 * Used by createGymAgent so the owner's corrections shape every channel that
 * drafts or proposes member messages.
 */
export async function getAllBoundaryConditionLines(): Promise<string[]> {
  const lines: string[] = [];
  for (const actionType of MESSAGE_ACTION_TYPES) {
    const reasons = await getBoundaryConditions(actionType);
    for (const reason of reasons) {
      lines.push(`[${actionType}] ${reason}`);
    }
  }
  return lines;
}

// ─── Graduation check (suggest, never auto-flip) ─────────────────────────────

/**
 * Verify -> notify graduation gate. ALL of:
 *   1. >= 20 decided proposals;
 *   2. > 95% approval rate over those decisions;
 *   3. >= 10 measured outcomes;
 *   4. calibration >= 70% (realized rupees vs projected);
 *   5. not demoted in the last 30 days, mode still "verify".
 * When met this writes an Insight suggesting notify mode. The mode is NEVER
 * flipped here — the owner accepts with `/autonomy notify <type>` on
 * Telegram (same security stack as every other owner command). Autonomy is
 * earned by the agent AND granted by the human.
 */
export async function checkGraduation(
  actionType: string
): Promise<{ qualifies: boolean; approvalRate: number; decisions: number }> {
  const policy = await prisma.autonomyPolicy.findUnique({ where: { actionType } });
  if (!policy) return { qualifies: false, approvalRate: 0, decisions: 0 };

  const decisions = policy.approvals + policy.rejections;
  const approvalRate = decisions > 0 ? policy.approvals / decisions : 0;
  const recentlyDemoted =
    policy.demotedAt !== null &&
    Date.now() - policy.demotedAt.getTime() <
      GRADUATION_DEMOTION_COOLDOWN_DAYS * 86_400_000;
  const qualifies =
    policy.mode === "verify" &&
    !recentlyDemoted &&
    decisions >= GRADUATION_MIN_DECISIONS &&
    approvalRate > GRADUATION_MIN_APPROVAL_RATE &&
    policy.measuredCount >= GRADUATION_MIN_MEASURED &&
    policy.calibrationPct !== null &&
    policy.calibrationPct >= GRADUATION_MIN_CALIBRATION_PCT;

  if (qualifies) {
    await upsertInsight({
      agent: "autonomy_graduation",
      severity: "medium",
      title: `"${actionType}" qualifies for notify mode (${Math.round(approvalRate * 100)}% approval, ${Math.round(policy.calibrationPct ?? 0)}% calibration)`,
      body:
        `You approved ${policy.approvals} of ${decisions} "${actionType}" proposals ` +
        `(${Math.round(approvalRate * 100)}%), and ${policy.measuredCount} measured outcomes ` +
        `realized ${Math.round(policy.calibrationPct ?? 0)}% of what was projected. This action ` +
        `type has earned a promotion from verify mode (you approve each action) to notify mode ` +
        `(auto-execute + inform you, with a one-tap way back). Nothing changes until you accept: ` +
        `reply "/autonomy notify ${actionType}" to the gym Telegram bot to enable, or ` +
        `"/autonomy status" to review the numbers first. Auto-demotion guards you: calibration ` +
        `below 50% or execution failures flip it straight back to verify.`,
      dataJson: {
        actionType,
        decisions,
        approvals: policy.approvals,
        rejections: policy.rejections,
        approvalRate,
        outcomeHitRate: policy.outcomeHitRate,
        calibrationPct: policy.calibrationPct,
        measuredCount: policy.measuredCount,
        executedCount: policy.executedCount,
      },
      entityType: "global",
      dedupeKey: `autonomy_graduation:${actionType}`,
    }).catch(() => {});
  }

  return { qualifies, approvalRate, decisions };
}

// ─── Demotion + mode management (fail-toward-human) ──────────────────────────

/** Demote an action type from notify back to verify. Automatic triggers:
 *  calibration collapse or execution failures (checkAutoDemotion); manual
 *  trigger: the owner. Re-graduation requires re-earning the full gate after
 *  a 30-day cooldown. */
export async function demotePolicy(
  actionType: string,
  reason: string,
  actorWorkerId?: number
): Promise<{ success: true; demoted: boolean } | { success: false; error: string }> {
  try {
    const r = await prisma.autonomyPolicy.updateMany({
      where: { actionType, mode: "notify" },
      data: {
        mode: "verify",
        demotedAt: new Date(),
        demotionReason: reason.slice(0, 500),
      },
    });
    if (r.count > 0) {
      await auditLog({
        action: "autonomy.policy.demote",
        status: "success",
        actorId: actorWorkerId,
        actorType: actorWorkerId ? "worker" : "system",
        details: JSON.stringify({ actionType, reason }),
      }).catch(() => {});
    }
    return { success: true, demoted: r.count > 0 };
  } catch (err) {
    console.error("[action-loop] demotePolicy error:", err);
    return { success: false, error: "Could not demote policy" };
  }
}

/**
 * Auto-demotion sweep for one action type (notify mode only). Returns the
 * demotion reason when triggered, null otherwise. ANY of:
 *   - calibration < 50% over >= 10 measured outcomes;
 *   - execution failure rate > 20% over the last 20 execution attempts.
 */
export async function checkAutoDemotion(actionType: string): Promise<string | null> {
  try {
    const policy = await prisma.autonomyPolicy.findUnique({ where: { actionType } });
    if (!policy || policy.mode !== "notify") return null;

    if (
      policy.measuredCount >= DEMOTION_MIN_MEASURED &&
      policy.calibrationPct !== null &&
      policy.calibrationPct < DEMOTION_MAX_CALIBRATION_PCT
    ) {
      const reason = `calibration ${Math.round(policy.calibrationPct)}% < ${DEMOTION_MAX_CALIBRATION_PCT}% over ${policy.measuredCount} measured outcomes`;
      await demotePolicy(actionType, reason);
      return reason;
    }

    const attempts = await prisma.actionProposal.findMany({
      where: {
        actionType,
        status: { in: ["executed", "auto_executed", "failed"] },
      },
      orderBy: { createdAt: "desc" },
      take: DEMOTION_FAILURE_WINDOW,
      select: { status: true },
    });
    if (attempts.length >= DEMOTION_FAILURE_MIN_ATTEMPTS) {
      const failures = attempts.filter((a) => a.status === "failed").length;
      const failureRate = failures / attempts.length;
      if (failureRate > DEMOTION_FAILURE_RATE) {
        const reason = `execution failure rate ${Math.round(failureRate * 100)}% over last ${attempts.length} attempts`;
        await demotePolicy(actionType, reason);
        return reason;
      }
    }
    return null;
  } catch (err) {
    console.error("[action-loop] checkAutoDemotion error:", err);
    return null;
  }
}

/** Owner-set mode for one action type ("verify" | "notify" | "off").
 *  Telegram `/autonomy <mode> <type>` lands here. Setting "notify" records
 *  graduatedAt (the human grant); leaving "notify" via "verify"/"off" stamps
 *  demotedAt so re-graduation needs the full 30-day re-earn. */
export async function setPolicyMode(
  actionType: string,
  mode: "verify" | "notify" | "off",
  workerId: number
): Promise<{ success: true; previousMode: string } | { success: false; error: string }> {
  if (!isMessageActionType(actionType)) {
    return { success: false, error: `Unknown action type "${actionType}"` };
  }
  try {
    const existing = await prisma.autonomyPolicy.findUnique({
      where: { actionType },
      select: { mode: true },
    });
    const previousMode = existing?.mode ?? "verify";
    const leavingNotify = previousMode === "notify" && mode !== "notify";
    await prisma.autonomyPolicy.upsert({
      where: { actionType },
      create: {
        actionType,
        mode,
        ...(mode === "notify" ? { graduatedAt: new Date() } : {}),
      },
      update: {
        mode,
        ...(mode === "notify" ? { graduatedAt: new Date() } : {}),
        ...(leavingNotify
          ? { demotedAt: new Date(), demotionReason: `owner set mode to ${mode}` }
          : {}),
      },
    });
    await auditLog({
      action: "autonomy.policy.mode",
      status: "success",
      actorId: workerId,
      actorType: "worker",
      details: JSON.stringify({ actionType, from: previousMode, to: mode }),
    }).catch(() => {});
    return { success: true, previousMode };
  } catch (err) {
    console.error("[action-loop] setPolicyMode error:", err);
    return { success: false, error: "Could not update policy mode" };
  }
}

/** Global kill-switch flip from Telegram `/autonomy on|off`. */
export async function setAutonomyEnabled(
  enabled: boolean,
  workerId: number
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await setSetting("autonomy_enabled", enabled ? "true" : "false");
    await auditLog({
      action: enabled ? "autonomy.enable" : "autonomy.kill",
      status: "success",
      actorId: workerId,
      actorType: "worker",
      details: JSON.stringify({ autonomy_enabled: enabled }),
    }).catch(() => {});
    return { success: true };
  } catch (err) {
    console.error("[action-loop] setAutonomyEnabled error:", err);
    return { success: false, error: "Could not update setting" };
  }
}

export type AutonomyStatusRow = {
  actionType: string;
  mode: string;
  approvals: number;
  rejections: number;
  approvalRatePct: number | null;
  executedCount: number;
  measuredCount: number;
  calibrationPct: number | null;
  outcomeHitRatePct: number | null;
  openCount: number;
  demotedAt: Date | null;
  demotionReason: string | null;
};

/** Per-type status table for `/autonomy status`. Includes every whitelisted
 *  type even before its first policy row exists (defaults: verify, zeros). */
export async function getAutonomyStatus(): Promise<{
  enabled: boolean;
  rows: AutonomyStatusRow[];
}> {
  const enabled = await isAutonomyEnabled();
  const rows: AutonomyStatusRow[] = [];
  try {
    const [policies, openCounts] = await Promise.all([
      prisma.autonomyPolicy.findMany(),
      prisma.actionProposal.groupBy({
        by: ["actionType"],
        where: { status: "proposed" },
        _count: { _all: true },
      }),
    ]);
    const policyByType = new Map(policies.map((p) => [p.actionType, p]));
    const openByType = new Map(
      openCounts.map((o) => [o.actionType, o._count._all])
    );
    for (const actionType of MESSAGE_ACTION_TYPES) {
      const p = policyByType.get(actionType);
      const decisions = (p?.approvals ?? 0) + (p?.rejections ?? 0);
      rows.push({
        actionType,
        mode: p?.mode ?? "verify",
        approvals: p?.approvals ?? 0,
        rejections: p?.rejections ?? 0,
        approvalRatePct:
          decisions > 0 ? Math.round((100 * (p?.approvals ?? 0)) / decisions) : null,
        executedCount: p?.executedCount ?? 0,
        measuredCount: p?.measuredCount ?? 0,
        calibrationPct:
          p?.calibrationPct !== null && p?.calibrationPct !== undefined
            ? Math.round(p.calibrationPct)
            : null,
        outcomeHitRatePct:
          p?.outcomeHitRate !== null && p?.outcomeHitRate !== undefined
            ? Math.round(p.outcomeHitRate * 100)
            : null,
        openCount: openByType.get(actionType) ?? 0,
        demotedAt: p?.demotedAt ?? null,
        demotionReason: p?.demotionReason ?? null,
      });
    }
  } catch (err) {
    console.error("[action-loop] getAutonomyStatus error:", err);
  }
  return { enabled, rows };
}

// ─── Register queries (Telegram verify surface) ──────────────────────────────

/** Open (still-proposed) proposals, oldest first, for the action register. */
export async function getOpenProposals(): Promise<ProposalSummary[]> {
  try {
    return await prisma.actionProposal.findMany({
      where: { status: "proposed" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        actionType: true,
        targetUserId: true,
        title: true,
        instruction: true,
        likelihood: true,
        projectedImpactInr: true,
        clockspeedDays: true,
        status: true,
        createdAt: true,
      },
      take: 100,
    });
  } catch {
    return [];
  }
}

/** Proposals auto-executed in the last `hours` (notify mode / legacy
 *  capture), newest first — rendered as "Done (auto): ..." lines in the
 *  register so autonomous sends stay visible to the owner. */
export async function getRecentAutoExecuted(
  hours = 24
): Promise<ProposalSummary[]> {
  try {
    return await prisma.actionProposal.findMany({
      where: {
        status: "auto_executed",
        executedAt: { gte: new Date(Date.now() - hours * 3_600_000) },
      },
      orderBy: { executedAt: "desc" },
      select: {
        id: true,
        actionType: true,
        targetUserId: true,
        title: true,
        instruction: true,
        likelihood: true,
        projectedImpactInr: true,
        clockspeedDays: true,
        status: true,
        createdAt: true,
      },
      take: 50,
    });
  } catch {
    return [];
  }
}

/** Approve every open proposal of one action type (clubbed "Approve all N").
 *  Never throws (services.md): a DB error reports everything as failed so the
 *  Telegram callback can still be answered. `skipped` counts duplicate-tap
 *  races (already decided elsewhere) — they are not failures. */
export async function approveAllOfType(
  actionType: string,
  workerId: number
): Promise<{ approved: number; failed: number; skipped: number }> {
  let open: Array<{ id: number }> = [];
  try {
    open = await prisma.actionProposal.findMany({
      where: { status: "proposed", actionType },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
  } catch (err) {
    console.error("[action-loop] approveAllOfType query error:", err);
    return { approved: 0, failed: 0, skipped: 0 };
  }
  let approved = 0;
  let failed = 0;
  let skipped = 0;
  for (const p of open) {
    const r = await decideProposal(p.id, workerId, true);
    if (r.success && r.status === "executed") approved++;
    else if (r.success && r.alreadyDecided) skipped++;
    else failed++;
  }
  return { approved, failed, skipped };
}

// ─── Reject-reason capture marker (10-minute conversation state) ─────────────
// The webhook has no per-chat conversation-state machine for plain text (text
// goes straight to the AI agent), so we use a GymSettings marker — the
// pattern the plan doc allows for v1. Last reject wins; a newer reject
// overwrites an unanswered older marker.

type PendingReject = { proposalId: number; chatId: string; expiresAt: string };

export async function markPendingReject(params: {
  proposalId: number;
  chatId: string;
}): Promise<void> {
  const marker: PendingReject = {
    proposalId: params.proposalId,
    chatId: params.chatId,
    expiresAt: new Date(Date.now() + PENDING_REJECT_TTL_MS).toISOString(),
  };
  try {
    await setSetting(PENDING_REJECT_KEY, JSON.stringify(marker));
  } catch (err) {
    // The reject itself is already recorded; losing the marker only means the
    // typed reason won't be captured. Never crash the webhook callback.
    console.error("[action-loop] markPendingReject error:", err);
  }
}

/**
 * If `chatId` has a live pending-reject marker, capture `text` as the reject
 * reason for that proposal and clear the marker. Returns whether the message
 * was consumed (the webhook then skips the AI agent for this message).
 */
export async function captureRejectReason(params: {
  chatId: string;
  text: string;
}): Promise<{ captured: false } | { captured: true; proposalId: number }> {
  try {
    const raw = await getSetting(PENDING_REJECT_KEY, "");
    if (!raw) return { captured: false };
    let marker: PendingReject;
    try {
      marker = JSON.parse(raw) as PendingReject;
    } catch {
      await setSetting(PENDING_REJECT_KEY, "");
      return { captured: false };
    }
    if (marker.chatId !== params.chatId) return { captured: false };
    if (new Date(marker.expiresAt).getTime() < Date.now()) {
      await setSetting(PENDING_REJECT_KEY, "");
      return { captured: false };
    }
    await setSetting(PENDING_REJECT_KEY, "");
    const saved = await setRejectReason(marker.proposalId, params.text);
    if (!saved.success) return { captured: false };
    return { captured: true, proposalId: marker.proposalId };
  } catch {
    return { captured: false };
  }
}
