import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import { runProactiveAgent } from "@/lib/ai/proactive-runner";
import { getAtRiskMembers } from "@/lib/services/churn-detection";
import { requireCronSecret } from "@/lib/auth-cron";

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  const enabled = await getSetting("ai_churn_alerts_enabled", "true");
  if (enabled !== "true") {
    return Response.json({ success: true, skipped: true, reason: "Churn alerts disabled" });
  }

  const inactiveDays = parseInt(await getSetting("ai_churn_inactive_days", "7"), 10);
  const atRisk = await getAtRiskMembers(inactiveDays);

  if (atRisk.length === 0) {
    return Response.json({ success: true, atRisk: 0, reason: "No at-risk members found" });
  }

  // Build context for AI
  const memberList = atRisk
    .slice(0, 20)
    .map((m, i) => `${i + 1}. ${m.name} — ${m.reason}${m.planName ? ` (${m.planName})` : ""}`)
    .join("\n");

  const prompt = `## Churn Risk Analysis

${atRisk.length} members are at risk of churning:

${memberList}

For each member, provide:
1. A one-line assessment of their risk level (high/medium/low)
2. A suggested action for staff (call, WhatsApp, offer, etc.)

Then provide a brief summary paragraph for the gym owner. Keep it concise — this goes into an in-app notification.`;

  const { output, tokensUsed } = await runProactiveAgent({
    feature: "churn_alert",
    prompt,
  });

  if (!output || output.includes("budget exhausted")) {
    return Response.json({ success: true, skipped: true, reason: output });
  }

  // Notify all admins
  const admins = await prisma.worker.findMany({
    where: { role: "admin", isActive: true },
    select: { id: true },
  });

  for (const admin of admins) {
    await prisma.inAppNotification.create({
      data: {
        workerId: admin.id,
        type: "churn_alert",
        title: `Churn Alert: ${atRisk.length} member(s) at risk`,
        message: output.slice(0, 500),
        link: "/admin/members",
      },
    });

    await prisma.aiProactiveLog.create({
      data: {
        feature: "churn_alert",
        targetType: "worker",
        targetId: admin.id,
        channel: "in_app",
        content: output,
        tokensUsed,
        status: "sent",
      },
    });
  }

  return Response.json({ success: true, atRisk: atRisk.length, adminsNotified: admins.length });
}
