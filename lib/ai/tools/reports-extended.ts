import { tool } from "@openai/agents";
import { z } from "zod";
import { getLoginHistory, getMembershipMatrix, getSourceAnalysis } from "@/lib/actions/reports";

export const reportsExtendedTools = [
  tool({
    name: "get_login_history",
    description:
      "Get worker/admin login history for a date range. Admin only.",
    parameters: z.object({
      fromDate: z.string().describe("Start date in YYYY-MM-DD format"),
      toDate: z.string().describe("End date in YYYY-MM-DD format"),
    }),
    async execute(input) {
      const result = await getLoginHistory(input.fromDate, input.toDate);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_membership_matrix",
    description:
      "Get membership distribution by plan: active, cancelled, and total counts per plan. Admin only.",
    parameters: z.object({
      locationId: z.number().nullable().describe("Filter by location ID"),
    }),
    async execute(input) {
      const result = await getMembershipMatrix(input.locationId ?? undefined);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_source_analysis",
    description:
      "Get lead source conversion analysis: total enquiries, converted count, and conversion rate per source. Admin only.",
    parameters: z.object({
      locationId: z.number().nullable().describe("Filter by location ID"),
    }),
    async execute(input) {
      const result = await getSourceAnalysis(input.locationId ?? undefined);
      return JSON.stringify(result);
    },
  }),
];
