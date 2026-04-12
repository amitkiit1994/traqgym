import { tool } from "@openai/agents";
import { z } from "zod";
import { getStats, getProfitLoss } from "@/lib/services/dashboard";
import { prisma } from "@/lib/prisma";

export const compositeTools = [
  tool({
    name: "get_morning_briefing",
    description:
      "Get a comprehensive morning briefing: today's check-ins, active members, revenue, expiring/overdue counts, P&L, and suggested actions",
    parameters: z.object({
      locationId: z.number().nullable().describe("Filter by location ID, null for all"),
    }),
    async execute(input) {
      const locId = input.locationId ?? undefined;
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      const [stats, pnl] = await Promise.all([
        getStats(locId),
        getProfitLoss(month, locId),
      ]);

      const topActions: string[] = [];
      if (stats.overdueMembers.length > 0) {
        topActions.push(
          `Follow up with ${stats.overdueMembers.length} overdue member(s) — revenue at risk`
        );
      }
      if (stats.expiringIn3Days.length > 0) {
        topActions.push(
          `Renew ${stats.expiringIn3Days.length} membership(s) expiring in 3 days`
        );
      }
      if (stats.todayBirthdays.length > 0) {
        topActions.push(
          `Wish happy birthday to ${stats.todayBirthdays.map((b) => b.name).join(", ")}`
        );
      }
      if (topActions.length < 3) {
        topActions.push("Review today's class schedule and staffing");
      }

      const result = {
        todayCheckIns: stats.todayCheckIns,
        activeMembers: stats.activeMembers,
        revenueThisMonth: stats.revenueThisMonth,
        expiringCount: stats.expiringIn3Days.length,
        overdueCount: stats.overdueMembers.length,
        profitLoss: pnl,
        topActions: topActions.slice(0, 3),
      };

      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_followup_queue",
    description:
      "Get a priority-ranked follow-up queue combining overdue members, expiring memberships, and open enquiries",
    parameters: z.object({
      locationId: z.number().nullable().describe("Filter by location ID, null for all"),
    }),
    async execute(input) {
      const locId = input.locationId ?? undefined;
      const now = new Date();
      const threeDaysFromNow = new Date(now);
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const locWhere = locId ? { locationId: locId } : {};

      const [overdueUsers, expiringTickets, openEnquiries] = await Promise.all([
        // Overdue: expired > 7 days ago
        prisma.user.findMany({
          where: {
            ...locWhere,
            memberTickets: { some: {} },
            NOT: {
              memberTickets: { some: { expireDate: { gte: sevenDaysAgo } } },
            },
          },
          include: {
            memberTickets: {
              orderBy: { expireDate: "desc" },
              take: 1,
              include: { plan: { select: { name: true } } },
            },
          },
          take: 20,
        }),
        // Expiring in 3 days
        prisma.memberTicket.findMany({
          where: {
            ...(locId ? { locationId: locId } : {}),
            expireDate: { gte: now, lte: threeDaysFromNow },
          },
          include: {
            user: { select: { firstname: true, lastname: true, phone: true } },
            plan: { select: { name: true } },
          },
          orderBy: { expireDate: "asc" },
          take: 20,
        }),
        // Open enquiries (new or contacted)
        prisma.enquiry.findMany({
          where: {
            ...locWhere,
            status: { in: ["new", "contacted"] },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
      ]);

      type QueueItem = {
        type: "overdue" | "expiring" | "enquiry";
        name: string;
        phone: string;
        detail: string;
        suggestedAction: string;
      };

      const queue: QueueItem[] = [];

      for (const u of overdueUsers) {
        const ticket = u.memberTickets[0];
        queue.push({
          type: "overdue",
          name: `${u.firstname} ${u.lastname}`,
          phone: u.phone || "-",
          detail: `Expired since ${ticket.expireDate.toISOString().split("T")[0]}, plan: ${ticket.plan.name}`,
          suggestedAction: "Call and offer renewal with incentive",
        });
      }

      for (const t of expiringTickets) {
        queue.push({
          type: "expiring",
          name: `${t.user.firstname} ${t.user.lastname}`,
          phone: t.user.phone || "-",
          detail: `Expires ${t.expireDate.toISOString().split("T")[0]}, plan: ${t.plan.name}`,
          suggestedAction: "Remind about upcoming renewal",
        });
      }

      for (const e of openEnquiries) {
        queue.push({
          type: "enquiry",
          name: e.name,
          phone: e.phone,
          detail: `Status: ${e.status}, interest: ${e.interest || "general"}, source: ${e.source}`,
          suggestedAction:
            e.status === "new" ? "Make first contact call" : "Schedule gym visit",
        });
      }

      return JSON.stringify(queue);
    },
  }),

  tool({
    name: "get_end_of_day_summary",
    description:
      "Get end-of-day summary: today's collections, check-ins, new members, and renewals",
    parameters: z.object({
      locationId: z.number().nullable().describe("Filter by location ID, null for all"),
    }),
    async execute(input) {
      const locId = input.locationId ?? undefined;
      const now = new Date();
      const todayStart = new Date(now.toISOString().split("T")[0]);
      const todayEnd = new Date(todayStart);
      todayEnd.setDate(todayEnd.getDate() + 1);

      const locWhere = locId ? { locationId: locId } : {};

      const [collectionsResult, checkIns, newMembers, renewals] =
        await Promise.all([
          prisma.payment.aggregate({
            where: {
              ...locWhere,
              createdAt: { gte: todayStart, lt: todayEnd },
            },
            _sum: { amount: true },
            _count: { id: true },
          }),
          prisma.attendanceLog.count({
            where: {
              ...locWhere,
              attendanceDate: { gte: todayStart, lt: todayEnd },
              userId: { not: null },
            },
          }),
          prisma.user.count({
            where: {
              ...locWhere,
              createdAt: { gte: todayStart, lt: todayEnd },
            },
          }),
          prisma.memberTicket.count({
            where: {
              ...(locId ? { locationId: locId } : {}),
              createdAt: { gte: todayStart, lt: todayEnd },
            },
          }),
        ]);

      const result = {
        todayCollections: collectionsResult._sum.amount
          ? Number(collectionsResult._sum.amount)
          : 0,
        paymentCount: collectionsResult._count.id,
        todayCheckIns: checkIns,
        newMembersToday: newMembers,
        renewalsToday: renewals,
      };

      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_member_health_check",
    description:
      "Get a comprehensive health check for a specific member: plan status, attendance patterns, balance due, risk level, and suggestions",
    parameters: z.object({
      userId: z.number().describe("Member user ID"),
    }),
    async execute(input) {
      const now = new Date();
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const [user, attendanceLast30] = await Promise.all([
        prisma.user.findUnique({
          where: { id: input.userId },
          include: {
            memberTickets: {
              orderBy: { expireDate: "desc" },
              take: 1,
              select: {
                expireDate: true,
                buyDate: true,
                balanceDue: true,
                amountPaid: true,
                status: true,
                plan: { select: { name: true } },
              },
            },
          },
        }),
        prisma.attendanceLog.count({
          where: {
            userId: input.userId,
            attendanceDate: { gte: thirtyDaysAgo },
          },
        }),
      ]);

      if (!user) {
        return JSON.stringify({ error: "Member not found" });
      }

      const ticket = user.memberTickets[0];
      const hasTicket = !!ticket;
      const isExpired = hasTicket && ticket.expireDate < now;
      const daysRemaining = hasTicket
        ? Math.ceil(
            (ticket.expireDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          )
        : 0;
      const avgVisitsPerWeek = Math.round((attendanceLast30 / 30) * 7 * 10) / 10;

      let riskLevel: "low" | "medium" | "high" = "low";
      if (!hasTicket || isExpired) {
        riskLevel = "high";
      } else if (daysRemaining < 7 || avgVisitsPerWeek < 2) {
        riskLevel = "medium";
      }

      const suggestions: string[] = [];
      if (isExpired) {
        suggestions.push("Membership expired — contact for renewal immediately");
      } else if (daysRemaining < 7) {
        suggestions.push(
          `Only ${daysRemaining} day(s) left — initiate renewal conversation`
        );
      }
      if (avgVisitsPerWeek < 2 && hasTicket && !isExpired) {
        suggestions.push(
          "Low attendance — check in with member about motivation or schedule issues"
        );
      }
      if (hasTicket && Number(ticket.balanceDue) > 0) {
        suggestions.push(
          `Outstanding balance of Rs ${Number(ticket.balanceDue)} — follow up on payment`
        );
      }
      if (suggestions.length === 0) {
        suggestions.push("Member is in good standing — no action needed");
      }

      const result = {
        memberName: `${user.firstname} ${user.lastname}`,
        planStatus: !hasTicket
          ? "no_plan"
          : isExpired
            ? "expired"
            : "active",
        planName: ticket?.plan.name ?? "N/A",
        daysRemaining: isExpired ? 0 : daysRemaining,
        attendanceLastMonth: attendanceLast30,
        avgVisitsPerWeek,
        balanceDue: ticket ? Number(ticket.balanceDue) : 0,
        riskLevel,
        suggestions,
      };

      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_period_comparison",
    description:
      "Compare revenue, expenses, and profit between two months side by side",
    parameters: z.object({
      month1: z.string().describe("First month in YYYY-MM format, e.g. 2026-01"),
      month2: z.string().describe("Second month in YYYY-MM format, e.g. 2026-02"),
      locationId: z.number().nullable().describe("Filter by location ID, null for all"),
    }),
    async execute(input) {
      const locId = input.locationId ?? undefined;

      const [pnl1, pnl2] = await Promise.all([
        getProfitLoss(input.month1, locId),
        getProfitLoss(input.month2, locId),
      ]);

      const revenueDelta = pnl2.revenue - pnl1.revenue;
      const expenseDelta = pnl2.expenses - pnl1.expenses;
      const profitDelta = pnl2.netProfitLoss - pnl1.netProfitLoss;
      const revenueDeltaPct =
        pnl1.revenue > 0
          ? Math.round((revenueDelta / pnl1.revenue) * 100 * 10) / 10
          : 0;

      const result = {
        month1: { month: input.month1, ...pnl1 },
        month2: { month: input.month2, ...pnl2 },
        revenueDelta,
        expenseDelta,
        profitDelta,
        revenueDeltaPct,
      };

      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_plan_performance",
    description:
      "Get performance metrics for each plan: active member count, total revenue, and average tenure",
    parameters: z.object({
      locationId: z.number().nullable().describe("Filter by location ID, null for all"),
    }),
    async execute(input) {
      const locId = input.locationId ?? undefined;
      const now = new Date();
      const locWhere = locId ? { locationId: locId } : {};

      const activeTickets = await prisma.memberTicket.findMany({
        where: {
          ...locWhere,
          expireDate: { gte: now },
          status: "active",
        },
        include: {
          plan: { select: { id: true, name: true } },
        },
      });

      const planMap = new Map<
        number,
        {
          planName: string;
          activeMembers: number;
          totalRevenue: number;
          totalTenureDays: number;
        }
      >();

      for (const t of activeTickets) {
        const existing = planMap.get(t.planId);
        const tenureDays = Math.ceil(
          (t.expireDate.getTime() - t.buyDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        const revenue = Number(t.amountPaid);

        if (existing) {
          existing.activeMembers += 1;
          existing.totalRevenue += revenue;
          existing.totalTenureDays += tenureDays;
        } else {
          planMap.set(t.planId, {
            planName: t.plan.name,
            activeMembers: 1,
            totalRevenue: revenue,
            totalTenureDays: tenureDays,
          });
        }
      }

      const result = Array.from(planMap.values()).map((p) => ({
        planName: p.planName,
        activeMembers: p.activeMembers,
        totalRevenue: p.totalRevenue,
        avgTenureDays: Math.round(p.totalTenureDays / p.activeMembers),
      }));

      result.sort((a, b) => b.activeMembers - a.activeMembers);

      return JSON.stringify(result);
    },
  }),
];
