/**
 * Silent Churn agent.
 *
 * Identifies members whose visit cadence has dropped sharply versus their own
 * personal 90-day baseline. Members with active memberships only — no point
 * flagging churn for someone whose ticket already expired.
 *
 * Severity:
 *   - high   if drop > 70%
 *   - medium otherwise (drop in [50%, 70%])
 *
 * Dedupe: one Insight per (user, day).
 */

import { prisma } from "@/lib/prisma";
import { upsertInsight, type InsightSeverity } from "./_shared";
import { isoDay } from "./_helpers";

const AGENT = "silent_churn";

const RECENT_DAYS = 14;
const BASELINE_DAYS = 90;
const DROP_THRESHOLD = 0.5; // 50%
const HIGH_DROP_THRESHOLD = 0.7; // 70%
/** Skip users who haven't visited enough historically — noise. */
const MIN_BASELINE_VISITS = 6;

export async function run(): Promise<{ created: number; total: number }> {
  const now = new Date();
  const baselineStart = new Date(now.getTime() - BASELINE_DAYS * 86400000);
  const recentStart = new Date(now.getTime() - RECENT_DAYS * 86400000);

  // Pull members with an active membership (expireDate today or later) so we
  // don't waste effort flagging already-churned users.
  const activeMembers = await prisma.user.findMany({
    where: {
      isActive: true,
      memberTickets: {
        some: { expireDate: { gte: now }, status: "active" },
      },
    },
    select: {
      id: true,
      firstname: true,
      lastname: true,
      phone: true,
      attendanceLogs: {
        where: { checkIn: { gte: baselineStart } },
        select: { checkIn: true },
      },
    },
  });

  const dateKey = isoDay();
  let created = 0;
  let total = 0;

  for (const m of activeMembers) {
    const baselineVisits = m.attendanceLogs.length;
    if (baselineVisits < MIN_BASELINE_VISITS) continue;

    const recentVisits = m.attendanceLogs.filter(
      (a) => a.checkIn >= recentStart
    ).length;

    // Expected visits in the last 14d if the member kept their 90d cadence.
    const expectedRecent = (baselineVisits / BASELINE_DAYS) * RECENT_DAYS;
    if (expectedRecent < 1) continue; // protects against divide-by-zero noise

    const dropRatio = 1 - recentVisits / expectedRecent;
    if (dropRatio < DROP_THRESHOLD) continue;

    total++;

    const severity: InsightSeverity =
      dropRatio > HIGH_DROP_THRESHOLD ? "high" : "medium";
    const dropPct = Math.round(dropRatio * 100);
    const name = `${m.firstname} ${m.lastname}`.trim();

    const result = await upsertInsight({
      agent: AGENT,
      severity,
      title: `${name} — visits down ${dropPct}% vs 90d baseline`,
      body:
        `${name} averaged ${(baselineVisits / BASELINE_DAYS).toFixed(2)} visits/day over the last 90 days ` +
        `but only ${recentVisits} visit(s) in the last ${RECENT_DAYS} days ` +
        `(expected ~${expectedRecent.toFixed(1)}). Reach out before they drop off entirely.`,
      dataJson: {
        userId: m.id,
        baselineVisits,
        recentVisits,
        expectedRecent,
        dropRatio,
        baselineDays: BASELINE_DAYS,
        recentDays: RECENT_DAYS,
      },
      suggestedActions: [
        {
          label: "Send reminder",
          action: "member.send_reminder",
          args: { userId: m.id, reason: "silent_churn" },
        },
        {
          label: "View member",
          action: "navigate",
          args: { href: `/admin/members/${m.id}` },
        },
      ],
      entityType: "user",
      entityId: m.id,
      dedupeKey: `${AGENT}:user_${m.id}:${dateKey}`,
    });

    if (result.created) created++;
  }

  return { created, total };
}
