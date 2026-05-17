import { tool } from "@openai/agents";
import { z } from "zod";
import { listActiveInsights, getInsightStats } from "@/lib/services/insight";

export const insightTools = [
  tool({
    name: "get_active_insights",
    description:
      "Get currently-active AI proactive insights for this gym — what the AI agents have flagged that needs attention (write-off candidates, renewal cliffs, revenue anomalies, defaulted tickets, etc.). Each insight has a severity (critical/high/medium/low), agent that produced it, title, body, and suggested actions. Use this when the user asks 'what insights do you have for me', 'anything I should worry about', 'what's flagged today', etc.",
    parameters: z.object({
      minSeverity: z
        .enum(["critical", "high", "medium", "low"])
        .nullable()
        .describe("Filter to insights at or above this severity"),
      agent: z
        .string()
        .nullable()
        .describe("Filter by producer agent name (e.g. 'silent_churn', 'defaulted_ticket_escalator')"),
      limit: z.number().nullable().describe("Max insights to return (default 25, max 100)"),
    }),
    async execute(input) {
      const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
      const insights = await listActiveInsights({
        minSeverity: input.minSeverity ?? undefined,
        agent: input.agent ?? undefined,
        limit,
      });
      return JSON.stringify({
        count: insights.length,
        insights: insights.map((i) => ({
          id: i.id,
          severity: i.severity,
          agent: i.agent,
          title: i.title,
          body: i.body.slice(0, 500),
          entityType: i.entityType,
          entityId: i.entityId,
          createdAt: i.createdAt.toISOString(),
        })),
      });
    },
  }),

  tool({
    name: "get_insight_stats",
    description:
      "Summary statistics about active AI insights: counts by severity, counts by agent, oldest open insight age. Use for 'overview of all flagged items' or 'how many critical issues right now' questions.",
    parameters: z.object({}),
    async execute() {
      const stats = await getInsightStats();
      return JSON.stringify(stats);
    },
  }),
];
