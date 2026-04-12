import { tool } from "@openai/agents";
import { z } from "zod";
import {
  createTrialMembership,
  convertTrial,
  getTrialStats,
  getActiveTrials,
} from "@/lib/actions/trials";

export const trialTools = [
  tool({
    name: "create_trial_membership",
    description: "Create a trial membership for a member. Only one active trial per member. Member must not have an active paid plan. Requires confirmation before executing.",
    parameters: z.object({
      userId: z.number().describe("Member user ID"),
      planId: z.number().describe("Trial plan ID (must be a trial plan)"),
      locationId: z.number().describe("Location ID"),
    }),
    async execute(input) {
      const result = await createTrialMembership(input);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "convert_trial",
    description: "Convert a trial membership to a paid plan. Expires the trial and creates a new paid membership with payment. Requires confirmation before executing.",
    parameters: z.object({
      ticketId: z.number().describe("Trial ticket ID to convert"),
      newPlanId: z.number().describe("New paid plan ID"),
      paymentMode: z.string().describe("Payment mode: cash, upi, card, bank_transfer"),
      amount: z.number().describe("Payment amount"),
      upiReference: z.string().nullable().describe("UPI reference number (required if paymentMode is upi, null otherwise)"),
    }),
    async execute(input) {
      const result = await convertTrial({ ...input, upiReference: input.upiReference ?? undefined });
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_trial_stats",
    description: "Get trial membership statistics: active trials, expired unconverted, converted count, and conversion rate",
    parameters: z.object({
      startDate: z.string().nullable().describe("Start date filter (YYYY-MM-DD), null for no filter"),
      endDate: z.string().nullable().describe("End date filter (YYYY-MM-DD), null for no filter"),
    }),
    async execute(input) {
      const result = await getTrialStats(input.startDate ?? undefined, input.endDate ?? undefined);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_active_trials",
    description: "List all active trial memberships with member info, plan details, and days remaining",
    parameters: z.object({
      locationId: z.number().nullable().describe("Filter by location ID (null for all locations)"),
    }),
    async execute(input) {
      const result = await getActiveTrials(input.locationId ?? undefined);
      return JSON.stringify(result);
    },
  }),
];
