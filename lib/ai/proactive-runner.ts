import { Agent, run } from "@openai/agents";
import { allTools } from "./agent";
import { buildProactivePrompt } from "./proactive-prompt";
import { runInAiContext } from "@/lib/ai-context";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";

// Read-only tools the proactive agent can use freely
const ALLOWED_READ_TOOLS = new Set([
  "get_dashboard_summary",
  "get_morning_briefing",
  "get_end_of_day_summary",
  "get_followup_queue",
  "get_member_health_check",
  "get_period_comparison",
  "get_plan_performance",
  "get_members",
  "get_member_by_id",
  "search_member",
  "get_attendance_summary",
  "get_attendance_list",
  "get_enquiries",
  "get_enquiry_by_id",
  "get_enquiry_followups",
  "get_revenue_summary",
  "get_collection_report",
  "get_expiring_memberships",
  "get_irregular_members",
  "get_pt_report",
  "get_lead_pipeline",
  "get_class_schedule",
  "get_attendance_patterns",
  "suggest_schedule",
  "get_notification_logs",
  "get_notification_analytics",
  "get_overdue_payments",
  "get_payment_followups",
  "get_birthdays_today",
  "get_anniversaries",
  "get_gym_targets",
]);

// Write tools allowed in proactive mode (notification only)
const ALLOWED_WRITE_TOOLS = new Set([
  "send_bulk_notification",
  "send_targeted_notification",
]);

export async function runProactiveAgent(params: {
  feature: string;
  prompt: string;
  allowedToolNames?: string[];
}): Promise<{ output: string; tokensUsed: number }> {
  // Check daily budget
  const budgetStr = await getSetting("ai_proactive_daily_budget", "30");
  const budget = parseInt(budgetStr, 10);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayCount = await prisma.aiProactiveLog.count({
    where: {
      createdAt: { gte: todayStart },
      status: { in: ["sent", "failed"] },
    },
  });

  if (todayCount >= budget) {
    return {
      output: `Daily AI proactive budget exhausted (${budget} calls/day).`,
      tokensUsed: 0,
    };
  }

  // Filter tools
  const allowedNames = params.allowedToolNames
    ? new Set(params.allowedToolNames)
    : new Set([...ALLOWED_READ_TOOLS, ...ALLOWED_WRITE_TOOLS]);

  const tools = allTools.filter((t) => allowedNames.has(t.name));

  // Get gym context
  const location = await prisma.location.findFirst({ where: { isActive: true } });
  const gymName = process.env.NEXT_PUBLIC_GYM_NAME || process.env.GYM_NAME || "TraqGym";

  const agent = new Agent({
    name: "TraqGym Proactive AI",
    model: "gpt-4o",
    instructions: buildProactivePrompt({
      gymName,
      locationName: location?.name || gymName,
      feature: params.feature,
    }),
    tools,
  });

  // Run as admin worker (ID 1)
  const aiCtx = { workerId: 1, role: "admin" };

  return runInAiContext(aiCtx, async () => {
    const result = await run(agent, [{ role: "user", content: params.prompt }]);
    const output = result.finalOutput ?? "";
    return { output, tokensUsed: 0 };
  });
}
