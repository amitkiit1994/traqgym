import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import { runProactiveAgent } from "@/lib/ai/proactive-runner";
import { send as sendWhatsApp } from "@/lib/channels/whatsapp";
import { requireCronSecret } from "@/lib/auth-cron";

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  const enabled = await getSetting("ai_member_nudges_enabled", "true");
  if (enabled !== "true") {
    return Response.json({ success: true, skipped: true, reason: "Member nudges disabled" });
  }

  const inactiveDays = parseInt(await getSetting("ai_member_nudge_inactive_days", "5"), 10);
  const channel = await getSetting("notification_channel", "whatsapp");

  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - inactiveDays);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find members with active workout/diet plans who haven't attended recently
  const inactiveWithPlans = await prisma.user.findMany({
    where: {
      memberTickets: { some: { expireDate: { gte: today } } },
      attendanceLogs: { none: { checkIn: { gte: cutoff } } },
      OR: [
        { userWorkoutPlans: { some: { isActive: true } } },
        { userDietPlans: { some: { isActive: true } } },
      ],
    },
    select: {
      id: true,
      firstname: true,
      lastname: true,
      phone: true,
      userWorkoutPlans: {
        where: { isActive: true },
        take: 1,
        include: { plan: { select: { name: true } } },
      },
      userDietPlans: {
        where: { isActive: true },
        take: 1,
        include: { plan: { select: { name: true } } },
      },
    },
    take: 20,
  });

  let sent = 0;

  for (const member of inactiveWithPlans) {
    if (!member.phone) continue;

    const planInfo = member.userWorkoutPlans[0]
      ? `Workout plan: ${member.userWorkoutPlans[0].plan.name}`
      : member.userDietPlans[0]
        ? `Diet plan: ${member.userDietPlans[0].plan.name}`
        : "Active plan assigned";

    const prompt = `Draft a short motivational WhatsApp nudge for a gym member who hasn't visited in ${inactiveDays}+ days.

Member: ${member.firstname} ${member.lastname}
${planInfo}

Write a friendly, motivational message (2 sentences max). Reference their plan. Be encouraging, not guilt-tripping. Return ONLY the message text.`;

    const { output, tokensUsed } = await runProactiveAgent({
      feature: "member_nudge",
      prompt,
    });

    if (!output || output.includes("budget exhausted")) continue;

    if (channel === "whatsapp" || channel === "both") {
      try {
        await sendWhatsApp({
          recipient: member.phone,
          templateName: "ai_member_nudge",
          variables: {
            name: member.firstname,
            message: output.slice(0, 500),
          },
        });
      } catch {
        await prisma.aiProactiveLog.create({
          data: {
            feature: "member_nudge",
            targetType: "user",
            targetId: member.id,
            channel: "whatsapp",
            content: output,
            tokensUsed,
            status: "failed",
            error: "WhatsApp delivery failed",
          },
        });
        continue;
      }
    }

    await prisma.aiProactiveLog.create({
      data: {
        feature: "member_nudge",
        targetType: "user",
        targetId: member.id,
        channel,
        content: output,
        tokensUsed,
        status: "sent",
      },
    });

    sent++;
  }

  return Response.json({ success: true, eligible: inactiveWithPlans.length, sent });
}
