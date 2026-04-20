import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dispatch, markSent, markFailed } from "@/lib/services/notification";
import { send as sendWhatsApp } from "@/lib/channels/whatsapp";
import { send as sendSMS } from "@/lib/channels/sms";
import { getSetting } from "@/lib/services/settings";
import { requireCronSecret } from "@/lib/auth-cron";

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  const enabled = await getSetting("cron_re_engagement_enabled", "true");
  if (enabled !== "true") {
    return NextResponse.json({ success: true, skipped: true, reason: "Cron disabled in settings" });
  }

  const channel = await getSetting("notification_channel", "whatsapp");
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const intervals = [7, 14, 30];
  let totalSent = 0;
  let totalSkipped = 0;

  for (const days of intervals) {
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() - days);

    const expiredMembers = await prisma.user.findMany({
      where: {
        memberTickets: {
          some: { expireDate: targetDate },
          none: { expireDate: { gt: targetDate } },
        },
      },
      select: { id: true, firstname: true, lastname: true, phone: true },
    });

    for (const member of expiredMembers) {
      if (!member.phone) continue;

      const templateName = `re_engagement_${days}d`;
      const result = await dispatch({
        userId: member.id,
        templateName,
        channel,
        recipient: member.phone,
        deliveryDate: today,
      });

      if (result.skipped) { totalSkipped++; continue; }

      try {
        const vars = {
          memberName: `${member.firstname} ${member.lastname}`,
          daysSinceExpiry: String(days),
        };
        if (channel === "whatsapp" || channel === "both") {
          await sendWhatsApp({ recipient: member.phone, templateName, variables: vars });
        }
        if (channel === "sms" || channel === "both") {
          await sendSMS({ recipient: member.phone, templateName, variables: vars });
        }
        await markSent(result.id);
        totalSent++;
      } catch (err) {
        await markFailed(result.id, err instanceof Error ? err.message : "Send failed");
      }
    }
  }

  return NextResponse.json({ sent: totalSent, skipped: totalSkipped });
}
