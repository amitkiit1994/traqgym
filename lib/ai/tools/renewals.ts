import { tool } from "@openai/agents";
import { z } from "zod";
import { n } from "./utils";
import { getActivePlans, submitRenewal } from "@/lib/actions/renewals";
import { upgradePlan } from "@/lib/services/plan-change";
import { getMemberPayments } from "@/lib/actions/payment-history";
import { getCollectionReport, getMemberReport } from "@/lib/actions/reports";

export const renewalTools = [
  tool({
    name: "get_active_plans",
    description: "Get all active membership plans available for renewal/purchase",
    parameters: z.object({}),
    async execute() {
      const plans = await getActivePlans();
      return JSON.stringify(plans);
    },
  }),

  tool({
    name: "submit_renewal",
    description: "Renew a member's membership with a specific plan. Requires confirmation. This is an atomic operation that creates the ticket, payment, and invoice.",
    parameters: z.object({
      userId: z.number().describe("Member ID"),
      planId: z.number().describe("Plan ID"),
      locationId: z.number().describe("Location ID"),
      paymentMode: z.string().describe("Payment mode: cash, upi, card, bank_transfer"),
      upiReference: z.string().nullable().describe("UPI reference number if payment mode is upi"),
      promoCode: z.string().nullable().describe("Promo code to apply"),
    }),
    async execute(input) {
      const result = await submitRenewal(n(input));
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "upgrade_plan",
    description: "Upgrade a member's current plan to a new plan with pro-rated credit. Requires confirmation.",
    parameters: z.object({
      userId: z.number().describe("Member ID"),
      currentTicketId: z.number().describe("Current MemberTicket ID"),
      newPlanId: z.number().describe("New plan ID to upgrade to"),
      locationId: z.number().describe("Location ID"),
      paymentMode: z.string().describe("Payment mode: cash, upi, card, bank_transfer"),
      upiRef: z.string().nullable().describe("UPI reference if applicable"),
      collectedById: z.number().describe("Worker ID who collected payment"),
    }),
    async execute(input) {
      const result = await upgradePlan(n(input));
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_payment_history",
    description: "Get a member's payment history",
    parameters: z.object({
      userId: z.number().describe("Member ID"),
      page: z.number().nullable().describe("Page number"),
      pageSize: z.number().nullable().describe("Results per page"),
    }),
    async execute(input) {
      const result = await getMemberPayments(input.userId, {
        page: input.page ?? undefined,
        pageSize: input.pageSize ?? undefined,
      });
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_collection_report",
    description: "Get daily collection report showing all payments received. Admin only.",
    parameters: z.object({
      date: z.string().describe("Date in YYYY-MM-DD format"),
      locationId: z.number().nullable().describe("Filter by location"),
    }),
    async execute(input) {
      const report = await getCollectionReport(input.date, input.locationId ?? undefined);
      return JSON.stringify(report);
    },
  }),

  tool({
    name: "get_member_report",
    description: "Get member report filtered by status (active, expired, overdue, etc.)",
    parameters: z.object({
      status: z.string().nullable().describe("Filter: active, expired, overdue, no_plan"),
      locationId: z.number().nullable().describe("Filter by location"),
    }),
    async execute(input) {
      const report = await getMemberReport(input.status ?? undefined, input.locationId ?? undefined);
      return JSON.stringify(report);
    },
  }),
];
