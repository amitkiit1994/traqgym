import { tool } from "@openai/agents";
import { z } from "zod";
import {
  getPendingChequesAction,
  updateChequeStatusAction,
} from "@/lib/actions/cheque";

export const chequeTools = [
  tool({
    name: "get_pending_cheques",
    description:
      "Get all payments with pending cheque status, optionally filtered by location",
    parameters: z.object({
      locationId: z
        .number()
        .nullable()
        .describe("Filter by location ID"),
    }),
    async execute(input) {
      const result = await getPendingChequesAction(
        input.locationId ?? undefined
      );
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "update_cheque_status",
    description:
      "Mark a cheque payment as cleared or bounced. If bounced, auto-creates a payment followup. Requires confirmation. Admin only.",
    parameters: z.object({
      paymentId: z.number().describe("Payment ID"),
      status: z
        .enum(["cleared", "bounced"])
        .describe("New cheque status"),
      notes: z
        .string()
        .nullable()
        .describe("Optional notes about the status change"),
    }),
    async execute(input) {
      const result = await updateChequeStatusAction(
        input.paymentId,
        input.status,
        input.notes ?? undefined
      );
      return JSON.stringify(result);
    },
  }),
];
