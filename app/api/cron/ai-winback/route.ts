import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import { runProactiveAgent } from "@/lib/ai/proactive-runner";
import { send as sendWhatsApp } from "@/lib/channels/whatsapp";
import { requireCronSecret } from "@/lib/auth-cron";

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  const enabled = await getSetting("ai_winback_enabled", "false");
  if (enabled !== "true") {
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
