import { tool } from "@openai/agents";
import { z } from "zod";
import {
  extendMembershipAction,
  getExtensionsAction,
} from "@/lib/actions/extension";

export const extensionTools = [
  tool({
    name: "extend_membership",
    description: "Extend a member's membership expiry date by a number of days (e.g., gym closed for holidays). Requires confirmation.",
    parameters: z.object({
      userId: z.number().describe("Member ID"),
      memberTicketId: z.number().describe("MemberTicket ID to extend"),
      daysToAdd: z.number().describe("Number of days to add to expiry"),
      reason: z.string().describe("Reason for extension (e.g., gym closed for Diwali)"),
    }),
    async execute(input) {
      const result = await extendMembershipAction({
        userId: input.userId,
        memberTicketId: input.memberTicketId,
        daysToAdd: input.daysToAdd,
        reason: input.reason,
      });
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_extensions",
    description: "List membership extensions, optionally filtered by member",
    parameters: z.object({
      userId: z.number().nullable().describe("Filter by member ID"),
    }),
    async execute(input) {
      const extensions = await getExtensionsAction(input.userId ?? undefined);
      return JSON.stringify(extensions);
    },
  }),
];
