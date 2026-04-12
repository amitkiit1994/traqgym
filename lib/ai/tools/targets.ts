import { tool } from "@openai/agents";
import { z } from "zod";
import {
  setTarget,
  getTarget,
  getTargetProgress,
} from "@/lib/actions/gym-targets";

export const targetTools = [
  tool({
    name: "set_gym_target",
    description: "Set monthly revenue, new member, and renewal targets for the gym. Requires confirmation before executing. Admin only.",
    parameters: z.object({
      month: z.number().min(1).max(12).describe("Month (1-12)"),
      year: z.number().describe("Year, e.g. 2026"),
      targetRevenue: z.number().describe("Target revenue amount"),
      targetNewMembers: z.number().nullable().describe("Target number of new members"),
      targetRenewals: z.number().nullable().describe("Target number of renewals"),
      locationId: z.number().nullable().describe("Location ID (null for all locations)"),
    }),
    async execute(input) {
      const result = await setTarget({
        month: input.month,
        year: input.year,
        targetRevenue: input.targetRevenue,
        targetNewMembers: input.targetNewMembers ?? undefined,
        targetRenewals: input.targetRenewals ?? undefined,
        locationId: input.locationId ?? undefined,
      });
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_gym_target",
    description: "Get the target set for a specific month and year",
    parameters: z.object({
      month: z.number().min(1).max(12).describe("Month (1-12)"),
      year: z.number().describe("Year, e.g. 2026"),
      locationId: z.number().nullable().describe("Location ID (null for all locations)"),
    }),
    async execute(input) {
      const result = await getTarget(input.month, input.year, input.locationId ?? undefined);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_target_progress",
    description: "Get target vs actual progress for a specific month: revenue, new members, and renewals with percentage completion",
    parameters: z.object({
      month: z.number().min(1).max(12).describe("Month (1-12)"),
      year: z.number().describe("Year, e.g. 2026"),
      locationId: z.number().nullable().describe("Location ID (null for all locations)"),
    }),
    async execute(input) {
      const result = await getTargetProgress(input.month, input.year, input.locationId ?? undefined);
      return JSON.stringify(result);
    },
  }),
];
