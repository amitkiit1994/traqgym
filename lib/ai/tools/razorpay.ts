import { tool } from "@openai/agents";
import { z } from "zod";
import { getOnlinePayments } from "@/lib/services/razorpay";

export const razorpayTools = [
  tool({
    name: "get_online_payments",
    description: "List payments made via Razorpay (online payments).",
    parameters: z.object({
      locationId: z.number().nullable().describe("Filter by location ID"),
    }),
    async execute(input) {
      const result = await getOnlinePayments(input.locationId ?? undefined);
      return JSON.stringify(result);
    },
  }),
];
