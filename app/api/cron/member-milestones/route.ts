import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import { getTodayMilestones } from "@/lib/services/member-milestones";
import { send as sendWhatsApp } from "@/lib/channels/whatsapp";
import { requireCronSecret } from "@/lib/auth-cron";

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  const enabled = await getSetting("member_milestones_enabled", "true");
  if (enabled !== "true") {
    return Response.json({ success: true, skipped: true, reason: "Milestones disabled" });
  }

  const channel = await getSetting("notification_channel", "whatsapp");
  const milestones = await getTodayMilestones();

  if (milestones.length === 0) {
    return Response.json({ success: true, milestones: 0 });
  }

  let sent = 0;

  for (const m of milestones) {
    // In-app notification to the member
    await prisma.inAppNotification.create({
      data: {
        userId: m.userId,
        type: "milestone",
        title: m.label,
        message: `Congratulations ${m.name}! ${m.label}`,
        link: "/member",
      },
    });

    // WhatsApp if configured
    if ((channel === "whatsapp" || channel === "both") && m.phone) {
      try {
        await sendWhatsApp({
          recipient: m.phone,
          templateName: `milestone_${m.type}`,
          variables: {
            name: m.name.split(" ")[0],
            milestone: m.label,
            value: String(m.value),
          },
        });
      } catch {
        // Non-critical
      }
    }

    // Log (no AI cost — template-based)
    await prisma.aiProactiveLog.create({
      data: {
        feature: "milestone",
        targetType: "user",
        targetId: m.userId,
        channel: m.phone ? channel : "in_app",
        content: m.label,
        tokensUsed: 0,
        status: "sent",
      },
    });

    sent++;
  }

  // Notify admins about milestones sent
  if (sent > 0) {
    const admins = await prisma.worker.findMany({
      where: { role: "admin", isActive: true },
      select: { id: true },
    });

    for (const admin of admins) {
      await prisma.inAppNotification.create({
        data: {
          workerId: admin.id,
          type: "milestone_summary",
          title: `${sent} Milestone Celebration(s) Sent`,
          message: milestones.map((m) => `${m.name}: ${m.label}`).join(", "),
          link: "/admin/members",
        },
      });
    }
  }

  return Response.json({ success: true, milestones: milestones.length, sent });
}
