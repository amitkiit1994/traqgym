import { tool } from "@openai/agents";
import { z } from "zod";
import {
  freezeMembershipAction,
  cancelFreezeAction,
  getActiveFreezesAction,
} from "@/lib/actions/freeze";

export const freezeTools = [
  tool({
    name: "freeze_membership",
    description: "Freeze a member's plan for a date range. Extends expiry by freeze duration. Requires confirmation.",
    parameters: z.object({
      userId: z.number().describe("Member ID"),
      memberTicketId: z.number().describe("MemberTicket ID to freeze"),
      freezeStart: z.string().describe("Freeze start date YYYY-MM-DD"),
      freezeEnd: z.string().describe("Freeze end date YYYY-MM-DD"),
      reason: z.string().nullable().describe("Reason for freeze"),
    }),
    async execute(input) {
      const result = await freezeMembershipAction(
        input.userId,
        input.memberTicketId,
        input.freezeStart,
        input.freezeEnd,
        input.reason ?? undefined,
      );
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "cancel_freeze",
    description: "Cancel an active membership freeze. Requires confirmation.",
    parameters: z.object({
      freezeId: z.number().describe("Freeze ID to cancel"),
      userId: z.number().describe("Member ID"),
    }),
    async execute(input) {
      const result = await cancelFreezeAction(input.freezeId, input.userId);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_active_freezes",
    description: "List active membership freezes, optionally filtered by member",
    parameters: z.object({
      userId: z.number().nullable().describe("Filter by member ID"),
    }),
    async execute(input) {
      const freezes = await getActiveFreezesAction(input.userId ?? undefined);
      return JSON.stringify(freezes);
    },
  }),
];
