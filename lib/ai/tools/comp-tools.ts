import { tool } from "@openai/agents";
import { z } from "zod";
import {
  issueCompPassAction,
  revokeCompPassAction,
  convertCompPassToPaidAction,
  issueCompAction,
  revokeCompAction,
  convertCompToPaidAction,
  getActiveCompsAction,
  getActiveCompPassesAction,
  getCompStatsAction,
} from "@/lib/actions/comp";

/**
 * Comp / comp-pass tools — wrap the existing server actions so the AI agent
 * can act on the gym owner's "issue comp pass for Karan" voice / Telegram
 * commands. All write operations are admin-only (server action enforces it).
 */
export const compTools = [
  // ── Comp pass (informal, no plan) ──────────────────────────────────────
  tool({
    name: "issue_comp_pass",
    description:
      "Issue an informal complimentary access pass (no plan attached) for a member, valid for `days` days. Used for trial visits, money-crunch goodwill, etc. Admin only.",
    parameters: z.object({
      userId: z.number().describe("Member user ID"),
      days: z
        .number()
        .int()
        .min(1)
        .max(90)
        .describe("Number of days the pass is valid"),
      reason: z
        .string()
        .describe(
          "Short reason code, e.g. 'trial', 'money_crunch', 'compensation'"
        ),
      reasonDetail: z
        .string()
        .nullable()
        .describe("Optional human-readable detail"),
      notes: z.string().nullable().describe("Optional internal notes"),
    }),
    async execute(input) {
      const expiresAt = new Date(
        Date.now() + input.days * 24 * 60 * 60 * 1000
      ).toISOString();
      const result = await issueCompPassAction({
        userId: input.userId,
        reason: input.reason,
        reasonDetail: input.reasonDetail ?? undefined,
        expiresAt,
        notes: input.notes ?? undefined,
      });
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "revoke_comp_pass",
    description:
      "Revoke an active comp pass (cancels access immediately). Admin only.",
    parameters: z.object({
      passId: z.number().describe("Comp pass ID"),
      reason: z.string().describe("Reason for revocation (audit trail)"),
    }),
    async execute(input) {
      const result = await revokeCompPassAction({
        passId: input.passId,
        reason: input.reason,
      });
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "convert_comp_pass",
    description:
      "Convert an active comp pass into a paid membership ticket on a real plan. Admin only.",
    parameters: z.object({
      passId: z.number().describe("Comp pass ID to convert"),
      planId: z.number().describe("Plan ID for the new paid ticket"),
      paidAmount: z.number().min(0).describe("Amount collected (rupees)"),
      paymentMode: z
        .string()
        .describe(
          "Payment mode: cash, upi, card, cheque, online, complimentary, etc."
        ),
    }),
    async execute(input) {
      const result = await convertCompPassToPaidAction({
        passId: input.passId,
        planId: input.planId,
        paidAmount: input.paidAmount,
        paymentMode: input.paymentMode,
      });
      return JSON.stringify(result);
    },
  }),

  // ── Comp on a real plan ────────────────────────────────────────────────
  tool({
    name: "issue_comp",
    description:
      "Issue a complimentary membership backed by a real plan (trial / influencer / family / compensation). Admin only.",
    parameters: z.object({
      userId: z.number().describe("Member user ID"),
      planId: z.number().describe("Plan ID to attach the comp to"),
      reason: z
        .enum([
          "trial",
          "influencer",
          "family",
          "compensation",
          "owner_friend",
          "money_crunch",
          "other",
        ])
        .describe("Comp reason code"),
      reasonDetail: z.string().nullable().describe("Optional detail"),
      days: z
        .number()
        .int()
        .min(1)
        .max(365)
        .nullable()
        .describe("Override duration in days (default = plan.expireDays)"),
    }),
    async execute(input) {
      const result = await issueCompAction({
        userId: input.userId,
        planId: input.planId,
        reason: input.reason,
        reasonDetail: input.reasonDetail ?? undefined,
        days: input.days ?? undefined,
      });
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "revoke_comp",
    description: "Revoke an active complimentary ticket. Admin only.",
    parameters: z.object({
      ticketId: z.number().describe("MemberTicket ID"),
      reason: z.string().describe("Reason for revocation"),
    }),
    async execute(input) {
      const result = await revokeCompAction({
        ticketId: input.ticketId,
        reason: input.reason,
      });
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "convert_comp",
    description:
      "Convert an active complimentary ticket into a paid ticket on a (possibly different) plan. Admin only.",
    parameters: z.object({
      ticketId: z.number().describe("Existing comp MemberTicket ID"),
      newPlanId: z.number().describe("Plan ID for the new paid ticket"),
      paidAmount: z.number().min(0).describe("Amount collected (rupees)"),
      paymentMode: z
        .string()
        .describe("Payment mode: cash, upi, card, cheque, online, etc."),
    }),
    async execute(input) {
      const result = await convertCompToPaidAction({
        ticketId: input.ticketId,
        newPlanId: input.newPlanId,
        paidAmount: input.paidAmount,
        paymentMode: input.paymentMode,
      });
      return JSON.stringify(result);
    },
  }),

  // ── Read tools (any worker) ────────────────────────────────────────────
  tool({
    name: "get_active_comps",
    description: "List active complimentary tickets, optionally by location.",
    parameters: z.object({
      locationId: z.number().nullable().describe("Filter by location ID"),
    }),
    async execute(input) {
      const result = await getActiveCompsAction(
        input.locationId != null ? { locationId: input.locationId } : undefined
      );
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_active_comp_passes",
    description: "List active comp passes (informal, no plan), optionally by location.",
    parameters: z.object({
      locationId: z.number().nullable().describe("Filter by location ID"),
    }),
    async execute(input) {
      const result = await getActiveCompPassesAction(
        input.locationId != null ? { locationId: input.locationId } : undefined
      );
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_comp_stats",
    description:
      "Aggregate complimentary-access metrics (active counts, ratio, top issuers, stale comps, conversion candidates, revenue leak).",
    parameters: z.object({
      from: z
        .string()
        .nullable()
        .describe("ISO date — start of window (default: 30 days ago)"),
      to: z.string().nullable().describe("ISO date — end of window (default: today)"),
      locationId: z.number().nullable().describe("Filter by location ID"),
    }),
    async execute(input) {
      const result = await getCompStatsAction({
        from: input.from ?? undefined,
        to: input.to ?? undefined,
        locationId: input.locationId ?? undefined,
      });
      return JSON.stringify(result);
    },
  }),
];
