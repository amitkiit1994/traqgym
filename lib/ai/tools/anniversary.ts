import { tool } from "@openai/agents";
import { z } from "zod";
import {
  getTodayAnniversaries,
  getUpcomingAnniversaries,
} from "@/lib/services/anniversary";

export const anniversaryTools = [
  tool({
    name: "get_today_anniversaries",
    description:
      "Get members whose gym join date anniversary is today (month+day match of their registration date)",
    parameters: z.object({
      locationId: z
        .number()
        .nullable()
        .describe("Filter by location ID"),
    }),
    async execute(input) {
      const result = await getTodayAnniversaries(
        input.locationId ?? undefined
      );
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_upcoming_anniversaries",
    description:
      "Get members with upcoming gym join date anniversaries in the next N days",
    parameters: z.object({
      days: z
        .number()
        .describe("Number of days to look ahead (e.g. 7, 30)"),
      locationId: z
        .number()
        .nullable()
        .describe("Filter by location ID"),
    }),
    async execute(input) {
      const result = await getUpcomingAnniversaries(
        input.days,
        input.locationId ?? undefined
      );
      return JSON.stringify(result);
    },
  }),
];
