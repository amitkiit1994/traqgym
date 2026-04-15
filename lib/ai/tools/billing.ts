import { tool } from "@openai/agents";
import { z } from "zod";
import {
  recordPartialPaymentAction,
  getBalanceDueReportAction,
  getMemberBalanceAction,
} from "@/lib/actions/partial-payment";
import { getTaxReportAction, getTaxSettingsAction } from "@/lib/actions/tax";
import {
  getFollowupsAction,
  createFollowupAction,
  updateFollowupAction,
  assignFollowupAction,
  getOverdueFollowupsAction,
} from "@/lib/actions/payment-followup";

export const billingTools = [
  // --- Partial Payments ---
  tool({
    name: "record_partial_payment",
    description:
      "Record a partial payment against an existing ticket balance. Requires confirmation.",
    parameters: z.object({
      ticketId: z.number().describe("Member ticket ID"),
      amount: z.number().describe("Payment amount"),
      paymentMode: z
        .string()
        .describe("Payment mode: cash, upi, card, cheque"),
      upiReference: z
        .string()
        .nullable()
        .describe("UPI reference number (if UPI)"),
    }),
    async execute(input) {
      const result = await recordPartialPaymentAction({
        ticketId: input.ticketId,
        amount: input.amount,
        paymentMode: input.paymentMode,
        upiReference: input.upiReference ?? undefined,
      });
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_balance_due_report",
    description:
      "Get all members with outstanding balance due, sorted by highest balance first",
    parameters: z.object({
      locationId: z
        .number()
        .nullable()
        .describe("Filter by location ID"),
    }),
    async execute(input) {
      const { data } = await getBalanceDueReportAction({
        locationId: input.locationId ?? undefined,
      });
      return JSON.stringify(data);
    },
  }),

  tool({
    name: "get_member_balance",
    description:
      "Get a specific member's outstanding balance details across all tickets",
    parameters: z.object({
      userId: z.number().describe("Member user ID"),
    }),
    async execute(input) {
      const result = await getMemberBalanceAction(input.userId);
      return JSON.stringify(result);
    },
  }),

  // --- Tax/GST ---
  tool({
    name: "get_tax_report",
    description:
      "Get tax/GST collection report for a date range with breakdown by tax rate",
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
      const result = await getTaxReportAction(
        input.startDate,
        input.endDate,
        input.locationId ?? undefined
      );
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_tax_settings",
    description:
      "Get current GST/tax configuration: default rate, inclusive/exclusive mode, GSTIN",
    parameters: z.object({}),
    async execute() {
      const result = await getTaxSettingsAction();
      return JSON.stringify(result);
    },
  }),

  // --- Payment Followups ---
  tool({
    name: "get_payment_followups",
    description:
      "List payment followups with optional filters by status, staff, priority, or location",
    parameters: z.object({
      status: z
        .string()
        .nullable()
        .describe(
          "Filter: pending, contacted, promised, resolved, written_off"
        ),
      assignedToId: z
        .number()
        .nullable()
        .describe("Filter by assigned staff worker ID"),
      priority: z
        .string()
        .nullable()
        .describe("Filter: low, normal, high, critical"),
      locationId: z
        .number()
        .nullable()
        .describe("Filter by location ID"),
    }),
    async execute(input) {
      const { data } = await getFollowupsAction({
        status: input.status ?? undefined,
        assignedToId: input.assignedToId ?? undefined,
        priority: input.priority ?? undefined,
        locationId: input.locationId ?? undefined,
      });
      return JSON.stringify(data);
    },
  }),

  tool({
    name: "create_payment_followup",
    description:
      "Create a manual payment followup for a member with outstanding balance. Requires confirmation.",
    parameters: z.object({
      userId: z.number().describe("Member user ID"),
      memberTicketId: z
        .number()
        .nullable()
        .describe("Related ticket ID"),
      amountDue: z.number().describe("Amount due"),
      dueDate: z.string().describe("Due date YYYY-MM-DD"),
      assignedToId: z
        .number()
        .nullable()
        .describe("Assign to staff worker ID"),
      priority: z
        .string()
        .nullable()
        .describe("Priority: low, normal, high, critical"),
      notes: z.string().nullable().describe("Notes"),
    }),
    async execute(input) {
      const result = await createFollowupAction({
        userId: input.userId,
        memberTicketId: input.memberTicketId ?? undefined,
        amountDue: input.amountDue,
        dueDate: input.dueDate,
        assignedToId: input.assignedToId ?? undefined,
        priority: input.priority ?? undefined,
        notes: input.notes ?? undefined,
      });
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "update_payment_followup",
    description:
      "Update a payment followup status, notes, or next followup date. Requires confirmation.",
    parameters: z.object({
      id: z.number().describe("Followup ID"),
      status: z
        .string()
        .nullable()
        .describe(
          "New status: pending, contacted, promised, resolved, written_off"
        ),
      notes: z.string().nullable().describe("Updated notes"),
      nextFollowupAt: z
        .string()
        .nullable()
        .describe("Next followup date YYYY-MM-DD"),
      priority: z
        .string()
        .nullable()
        .describe("Priority: low, normal, high, critical"),
    }),
    async execute(input) {
      const result = await updateFollowupAction(input.id, {
        status: input.status ?? undefined,
        notes: input.notes ?? undefined,
        nextFollowupAt: input.nextFollowupAt ?? undefined,
        priority: input.priority ?? undefined,
      });
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "assign_payment_followup",
    description:
      "Assign a payment followup to a specific staff member. Requires confirmation.",
    parameters: z.object({
      id: z.number().describe("Followup ID"),
      workerId: z.number().describe("Staff worker ID to assign"),
    }),
    async execute(input) {
      const result = await assignFollowupAction(input.id, input.workerId);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_overdue_followups",
    description:
      "Get payment followups that are past their next followup date and still pending/in-progress",
    parameters: z.object({
      locationId: z
        .number()
        .nullable()
        .describe("Filter by location ID"),
    }),
    async execute(input) {
      const result = await getOverdueFollowupsAction(
        input.locationId ?? undefined
      );
      return JSON.stringify(result);
    },
  }),
];
