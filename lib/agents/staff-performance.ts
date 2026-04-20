/**
 * Staff Performance agent.
 *
 * Weekly per-worker enquiry follow-up → conversion ratio over the last 30
 * days. Flags outliers whose conversion is below 50% of the team median, with
 * a minimum follow-up volume to avoid noise from idle staff.
 *
 * "Conversion" here = the worker logged at least one EnquiryFollowup whose
 * outcome is "converted" for that enquiry. We count distinct enquiries.
 */

import { prisma } from "@/lib/prisma";
import { upsertInsight } from "./_shared";
import { isoWeekStart, median } from "./_helpers";

const AGENT = "staff_performance";

const WINDOW_DAYS = 30;
const MIN_FOLLOWUPS = 5;
const RATIO_THRESHOLD = 0.5; // < 50% of team median

export async function run(): Promise<{ created: number; total: number }> {
  const now = new Date();
  const since = new Date(now.getTime() - WINDOW_DAYS * 86400000);

  const followups = await prisma.enquiryFollowup.findMany({
    where: { createdAt: { gte: since } },
    select: {
      workerId: true,
      enquiryId: true,
      outcome: true,
      worker: { select: { firstname: true, lastname: true, isActive: true } },
    },
  });

  // Aggregate per worker: distinct enquiries followed up, distinct converted.
  type Stat = {
    workerId: number;
    name: string;
    isActive: boolean;
    followups: Set<number>;
    conversions: Set<number>;
  };
  const stats = new Map<number, Stat>();
  for (const f of followups) {
    let s = stats.get(f.workerId);
    if (!s) {
      s = {
        workerId: f.workerId,
        name: `${f.worker?.firstname ?? ""} ${f.worker?.lastname ?? ""}`.trim() ||
          `Worker #${f.workerId}`,
        isActive: f.worker?.isActive ?? false,
        followups: new Set<number>(),
        conversions: new Set<number>(),
      };
      stats.set(f.workerId, s);
    }
    s.followups.add(f.enquiryId);
    if (f.outcome === "converted") s.conversions.add(f.enquiryId);
  }

  // Compute conversion ratios for active workers with enough volume.
  const ratios: Array<{
    workerId: number;
    name: string;
    followups: number;
    conversions: number;
    ratio: number;
  }> = [];
  for (const s of stats.values()) {
    if (!s.isActive) continue;
    if (s.followups.size < MIN_FOLLOWUPS) continue;
    ratios.push({
      workerId: s.workerId,
      name: s.name,
      followups: s.followups.size,
      conversions: s.conversions.size,
      ratio: s.conversions.size / s.followups.size,
    });
  }

  if (ratios.length === 0) {
    return { created: 0, total: 0 };
  }

  const teamMedian = median(ratios.map((r) => r.ratio));
  const cutoff = teamMedian * RATIO_THRESHOLD;

  const weekKey = isoWeekStart(now);
  let created = 0;
  let total = 0;

  for (const r of ratios) {
    if (r.ratio >= cutoff) continue;
    if (teamMedian === 0) continue; // nothing to compare against

    total++;
    const result = await upsertInsight({
      agent: AGENT,
      severity: "medium",
      title: `${r.name} — conversion ${(r.ratio * 100).toFixed(0)}% (team median ${(teamMedian * 100).toFixed(0)}%)`,
      body:
        `${r.name} converted ${r.conversions} of ${r.followups} enquiries followed up in the last ${WINDOW_DAYS} days ` +
        `(${(r.ratio * 100).toFixed(1)}%). Team median is ${(teamMedian * 100).toFixed(1)}%. ` +
        `Worth a 1:1 — coaching, lead quality, or workload could be the cause.`,
      dataJson: {
        workerId: r.workerId,
        followups: r.followups,
        conversions: r.conversions,
        ratio: r.ratio,
        teamMedian,
        windowDays: WINDOW_DAYS,
      },
      suggestedActions: [
        {
          label: "Open staff performance",
          action: "navigate",
          args: { href: `/admin/staff-performance?workerId=${r.workerId}` },
        },
      ],
      entityType: "worker",
      entityId: r.workerId,
      dedupeKey: `${AGENT}:worker_${r.workerId}:${weekKey}`,
    });
    if (result.created) created++;
  }

  return { created, total };
}
