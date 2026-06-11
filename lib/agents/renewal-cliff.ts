/**
 * Renewal Cliff agent.
 *
 * Daily snapshot of MemberTickets expiring in the next 7 days. The aggregate
 * ₹ exposure (sum of ticket totalAmount or plan price) becomes
 * `estimatedImpactRupees`, used by the future Manager ranker.
 *
 * Severity: high if exposure > ₹50k, medium otherwise.
 */

import { prisma } from "@/lib/prisma";
import { upsertInsight, type InsightSeverity } from "./_shared";
import { inr, isoDay } from "./_helpers";
import { createProposal, isAutonomyEnabled } from "@/lib/services/action-loop";
import { sendActionRegister } from "@/lib/ai/action-telegram";
import { getSetting } from "@/lib/services/settings";

const AGENT = "renewal_cliff";

const HORIZON_DAYS = 7;
const HIGH_EXPOSURE_RUPEES = 50_000;

// Earned Autonomy: agent-estimated probability that a timely reminder saves
// the renewal. v1 is a deterministic prior; outcome measurement (recordOutcome
// cron) will calibrate this per gym over time.
const RENEWAL_REMINDER_LIKELIHOOD = 0.7;
const RENEWAL_REMINDER_CLOCKSPEED_DAYS = 7;

export async function run(): Promise<{
  created: number;
  total: number;
  proposalsCreated: number;
}> {
  const now = new Date();
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86400000);

  const tickets = await prisma.memberTicket.findMany({
    where: {
      status: "active",
      expireDate: { gte: now, lte: horizon },
    },
    select: {
      id: true,
      userId: true,
      expireDate: true,
      totalAmount: true,
      user: { select: { firstname: true, lastname: true, phone: true } },
      plan: { select: { name: true, price: true } },
    },
    orderBy: { expireDate: "asc" },
  });

  if (tickets.length === 0) {
    return { created: 0, total: 0, proposalsCreated: 0 };
  }

  // Use ticket.totalAmount if known, else fall back to plan price.
  let exposure = 0;
  const enriched = tickets.map((t) => {
    const value = Number(t.totalAmount ?? t.plan?.price ?? 0);
    exposure += value;
    return {
      ticketId: t.id,
      userId: t.userId,
      userName: `${t.user.firstname} ${t.user.lastname}`.trim(),
      userPhone: t.user.phone,
      planName: t.plan?.name ?? "Unknown",
      expireDate: isoDay(t.expireDate),
      value,
    };
  });

  const top10 = [...enriched]
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const severity: InsightSeverity =
    exposure > HIGH_EXPOSURE_RUPEES ? "high" : "medium";
  const dateKey = isoDay();

  const result = await upsertInsight({
    agent: AGENT,
    severity,
    title: `${tickets.length} membership(s) expiring in 7 days — ${inr(exposure)} at risk`,
    body:
      `${tickets.length} active ticket(s) expire on or before ` +
      `${isoDay(horizon)}. Total exposure: ${inr(exposure)}. ` +
      `Top renewal: ${top10[0]?.userName ?? "n/a"} (${inr(top10[0]?.value ?? 0)}).`,
    dataJson: {
      ticketsExpiring: tickets.length,
      horizonDays: HORIZON_DAYS,
      estimatedImpactRupees: exposure,
      top10,
    },
    suggestedActions: [
      {
        label: "Open renewals",
        action: "navigate",
        args: { href: "/admin/renewals" },
      },
    ],
    entityType: "global",
    dedupeKey: `${AGENT}:${dateKey}`,
  });

  // ── Earned Autonomy: emit verifiable renewal_reminder ActionProposals ────
  // The insight above stays the analysis layer; here the SAME selection also
  // produces concrete actions (instruction + likelihood + projected impact in
  // rupees + clockspeed) for the owner to verify on Telegram. Guarded by the
  // `autonomy_enabled` kill-switch (default off — zero behavior change) and
  // deduped per member inside createProposal, so re-runs don't stack.
  let proposalsCreated = 0;
  if (await isAutonomyEnabled()) {
    const gymName =
      process.env.NEXT_PUBLIC_GYM_NAME || process.env.GYM_NAME || "the gym";
    for (const t of enriched) {
      const firstName = t.userName.split(" ")[0] || t.userName;
      const draft =
        `Hi ${firstName}, your ${t.planName} membership at ${gymName} ` +
        `expires on ${t.expireDate}. Renew now to keep your access and your ` +
        `streak going — reply here or visit the front desk and we'll set you up in two minutes.`;
      const proposal = await createProposal({
        actionType: "renewal_reminder",
        sourceAgent: AGENT,
        targetUserId: t.userId,
        title: `Renewal reminder — ${t.userName}`,
        instruction:
          `Send ${t.userName} (${t.planName}, expires ${t.expireDate}) the renewal ` +
          `reminder below via the configured member channel (WhatsApp/SMS + in-app). ` +
          `Projected save: ${inr(t.value)}.\n\n"${draft}"`,
        params: {
          templateName: "ai_smart_renewal",
          variables: { name: firstName, message: draft },
          messageText: draft,
        },
        likelihood: RENEWAL_REMINDER_LIKELIHOOD,
        // Projected impact = ticket value (the renewal at risk).
        projectedImpactInr: Math.round(t.value),
        clockspeedDays: RENEWAL_REMINDER_CLOCKSPEED_DAYS,
        gymContext: {
          ticketId: t.ticketId,
          planName: t.planName,
          expireDate: t.expireDate,
        },
        insightId: result.insightId,
      });
      if (proposal.success && !proposal.skipped) proposalsCreated++;
    }

    // Surface the register to the paired owner chat right away (verify mode).
    if (proposalsCreated > 0) {
      const ownerChatId = (
        await getSetting("gym_owner_telegram_chat_id", "")
      ).trim();
      if (ownerChatId) {
        await sendActionRegister(ownerChatId);
      }
    }
  }

  return { created: result.created ? 1 : 0, total: 1, proposalsCreated };
}
