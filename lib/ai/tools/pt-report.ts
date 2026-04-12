import { tool } from "@openai/agents";
import { z } from "zod";
import { getPTReport } from "@/lib/services/pt-report";

export const ptReportTools = [
  tool({
    name: "get_pt_session_report",
    description:
      "Get personal training session report for a date range. Shows total bookings, attendance, completion rate, grouped by instructor.",
    parameters: z.object({
      startDate: z
        .string()
        .describe("Start date YYYY-MM-DD"),
      endDate: z
        .string()
        .describe("End date YYYY-MM-DD"),
      locationId: z
        .number()
        .nullable()
        .describe("Filter by location ID"),
    }),
    async execute(input) {
      const result = await getPTReport(
        input.startDate,
        input.endDate,
        input.locationId ?? undefined
      );
      return JSON.stringify(result);
    },
  }),
];
