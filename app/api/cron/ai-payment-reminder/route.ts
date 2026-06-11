import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import { runProactiveAgent } from "@/lib/ai/proactive-runner";
import { send as sendWhatsApp } from "@/lib/channels/whatsapp";
import { requireCronSecret } from "@/lib/auth-cron";
import { createProposal, isAutonomyEnabled } from "@/lib/services/action-loop";
import { sendActionRegister } from "@/lib/ai/action-telegram";
import { upsertInsight } from "@/lib/agents/_shared";
import { inr, isoDay } from "@/lib/agents/_helpers";

// Earned Autonomy priors. A dues nudge is a collection attempt on money
// already owed, so the projected impact is the balanceDue itself (the honest
// recoverable amount); likelihood is the agent's estimate that THIS nudge
// collects it within the window. The autonomy-outcomes cron measures the
// actual balanceDue delta and calibrates per gym.
const DUES_LIKELIHOOD = 0.5;
const DUES_CLOCKSPEED_DAYS = 14;
const PAYMENT_FOLLOWUP_LIKELIHOOD = 0.5;
const PAYMENT_FOLLOWUP_CLOCKSPEED_DAYS = 7;

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  // Cutover (spec section 6): when the action loop is ON, this cron becomes
  // the dues_nudge + payment_followup PRODUCER — the same selection queries
  // emit ActionProposals for the owner to verify, and the legacy LLM direct
  // send below is disabled (no double-sending). When the loop is OFF, legacy
  // behavior is untouched.
  const autonomyOn = await isAutonomyEnabled();

  const enabled = await getSetting("ai_payment_reminder_enabled", "false");
  if (!autonomyOn && enabled !== "true") {
    return Response.json({ success: true, skipped: true, reason: "AI payment reminder disabled" });
  }

  // IST now
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);

  // 3 days ago threshold for fallback when dueDate is null
  const threeDaysAgo = new Date(now.getTime() - 3 * 86400000);

  // Find active tickets with outstanding balance where payment is overdue
  const overdueTickets = await prisma.memberTicket.findMany({
    where: {
      status: "active",
      balanceDue: { gt: 0 },
      OR: [
        // dueDate is past
        { dueDate: { lt: now } },
        // dueDate is null but ticket was created more than 3 days ago
        { dueDate: null, createdAt: { lt: threeDaysAgo } },
      ],
    },
    include: {
      user: { select: { id: true, firstname: true, lastname: true, phone: true } },
      plan: { select: { name: true, price: true } },
    },
    take: 10,
    orderBy: { balanceDue: "desc" },
  });

  // ── Earned Autonomy: dues_nudge + payment_followup producers ─────────────
  if (autonomyOn) {
    const gymName =
      process.env.NEXT_PUBLIC_GYM_NAME || process.env.GYM_NAME || "the gym";

    // a) dues_nudge — overdue ticket balances (balance-due path).
    let duesCreated = 0;
    let duesProjected = 0;
    const duesTargetUserIds = new Set<number>();
    for (const ticket of overdueTickets) {
      const memberName = `${ticket.user.firstname} ${ticket.user.lastname}`.trim();
      const balance = Number(ticket.balanceDue);
      const dueDateStr = ticket.dueDate
        ? ticket.dueDate.toISOString().split("T")[0]
        : null;
      const draft =
        `Hi ${ticket.user.firstname}, a friendly reminder from ${gymName}: ` +
        `${inr(balance)} is pending on your ${ticket.plan.name} membership` +
        `${dueDateStr ? ` (was due ${dueDateStr})` : ""}. You can clear it at the ` +
        `front desk or via UPI on your next visit — thank you!`;

      const proposal = await createProposal({
        actionType: "dues_nudge",
        sourceAgent: "ai_payment_reminder",
        targetUserId: ticket.user.id,
        title: `Dues nudge — ${memberName} (${inr(balance)})`,
        instruction:
          `Send ${memberName} (${ticket.plan.name}, ${inr(balance)} outstanding` +
          `${dueDateStr ? `, due ${dueDateStr}` : ""}) the payment reminder below via ` +
          `the configured member channel (WhatsApp/SMS + in-app). ` +
          `Projected collection: ${inr(balance)}.\n\n"${draft}"`,
        params: {
          templateName: "ai_payment_reminder",
          variables: { name: ticket.user.firstname, message: draft },
          messageText: draft,
        },
        likelihood: DUES_LIKELIHOOD,
        // Honest projection: the balance actually owed — the outcomes cron
        // measures the realized balanceDue delta against this.
        projectedImpactInr: Math.round(balance),
        clockspeedDays: DUES_CLOCKSPEED_DAYS,
        gymContext: {
          ticketId: ticket.id,
          planName: ticket.plan.name,
          balanceDueAtProposal: balance,
          dueDate: dueDateStr,
        },
      });
      duesTargetUserIds.add(ticket.user.id);
      if (proposal.success && !proposal.skipped) {
        duesCreated++;
        duesProjected += Math.round(balance);
      }
    }

    // b) payment_followup — the staff collection pipeline (PaymentFollowup
    // rows due for a touch). Skips members already covered by a dues_nudge
    // this run or a live one in the DB, so one member never gets two
    // collection messages from the same loop.
    const dueFollowups = await prisma.paymentFollowup.findMany({
      where: {
        status: { in: ["pending", "contacted", "promised"] },
        OR: [
          { nextFollowupAt: { lte: now } },
          { nextFollowupAt: null, dueDate: { lt: now } },
        ],
      },
      include: {
        user: { select: { id: true, firstname: true, lastname: true, phone: true } },
      },
      orderBy: { amountDue: "desc" },
      take: 10,
    });

    let followupCreated = 0;
    let followupProjected = 0;
    for (const fu of dueFollowups) {
      if (!fu.user.phone) continue;
      if (duesTargetUserIds.has(fu.userId)) continue;
      const liveDues = await prisma.actionProposal.findFirst({
        where: {
          actionType: "dues_nudge",
          targetUserId: fu.userId,
          status: { in: ["proposed", "approved", "executed", "auto_executed"] },
          createdAt: { gte: new Date(now.getTime() - DUES_CLOCKSPEED_DAYS * 86400000) },
        },
        select: { id: true },
      });
      if (liveDues) continue;

      const memberName = `${fu.user.firstname} ${fu.user.lastname}`.trim();
      const amount = Number(fu.amountDue);
      const dueDateStr = fu.dueDate.toISOString().split("T")[0];
      const draft =
        `Hi ${fu.user.firstname}, following up from ${gymName} on the pending ` +
        `payment of ${inr(amount)} (due ${dueDateStr}). You can settle it at the ` +
        `front desk or via UPI — tell us if you need anything from our side.`;

      const proposal = await createProposal({
        actionType: "payment_followup",
        sourceAgent: "ai_payment_reminder",
        targetUserId: fu.userId,
        title: `Payment follow-up — ${memberName} (${inr(amount)})`,
        instruction:
          `Send ${memberName} (follow-up #${fu.id}, ${inr(amount)} due ${dueDateStr}, ` +
          `status "${fu.status}") the reminder below via the configured member channel. ` +
          `Projected collection: ${inr(amount)}.\n\n"${draft}"`,
        params: {
          templateName: "ai_payment_reminder",
          variables: { name: fu.user.firstname, message: draft },
          messageText: draft,
        },
        likelihood: PAYMENT_FOLLOWUP_LIKELIHOOD,
        projectedImpactInr: Math.round(amount),
        clockspeedDays: PAYMENT_FOLLOWUP_CLOCKSPEED_DAYS,
        gymContext: {
          followupId: fu.id,
          memberTicketId: fu.memberTicketId,
          amountDueAtProposal: amount,
          dueDate: dueDateStr,
          followupStatus: fu.status,
        },
      });
      if (proposal.success && !proposal.skipped) {
        followupCreated++;
        followupProjected += Math.round(amount);
      }
    }

    // Insight provenance (analysis layer) + link fresh proposals to it.
    const oneHourAgo = new Date(now.getTime() - 60 * 60000);
    if (duesCreated > 0) {
      const insight = await upsertInsight({
        agent: "dues_nudge_proposer",
        severity: "medium",
        title: `${duesCreated} dues nudge(s) proposed — ${inr(duesProjected)} outstanding`,
        body:
          `${duesCreated} member(s) with overdue balances were proposed for payment ` +
          `nudges (verify on Telegram via /actions). Total outstanding: ${inr(duesProjected)}.`,
        dataJson: {
          proposalsCreated: duesCreated,
          estimatedImpactRupees: duesProjected,
          likelihood: DUES_LIKELIHOOD,
          clockspeedDays: DUES_CLOCKSPEED_DAYS,
        },
        entityType: "global",
        dedupeKey: `dues_nudge_proposer:${isoDay()}`,
      });
      await prisma.actionProposal.updateMany({
        where: { actionType: "dues_nudge", insightId: null, createdAt: { gte: oneHourAgo } },
        data: { insightId: insight.insightId },
      });
    }
    if (followupCreated > 0) {
      const insight = await upsertInsight({
        agent: "payment_followup_proposer",
        severity: "medium",
        title: `${followupCreated} payment follow-up(s) proposed — ${inr(followupProjected)} due`,
        body:
          `${followupCreated} pending payment follow-up(s) from the collection pipeline ` +
          `were proposed as member messages (verify on Telegram via /actions). ` +
          `Total due: ${inr(followupProjected)}.`,
        dataJson: {
          proposalsCreated: followupCreated,
          estimatedImpactRupees: followupProjected,
          likelihood: PAYMENT_FOLLOWUP_LIKELIHOOD,
          clockspeedDays: PAYMENT_FOLLOWUP_CLOCKSPEED_DAYS,
        },
        entityType: "global",
        dedupeKey: `payment_followup_proposer:${isoDay()}`,
      });
      await prisma.actionProposal.updateMany({
        where: { actionType: "payment_followup", insightId: null, createdAt: { gte: oneHourAgo } },
        data: { insightId: insight.insightId },
      });
    }

    if (duesCreated + followupCreated > 0) {
      const ownerChatId = (
        await getSetting("gym_owner_telegram_chat_id", "")
      ).trim();
      if (ownerChatId) {
        await sendActionRegister(ownerChatId);
      }
    }

    return Response.json({
      success: true,
      duesProposals: duesCreated,
      paymentFollowupProposals: followupCreated,
      legacyDirectSend: "disabled (autonomy_enabled=true — verify loop owns dues sends)",
    });
  }

  if (overdueTickets.length === 0) {
    return Response.json({ success: true, reminded: 0, reason: "No overdue payments found" });
  }

  let reminded = 0;
  const summaryLines: string[] = [];

  for (const ticket of overdueTickets) {
    try {
      const memberName = `${ticket.user.firstname} ${ticket.user.lastname}`;
      const balance = Number(ticket.balanceDue);

      const prompt = `Draft a personalized WhatsApp payment reminder for a gym member:

Name: ${ticket.user.firstname}
Plan: ${ticket.plan.name} (₹${ticket.plan.price})
Outstanding Balance: ₹${balance}
Due Date: ${ticket.dueDate ? ticket.dueDate.toISOString().split("T")[0] : "Overdue"}

Write a polite, friendly 2-sentence message reminding them about the pending payment. Be warm, not aggressive. Return ONLY the message text.`;

      const { output, tokensUsed } = await runProactiveAgent({
        feature: "payment_reminder",
        prompt,
      });

      if (!output || output.includes("budget exhausted")) {
        break; // Budget exhausted, stop processing
      }

      // Send WhatsApp to member
      if (ticket.user.phone) {
        await sendWhatsApp({
          recipient: ticket.user.phone,
          templateName: "ai_payment_reminder",
          variables: {
            name: ticket.user.firstname,
            message: output.slice(0, 500),
          },
        });
      }

      // Log AI action
      await prisma.aiProactiveLog.create({
        data: {
          feature: "payment_reminder",
          targetType: "user",
          targetId: ticket.userId,
          channel: "whatsapp",
          content: output,
          tokensUsed,
          status: "sent",
        },
      });

      summaryLines.push(`${memberName} — ₹${balance} due (${ticket.plan.name})`);
      reminded++;
    } catch (err) {
      console.error(`[AI Payment Reminder] Error for ticket ${ticket.id}:`, err);
      await prisma.aiProactiveLog.create({
        data: {
          feature: "payment_reminder",
          targetType: "user",
          targetId: ticket.userId,
          channel: "whatsapp",
          content: "",
          tokensUsed: 0,
          status: "failed",
          error: err instanceof Error ? err.message : "Unknown error",
        },
      });
    }
  }

  // Notify admins with summary
  if (summaryLines.length > 0) {
    const admins = await prisma.worker.findMany({
      where: { role: "admin", isActive: true },
      select: { id: true },
    });

    const summaryMessage = `Payment reminders sent to ${reminded} member(s):\n${summaryLines.join("\n")}`;

    for (const admin of admins) {
      await prisma.inAppNotification.create({
        data: {
          workerId: admin.id,
          type: "payment_reminder",
          title: `Payment Reminder: ${reminded} member(s) reminded`,
          message: summaryMessage.slice(0, 500),
          link: "/admin/balance-due",
        },
      });
    }
  }

  return Response.json({ success: true, reminded });
}
