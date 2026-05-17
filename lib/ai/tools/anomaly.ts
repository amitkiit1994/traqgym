import { tool } from "@openai/agents";
import { z } from "zod";
import {
  detectDuplicatePayments,
  detectOffShiftCashPayments,
  detectDiscountOutliers,
  detectRefundRouting,
  detectCompAbusePatterns,
  detectBalanceMismatches,
  detectAuditAnomalies,
  getOwnerAnomalySummary,
} from "@/lib/services/anomaly";

const dateRange = z.object({
  from: z.string().describe("Start date inclusive, YYYY-MM-DD"),
  to: z.string().describe("End date inclusive, YYYY-MM-DD"),
  locationId: z.number().nullable().describe("Filter by location ID"),
});

function parseRange(input: { from: string; to: string; locationId: number | null }) {
  const from = new Date(`${input.from}T00:00:00.000Z`);
  const to = new Date(`${input.to}T23:59:59.999Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return null;
  }
  return { from, to, locationId: input.locationId ?? undefined };
}

export const anomalyTools = [
  tool({
    name: "detect_duplicate_payments",
    description:
      "Find payments that look like duplicates: same member, same amount, within a short window (default 10 minutes). Catches staff hitting save twice or double-charging a member. Returns count and sample. Use for 'any duplicate charges', 'are we double-billing anyone' questions.",
    parameters: dateRange.extend({
      windowMinutes: z.number().nullable().describe("Window size in minutes — default 10"),
    }),
    async execute(input) {
      const r = parseRange(input);
      if (!r) return JSON.stringify({ error: "Invalid date range" });
      const out = await detectDuplicatePayments({ ...r, windowMinutes: input.windowMinutes ?? 10 });
      return JSON.stringify(out);
    },
  }),

  tool({
    name: "detect_off_shift_cash",
    description:
      "Cash payments that were NOT recorded against an open cash shift — Robin can't reconcile these against the drawer. Returns total, count, breakdown by collector, and sample. Use for 'is anyone collecting cash without opening a shift', 'cash that bypassed reconciliation'.",
    parameters: dateRange,
    async execute(input) {
      const r = parseRange(input);
      if (!r) return JSON.stringify({ error: "Invalid date range" });
      const out = await detectOffShiftCashPayments(r);
      return JSON.stringify(out);
    },
  }),

  tool({
    name: "detect_discount_outliers",
    description:
      "Per-staff discount distribution. Surfaces collectors whose median discount is materially higher than the gym-wide median — 'sweethearting' friends. Returns gym median, per-collector breakdown, and a list of flagged outliers.",
    parameters: dateRange,
    async execute(input) {
      const r = parseRange(input);
      if (!r) return JSON.stringify({ error: "Invalid date range" });
      const out = await detectDiscountOutliers(r);
      return JSON.stringify(out);
    },
  }),

  tool({
    name: "detect_refund_routing",
    description:
      "Refunds where the requesting staff is the same person who originally collected the payment — and especially when refund mode is cash. A classic 'route through myself' pattern. Returns count, cash subset, total amount, and suspect list.",
    parameters: dateRange,
    async execute(input) {
      const r = parseRange(input);
      if (!r) return JSON.stringify({ error: "Invalid date range" });
      const out = await detectRefundRouting(r);
      return JSON.stringify(out);
    },
  }),

  tool({
    name: "detect_comp_abuse_patterns",
    description:
      "Who issues free / complimentary memberships and who keeps receiving them. Use for: 'top comp issuers', 'who got multiple comps', 'comps in a row', 'repeat comp recipients', 'is anyone abusing the comp system'. Built from comp.issue + comp_pass.issue audit logs — returns topIssuers and repeatRecipients (members with 2+ comps in the window).",
    parameters: dateRange,
    async execute(input) {
      const r = parseRange(input);
      if (!r) return JSON.stringify({ error: "Invalid date range" });
      const out = await detectCompAbusePatterns(r);
      return JSON.stringify(out);
    },
  }),

  tool({
    name: "detect_balance_mismatches",
    description:
      "Tickets where recorded amountPaid disagrees with the actual Payment sum for that ticket. Catches: payment recorded against wrong ticket, ticket amountPaid manually adjusted, or a payment deleted out-of-band. By default scans only the last 90 days of tickets (recentOnly=true) so legacy import drift is filtered out. Set recentOnly=false for a full historical sweep. Returns mismatch count, total drift, and the worst offenders.",
    parameters: z.object({
      locationId: z.number().nullable().describe("Filter by location ID"),
      limit: z.number().nullable().describe("Max mismatch rows to return (default 50)"),
      recentOnly: z.boolean().nullable().describe("Default true. When false, scan all-time tickets (will include legacy import noise)."),
      recentDays: z.number().nullable().describe("Lookback window if recentOnly is true. Default 90."),
      minDriftRupees: z.number().nullable().describe("Ignore mismatches smaller than this rupee amount. Default 100."),
    }),
    async execute(input) {
      const out = await detectBalanceMismatches({
        locationId: input.locationId ?? undefined,
        limit: input.limit ?? 50,
        recentOnly: input.recentOnly ?? true,
        recentDays: input.recentDays ?? 90,
        minDriftRupees: input.minDriftRupees ?? 100,
      });
      return JSON.stringify(out);
    },
  }),

  tool({
    name: "detect_audit_anomalies",
    description:
      "Per-staff rates of sensitive audit actions (password_reset, member_transfer, refund.*, comp.issue, cash_shift.variance_approve). Tells Robin which staff member is most active in the dangerous areas.",
    parameters: dateRange,
    async execute(input) {
      const r = parseRange(input);
      if (!r) return JSON.stringify({ error: "Invalid date range" });
      const out = await detectAuditAnomalies(r);
      return JSON.stringify(out);
    },
  }),

  tool({
    name: "get_owner_anomaly_summary",
    description:
      "One-shot owner trust summary across all anomaly detectors for the given range. Use this when Robin asks 'anything I should know', 'any anomalies', 'is my staff stealing', or for a daily/weekly trust briefing. Returns compact JSON with the top signals from every detector.",
    parameters: dateRange,
    async execute(input) {
      const r = parseRange(input);
      if (!r) return JSON.stringify({ error: "Invalid date range" });
      const out = await getOwnerAnomalySummary(r);
      return JSON.stringify(out);
    },
  }),
];
