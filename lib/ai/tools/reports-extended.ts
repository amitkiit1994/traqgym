import { tool } from "@openai/agents";
import { z } from "zod";
import { getLoginHistory, getMembershipMatrix, getSourceAnalysis, getConversionFunnelReport } from "@/lib/actions/reports";
import { getMemberUsage } from "@/lib/services/member-usage";

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

  tool({
    name: "get_member_usage_report",
    description:
      "Get member usage analysis: segments active members into Heavy (>70%), Moderate (30-70%), and Light (<30%) based on visit frequency vs membership days. Returns segment counts and individual member details sorted by usage (lowest first). Admin only.",
    parameters: z.object({
      locationId: z.number().nullable().describe("Filter by location ID"),
    }),
    async execute(input) {
      const result = await getMemberUsage(input.locationId ?? undefined);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_conversion_funnel",
    description:
      "Get enquiry conversion funnel: counts at each stage (new, contacted, tour_scheduled, tour_done, trial, negotiation, converted, lost) with conversion rates between stages and overall new-to-converted rate. Admin only.",
    parameters: z.object({
      startDate: z.string().nullable().describe("Start date in YYYY-MM-DD format"),
      endDate: z.string().nullable().describe("End date in YYYY-MM-DD format"),
      locationId: z.number().nullable().describe("Filter by location ID"),
    }),
    async execute(input) {
      const result = await getConversionFunnelReport(
        input.startDate ?? undefined,
        input.endDate ?? undefined,
        input.locationId ?? undefined
      );
      return JSON.stringify(result);
    },
  }),
];
