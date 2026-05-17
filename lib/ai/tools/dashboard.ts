import { tool } from "@openai/agents";
import { z } from "zod";
import { n } from "./utils";
import {
  getStats,
  getStaffPerformance,
  getProfitLoss,
  getDailyCollection,
  getCollectionsInRange,
  getExpiredMembershipsInRange,
  getPTRevenueByTrainer,
  getUpgradeStats,
} from "@/lib/services/dashboard";
import { getActivityFeed } from "@/lib/actions/activity";
import { getMyDashboard } from "@/lib/actions/worker-dashboard";

export const dashboardTools = [
  tool({
    name: "get_dashboard_stats",
    description: "Get gym dashboard statistics: active members, revenue, check-ins, expiring memberships, overdue payments, birthdays, plan distribution",
    parameters: z.object({
      locationId: z.number().nullable().describe("Filter by location ID"),
    }),
    async execute(input) {
      const stats = await getStats(input.locationId ?? undefined);
      return JSON.stringify(stats);
    },
  }),

  tool({
    name: "get_profit_loss",
    description: "Get monthly profit & loss report (revenue, expenses, net). Admin only.",
    parameters: z.object({
      month: z.string().describe("Month in YYYY-MM format, e.g. 2026-04"),
      locationId: z.number().nullable().describe("Filter by location ID"),
    }),
    async execute(input) {
      const pnl = await getProfitLoss(input.month, input.locationId ?? undefined);
      return JSON.stringify(pnl);
    },
  }),

  tool({
    name: "get_staff_performance",
    description: "Get staff performance metrics: collections, check-ins per staff member. Admin only.",
    parameters: z.object({
      monthStart: z.string().describe("Start date ISO string, e.g. 2026-04-01"),
      monthEnd: z.string().describe("End date ISO string, e.g. 2026-04-30"),
    }),
    async execute(input) {
      const perf = await getStaffPerformance(new Date(input.monthStart), new Date(input.monthEnd));
      return JSON.stringify(perf);
    },
  }),

  tool({
    name: "get_activity_feed",
    description: "Get recent activity feed (check-ins, payments, new members, etc.)",
    parameters: z.object({}),
    async execute() {
      const feed = await getActivityFeed();
      return JSON.stringify(feed);
    },
  }),

  tool({
    name: "get_daily_collection",
    description: "Get today's collection summary grouped by payment mode (cash, upi, card, cheque) and by staff member",
    parameters: z.object({
      locationId: z.number().nullable().describe("Filter by location ID"),
    }),
    async execute(input) {
      const result = await getDailyCollection(input.locationId ?? undefined);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_expired_memberships_in_range",
    description:
      "Memberships that expired between two dates (inclusive). Returns count, total paid value, total billed value, per-plan breakdown, and a sample of up to 20 expired members with phone numbers (useful for renewal call lists).",
    parameters: z.object({
      from: z.string().describe("Start date inclusive, YYYY-MM-DD"),
      to: z.string().describe("End date inclusive, YYYY-MM-DD"),
      locationId: z.number().nullable().describe("Filter by location ID"),
    }),
    async execute(input) {
      const from = new Date(`${input.from}T00:00:00.000Z`);
      const to = new Date(`${input.to}T00:00:00.000Z`);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        return JSON.stringify({ error: `Invalid date — expected YYYY-MM-DD, got from=${input.from} to=${input.to}` });
      }
      const result = await getExpiredMembershipsInRange(from, to, input.locationId ?? undefined);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_pt_revenue_by_trainer",
    description:
      "PT plan revenue split by trainer over a date range. Identifies PT plans by name (contains PT or OPT). Use this for trainer payouts, PT performance rankings, and 'who's selling the most PT' questions.",
    parameters: z.object({
      from: z.string().describe("Start date inclusive, YYYY-MM-DD"),
      to: z.string().describe("End date inclusive, YYYY-MM-DD"),
      locationId: z.number().nullable().describe("Filter by location ID"),
    }),
    async execute(input) {
      const from = new Date(`${input.from}T00:00:00.000Z`);
      const to = new Date(`${input.to}T00:00:00.000Z`);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        return JSON.stringify({ error: `Invalid date — expected YYYY-MM-DD, got from=${input.from} to=${input.to}` });
      }
      const result = await getPTRevenueByTrainer(from, to, input.locationId ?? undefined);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_collections_in_range",
    description:
      "Get total payment collections for an arbitrary date range. Returns the grand total, per-day breakdown, payment-mode breakdown (cash/upi/card/cheque/other), and PT vs non-PT split. Use this for any 'how much did we collect between X and Y' question. Excludes complimentary payments.",
    parameters: z.object({
      from: z.string().describe("Start date inclusive, ISO format YYYY-MM-DD"),
      to: z.string().describe("End date inclusive, ISO format YYYY-MM-DD"),
      locationId: z.number().nullable().describe("Filter by location ID"),
    }),
    async execute(input) {
      const from = new Date(`${input.from}T00:00:00.000Z`);
      const to = new Date(`${input.to}T00:00:00.000Z`);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        return JSON.stringify({ error: `Invalid date — expected YYYY-MM-DD, got from=${input.from} to=${input.to}` });
      }
      const result = await getCollectionsInRange(from, to, input.locationId ?? undefined);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_upgrade_stats",
    description: "Get plan upgrade statistics with monthly trends. Queries audit logs for upgrade actions.",
    parameters: z.object({
      from: z.string().nullable().describe("Start date ISO string, e.g. 2026-01-01"),
      to: z.string().nullable().describe("End date ISO string, e.g. 2026-04-30"),
      locationId: z.number().nullable().describe("Filter by location ID"),
    }),
    async execute(input) {
      const dateRange = input.from && input.to ? { from: input.from, to: input.to } : undefined;
      const result = await getUpgradeStats(dateRange, input.locationId ?? undefined);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_worker_dashboard",
    description: "Get personal dashboard for a specific staff member: today's attendance, collections, leave balance",
    parameters: z.object({
      workerId: z.number().describe("Worker ID"),
      locationId: z.number().nullable().describe("Location ID"),
    }),
    async execute(input) {
      const dash = await getMyDashboard(input.workerId, input.locationId ?? undefined);
      return JSON.stringify(dash);
    },
  }),
];
