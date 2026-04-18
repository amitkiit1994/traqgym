import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { dispatch, markSent, markFailed } from "@/lib/services/notification";
import { send as sendWhatsApp } from "@/lib/channels/whatsapp";
import { send as sendSMS } from "@/lib/channels/sms";
import { getSetting } from "@/lib/services/settings";
import { requireCronSecret } from "@/lib/auth-cron";

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  const enabled = await getSetting("cron_renewal_reminders_enabled", "true");
  if (enabled !== "true") {
    return Response.json({ success: true, skipped: true, reason: "Cron disabled in settings" });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const channel = await getSetting("notification_channel", "whatsapp");
  const renewalEnabled = await getSetting("renewal_reminder_enabled", "true") === "true";

  let sent = 0;
  let skipped = 0;

  // ── Renewal Reminders ──
  if (renewalEnabled) {
    const reminderDaysSetting = await getSetting("renewal_reminder_days", "7,3,1");
    const reminderDays = reminderDaysSetting.split(",").map(d => parseInt(d.trim(), 10)).filter(n => !isNaN(n));

    for (const daysAhead of reminderDays) {
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + daysAhead);

      const expiringTickets = await prisma.memberTicket.findMany({
        where: {
          expireDate: {
            gte: targetDate,
            lt: new Date(targetDate.getTime() + 86400000),
          },
        },
        include: {
          user: { select: { id: true, firstname: true, lastname: true, phone: true } },
          plan: { select: { name: true } },
        },
      });

      const seenUsers = new Set<number>();

      for (const ticket of expiringTickets) {
        if (seenUsers.has(ticket.userId)) continue;
        seenUsers.add(ticket.userId);

        const templateName =
          daysAhead === 0
            ? "renewal_expiry_today"
            : daysAhead === 1
              ? "renewal_expiry_1day"
              : "renewal_expiry_3days";

        const result = await dispatch({
          userId: ticket.userId,
          templateName,
          channel,
          recipient: ticket.user.phone ?? undefined,
          deliveryDate: today,
        });

        if (result.skipped) { skipped++; continue; }

        try {
          const phone = ticket.user.phone ?? "unknown";
          const vars = {
            name: `${ticket.user.firstname} ${ticket.user.lastname}`,
            plan: ticket.plan.name,
            expiryDate: targetDate.toISOString().split("T")[0],
          };
          if (channel === "whatsapp" || channel === "both") {
            await sendWhatsApp({ recipient: phone, templateName, variables: vars });
          }
          if (channel === "sms" || channel === "both") {
            await sendSMS({ recipient: phone, templateName, variables: vars });
          }
          await markSent(result.id);
          sent++;
        } catch (err) {
          await markFailed(result.id, err instanceof Error ? err.message : "Unknown error");
        }
      }
    }
  }

  // ── Birthday Greetings ──
  const birthdayEnabled = await getSetting("birthday_wish_enabled", "true") === "true";
  let birthdaySent = 0;
  if (birthdayEnabled) {
    const birthdayMembers = await prisma.user.findMany({
      where: { birthdate: { not: null } },
      select: { id: true, firstname: true, lastname: true, phone: true, birthdate: true },
    });
    const todayMonth = today.getMonth();
    const todayDay = today.getDate();
    const birthdayUsers = birthdayMembers.filter((u) => {
      const bd = new Date(u.birthdate!);
      return bd.getMonth() === todayMonth && bd.getDate() === todayDay;
    });

    for (const user of birthdayUsers) {
      if (!user.phone) continue;
      const result = await dispatch({
        userId: user.id,
        templateName: "birthday_greeting",
        channel,
        recipient: user.phone,
        deliveryDate: today,
      });

      if (!result.skipped) {
        try {
          const vars = { name: `${user.firstname} ${user.lastname}` };
          if (channel === "whatsapp" || channel === "both") {
            await sendWhatsApp({ recipient: user.phone, templateName: "birthday_greeting", variables: vars });
          }
          if (channel === "sms" || channel === "both") {
            await sendSMS({ recipient: user.phone, templateName: "birthday_greeting", variables: vars });
          }
          await markSent(result.id);
          birthdaySent++;
        } catch (err) {
          await markFailed(result.id, err instanceof Error ? err.message : "Unknown error");
        }
      }
    }
  }

  // ── Smart AI Renewal: 7-day window ──
  let aiRenewal7daySent = 0;
  const aiSmart7dayEnabled = await getSetting("ai_smart_renewal_7day_enabled", "false") === "true";
  if (aiSmart7dayEnabled) {
    try {
      const { runProactiveAgent } = await import("@/lib/ai/proactive-runner");

      const target7day = new Date(today);
      target7day.setDate(target7day.getDate() + 7);

      const expiring7day = await prisma.memberTicket.findMany({
        where: {
          expireDate: {
            gte: target7day,
            lt: new Date(target7day.getTime() + 86400000),
          },
        },
        include: {
          user: {
            select: {
              id: true,
              firstname: true,
              lastname: true,
              phone: true,
              createdAt: true,
              attendanceLogs: {
                orderBy: { checkIn: "desc" },
                take: 30,
                select: { checkIn: true },
              },
            },
          },
          plan: { select: { name: true, price: true } },
        },
        take: 10,
      });

      for (const ticket of expiring7day) {
        if (!ticket.user.phone) continue;

        const tenureMonths = Math.floor(
          (today.getTime() - new Date(ticket.user.createdAt).getTime()) / (30 * 86400000)
        );
        const recentVisits = ticket.user.attendanceLogs.length;

        const prompt = `Draft a personalized WhatsApp renewal reminder for a gym member whose membership expires in 7 days:

Name: ${ticket.user.firstname}
Plan: ${ticket.plan.name} (₹${ticket.plan.price})
Expires in: 7 days
Member tenure: ${tenureMonths} months
Recent attendance: ${recentVisits} visits in last 30 logged sessions

Write a warm, personal 2-sentence early reminder encouraging renewal. Reference their fitness journey and consistency. Return ONLY the message text.`;

        const { output, tokensUsed } = await runProactiveAgent({
          feature: "smart_renewal_7day",
          prompt,
        });

        if (output && !output.includes("budget exhausted")) {
          try {
            await sendWhatsApp({
              recipient: ticket.user.phone,
              templateName: "ai_smart_renewal",
              variables: {
                name: ticket.user.firstname,
                message: output.slice(0, 500),
              },
            });

            await prisma.aiProactiveLog.create({
              data: {
                feature: "smart_renewal_7day",
                targetType: "user",
                targetId: ticket.userId,
                channel: "whatsapp",
                content: output,
                tokensUsed,
                status: "sent",
              },
            });

            aiRenewal7daySent++;
          } catch {
            // Non-critical
          }
        }
      }
    } catch {
      // AI runner not available
    }
  }

  // ── Smart AI Renewal: 3-day window ──
  let aiRenewal3daySent = 0;
  const aiSmart3dayEnabled = await getSetting("ai_smart_renewal_3day_enabled", "false") === "true";
  if (aiSmart3dayEnabled) {
    try {
      const { runProactiveAgent } = await import("@/lib/ai/proactive-runner");

      const target3day = new Date(today);
      target3day.setDate(target3day.getDate() + 3);

      const expiring3day = await prisma.memberTicket.findMany({
        where: {
          expireDate: {
            gte: target3day,
            lt: new Date(target3day.getTime() + 86400000),
          },
        },
        include: {
          user: {
            select: {
              id: true,
              firstname: true,
              lastname: true,
              phone: true,
              createdAt: true,
              attendanceLogs: {
                orderBy: { checkIn: "desc" },
                take: 30,
                select: { checkIn: true },
              },
            },
          },
          plan: { select: { name: true, price: true } },
        },
        take: 10,
      });

      for (const ticket of expiring3day) {
        if (!ticket.user.phone) continue;

        const tenureMonths = Math.floor(
          (today.getTime() - new Date(ticket.user.createdAt).getTime()) / (30 * 86400000)
        );
        const recentVisits = ticket.user.attendanceLogs.length;

        const prompt = `Draft a personalized WhatsApp renewal reminder for a gym member whose membership expires in 3 days:

Name: ${ticket.user.firstname}
Plan: ${ticket.plan.name} (₹${ticket.plan.price})
Expires in: 3 days
Member tenure: ${tenureMonths} months
Recent attendance: ${recentVisits} visits in last 30 logged sessions

Write a warm but slightly urgent 2-sentence reminder encouraging renewal. Mention the approaching deadline. Return ONLY the message text.`;

        const { output, tokensUsed } = await runProactiveAgent({
          feature: "smart_renewal_3day",
          prompt,
        });

        if (output && !output.includes("budget exhausted")) {
          try {
            await sendWhatsApp({
              recipient: ticket.user.phone,
              templateName: "ai_smart_renewal",
              variables: {
                name: ticket.user.firstname,
                message: output.slice(0, 500),
              },
            });

            await prisma.aiProactiveLog.create({
              data: {
                feature: "smart_renewal_3day",
                targetType: "user",
                targetId: ticket.userId,
                channel: "whatsapp",
                content: output,
                tokensUsed,
                status: "sent",
              },
            });

            aiRenewal3daySent++;
          } catch {
            // Non-critical
          }
        }
      }
    } catch {
      // AI runner not available
    }
  }

  // ── Smart AI Renewal (personalized message for expiring-today members) ──
  let aiRenewalSent = 0;
  const aiSmartEnabled = await getSetting("ai_smart_renewal_enabled", "false") === "true";
  if (aiSmartEnabled) {
    try {
      const { runProactiveAgent } = await import("@/lib/ai/proactive-runner");

      // Members expiring today who have a phone number
      const expiringToday = await prisma.memberTicket.findMany({
        where: {
          expireDate: {
            gte: today,
            lt: new Date(today.getTime() + 86400000),
          },
        },
        include: {
          user: {
            select: {
              id: true,
              firstname: true,
              lastname: true,
              phone: true,
              attendanceLogs: {
                orderBy: { checkIn: "desc" },
                take: 1,
                select: { checkIn: true },
              },
            },
          },
          plan: { select: { name: true, price: true } },
        },
        take: 10,
      });

      for (const ticket of expiringToday) {
        if (!ticket.user.phone) continue;

        const lastVisit = ticket.user.attendanceLogs[0]?.checkIn;
        const prompt = `Draft a personalized WhatsApp renewal reminder for a gym member:

Name: ${ticket.user.firstname}
Plan: ${ticket.plan.name} (₹${ticket.plan.price})
Expires: Today
Last visit: ${lastVisit ? lastVisit.toISOString().split("T")[0] : "Unknown"}

Write a warm, personal 2-sentence message encouraging renewal. Reference their fitness journey. Return ONLY the message text.`;

        const { output, tokensUsed } = await runProactiveAgent({
          feature: "smart_renewal",
          prompt,
        });

        if (output && !output.includes("budget exhausted")) {
          try {
            await sendWhatsApp({
              recipient: ticket.user.phone,
              templateName: "ai_smart_renewal",
              variables: {
                name: ticket.user.firstname,
                message: output.slice(0, 500),
              },
            });

            await prisma.aiProactiveLog.create({
              data: {
                feature: "smart_renewal",
                targetType: "user",
                targetId: ticket.userId,
                channel: "whatsapp",
                content: output,
                tokensUsed,
                status: "sent",
              },
            });

            aiRenewalSent++;
          } catch {
            // Non-critical — template already sent
          }
        }
      }
    } catch {
      // AI runner not available — continue without
    }
  }

  return Response.json({ success: true, sent, skipped, birthdaySent, aiRenewal7daySent, aiRenewal3daySent, aiRenewalSent });
}
