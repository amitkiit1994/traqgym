import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import { runProactiveAgent } from "@/lib/ai/proactive-runner";
import { getColdLeads } from "@/lib/services/lead-scoring";
import { send as sendWhatsApp } from "@/lib/channels/whatsapp";
import { requireCronSecret } from "@/lib/auth-cron";
import { createProposal, isAutonomyEnabled } from "@/lib/services/action-loop";
import { sendActionRegister } from "@/lib/ai/action-telegram";
import { upsertInsight } from "@/lib/agents/_shared";
import { inr, isoDay } from "@/lib/agents/_helpers";

// Earned Autonomy prior: probability that one followup converts a cold lead
// within the window. Projected impact = average realized ticket value (last
// 90 days of actual sales) x likelihood — measured by the autonomy-outcomes
// cron as enquiry stage advancement / conversion payments.
const ENQUIRY_LIKELIHOOD = 0.1;
const ENQUIRY_CLOCKSPEED_DAYS = 7;

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  // Cutover: when the action loop is ON, this cron becomes the
  // enquiry_followup PRODUCER (this legacy path was ALSO unearned autonomy —
  // default-on LLM direct sends to leads). Same selection (getColdLeads),
  // proposals instead of sends; legacy direct send disabled. When the loop
  // is OFF, legacy behavior is untouched.
  const autonomyOn = await isAutonomyEnabled();

  const enabled = await getSetting("ai_lead_followup_enabled", "true");
  if (!autonomyOn && enabled !== "true") {
    return Response.json({ success: true, skipped: true, reason: "Lead follow-up disabled" });
  }

  const gapHours = parseInt(await getSetting("ai_lead_followup_gap_hours", "48"), 10);
  const maxPerRun = parseInt(await getSetting("ai_lead_followup_max_per_run", "10"), 10);
  const channel = await getSetting("notification_channel", "whatsapp");

  // Guard: don't run if WhatsApp channel selected but MSG91 isn't configured.
  // Otherwise we burn OpenAI tokens generating messages that get console.log'd.
  // Applies to the producer too — proposing a send that can only dev-log is
  // not an honest action.
  if (channel === "whatsapp" || channel === "both") {
    const authKey = (await getSetting("msg91_auth_key", "")) || process.env.MSG91_AUTH_KEY;
    const integratedNumber = (await getSetting("msg91_whatsapp_number", "")) || process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER;
    if (!authKey || !integratedNumber) {
      return Response.json({
        success: true,
        skipped: true,
        reason: "WhatsApp not configured (MSG91 credentials missing). Configure in Settings or disable lead follow-up.",
      });
    }
  }

  const coldLeads = await getColdLeads({ gapHours, maxResults: maxPerRun });

  if (coldLeads.length === 0) {
    return Response.json({ success: true, processed: 0, reason: "No cold leads found" });
  }

  // ── Earned Autonomy: enquiry_followup producer ───────────────────────────
  if (autonomyOn) {
    const gymName =
      process.env.NEXT_PUBLIC_GYM_NAME || process.env.GYM_NAME || "the gym";

    // Honest projection basis: what a converted enquiry has actually been
    // worth at this gym lately (average ticket value over the last 90 days).
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000);
    const agg = await prisma.memberTicket.aggregate({
      _avg: { totalAmount: true },
      where: { createdAt: { gte: ninetyDaysAgo }, totalAmount: { not: null } },
    });
    const avgTicketValue = Number(agg._avg.totalAmount ?? 0);
    const projected =
      avgTicketValue > 0 ? Math.round(avgTicketValue * ENQUIRY_LIKELIHOOD) : undefined;

    let proposalsCreated = 0;
    for (const lead of coldLeads) {
      if (!lead.phone) continue;
      const draft =
        `Hi ${lead.name.split(" ")[0] || lead.name}, thanks for your interest in ` +
        `${gymName}! We'd love to show you around — drop in any time this week for a ` +
        `quick tour and a trial workout, or reply here and we'll call you back at a ` +
        `time that suits you.`;

      const proposal = await createProposal({
        actionType: "enquiry_followup",
        sourceAgent: "ai_lead_followup",
        targetEnquiryId: lead.enquiryId,
        title: `Lead follow-up — ${lead.name} (${lead.stage}, quiet ${lead.daysSinceLastActivity}d)`,
        instruction:
          `Send enquiry ${lead.name} (${lead.phone}, source ${lead.source}, stage ` +
          `"${lead.stage}", ${lead.daysSinceLastActivity}d since last activity, ` +
          `${lead.followupCount} prior followup(s)) the message below via WhatsApp/SMS. ` +
          (projected
            ? `Projected: avg ticket ${inr(avgTicketValue)} x ${Math.round(ENQUIRY_LIKELIHOOD * 100)}% = ${inr(projected)}.`
            : `No projection (no ticket sales in the last 90 days to base one on).`) +
          `\n\n"${draft}"`,
        params: {
          templateName: "ai_lead_followup",
          variables: { name: lead.name, message: draft },
          messageText: draft,
        },
        likelihood: ENQUIRY_LIKELIHOOD,
        projectedImpactInr: projected,
        clockspeedDays: ENQUIRY_CLOCKSPEED_DAYS,
        gymContext: {
          stageAtProposal: lead.stage,
          source: lead.source,
          daysSinceLastActivity: lead.daysSinceLastActivity,
          followupCount: lead.followupCount,
        },
      });
      if (proposal.success && !proposal.skipped) proposalsCreated++;
    }

    if (proposalsCreated > 0) {
      const insight = await upsertInsight({
        agent: "enquiry_followup_proposer",
        severity: "medium",
        title: `${proposalsCreated} cold lead(s) proposed for follow-up`,
        body:
          `${proposalsCreated} enquiry(ies) inactive >${gapHours}h were proposed for ` +
          `follow-up messages (verify on Telegram via /actions).` +
          (projected
            ? ` Projection basis: ${inr(avgTicketValue)} avg ticket x ${Math.round(ENQUIRY_LIKELIHOOD * 100)}% conversion prior.`
            : ""),
        dataJson: {
          proposalsCreated,
          avgTicketValue,
          likelihood: ENQUIRY_LIKELIHOOD,
          clockspeedDays: ENQUIRY_CLOCKSPEED_DAYS,
        },
        entityType: "global",
        dedupeKey: `enquiry_followup_proposer:${isoDay()}`,
      });
      await prisma.actionProposal.updateMany({
        where: {
          actionType: "enquiry_followup",
          insightId: null,
          createdAt: { gte: new Date(Date.now() - 60 * 60000) },
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
      legacyDirectSend: "disabled (autonomy_enabled=true — verify loop owns lead followups)",
    });
  }

  let sent = 0;
  let skipped = 0;

  for (const lead of coldLeads) {
    const prompt = `## Follow-up Message for Cold Lead

Enquiry: ${lead.name}
Phone: ${lead.phone}
Source: ${lead.source}
Stage: ${lead.stage}
Days since last activity: ${lead.daysSinceLastActivity}
Previous follow-ups: ${lead.followupCount}
Last note: ${lead.lastNote ?? "None"}

Craft a short, warm, personalized WhatsApp follow-up message for this enquiry. The message should:
- Be friendly and non-pushy
- Reference their interest in the gym
- Be 2-3 sentences max
- End with a clear call to action (visit, call back, etc.)
- Do NOT include any greeting like "Hi [Name]" — just the message body

Return ONLY the message text, nothing else.`;

    const { output, tokensUsed } = await runProactiveAgent({
      feature: "lead_followup",
      prompt,
    });

    if (!output || output.includes("budget exhausted")) {
      skipped++;
      continue;
    }

    // Send the message
    if (channel === "whatsapp" || channel === "both") {
      try {
        await sendWhatsApp({
          recipient: lead.phone,
          templateName: "ai_lead_followup",
          variables: {
            name: lead.name,
            message: output.slice(0, 500),
          },
        });
      } catch {
        // Log failure but continue
        await prisma.aiProactiveLog.create({
          data: {
            feature: "lead_followup",
            targetType: "user",
            targetId: lead.enquiryId,
            channel: "whatsapp",
            content: output,
            tokensUsed,
            status: "failed",
            error: "WhatsApp delivery failed",
          },
        });
        skipped++;
        continue;
      }
    }

    // Log success
    await prisma.aiProactiveLog.create({
      data: {
        feature: "lead_followup",
        targetType: "user",
        targetId: lead.enquiryId,
        channel,
        content: output,
        tokensUsed,
        status: "sent",
      },
    });

    // Notify admins about the auto-follow-up
    const admins = await prisma.worker.findMany({
      where: { role: "admin", isActive: true },
      select: { id: true },
    });

    for (const admin of admins) {
      await prisma.inAppNotification.create({
        data: {
          workerId: admin.id,
          type: "ai_lead_followup",
          title: `AI Follow-up Sent: ${lead.name}`,
          message: `Auto-sent follow-up to ${lead.name} (${lead.phone}) — inactive for ${lead.daysSinceLastActivity} days.`,
          link: `/admin/enquiries?showArchived=true&search=${encodeURIComponent(lead.phone)}`,
        },
      });
    }

    sent++;
  }

  return Response.json({ success: true, processed: coldLeads.length, sent, skipped });
}
