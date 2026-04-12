import { tool } from "@openai/agents";
import { z } from "zod";
import { getColdLeads } from "@/lib/services/lead-scoring";

export const coldLeadTools = [
  tool({
    name: "get_cold_leads",
    description:
      "Get enquiries that have gone cold: no follow-up activity in N hours, still in active stages (not converted/lost)",
    parameters: z.object({
      gapHours: z
        .number()
        .describe("Hours since last activity to consider cold, e.g. 48"),
      maxResults: z
        .number()
        .describe("Maximum number of cold leads to return, e.g. 20"),
    }),
    async execute(input) {
      const result = await getColdLeads({
        gapHours: input.gapHours,
        maxResults: input.maxResults,
      });
      return JSON.stringify(result);
    },
  }),
];
