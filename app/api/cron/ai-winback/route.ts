import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import { runProactiveAgent } from "@/lib/ai/proactive-runner";
import { send as sendWhatsApp } from "@/lib/channels/whatsapp";
import { requireCronSecret } from "@/lib/auth-cron";
import { createProposal, isAutonomyEnabled } from "@/lib/services/action-loop";
import { sendActionRegister } from "@/lib/ai/action-telegram";
import { upsertInsight } from "@/lib/agents/_shared";
import { inr, isoDay } from "@/lib/agents/_helpers";

// Earned Autonomy: deterministic prior for "a win-back message brings a
// lapsed member back". Outcome measurement (autonomy-outcomes cron: new
// active ticket within 30 days of the send) calibrates this per gym.
const WINBACK_LIKELIHOOD = 0.2;
const WINBACK_CLOCKSPEED_DAYS = 30;

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  // Cutover (spec section 6): when the action loop is ON, this cron becomes
  // the winback_message PRODUCER — the same selection query emits
  // ActionProposals for the owner to verify on Telegram, and the legacy LLM
  // direct send below is disabled (no double-sending). When the loop is OFF,
  // legacy behavior is untouched.
  const autonomyOn = await isAutonomyEnabled();

  const enabled = await getSetting("ai_winback_enabled", "false");
  if (!autonomyOn && enabled !== "true") {
    return Response.json({ success: true, skipped: true, reason: "AI win-back disabled" });
  }

  const expiredDaysStr = await getSetting("ai_winback_expired_days", "30");
  const expiredDays = parseInt(expiredDaysStr, 10) || 30;
  const maxPerRunStr = await getSetting("ai_winback_max_per_run", "10");
  const maxPerRun = parseInt(maxPerRunStr, 10) || 10;

  const now = new Date();
  const cutoffDate = new Date(now.getTime() - expiredDays * 86400000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

  // Find users whose latest ticket expired more than N days ago and have NO active ticket
  // Using raw aggregation: get users where max(expireDate) < cutoff and no active tickets
  const expiredUsers = await prisma.user.findMany({
    where: {
      isActive: true,
      memberTickets: {
        every: {
          OR: [
            { expireDate: { lt: cutoffDate } },
            { status: "cancelled" },
          ],
        },
        some: {}, // must have at least one ticket
      },
      // Exclude users with any active (non-expired, non-cancelled) ticket
      NOT: {
        memberTickets: {
          some: {
            status: "active",
            expireDate: { gte: now },
          },
        },
      },
    },
    select: {
      id: true,
      firstname: true,
      lastname: true,
      phone: true,
      memberTickets: {
        orderBy: { expireDate: "desc" },
        take: 1,
        include: {
          plan: { select: { name: true, price: true } },
        },
      },
      payments: {
        select: { amount: true },
      },
      attendanceLogs: {
        orderBy: { checkIn: "desc" },
        take: 1,
        select: { checkIn: true },
      },
    },
    take: maxPerRun * 2, // Fetch extra to account for dedup filtering
  });

  if (expiredUsers.length === 0) {
    return Response.json({ success: true, contacted: 0, reason: "No lapsed members found" });
  }

  // Dedup: check AiProactiveLog for winback in last 30 days
  const recentLogs = await prisma.aiProactiveLog.findMany({
    where: {
      feature: "winback",
      createdAt: { gte: thirtyDaysAgo },
      targetType: "user",
    },
    select: { targetId: true },
  });
  const alreadyContacted = new Set(recentLogs.map((l) => l.targetId));

  // ── Earned Autonomy: winback_message producer ────────────────────────────
  // Same selection, different trigger-puller: emit verifiable proposals
  // (instruction + likelihood + projected impact + clockspeed) instead of
  // direct-sending. Projected impact is honest: plan value x likelihood —
  // a win-back is a probabilistic recovery, not a booked renewal.
  if (autonomyOn) {
    const gymName =
      process.env.NEXT_PUBLIC_GYM_NAME || process.env.GYM_NAME || "the gym";
    let proposalsCreated = 0;
    let totalProjected = 0;
    const candidates: Array<{ name: string; daysSinceExpiry: number; planName: string; projected: number }> = [];

    for (const user of expiredUsers) {
      if (proposalsCreated >= maxPerRun) break;
      if (alreadyContacted.has(user.id)) continue;
      if (!user.phone) continue;
      const lastTicket = user.memberTickets[0];
      if (!lastTicket) continue;

      const memberName = `${user.firstname} ${user.lastname}`.trim();
      const lastPlan = lastTicket.plan.name;
      const planPrice = Number(lastTicket.plan.price);
      const lastExpiry = lastTicket.expireDate.toISOString().split("T")[0];
      const daysSinceExpiry = Math.floor(
        (now.getTime() - lastTicket.expireDate.getTime()) / 86400000
      );
      const projected = Math.round(planPrice * WINBACK_LIKELIHOOD);
      const draft =
        `Hi ${user.firstname}, we miss you at ${gymName}! Your ${lastPlan} ` +
        `membership ended on ${lastExpiry} — that's ${daysSinceExpiry} days without ` +
        `your workout. Your progress is waiting for you: drop by or reply here and ` +
        `we'll have you training again in minutes.`;

      const proposal = await createProposal({
        actionType: "winback_message",
        sourceAgent: "ai_winback",
        targetUserId: user.id,
        title: `Win-back — ${memberName}`,
        instruction:
          `Send ${memberName} (last plan ${lastPlan}, lapsed ${daysSinceExpiry}d) the ` +
          `win-back below via the configured member channel (WhatsApp/SMS + in-app). ` +
          `Plan value ${inr(planPrice)} x ${Math.round(WINBACK_LIKELIHOOD * 100)}% likelihood ` +
          `= projected ${inr(projected)}.\n\n"${draft}"`,
        params: {
          templateName: "ai_winback",
          variables: { name: user.firstname, message: draft },
          messageText: draft,
        },
        likelihood: WINBACK_LIKELIHOOD,
        projectedImpactInr: projected,
        clockspeedDays: WINBACK_CLOCKSPEED_DAYS,
        gymContext: {
          lastTicketId: lastTicket.id,
          lastPlan,
          planPrice,
          lastExpiry,
          daysSinceExpiry,
        },
      });
      if (proposal.success && !proposal.skipped) {
        proposalsCreated++;
        totalProjected += projected;
        candidates.push({ name: memberName, daysSinceExpiry, planName: lastPlan, projected });
      }
    }

    // Insight provenance: one analysis-layer row per run; proposals are the
    // action layer. (Linked after the fact so the insight reflects the
    // actually-proposed set, not the raw candidate pool.)
    if (proposalsCreated > 0) {
      const insight = await upsertInsight({
        agent: "winback_proposer",
        severity: "medium",
        title: `${proposalsCreated} lapsed member(s) proposed for win-back — ${inr(totalProjected)} projected`,
        body:
          `${proposalsCreated} member(s) lapsed >${expiredDays}d with no active ticket were ` +
          `proposed for win-back messages (verify on Telegram via /actions). ` +
          `Top: ${candidates[0]?.name ?? "n/a"} (${candidates[0]?.daysSinceExpiry ?? 0}d lapsed).`,
        dataJson: {
          proposalsCreated,
          estimatedImpactRupees: totalProjected,
          likelihood: WINBACK_LIKELIHOOD,
          clockspeedDays: WINBACK_CLOCKSPEED_DAYS,
          candidates: candidates.slice(0, 10),
        },
        entityType: "global",
        dedupeKey: `winback_proposer:${isoDay()}`,
      });
      // Link the rows created this run (notify mode may already have
      // auto-executed them, so no status filter — just fresh + unlinked).
      await prisma.actionProposal.updateMany({
        where: {
          actionType: "winback_message",
          insightId: null,
          createdAt: { gte: new Date(now.getTime() - 60 * 60000) },
        },
        data: { insightId: insight.insightId },
      });

      const ownerChatId = (
        await getSetting("gym_owner_telegram_chat_id", "")
      ).trim();
      if (ownerChatId) {
        await sendActionRegister(ownerChatId);
      }
    }

    return Response.json({
      success: true,
      proposalsCreated,
      legacyDirectSend: "disabled (autonomy_enabled=true — verify loop owns winback sends)",
    });
  }

  let contacted = 0;
  const summaryLines: string[] = [];

  for (const user of expiredUsers) {
    if (contacted >= maxPerRun) break;
    if (alreadyContacted.has(user.id)) continue;
    if (!user.phone) continue;

    const lastTicket = user.memberTickets[0];
    if (!lastTicket) continue;

    try {
      const memberName = `${user.firstname} ${user.lastname}`;
      const lastPlan = lastTicket.plan.name;
      const lastExpiry = lastTicket.expireDate.toISOString().split("T")[0];
      const daysSinceExpiry = Math.floor(
        (now.getTime() - lastTicket.expireDate.getTime()) / 86400000
      );
      const totalPayments = user.payments.reduce(
        (sum, p) => sum + Number(p.amount),
        0
      );
      const lastAttendance = user.attendanceLogs[0]?.checkIn;

      const prompt = `Draft a personalized WhatsApp win-back message for a lapsed gym member:

Name: ${user.firstname}
Last plan: ${lastPlan} (₹${lastTicket.plan.price})
Membership expired: ${lastExpiry} (${daysSinceExpiry} days ago)
Lifetime payments: ₹${totalPayments}
Last gym visit: ${lastAttendance ? lastAttendance.toISOString().split("T")[0] : "Unknown"}

Write a friendly, warm 2-3 sentence message encouraging them to come back. Reference their past commitment and how the gym misses them. Do NOT mention discounts unless explicitly told. Return ONLY the message text.`;

      const { output, tokensUsed } = await runProactiveAgent({
        feature: "winback",
        prompt,
      });

      if (!output || output.includes("budget exhausted")) {
        break;
      }

      await sendWhatsApp({
        recipient: user.phone,
        templateName: "ai_winback",
        variables: {
          name: user.firstname,
          message: output.slice(0, 500),
        },
      });

      await prisma.aiProactiveLog.create({
        data: {
          feature: "winback",
          targetType: "user",
          targetId: user.id,
          channel: "whatsapp",
          content: output,
          tokensUsed,
          status: "sent",
        },
      });

      summaryLines.push(`${memberName} — lapsed ${daysSinceExpiry}d, last plan: ${lastPlan}`);
      contacted++;
    } catch (err) {
      console.error(`[AI Win-Back] Error for user ${user.id}:`, err);
      await prisma.aiProactiveLog.create({
        data: {
          feature: "winback",
          targetType: "user",
          targetId: user.id,
          channel: "whatsapp",
          content: "",
          tokensUsed: 0,
          status: "failed",
          error: err instanceof Error ? err.message : "Unknown error",
        },
      });
    }
  }

  // Notify admins
  if (summaryLines.length > 0) {
    const admins = await prisma.worker.findMany({
      where: { role: "admin", isActive: true },
      select: { id: true },
    });

    const summaryMessage = `Win-back messages sent to ${contacted} lapsed member(s):\n${summaryLines.join("\n")}`;

    for (const admin of admins) {
      await prisma.inAppNotification.create({
        data: {
          workerId: admin.id,
          type: "winback",
          title: `Win-Back: ${contacted} lapsed member(s) contacted`,
          message: summaryMessage.slice(0, 500),
          link: "/admin/members",
        },
      });
    }
  }

  return Response.json({ success: true, contacted });
}
