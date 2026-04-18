import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import { runProactiveAgent } from "@/lib/ai/proactive-runner";
import { requireCronSecret } from "@/lib/auth-cron";

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  const enabled = await getSetting("ai_daily_briefing_enabled", "true");
  if (enabled !== "true") {
    return Response.json({ success: true, skipped: true, reason: "AI briefing disabled (weekly uses same setting)" });
  }

  // Only run on Mondays
  const today = new Date();
  if (today.getDay() !== 1) {
    return Response.json({ success: true, skipped: true, reason: "Not Monday" });
  }

  today.setHours(0, 0, 0, 0);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const twoWeeksAgo = new Date(today);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  const [
    thisWeekRevenue,
    lastWeekRevenue,
    thisWeekNewMembers,
    lastWeekNewMembers,
    thisWeekAttendance,
    lastWeekAttendance,
    thisWeekEnquiries,
    thisWeekConversions,
    activeMembers,
    expiredThisWeek,
  ] = await Promise.all([
    prisma.payment.aggregate({
      _sum: { amount: true },
      where: { createdAt: { gte: weekAgo, lt: today } },
    }),
    prisma.payment.aggregate({
      _sum: { amount: true },
      where: { createdAt: { gte: twoWeeksAgo, lt: weekAgo } },
    }),
    prisma.user.count({
      where: { createdAt: { gte: weekAgo, lt: today } },
    }),
    prisma.user.count({
      where: { createdAt: { gte: twoWeeksAgo, lt: weekAgo } },
    }),
    prisma.attendanceLog.count({
      where: { checkIn: { gte: weekAgo, lt: today }, userId: { not: null } },
    }),
    prisma.attendanceLog.count({
      where: { checkIn: { gte: twoWeeksAgo, lt: weekAgo }, userId: { not: null } },
    }),
    prisma.enquiry.count({
      where: { createdAt: { gte: weekAgo, lt: today } },
    }),
    prisma.enquiry.count({
      where: {
        stage: "converted",
        updatedAt: { gte: weekAgo, lt: today },
      },
    }),
    prisma.memberTicket.count({
      where: { expireDate: { gte: today } },
    }),
    prisma.memberTicket.count({
      where: { expireDate: { gte: weekAgo, lt: today } },
    }),
  ]);

  const thisRevenue = Number(thisWeekRevenue._sum.amount ?? 0);
  const lastRevenue = Number(lastWeekRevenue._sum.amount ?? 0);
  const revenueChange = lastRevenue > 0
    ? Math.round(((thisRevenue - lastRevenue) / lastRevenue) * 100)
    : 0;

  const prompt = `## Weekly Business Summary (${weekAgo.toISOString().split("T")[0]} to ${today.toISOString().split("T")[0]})

### Revenue
- This week: ₹${thisRevenue.toLocaleString("en-IN")} (${revenueChange >= 0 ? "+" : ""}${revenueChange}% vs last week)
- Last week: ₹${lastRevenue.toLocaleString("en-IN")}

### Members
- New members: ${thisWeekNewMembers} (last week: ${lastWeekNewMembers})
- Active memberships: ${activeMembers}
- Expired this week: ${expiredThisWeek}

### Attendance
- Total check-ins: ${thisWeekAttendance} (last week: ${lastWeekAttendance})

### Enquiries
- New enquiries: ${thisWeekEnquiries}
- Conversions: ${thisWeekConversions}
- Conversion rate: ${thisWeekEnquiries > 0 ? Math.round((thisWeekConversions / thisWeekEnquiries) * 100) : 0}%

Generate a concise weekly summary for the gym owner. Highlight trends (up/down), call out anything concerning, and give ONE actionable recommendation for next week. Keep it under 250 words — this goes via WhatsApp.`;

  const { output, tokensUsed } = await runProactiveAgent({
    feature: "weekly_summary",
    prompt,
  });

  if (!output || output.includes("budget exhausted")) {
    return Response.json({ success: true, skipped: true, reason: output });
  }

  // Notify admin workers
  const admins = await prisma.worker.findMany({
    where: { role: "admin", isActive: true },
    select: { id: true },
  });

  for (const admin of admins) {
    await prisma.inAppNotification.create({
      data: {
        workerId: admin.id,
        type: "weekly_summary",
        title: "Weekly AI Summary",
        message: output.slice(0, 500),
        link: "/admin/in-app-notifications",
      },
    });

    await prisma.aiProactiveLog.create({
      data: {
        feature: "weekly_summary",
        targetType: "worker",
        targetId: admin.id,
        channel: "in_app",
        content: output,
        tokensUsed,
        status: "sent",
      },
    });
  }

  return Response.json({ success: true, adminsNotified: admins.length });
}
