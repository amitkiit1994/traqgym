import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import { runProactiveAgent } from "@/lib/ai/proactive-runner";
import { send as sendWhatsApp } from "@/lib/channels/whatsapp";
import { requireCronSecret } from "@/lib/auth-cron";

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  const enabled = await getSetting("ai_post_renewal_enabled", "false");
  if (enabled !== "true") {
    return Response.json({ success: true, skipped: true, reason: "AI post-renewal disabled" });
  }

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Find tickets created in the last 24 hours where the user has at least 1 other ticket (renewal)
  const recentTickets = await prisma.memberTicket.findMany({
    where: {
      createdAt: { gte: oneDayAgo },
    },
    include: {
      user: {
        select: {
          id: true,
          firstname: true,
          lastname: true,
          phone: true,
          createdAt: true,
          memberTickets: {
            select: { id: true },
            take: 2, // We only need to know if >1 exists
          },
          attendanceLogs: {
            orderBy: { checkIn: "desc" },
            take: 30,
            select: { checkIn: true },
          },
        },
      },
      plan: { select: { name: true, price: true } },
    },
  });

  // Filter to only renewals (user has more than 1 ticket)
  const renewals = recentTickets.filter((t) => t.user.memberTickets.length > 1);

  if (renewals.length === 0) {
    return Response.json({ success: true, thanked: 0, reason: "No recent renewals found" });
  }

  // Dedup: check AiProactiveLog for post_renewal in last 7 days
  const recentLogs = await prisma.aiProactiveLog.findMany({
    where: {
      feature: "post_renewal",
      createdAt: { gte: sevenDaysAgo },
      targetType: "user",
    },
    select: { targetId: true },
  });
  const alreadyThanked = new Set(recentLogs.map((l) => l.targetId));

  let thanked = 0;
  const summaryLines: string[] = [];

  for (const ticket of renewals) {
    if (alreadyThanked.has(ticket.userId)) continue;

    try {
      const memberName = `${ticket.user.firstname} ${ticket.user.lastname}`;
      const tenureMonths = Math.floor(
        (now.getTime() - new Date(ticket.user.createdAt).getTime()) / (30 * 86400000)
      );
      const totalVisits = ticket.user.attendanceLogs.length;

      const prompt = `Draft a personalized WhatsApp thank-you message for a gym member who just renewed:

Name: ${ticket.user.firstname}
Plan renewed: ${ticket.plan.name} (₹${ticket.plan.price})
Member since: ${tenureMonths} months
Recent attendance: ${totalVisits} visits in last 30 logged sessions

Write a warm, appreciative 2-sentence thank-you message. Reference their loyalty and fitness commitment. Return ONLY the message text.`;

      const { output, tokensUsed } = await runProactiveAgent({
        feature: "post_renewal",
        prompt,
      });

      if (!output || output.includes("budget exhausted")) {
        break;
      }

      // Send WhatsApp to member
      if (ticket.user.phone) {
        await sendWhatsApp({
          recipient: ticket.user.phone,
          templateName: "ai_post_renewal",
          variables: {
            name: ticket.user.firstname,
            message: output.slice(0, 500),
          },
        });
      }

      await prisma.aiProactiveLog.create({
        data: {
          feature: "post_renewal",
          targetType: "user",
          targetId: ticket.userId,
          channel: "whatsapp",
          content: output,
          tokensUsed,
          status: "sent",
        },
      });

      summaryLines.push(`${memberName} — renewed ${ticket.plan.name}`);
      thanked++;
    } catch (err) {
      console.error(`[AI Post-Renewal] Error for ticket ${ticket.id}:`, err);
      await prisma.aiProactiveLog.create({
        data: {
          feature: "post_renewal",
          targetType: "user",
          targetId: ticket.userId,
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

    const summaryMessage = `Thank-you messages sent to ${thanked} renewed member(s):\n${summaryLines.join("\n")}`;

    for (const admin of admins) {
      await prisma.inAppNotification.create({
        data: {
          workerId: admin.id,
          type: "post_renewal",
          title: `Post-Renewal: ${thanked} member(s) thanked`,
          message: summaryMessage.slice(0, 500),
          link: "/admin/renewals",
        },
      });
    }
  }

  return Response.json({ success: true, thanked });
}
