"use server";

import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/auth-guard";
import { getSetting } from "@/lib/services/settings";

export async function getAiActivitySummary() {
  await requireWorker(["admin"]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [
    totalThisWeek,
    byFeature,
    byStatus,
    recentLogs,
    totalTokens,
  ] = await Promise.all([
    prisma.aiProactiveLog.count({
      where: { createdAt: { gte: weekAgo } },
    }),

    prisma.aiProactiveLog.groupBy({
      by: ["feature"],
      _count: true,
      where: { createdAt: { gte: weekAgo } },
    }),

    prisma.aiProactiveLog.groupBy({
      by: ["status"],
      _count: true,
      where: { createdAt: { gte: weekAgo } },
    }),

    prisma.aiProactiveLog.findMany({
      where: { createdAt: { gte: weekAgo } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        feature: true,
        targetType: true,
        targetId: true,
        channel: true,
        content: true,
        tokensUsed: true,
        status: true,
        error: true,
        createdAt: true,
      },
    }),

    prisma.aiProactiveLog.aggregate({
      _sum: { tokensUsed: true },
      where: { createdAt: { gte: weekAgo } },
    }),
  ]);

  return {
    totalThisWeek,
    byFeature: byFeature.map((f) => ({ feature: f.feature, count: f._count })),
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
    recentLogs,
    totalTokens: totalTokens._sum.tokensUsed ?? 0,
  };
}

export async function getAiSettings() {
  await requireWorker(["admin"]);

  const keys = [
    "ai_daily_briefing_enabled",
    "ai_churn_alerts_enabled",
    "ai_lead_followup_enabled",
    "ai_member_nudges_enabled",
    "ai_smart_renewal_enabled",
    "member_milestones_enabled",
    "ai_proactive_daily_budget",
    "ai_churn_inactive_days",
    "ai_lead_followup_gap_hours",
    "ai_lead_followup_max_per_run",
    "ai_member_nudge_inactive_days",
  ];

  const settings: Record<string, string> = {};
  for (const key of keys) {
    const defaults: Record<string, string> = {
      ai_daily_briefing_enabled: "true",
      ai_churn_alerts_enabled: "true",
      ai_lead_followup_enabled: "true",
      ai_member_nudges_enabled: "true",
      ai_smart_renewal_enabled: "false",
      member_milestones_enabled: "true",
      ai_proactive_daily_budget: "30",
      ai_churn_inactive_days: "7",
      ai_lead_followup_gap_hours: "48",
      ai_lead_followup_max_per_run: "10",
      ai_member_nudge_inactive_days: "5",
    };
    settings[key] = await getSetting(key, defaults[key] ?? "");
  }

  return settings;
}

export async function updateAiSetting(key: string, value: string) {
  await requireWorker(["admin"]);

  // Only allow AI-related settings
  if (!key.startsWith("ai_") && !key.startsWith("member_milestones")) {
    return { success: false, error: "Invalid setting key" };
  }

  await prisma.gymSettings.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });

  return { success: true };
}
