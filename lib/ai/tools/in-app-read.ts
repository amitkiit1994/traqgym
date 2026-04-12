import { tool } from "@openai/agents";
import { z } from "zod";
import {
  getNotifications,
  getUnreadCount,
} from "@/lib/services/in-app-notification";
import { getAiContext } from "@/lib/ai-context";

export const inAppReadTools = [
  tool({
    name: "get_my_notifications",
    description:
      "Get the current worker's in-app notifications (AI briefings, churn alerts, lead followups, etc.)",
    parameters: z.object({
      limit: z
        .number()
        .nullable()
        .describe("Max notifications to return, default 20"),
      offset: z
        .number()
        .nullable()
        .describe("Offset for pagination, default 0"),
    }),
    async execute(input) {
      const ctx = getAiContext();
      if (!ctx) return JSON.stringify({ error: "No AI context" });
      const result = await getNotifications({
        workerId: ctx.workerId,
        limit: input.limit ?? 20,
        offset: input.offset ?? 0,
      });
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_unread_count",
    description:
      "Get the count of unread in-app notifications for the current worker",
    parameters: z.object({}),
    async execute() {
      const ctx = getAiContext();
      if (!ctx) return JSON.stringify({ error: "No AI context" });
      const count = await getUnreadCount({ workerId: ctx.workerId });
      return JSON.stringify({ unreadCount: count });
    },
  }),
];
