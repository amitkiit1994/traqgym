import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import { runProactiveAgent } from "@/lib/ai/proactive-runner";
import { requireCronSecret } from "@/lib/auth-cron";

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  const enabled = await getSetting("ai_revenue_anomaly_enabled", "false");
  if (enabled !== "true") {
    return Response.json({ success: true, skipped: true, reason: "Revenue anomaly detection disabled" });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Dedup: no revenue_anomaly log for today already
  const existingLog = await prisma.aiProactiveLog.findFirst({
    where: {
      feature: "revenue_anomaly",
      createdAt: { gte: today },
    },
  });

  if (existingLog) {
    return Response.json({ success: true, skipped: true, reason: "Already checked today" });
  }

  // 1. Get today's total revenue
  const todayPayments = await prisma.payment.aggregate({
    where: { createdAt: { gte: today, lt: tomorrow } },
    _sum: { amount: true },
  });
  const todayRevenue = Number(todayPayments._sum.amount ?? 0);

  // 2. Get same-weekday average over last 4 weeks
  const dayOfWeek = today.getDay(); // 0=Sunday
  const sameWeekdayTotals: number[] = [];

  for (let w = 1; w <= 4; w++) {
    const pastDate = new Date(today);
    pastDate.setDate(pastDate.getDate() - 7 * w);
    const pastNext = new Date(pastDate);
    pastNext.setDate(pastNext.getDate() + 1);

    const pastPayments = await prisma.payment.aggregate({
      where: { createdAt: { gte: pastDate, lt: pastNext } },
      _sum: { amount: true },
    });
    sameWeekdayTotals.push(Number(pastPayments._sum.amount ?? 0));
  }

  const weekdayAverage =
    sameWeekdayTotals.length > 0
      ? sameWeekdayTotals.reduce((a, b) => a + b, 0) / sameWeekdayTotals.length
      : 0;

  // 3. Check if today < 50% of average AND average > 0
  if (weekdayAverage <= 0 || todayRevenue >= weekdayAverage * 0.5) {
    return Response.json({
      success: true,
      todayRevenue,
      weekdayAverage: Math.round(weekdayAverage),
      anomaly: false,
    });
  }

  // 4. Use AI to generate narrative
  const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayOfWeek];
  const pctDrop = Math.round((1 - todayRevenue / weekdayAverage) * 100);

  const prompt = `Revenue anomaly detected today.

Today's revenue: ₹${Math.round(todayRevenue)}
Average ${dayName} revenue (last 4 weeks): ₹${Math.round(weekdayAverage)}
Drop: ${pctDrop}%

Past 4 ${dayName}s revenue: ${sameWeekdayTotals.map((v) => `₹${Math.round(v)}`).join(", ")}

Write a brief 2-3 sentence alert for the gym owner explaining this revenue dip. Mention possible reasons (fewer renewals, lower footfall, holiday, etc.). Keep it concise — this goes into an in-app notification.`;

  const { output, tokensUsed } = await runProactiveAgent({
    feature: "revenue_anomaly",
    prompt,
  });

  if (!output || output.includes("budget exhausted")) {
    return Response.json({ success: true, skipped: true, reason: output });
  }

  // 5. Notify all admins
  const admins = await prisma.worker.findMany({
    where: { role: "admin", isActive: true },
    select: { id: true },
  });

  for (const admin of admins) {
    await prisma.inAppNotification.create({
      data: {
        workerId: admin.id,
        type: "revenue_anomaly",
        title: `Revenue Alert: ${pctDrop}% below average today`,
        message: output.slice(0, 500),
        link: "/admin/reports",
      },
    });
  }

  // 6. Log to AiProactiveLog
  await prisma.aiProactiveLog.create({
    data: {
      feature: "revenue_anomaly",
      targetType: "worker",
      targetId: admins[0]?.id ?? 0,
      channel: "in_app",
      content: output,
      tokensUsed,
      status: "sent",
    },
  });

  return Response.json({
    success: true,
    todayRevenue,
    weekdayAverage: Math.round(weekdayAverage),
    pctDrop,
    adminsNotified: admins.length,
  });
}
