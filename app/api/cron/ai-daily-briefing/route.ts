import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import { runProactiveAgent } from "@/lib/ai/proactive-runner";
import { gatherBriefingContext } from "@/lib/services/ai-briefing";

export async function GET(request: Request) {
  const secret = request.headers.get("x-cron-secret") || new URL(request.url).searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET && process.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const enabled = await getSetting("ai_daily_briefing_enabled", "true");
  if (enabled !== "true") {
    return Response.json({ success: true, skipped: true, reason: "Daily briefing disabled" });
  }

  const context = await gatherBriefingContext();

  // Run AI to generate the briefing
  const { output, tokensUsed } = await runProactiveAgent({
    feature: "daily_briefing",
    prompt: context,
  });

  if (!output || output.includes("budget exhausted")) {
    return Response.json({ success: true, skipped: true, reason: output });
  }

  // Get admin workers to notify via in-app notifications
  const admins = await prisma.worker.findMany({
    where: { role: "admin", isActive: true },
    select: { id: true, firstname: true, lastname: true },
  });

  let sent = 0;

  for (const admin of admins) {
    // In-app notification
    await prisma.inAppNotification.create({
      data: {
        workerId: admin.id,
        type: "ai_briefing",
        title: "Daily AI Briefing",
        message: output.slice(0, 500),
        link: "/admin/in-app-notifications",
      },
    });

    // Log
    await prisma.aiProactiveLog.create({
      data: {
        feature: "daily_briefing",
        targetType: "worker",
        targetId: admin.id,
        channel: "in_app",
        content: output,
        tokensUsed,
        status: "sent",
      },
    });

    sent++;
  }

  return Response.json({ success: true, sent, briefingLength: output.length });
}
