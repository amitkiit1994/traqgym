import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import { runProactiveAgent } from "@/lib/ai/proactive-runner";
import { send as sendWhatsApp } from "@/lib/channels/whatsapp";

export async function GET(request: Request) {
  const secret = request.headers.get("x-cron-secret") || new URL(request.url).searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET && process.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const enabled = await getSetting("ai_payment_reminder_enabled", "false");
  if (enabled !== "true") {
    return Response.json({ success: true, skipped: true, reason: "AI payment reminder disabled" });
  }

  // IST now
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);

  // 3 days ago threshold for fallback when dueDate is null
  const threeDaysAgo = new Date(now.getTime() - 3 * 86400000);

  // Find active tickets with outstanding balance where payment is overdue
  const overdueTickets = await prisma.memberTicket.findMany({
    where: {
      status: "active",
      balanceDue: { gt: 0 },
      OR: [
        // dueDate is past
        { dueDate: { lt: now } },
        // dueDate is null but ticket was created more than 3 days ago
        { dueDate: null, createdAt: { lt: threeDaysAgo } },
      ],
    },
    include: {
      user: { select: { id: true, firstname: true, lastname: true, phone: true } },
      plan: { select: { name: true, price: true } },
    },
    take: 10,
    orderBy: { balanceDue: "desc" },
  });

  if (overdueTickets.length === 0) {
    return Response.json({ success: true, reminded: 0, reason: "No overdue payments found" });
  }

  let reminded = 0;
  const summaryLines: string[] = [];

  for (const ticket of overdueTickets) {
    try {
      const memberName = `${ticket.user.firstname} ${ticket.user.lastname}`;
      const balance = Number(ticket.balanceDue);

      const prompt = `Draft a personalized WhatsApp payment reminder for a gym member:

Name: ${ticket.user.firstname}
Plan: ${ticket.plan.name} (₹${ticket.plan.price})
Outstanding Balance: ₹${balance}
Due Date: ${ticket.dueDate ? ticket.dueDate.toISOString().split("T")[0] : "Overdue"}

Write a polite, friendly 2-sentence message reminding them about the pending payment. Be warm, not aggressive. Return ONLY the message text.`;

      const { output, tokensUsed } = await runProactiveAgent({
        feature: "payment_reminder",
        prompt,
      });

      if (!output || output.includes("budget exhausted")) {
        break; // Budget exhausted, stop processing
      }

      // Send WhatsApp to member
      if (ticket.user.phone) {
        await sendWhatsApp({
          recipient: ticket.user.phone,
          templateName: "ai_payment_reminder",
          variables: {
            name: ticket.user.firstname,
            message: output.slice(0, 500),
          },
        });
      }

      // Log AI action
      await prisma.aiProactiveLog.create({
        data: {
          feature: "payment_reminder",
          targetType: "user",
          targetId: ticket.userId,
          channel: "whatsapp",
          content: output,
          tokensUsed,
          status: "sent",
        },
      });

      summaryLines.push(`${memberName} — ₹${balance} due (${ticket.plan.name})`);
      reminded++;
    } catch (err) {
      console.error(`[AI Payment Reminder] Error for ticket ${ticket.id}:`, err);
      await prisma.aiProactiveLog.create({
        data: {
          feature: "payment_reminder",
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

  // Notify admins with summary
  if (summaryLines.length > 0) {
    const admins = await prisma.worker.findMany({
      where: { role: "admin", isActive: true },
      select: { id: true },
    });

    const summaryMessage = `Payment reminders sent to ${reminded} member(s):\n${summaryLines.join("\n")}`;

    for (const admin of admins) {
      await prisma.inAppNotification.create({
        data: {
          workerId: admin.id,
          type: "payment_reminder",
          title: `Payment Reminder: ${reminded} member(s) reminded`,
          message: summaryMessage.slice(0, 500),
          link: "/admin/balance-due",
        },
      });
    }
  }

  return Response.json({ success: true, reminded });
}
