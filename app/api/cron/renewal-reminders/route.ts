import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { dispatch, markSent, markFailed } from "@/lib/services/notification";
import { send as sendWhatsApp } from "@/lib/channels/whatsapp";
import { send as sendSMS } from "@/lib/channels/sms";
import { getSetting } from "@/lib/services/settings";
import { requireCronSecret } from "@/lib/auth-cron";
import { istCalendarFor, istDayBoundsUtc } from "@/lib/utils/date-ist";
import { createProposal, isAutonomyEnabled } from "@/lib/services/action-loop";
import { inr } from "@/lib/agents/_helpers";

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  const enabled = await getSetting("cron_renewal_reminders_enabled", "true");
  if (enabled !== "true") {
    return Response.json({ success: true, skipped: true, reason: "Cron disabled in settings" });
  }

  // Earned Autonomy cutover: this cron is the spec's canonical "unearned
  // autonomy" — it direct-sends to members with no approval history. When
  // the action loop is ON, its renewal sends are CAPTURED: each becomes an
  // auto_executed ActionProposal routed through the message-only executor,
  // so it shows up in the register ("Done (auto)") and gets outcome-measured
  // like everything else. The duplicate raw direct send is disabled.
  // Priority goes to the verify loop: if renewal-cliff already proposed for
  // a member (it runs earlier and covers the full 7-day window), the dedupe
  // inside createProposal suppresses the legacy auto-send — the owner's
  // pending decision owns that member. Birthday greetings are NOT renewal
  // reminders and are untouched. When the loop is OFF, nothing changes.
  const autonomyOn = await isAutonomyEnabled();

  // Anchor "today" to the IST calendar day. MemberTicket.expireDate is stored as
  // IST midnight (which is 18:30 UTC of the prior day), so all date-window math
  // must be IST-aligned to avoid off-by-hours errors at the IST-midnight boundary.
  const now = new Date();
  const istToday = istCalendarFor(now);
  // `today` represents IST midnight as a UTC instant — used for delivery timestamps
  // and for tenure math (subtracting createdAt).
  const { startUtc: today } = istDayBoundsUtc(istToday);
  // Probe Date for IST weekday/month/day extraction.
  const istTodayProbe = new Date(Date.UTC(istToday.year, istToday.month, istToday.day));

  const channel = await getSetting("notification_channel", "whatsapp");
  const renewalEnabled = await getSetting("renewal_reminder_enabled", "true") === "true";

  let sent = 0;
  let skipped = 0;

  // ── Renewal Reminders ──
  if (renewalEnabled) {
    const reminderDaysSetting = await getSetting("renewal_reminder_days", "7,3,1");
    const reminderDays = reminderDaysSetting.split(",").map(d => parseInt(d.trim(), 10)).filter(n => !isNaN(n));

    for (const daysAhead of reminderDays) {
      // Compute the IST day "daysAhead" days from today, then derive its UTC bounds.
      const { startUtc: targetDate, endUtc: targetEnd } = istDayBoundsUtc({
        year: istToday.year,
        month: istToday.month,
        day: istToday.day + daysAhead,
      });

      const expiringTickets = await prisma.memberTicket.findMany({
        where: {
          expireDate: {
            gte: targetDate,
            lt: targetEnd,
          },
        },
        include: {
          user: { select: { id: true, firstname: true, lastname: true, phone: true } },
          plan: { select: { name: true, price: true } },
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

        // Render expiryDate in IST (targetDate is IST midnight as a UTC instant —
        // calling .toISOString() directly would yield the prior UTC day).
        const expiryIst = istCalendarFor(targetDate);
        const expiryDateStr = `${expiryIst.year}-${String(expiryIst.month + 1).padStart(2, "0")}-${String(expiryIst.day).padStart(2, "0")}`;
        const memberName = `${ticket.user.firstname} ${ticket.user.lastname}`.trim();

        // ── Legacy autonomy captured ───────────────────────────────────────
        // Route the send through the executor as an auto_executed proposal:
        // visible in the register, outcome-measured, NotificationLog-deduped
        // by the executor itself. If renewal-cliff already has a live
        // proposal for this member, createProposal skips and the verify
        // loop owns the member (no unearned send, no duplicate).
        if (autonomyOn) {
          const value = Number(ticket.totalAmount ?? ticket.plan.price ?? 0);
          const draft =
            `Hi ${ticket.user.firstname}, your ${ticket.plan.name} membership ` +
            `expires on ${expiryDateStr}` +
            `${daysAhead === 0 ? " (today)" : daysAhead === 1 ? " (tomorrow)" : ""}. ` +
            `Renew at the front desk or reply here to keep your access uninterrupted.`;
          const proposal = await createProposal(
            {
              actionType: "renewal_reminder",
              sourceAgent: "renewal_reminders_cron",
              targetUserId: ticket.userId,
              title: `Renewal reminder — ${memberName} (D-${daysAhead})`,
              instruction:
                `Deterministic ${daysAhead}-day renewal reminder for ${memberName} ` +
                `(${ticket.plan.name}, expires ${expiryDateStr}). ` +
                `Projected save: ${inr(value)}.\n\n"${draft}"`,
              params: {
                templateName,
                variables: {
                  name: memberName,
                  plan: ticket.plan.name,
                  expiryDate: expiryDateStr,
                },
                messageText: draft,
              },
              likelihood: 0.7,
              projectedImpactInr: Math.round(value),
              clockspeedDays: 7,
              gymContext: {
                ticketId: ticket.id,
                planName: ticket.plan.name,
                expireDate: expiryDateStr,
                daysAhead,
                legacyCapture: true,
              },
            },
            { forceAuto: true }
          );
          if (proposal.success && !proposal.skipped && proposal.autoExecuted) {
            sent++;
          } else {
            skipped++;
          }
          continue;
        }

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
            name: memberName,
            plan: ticket.plan.name,
            expiryDate: expiryDateStr,
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
    // Compare against IST month/day (not UTC, since `today` is IST-midnight in UTC).
    const todayMonth = istTodayProbe.getUTCMonth();
    const todayDay = istTodayProbe.getUTCDate();
    const birthdayUsers = birthdayMembers.filter((u) => {
      const bd = new Date(u.birthdate!);
      // Birthdates are stored as date-only; read in UTC to avoid local-tz drift.
      return bd.getUTCMonth() === todayMonth && bd.getUTCDate() === todayDay;
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
  // All three Smart AI Renewal sections below are additional renewal_reminder
  // direct sends — when the action loop is ON they are disabled (cutover):
  // renewal_reminder drafting + sending is owned by the register
  // (renewal-cliff proposals + the captured deterministic path above).
  let aiRenewal7daySent = 0;
  const aiSmart7dayEnabled = !autonomyOn && (await getSetting("ai_smart_renewal_7day_enabled", "false")) === "true";
  if (aiSmart7dayEnabled) {
    try {
      const { runProactiveAgent } = await import("@/lib/ai/proactive-runner");

      const { startUtc: target7day, endUtc: target7dayEnd } = istDayBoundsUtc({
        year: istToday.year,
        month: istToday.month,
        day: istToday.day + 7,
      });

      const expiring7day = await prisma.memberTicket.findMany({
        where: {
          expireDate: {
            gte: target7day,
            lt: target7dayEnd,
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
  const aiSmart3dayEnabled = !autonomyOn && (await getSetting("ai_smart_renewal_3day_enabled", "false")) === "true";
  if (aiSmart3dayEnabled) {
    try {
      const { runProactiveAgent } = await import("@/lib/ai/proactive-runner");

      const { startUtc: target3day, endUtc: target3dayEnd } = istDayBoundsUtc({
        year: istToday.year,
        month: istToday.month,
        day: istToday.day + 3,
      });

      const expiring3day = await prisma.memberTicket.findMany({
        where: {
          expireDate: {
            gte: target3day,
            lt: target3dayEnd,
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
  const aiSmartEnabled = !autonomyOn && (await getSetting("ai_smart_renewal_enabled", "false")) === "true";
  if (aiSmartEnabled) {
    try {
      const { runProactiveAgent } = await import("@/lib/ai/proactive-runner");

      // Members expiring today (IST) who have a phone number
      const { startUtc: todayStart, endUtc: todayEnd } = istDayBoundsUtc(istToday);
      const expiringToday = await prisma.memberTicket.findMany({
        where: {
          expireDate: {
            gte: todayStart,
            lt: todayEnd,
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

  return Response.json({
    success: true,
    sent,
    skipped,
    birthdaySent,
    aiRenewal7daySent,
    aiRenewal3daySent,
    aiRenewalSent,
    mode: autonomyOn
      ? "legacy captured — renewal sends routed through the action register as auto_executed proposals"
      : "legacy direct send",
  });
}
