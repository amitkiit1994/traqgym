import { tool } from "@openai/agents";
import { z } from "zod";
import {
  getLockersAction,
  createLockerAction,
  assignLockerAction,
  releaseLockerAction,
  getLockerStatsAction,
} from "@/lib/actions/lockers";

export const lockerTools = [
  tool({
    name: "get_lockers",
    description: "List all lockers with assignment info, optionally filtered by location",
    parameters: z.object({
      locationId: z.number().nullable().describe("Filter by location ID"),
    }),
    async execute(input) {
      const lockers = await getLockersAction(input.locationId ?? undefined);
      return JSON.stringify(lockers);
    },
  }),

  tool({
    name: "assign_locker",
    description: "Assign a locker to a member. Requires confirmation.",
    parameters: z.object({
      lockerId: z.number().describe("Locker ID"),
      userId: z.number().describe("Member ID to assign to"),
    }),
    async execute(input) {
      const result = await assignLockerAction(input.lockerId, input.userId);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "release_locker",
    description: "Release a locker from its current assignment. Requires confirmation.",
    parameters: z.object({
      lockerId: z.number().describe("Locker ID to release"),
    }),
    async execute(input) {
      const result = await releaseLockerAction(input.lockerId);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "create_locker",
    description: "Create a new locker at a location. Requires confirmation.",
    parameters: z.object({
      number: z.string().describe("Locker number/label"),
      locationId: z.number().describe("Location ID"),
    }),
    async execute(input) {
      const result = await createLockerAction({ number: input.number, locationId: input.locationId });
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_locker_stats",
    description: "Get locker counts by status (available/assigned/maintenance)",
    parameters: z.object({
      locationId: z.number().nullable().describe("Filter by location ID"),
    }),
    async execute(input) {
      const stats = await getLockerStatsAction(input.locationId ?? undefined);
      return JSON.stringify(stats);
    },
  }),
];
