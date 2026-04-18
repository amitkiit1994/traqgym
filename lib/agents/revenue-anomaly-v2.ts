/**
 * Revenue Anomaly v2 agent.
 *
 * Compares yesterday's collection (sum of Payment.amount across all completed
 * payments) against the median of the previous 30 days. Flags ±25% deviation.
 *
 * Severity:
 *   - critical if drop > 50%
 *   - high     if drop in [25%, 50%]
 *   - medium   if positive deviation > 25% (a spike, worth investigating too)
 *
 * dataJson includes per-paymentMode and per-collector breakdowns so the
 * downstream investigator/manager can route the alert.
 */

import { prisma } from "@/lib/prisma";
import { upsertInsight, type InsightSeverity } from "./_shared";
import { inr, median, todayISO } from "./_helpers";

const AGENT = "revenue_anomaly_v2";

const DEVIATION_THRESHOLD = 0.25;
const HIGH_DROP_THRESHOLD = 0.5;

type DayWindow = { start: Date; end: Date };

function dayWindow(d: Date): DayWindow {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export async function run(): Promise<{ created: number; total: number }> {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yWin = dayWindow(yesterday);

  // Yesterday's total + per-mode + per-collector breakdowns
  const yesterdayPayments = await prisma.payment.findMany({
    where: { createdAt: { gte: yWin.start, lt: yWin.end } },
    select: {
      amount: true,
      paymentMode: true,
      collectedById: true,
      collectedBy: { select: { firstname: true, lastname: true } },
    },
  });

  const yesterdayTotal = yesterdayPayments.reduce(
    (sum, p) => sum + Number(p.amount ?? 0),
    0
  );

  const byMode: Record<string, number> = {};
  const byCollector: Record<string, { name: string; total: number }> = {};
  for (const p of yesterdayPayments) {
    const amt = Number(p.amount ?? 0);
    byMode[p.paymentMode] = (byMode[p.paymentMode] ?? 0) + amt;
    const cid = String(p.collectedById);
    if (!byCollector[cid]) {
      byCollector[cid] = {
        name: `${p.collectedBy?.firstname ?? ""} ${p.collectedBy?.lastname ?? ""}`.trim() ||
          `Worker #${p.collectedById}`,
        total: 0,
      };
    }
    byCollector[cid].total += amt;
  }

  // Build daily totals for the previous 30 days (excluding yesterday itself)
  const dailyTotals: number[] = [];
  for (let i = 2; i <= 31; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const w = dayWindow(d);
    const agg = await prisma.payment.aggregate({
      where: { createdAt: { gte: w.start, lt: w.end } },
      _sum: { amount: true },
    });
    dailyTotals.push(Number(agg._sum.amount ?? 0));
  }

  const med = median(dailyTotals);
  if (med <= 0) {
    // Not enough history (no payments in the prior 30 days). Don't fire.
    return { created: 0, total: 0 };
  }

  const deviation = (yesterdayTotal - med) / med;
  const absDeviation = Math.abs(deviation);
  if (absDeviation < DEVIATION_THRESHOLD) {
    return { created: 0, total: 0 };
  }

  const isDrop = deviation < 0;
  let severity: InsightSeverity;
  if (isDrop && absDeviation > HIGH_DROP_THRESHOLD) severity = "critical";
  else if (isDrop) severity = "high";
  else severity = "medium"; // positive spike

  const pct = Math.round(absDeviation * 100);
  const direction = isDrop ? "below" : "above";
  const dateKey = todayISO();

  const collectorList = Object.values(byCollector)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const result = await upsertInsight({
    agent: AGENT,
    severity,
    title: `Yesterday's collection ${pct}% ${direction} 30-day median`,
    body:
      `Collected ${inr(yesterdayTotal)} on ${yesterday.toISOString().slice(0, 10)} ` +
      `vs 30-day median of ${inr(med)}. ${isDrop ? "Investigate dip — " : "Spike — verify legitimacy. "}` +
      `Top mode: ${
        Object.entries(byMode)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 1)
          .map(([m, v]) => `${m} ${inr(v)}`)
          .join("") || "n/a"
      }.`,
    dataJson: {
      yesterdayDate: yesterday.toISOString().slice(0, 10),
      yesterdayTotal,
      median30d: med,
      deviation,
      direction: isDrop ? "drop" : "spike",
      byMode,
      byCollector: collectorList,
      estimatedImpactRupees: Math.abs(yesterdayTotal - med),
      requiresInvestigation: true,
    },
    suggestedActions: [
      {
        label: "Open reports",
        action: "navigate",
        args: { href: "/admin/reports" },
      },
    ],
    entityType: "global",
    dedupeKey: `${AGENT}:${dateKey}`,
  });

  return { created: result.created ? 1 : 0, total: 1 };
}
