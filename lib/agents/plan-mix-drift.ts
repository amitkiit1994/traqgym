/**
 * Plan Mix Drift agent.
 *
 * Weekly check for plans whose share of new ticket sales swung > 20 percentage
 * points month-over-month. Useful for spotting "everyone is buying the cheap
 * plan now" or "the new HIIT plan blew up".
 *
 * Requires a baseline (previous month) volume of ≥10 new tickets for the plan
 * so a one-off rare plan with a single sale doesn't trigger noise.
 */

import { prisma } from "@/lib/prisma";
import { upsertInsight } from "./_shared";
import { isoWeekStart } from "./_helpers";
import { istCalendarFor, istMonthBoundsUtc } from "@/lib/utils/date-ist";

const AGENT = "plan_mix_drift";

const SWING_THRESHOLD_PP = 20; // percentage points
const MIN_BASELINE_TICKETS = 10;

export async function run(): Promise<{ created: number; total: number }> {
  const now = new Date();
  // Use IST month boundaries (gym operates in IST). UTC boundaries would
  // misclassify sales between 18:30–24:00 UTC into the wrong calendar month.
  const istNow = istCalendarFor(now); // month is 0-indexed
  const thisYear = istNow.year;
  const thisMonth1 = istNow.month + 1; // make 1-indexed
  const prevMonth1 = thisMonth1 === 1 ? 12 : thisMonth1 - 1;
  const prevYear = thisMonth1 === 1 ? thisYear - 1 : thisYear;
  const thisBounds = istMonthBoundsUtc(thisYear, thisMonth1);
  const prevBounds = istMonthBoundsUtc(prevYear, prevMonth1);
  const thisMonthStart = thisBounds.startUtc;
  const lastMonthStart = prevBounds.startUtc;

  // Aggregate new tickets per plan for this month and last month.
  const [thisMonthRows, lastMonthRows] = await Promise.all([
    prisma.memberTicket.groupBy({
      by: ["planId"],
      where: { buyDate: { gte: thisMonthStart } },
      _count: { _all: true },
    }),
    prisma.memberTicket.groupBy({
      by: ["planId"],
      where: { buyDate: { gte: lastMonthStart, lt: thisMonthStart } },
      _count: { _all: true },
    }),
  ]);

  const thisCounts = new Map<number, number>();
  for (const r of thisMonthRows) thisCounts.set(r.planId, r._count._all);
  const lastCounts = new Map<number, number>();
  for (const r of lastMonthRows) lastCounts.set(r.planId, r._count._all);

  const thisTotal = [...thisCounts.values()].reduce((a, b) => a + b, 0);
  const lastTotal = [...lastCounts.values()].reduce((a, b) => a + b, 0);

  if (thisTotal === 0 || lastTotal === 0) {
    return { created: 0, total: 0 };
  }

  const planIds = new Set<number>([...thisCounts.keys(), ...lastCounts.keys()]);
  const plans =
    planIds.size > 0
      ? await prisma.ticketPlan.findMany({
          where: { id: { in: [...planIds] } },
          select: { id: true, name: true },
        })
      : [];
  const planNameById = new Map(plans.map((p) => [p.id, p.name]));

  const weekKey = isoWeekStart(now);
  let created = 0;
  let total = 0;

  for (const planId of planIds) {
    const lastCount = lastCounts.get(planId) ?? 0;
    if (lastCount < MIN_BASELINE_TICKETS) continue;

    const thisCount = thisCounts.get(planId) ?? 0;
    const thisShare = thisCount / thisTotal;
    const lastShare = lastCount / lastTotal;
    const swingPp = (thisShare - lastShare) * 100;

    if (Math.abs(swingPp) < SWING_THRESHOLD_PP) continue;

    total++;
    const direction = swingPp > 0 ? "up" : "down";
    const planName = planNameById.get(planId) ?? `Plan #${planId}`;
    const result = await upsertInsight({
      agent: AGENT,
      severity: "medium",
      title: `${planName} share ${direction} ${Math.abs(swingPp).toFixed(1)}pp MoM`,
      body:
        `"${planName}" was ${(lastShare * 100).toFixed(1)}% of new tickets last month ` +
        `(${lastCount}/${lastTotal}) and is now ${(thisShare * 100).toFixed(1)}% ` +
        `(${thisCount}/${thisTotal}). ${direction === "up" ? "Surge — investigate why." : "Slump — check pricing/positioning."}`,
      dataJson: {
        planId,
        planName,
        thisCount,
        lastCount,
        thisShare,
        lastShare,
        swingPp,
        thisTotal,
        lastTotal,
      },
      suggestedActions: [
        {
          label: "Open plans",
          action: "navigate",
          args: { href: "/admin/plans" },
        },
      ],
      entityType: "global",
      dedupeKey: `${AGENT}:plan_${planId}:${weekKey}`,
    });
    if (result.created) created++;
  }

  return { created, total };
}
