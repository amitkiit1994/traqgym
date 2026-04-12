import { tool } from "@openai/agents";
import { z } from "zod";
import {
  getWaiverStatus,
  getUnsignedWaivers,
  getTemplates,
} from "@/lib/actions/waivers";

export const waiverTools = [
  tool({
    name: "get_waiver_status",
    description: "Get all waiver templates with signed/unsigned status for a member.",
    parameters: z.object({
      userId: z.number().describe("Member user ID"),
    }),
    async execute(input) {
      const result = await getWaiverStatus(input.userId);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_unsigned_waivers",
    description: "Get list of waivers a member has not yet signed.",
    parameters: z.object({
      userId: z.number().describe("Member user ID"),
    }),
    async execute(input) {
      const result = await getUnsignedWaivers(input.userId);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_waiver_templates",
    description: "List all waiver templates.",
    parameters: z.object({
      activeOnly: z.boolean().nullable().describe("Only show active templates"),
    }),
    async execute(input) {
      const result = await getTemplates(input.activeOnly ?? undefined);
      return JSON.stringify(result);
    },
  }),
];
