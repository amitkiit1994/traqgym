import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import { runProactiveAgent } from "@/lib/ai/proactive-runner";
import { getColdLeads } from "@/lib/services/lead-scoring";
import { send as sendWhatsApp } from "@/lib/channels/whatsapp";

export async function GET(request: Request) {
  const secret = request.headers.get("x-cron-secret") || new URL(request.url).searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET && process.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const enabled = await getSetting("ai_lead_followup_enabled", "true");
  if (enabled !== "true") {
    return Response.json({ success: true, skipped: true, reason: "Lead follow-up disabled" });
  }

  const gapHours = parseInt(await getSetting("ai_lead_followup_gap_hours", "48"), 10);
  const maxPerRun = parseInt(await getSetting("ai_lead_followup_max_per_run", "10"), 10);
  const channel = await getSetting("notification_channel", "whatsapp");

  const coldLeads = await getColdLeads({ gapHours, maxResults: maxPerRun });

  if (coldLeads.length === 0) {
    return Response.json({ success: true, processed: 0, reason: "No cold leads found" });
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
          link: "/admin/enquiries",
        },
      });
    }

    sent++;
  }

  return Response.json({ success: true, processed: coldLeads.length, sent, skipped });
}
