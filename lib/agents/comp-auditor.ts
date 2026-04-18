/**
 * Comp Auditor agent.
 *
 * Periodically scans complimentary memberships + comp passes and emits Insights
 * for: high comp ratio, stale comps, conversion candidates, revenue leak.
 *
 * Insights are deduped daily via dedupeKey including the ISO date.
 */

import { getCompStats } from "@/lib/services/comp";
import { upsertInsight, type InsightSeverity } from "./_shared";

const AGENT = "comp_auditor";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export async function runCompAuditor(opts?: {
  locationId?: number;
}): Promise<{ insightsCreated: number }> {
  const stats = await getCompStats({ locationId: opts?.locationId });
  const dateKey = todayISO();
  const locSuffix = opts?.locationId ? `:loc${opts.locationId}` : "";

  let insightsCreated = 0;

  // ── 1. Comp ratio insight ───────────────────────────────────────────────
  if (stats.compRatio > 0.05) {
    const severity: InsightSeverity =
      stats.compRatio > 0.1 ? "critical" : "high";
    const pct = (stats.compRatio * 100).toFixed(1);
    const result = await upsertInsight({
      agent: AGENT,
      severity,
      title: `Comp ratio is ${pct}% — above healthy 5%`,
      body: `${stats.activeCompCount} comp ticket(s) + ${stats.activeCompPassCount} comp pass(es) are active. Industry healthy ceiling is 5%. Review issuance policy and consider converting high-engagement comps to paid.`,
      dataJson: {
        compRatio: stats.compRatio,
        activeCompCount: stats.activeCompCount,
        activeCompPassCount: stats.activeCompPassCount,
        topIssuers: stats.topIssuers,
      },
      suggestedActions: [
        {
          label: "Review active comps",
          action: "navigate",
          args: { href: "/admin/comps" },
        },
      ],
      dedupeKey: `comp_audit:${dateKey}:${severity}:comp_ratio${locSuffix}`,
    });
    if (result.created) insightsCreated++;
  }

  // ── 2. Stale comps insight (group, not per-comp) ────────────────────────
  if (stats.staleComps.length > 5) {
    const result = await upsertInsight({
      agent: AGENT,
      severity: "medium",
      title: `${stats.staleComps.length} stale comp(s) — no visit in 14+ days`,
      body: `Comps issued but not being used. Top: ${stats.staleComps
        .slice(0, 3)
        .map((s) => `${s.userName} (${s.daysSinceLastVisit}d)`)
        .join(", ")}. Consider revoking to clean up the books.`,
      dataJson: { staleComps: stats.staleComps.slice(0, 20) },
      suggestedActions: [
        {
          label: "Review stale comps",
          action: "navigate",
          args: { href: "/admin/comps?filter=stale" },
        },
      ],
      dedupeKey: `comp_audit:${dateKey}:medium:stale_comps${locSuffix}`,
    });
    if (result.created) insightsCreated++;
  }

  // ── 3. Conversion candidates insight ────────────────────────────────────
  if (stats.conversionCandidates.length > 0) {
    const top = stats.conversionCandidates
      .slice(0, 3)
      .map((c) => `${c.userName} (${c.visitsLast30d} visits)`)
      .join(", ");
    const result = await upsertInsight({
      agent: AGENT,
      severity: "high",
      title: `${stats.conversionCandidates.length} comp(s) ready to convert to paid`,
      body: `These users are visiting heavily on a comp — they're hooked. Top: ${top}. Pitch them a paid plan now.`,
      dataJson: {
        conversionCandidates: stats.conversionCandidates.slice(0, 20),
      },
      suggestedActions: [
        {
          label: "View conversion candidates",
          action: "navigate",
          args: { href: "/admin/comps?filter=conversion_ready" },
        },
      ],
      dedupeKey: `comp_audit:${dateKey}:high:conversion_candidates${locSuffix}`,
    });
    if (result.created) insightsCreated++;
  }

  // ── 4. Revenue leak insight ─────────────────────────────────────────────
  if (stats.revenueLeakEstimateInRupees > 10_000) {
    const severity: InsightSeverity =
      stats.revenueLeakEstimateInRupees > 50_000 ? "critical" : "high";
    const result = await upsertInsight({
      agent: AGENT,
      severity,
      title: `Estimated revenue leak from comps: ${inr(stats.revenueLeakEstimateInRupees)}`,
      body: `Sum of plan prices for active comp tickets. This is what you'd have collected if these were paid. ${stats.activeCompCount} comp(s) at risk.`,
      dataJson: {
        revenueLeakEstimateInRupees: stats.revenueLeakEstimateInRupees,
        activeCompCount: stats.activeCompCount,
      },
      suggestedActions: [
        {
          label: "Review comps",
          action: "navigate",
          args: { href: "/admin/comps" },
        },
      ],
      dedupeKey: `comp_audit:${dateKey}:${severity}:revenue_leak${locSuffix}`,
    });
    if (result.created) insightsCreated++;
  }

  return { insightsCreated };
}
