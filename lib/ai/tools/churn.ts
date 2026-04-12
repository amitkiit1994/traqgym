import { tool } from "@openai/agents";
import { z } from "zod";
import { getAtRiskMembers } from "@/lib/services/churn-detection";

export const churnTools = [
  tool({
    name: "get_at_risk_members",
    description:
      "Get members at risk of churning: active members with no attendance in N days, plus members expiring within 7 days",
    parameters: z.object({
      inactiveDays: z
        .number()
        .describe("Days of inactivity threshold, e.g. 14"),
    }),
    async execute(input) {
      const result = await getAtRiskMembers(input.inactiveDays);
      return JSON.stringify(result);
    },
  }),
];
