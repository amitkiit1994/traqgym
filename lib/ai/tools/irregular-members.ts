import { tool } from "@openai/agents";
import { z } from "zod";
import { getIrregularMembers } from "@/lib/services/irregular-members";

export const irregularMemberTools = [
  tool({
    name: "get_irregular_members",
    description:
      "Get active members who haven't checked in for X days (default 7). Only includes members with active, non-expired tickets.",
    parameters: z.object({
      daysThreshold: z
        .number()
        .nullable()
        .describe("Number of days without check-in to consider irregular (default 7)"),
      locationId: z
        .number()
        .nullable()
        .describe("Filter by location ID"),
    }),
    async execute(input) {
      const result = await getIrregularMembers(
        input.daysThreshold ?? 7,
        input.locationId ?? undefined
      );
      return JSON.stringify(result);
    },
  }),
];
