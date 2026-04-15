import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import { runProactiveAgent } from "@/lib/ai/proactive-runner";
import { send as sendWhatsApp } from "@/lib/channels/whatsapp";

const STEPS = [
  {
    day: 0,
    feature: "onboarding_day0",
    template: "ai_onboarding_day0",
    promptPrefix: "Draft a warm welcome WhatsApp message for a new gym member who just joined today. Include basic gym etiquette/rules reminder.",
  },
  {
    day: 1,
    feature: "onboarding_day1",
    template: "ai_onboarding_day1",
    promptPrefix: "Draft a friendly WhatsApp message suggesting a simple first workout for a new gym member who joined yesterday.",
  },
  {
    day: 3,
    feature: "onboarding_day3",
    template: "ai_onboarding_day3",
    promptPrefix: "Draft a short check-in WhatsApp message for a new gym member 3 days after joining. Ask how their first few days have been.",
  },
  {
    day: 7,
    feature: "onboarding_day7",
    template: "ai_onboarding_day7",
    promptPrefix: "Draft a WhatsApp message for a new gym member 1 week in, recommending they try a structured workout plan.",
  },
] as const;

export async function GET(request: Request) {
  const secret = request.headers.get("x-cron-secret") || new URL(request.url).searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET && process.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const enabled = await getSetting("ai_onboarding_enabled", "false");
  if (enabled !== "true") {
    return Response.json({ success: true, skipped: true, reason: "Onboarding sequence disabled" });
  }

  const channel = await getSetting("notification_channel", "whatsapp");
  const results: Record<string, number> = {};

  for (const step of STEPS) {
    const targetDate = new Date();
    targetDate.setHours(0, 0, 0, 0);
    targetDate.setDate(targetDate.getDate() - step.day);

    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // Find users whose FIRST MemberTicket.buyDate is exactly N days ago
    // and who have exactly 1 total MemberTicket (truly new, not a renewal)
    const newMembers = await prisma.user.findMany({
      where: {
        phone: { not: null },
        memberTickets: {
          some: {
            buyDate: { gte: targetDate, lt: nextDay },
          },
        },
      },
      select: {
        id: true,
        firstname: true,
        lastname: true,
        phone: true,
        _count: { select: { memberTickets: true } },
        memberTickets: {
          orderBy: { buyDate: "asc" },
          take: 1,
          select: { buyDate: true, plan: { select: { name: true } } },
        },
      },
    });

    // Filter: exactly 1 ticket and first buyDate matches target day
    const eligible = newMembers.filter((m) => {
      if (m._count.memberTickets !== 1) return false;
      const firstBuy = m.memberTickets[0]?.buyDate;
      if (!firstBuy) return false;
      return firstBuy >= targetDate && firstBuy < nextDay;
    });

    // Check dedup: no existing log with this step's feature for this user
    const alreadySent = eligible.length > 0
      ? await prisma.aiProactiveLog.findMany({
          where: {
            feature: step.feature,
            targetType: "user",
            targetId: { in: eligible.map((m) => m.id) },
          },
          select: { targetId: true },
        })
      : [];

    const sentIds = new Set(alreadySent.map((l) => l.targetId));
    const toProcess = eligible.filter((m) => !sentIds.has(m.id)).slice(0, 10);

    let sent = 0;

    for (const member of toProcess) {
      if (!member.phone) continue;

      const planName = member.memberTickets[0]?.plan.name ?? "gym membership";

      const prompt = `${step.promptPrefix}

Member: ${member.firstname} ${member.lastname}
Plan: ${planName}

Write a friendly, concise message (2-3 sentences max). Return ONLY the message text.`;

      const { output, tokensUsed } = await runProactiveAgent({
        feature: step.feature,
        prompt,
      });

      if (!output || output.includes("budget exhausted")) continue;

      if (channel === "whatsapp" || channel === "both") {
        try {
          await sendWhatsApp({
            recipient: member.phone,
            templateName: step.template,
            variables: {
              name: member.firstname,
              message: output.slice(0, 500),
            },
          });
        } catch {
          await prisma.aiProactiveLog.create({
            data: {
              feature: step.feature,
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
          feature: step.feature,
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

    results[step.feature] = sent;
  }

  return Response.json({ success: true, results });
}
