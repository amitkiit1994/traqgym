"use server";

import { prisma } from "@/lib/prisma";
import { dispatch, markSent, markFailed } from "@/lib/services/notification";
import { send as sendWhatsApp } from "@/lib/channels/whatsapp";
import { send as sendSMS } from "@/lib/channels/sms";
import { getSetting } from "@/lib/services/settings";
import { requireWorker } from "@/lib/auth-guard";
import { bulkNotifySchema, zodErrors } from "@/lib/validations";

export async function getSegmentMembers(segment: string) {
  try { await requireWorker(); } catch { return []; }
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const sevenDaysFromNow = new Date(now);
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

  switch (segment) {
    case "all_active": {
      const users = await prisma.user.findMany({
        where: {
          memberTickets: { some: { expireDate: { gte: now } } },
        },
        select: { id: true, firstname: true, lastname: true, phone: true },
      });
      return users;
    }

    case "expiring_7d": {
      const users = await prisma.user.findMany({
        where: {
          memberTickets: {
            some: { expireDate: { gte: now, lte: sevenDaysFromNow } },
          },
        },
        select: { id: true, firstname: true, lastname: true, phone: true },
      });
      return users;
    }

    case "expired": {
      const users = await prisma.user.findMany({
        where: {
          memberTickets: { some: {} },
          NOT: { memberTickets: { some: { expireDate: { gte: now } } } },
        },
        select: { id: true, firstname: true, lastname: true, phone: true },
      });
      return users;
    }

    default:
      return [];
  }
}

export async function sendBulkNotification(
  segment: string,
  templateName: string,
  customMessage?: string
) {
  try { await requireWorker(); } catch { return { error: "Unauthorized", total: 0, sent: 0, failed: 0, skipped: 0 }; }
  const parsed = bulkNotifySchema.safeParse({ segment, templateName, customMessage });
  if (!parsed.success) return { error: Object.values(zodErrors(parsed.error))[0], total: 0, sent: 0, failed: 0, skipped: 0 };

  const channel = await getSetting("notification_channel", "whatsapp");
  const members = await getSegmentMembers(segment);
  const withPhone = members.filter((m) => m.phone);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const member of withPhone) {
    try {
      const notifResult = await dispatch({
        userId: member.id,
        templateName,
        channel,
        recipient: member.phone!,
        deliveryDate: today,
      });

      if (notifResult.skipped) { skipped++; continue; }

      const vars = {
        memberName: `${member.firstname} ${member.lastname}`,
        customMessage: customMessage || "",
      };

      let success = false;
      if (channel === "whatsapp" || channel === "both") {
        const r = await sendWhatsApp({ recipient: member.phone!, templateName, variables: vars });
        success = r.success;
      }
      if (channel === "sms" || channel === "both") {
        const r = await sendSMS({ recipient: member.phone!, templateName, variables: vars });
        if (!success) success = r.success;
      }

      if (success) {
        await markSent(notifResult.id);
        sent++;
      } else {
        await markFailed(notifResult.id, "Send failed");
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return { total: withPhone.length, sent, failed, skipped };
}

// ── Send to specific members ──
export async function sendTargetedNotification(
  userIds: number[],
  templateName: string,
  customMessage?: string
) {
  try { await requireWorker(); } catch { return { error: "Unauthorized", total: 0, sent: 0, failed: 0, skipped: 0 }; }
  if (!userIds.length) return { error: "No members selected", total: 0, sent: 0, failed: 0, skipped: 0 };
  if (!templateName.trim()) return { error: "Template is required", total: 0, sent: 0, failed: 0, skipped: 0 };

  const channel = await getSetting("notification_channel", "whatsapp");
  const members = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, firstname: true, lastname: true, phone: true },
  });
  const withPhone = members.filter((m) => m.phone);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const member of withPhone) {
    try {
      const notifResult = await dispatch({
        userId: member.id,
        templateName,
        channel,
        recipient: member.phone!,
        deliveryDate: today,
      });

      if (notifResult.skipped) { skipped++; continue; }

      const vars = {
        memberName: `${member.firstname} ${member.lastname}`,
        customMessage: customMessage || "",
      };

      let success = false;
      if (channel === "whatsapp" || channel === "both") {
        const r = await sendWhatsApp({ recipient: member.phone!, templateName, variables: vars });
        success = r.success;
      }
      if (channel === "sms" || channel === "both") {
        const r = await sendSMS({ recipient: member.phone!, templateName, variables: vars });
        if (!success) success = r.success;
      }

      if (success) {
        await markSent(notifResult.id);
        sent++;
      } else {
        await markFailed(notifResult.id, "Send failed");
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return { total: withPhone.length, sent, failed, skipped };
}
