/**
 * Cron: Manager Investigator (every 15 min).
 *
 * Picks up to 3 critical Insights flagged with `dataJson.requiresInvestigation`
 * and not yet enriched (`dataJson.investigatedAt` missing). For each, pulls
 * read-only context (recent attendance, payment history, complaint history)
 * and rewrites the insight `body` with an enriched narrative.
 *
 * READ-ONLY: never mutates anything outside the insight row itself.
 *
 * Schedule (vercel.json): "*\/15 * * * *"
 *
 * Auth: Bearer / x-cron-secret / ?secret= matching CRON_SECRET (env).
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { requireCronSecret } from "@/lib/auth-cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type InsightDataJson = Record<string, unknown> & {
  requiresInvestigation?: boolean;
  investigatedAt?: string;
  enrichmentStatus?: string;
};

type EnrichmentSummary = {
  attendanceLast30Days: number;
  lastSeenAt: string | null;
  paymentsLast90Days: number;
  totalCollectedLast90Days: number;
  pendingFollowups: number;
  recentComplaints: number;
};

async function gatherUserContext(userId: number): Promise<EnrichmentSummary> {
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const since90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const [att, lastAtt, payAgg, followups, feedbacks] = await Promise.all([
    prisma.attendanceLog.count({
      where: { userId, attendanceDate: { gte: since30 } },
    }),
    prisma.attendanceLog.findFirst({
      where: { userId },
      orderBy: { attendanceDate: "desc" },
      select: { attendanceDate: true },
    }),
    prisma.payment.aggregate({
      where: { userId, createdAt: { gte: since90 } },
      _count: true,
      _sum: { amount: true },
    }),
    prisma.paymentFollowup.count({
      where: { userId, status: { in: ["pending", "contacted", "promised"] } },
    }),
    prisma.feedback.count({
      where: { userId, rating: { lte: 2 }, createdAt: { gte: since90 } },
    }),
  ]);

  return {
    attendanceLast30Days: att,
    lastSeenAt: lastAtt?.attendanceDate
      ? lastAtt.attendanceDate.toISOString().slice(0, 10)
      : null,
    paymentsLast90Days: payAgg._count ?? 0,
    totalCollectedLast90Days: Number(payAgg._sum.amount ?? 0),
    pendingFollowups: followups,
    recentComplaints: feedbacks,
  };
}

function formatRupees(n: number): string {
  if (n <= 0) return "\u20B90";
  if (n >= 100000) return `\u20B9${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `\u20B9${Math.round(n / 1000)}k`;
  return `\u20B9${Math.round(n)}`;
}

function buildEnrichmentNarrative(
  ctx: EnrichmentSummary,
  entityType: string | null,
  entityId: number | null
): string {
  const lines: string[] = [];
  lines.push("\u2014 Investigation context \u2014");
  if (entityType === "user" && entityId) {
    lines.push(`Member #${entityId}:`);
  }
  lines.push(
    `\u2022 Attendance (last 30d): ${ctx.attendanceLast30Days} check-in${ctx.attendanceLast30Days === 1 ? "" : "s"}` +
      (ctx.lastSeenAt ? ` (last seen ${ctx.lastSeenAt})` : " (no recent check-in)")
  );
  lines.push(
    `\u2022 Payments (last 90d): ${ctx.paymentsLast90Days} (collected ${formatRupees(ctx.totalCollectedLast90Days)})`
  );
  if (ctx.pendingFollowups > 0) {
    lines.push(`\u2022 ${ctx.pendingFollowups} pending payment followup(s)`);
  }
  if (ctx.recentComplaints > 0) {
    lines.push(
      `\u2022 ${ctx.recentComplaints} negative feedback (rating \u2264 2) in last 90d`
    );
  }
  return lines.join("\n");
}

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  // Find critical insights that asked for investigation and haven't been
  // enriched yet. Prisma JSON path filters work on Postgres jsonb.
  const candidates = await prisma.insight.findMany({
    where: {
      dismissedAt: null,
      severity: "critical",
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const todo = candidates
    .filter((ins) => {
      const data = (ins.dataJson ?? {}) as InsightDataJson;
      if (data.requiresInvestigation !== true) return false;
      if (data.enrichmentStatus === "done") return false;
      if (data.investigatedAt) return false;
      return true;
    })
    .slice(0, 3);

  let investigated = 0;
  for (const ins of todo) {
    try {
      let enrichment = "";
      if (ins.entityType === "user" && typeof ins.entityId === "number") {
        const ctx = await gatherUserContext(ins.entityId);
        enrichment = buildEnrichmentNarrative(ctx, ins.entityType, ins.entityId);
      } else {
        enrichment =
          "\u2014 Investigation context \u2014\n(no per-user context available; entity is global)";
      }

      const newBody = `${ins.body.trim()}\n\n${enrichment}`;
      const newData = {
        ...((ins.dataJson ?? {}) as InsightDataJson),
        investigatedAt: new Date().toISOString(),
        enrichmentStatus: "done",
      } as Prisma.InputJsonValue;

      await prisma.insight.update({
        where: { id: ins.id },
        data: {
          body: newBody,
          dataJson: newData,
        },
      });
      investigated++;
    } catch (err) {
      console.warn(
        `[manager-investigate] failed to enrich insight ${ins.id}:`,
        err
      );
    }
  }

  return Response.json({
    ok: true,
    investigated,
    candidates: todo.length,
    scanned: candidates.length,
  });
}
