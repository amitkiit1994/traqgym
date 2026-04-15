import { tool } from "@openai/agents";
import { z } from "zod";
import { getFeedbackAction, getFeedbackStatsAction } from "@/lib/actions/feedback";

export const feedbackTools = [
  tool({
    name: "get_feedback",
    description: "List member feedback with optional filters for category and pagination",
    parameters: z.object({
      category: z.string().nullable().describe("Filter by category: facility, trainer, cleanliness, general"),
      page: z.number().nullable().describe("Page number (default 1)"),
      limit: z.number().nullable().describe("Items per page (default 20)"),
    }),
    async execute(input) {
      const result = await getFeedbackAction({
        category: input.category ?? undefined,
        page: input.page ?? undefined,
        limit: input.limit ?? undefined,
      });
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_feedback_stats",
    description: "Get aggregated feedback statistics: average rating, total count, distribution by rating and category, monthly trend",
    parameters: z.object({}),
    async execute() {
      const result = await getFeedbackStatsAction();
      return JSON.stringify(result);
    },
  }),
];
