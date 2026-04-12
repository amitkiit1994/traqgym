import { tool } from "@openai/agents";
import { z } from "zod";
import { getDailyActions } from "@/lib/services/daily-actions";

export const dailyActionTools = [
  tool({
    name: "get_daily_actions",
    description:
      "Get today's priority action items: overdue enquiries, overdue payments, expiring memberships, inactive members, birthdays, pending leaves. Sorted by priority.",
    parameters: z.object({}),
    async execute() {
      const result = await getDailyActions();
      return JSON.stringify(result);
    },
  }),
];
