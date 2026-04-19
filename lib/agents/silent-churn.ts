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

  // Sprint 3 perf: was `findMany(activeMembers).include(attendanceLogs)`,
  // which on E-GYM (10k+ active members × up to 90 days of logs) pulled
  // hundreds of thousands of log rows into Node and did the counting in
  // JS. Now we push the bucketing to PostgreSQL via two parallel `groupBy`
  // calls — one per window — so only one row per user is returned. A final
  // `findMany(user where id in [candidates])` hydrates names just for the
  // members that actually crossed the threshold.
  const [baselineCounts, recentCounts] = await Promise.all([
    prisma.attendanceLog.groupBy({
      by: ["userId"],
      where: {
        checkIn: { gte: baselineStart },
        userId: { not: null },
        user: {
          isActive: true,
          memberTickets: { some: { expireDate: { gte: now }, status: "active" } },
        },
      },
      _count: { _all: true },
      having: { userId: { _count: { gte: MIN_BASELINE_VISITS } } },
    }),
    prisma.attendanceLog.groupBy({
      by: ["userId"],
      where: {
        checkIn: { gte: recentStart },
        userId: { not: null },
      },
      _count: { _all: true },
    }),
  ]);

  const recentByUser = new Map<number, number>();
  for (const r of recentCounts) {
    if (r.userId != null) recentByUser.set(r.userId, r._count._all);
  }

  type Candidate = {
    userId: number;
    baselineVisits: number;
    recentVisits: number;
    expectedRecent: number;
    dropRatio: number;
  };
  const candidates: Candidate[] = [];
  for (const b of baselineCounts) {
    if (b.userId == null) continue;
    const baselineVisits = b._count._all;
    const recentVisits = recentByUser.get(b.userId) ?? 0;
    const expectedRecent = (baselineVisits / BASELINE_DAYS) * RECENT_DAYS;
    if (expectedRecent < 1) continue;
    const dropRatio = 1 - recentVisits / expectedRecent;
    if (dropRatio < DROP_THRESHOLD) continue;
    candidates.push({
      userId: b.userId,
      baselineVisits,
      recentVisits,
      expectedRecent,
      dropRatio,
    });
  }

  if (candidates.length === 0) return { created: 0, total: 0 };

  // Hydrate names only for members that actually crossed the threshold.
  const users = await prisma.user.findMany({
    where: { id: { in: candidates.map((c) => c.userId) } },
    select: { id: true, firstname: true, lastname: true },
  });
  const nameById = new Map(
    users.map((u) => [u.id, `${u.firstname} ${u.lastname}`.trim()] as const),
  );

  const dateKey = isoDay();
  let created = 0;
  let total = 0;

  for (const c of candidates) {
    total++;
    const severity: InsightSeverity =
      c.dropRatio > HIGH_DROP_THRESHOLD ? "high" : "medium";
    const dropPct = Math.round(c.dropRatio * 100);
    const name = nameById.get(c.userId) ?? `Member ${c.userId}`;

    const result = await upsertInsight({
      agent: AGENT,
      severity,
      title: `${name} — visits down ${dropPct}% vs 90d baseline`,
      body:
        `${name} averaged ${(c.baselineVisits / BASELINE_DAYS).toFixed(2)} visits/day over the last 90 days ` +
        `but only ${c.recentVisits} visit(s) in the last ${RECENT_DAYS} days ` +
        `(expected ~${c.expectedRecent.toFixed(1)}). Reach out before they drop off entirely.`,
      dataJson: {
        userId: c.userId,
        baselineVisits: c.baselineVisits,
        recentVisits: c.recentVisits,
        expectedRecent: c.expectedRecent,
        dropRatio: c.dropRatio,
        baselineDays: BASELINE_DAYS,
        recentDays: RECENT_DAYS,
      },
      suggestedActions: [
        {
          label: "Send reminder",
          action: "member.send_reminder",
          args: { userId: c.userId, reason: "silent_churn" },
        },
        {
          label: "View member",
          action: "navigate",
          args: { href: `/admin/members/${c.userId}` },
        },
      ],
      entityType: "user",
      entityId: c.userId,
      dedupeKey: `${AGENT}:user_${c.userId}:${dateKey}`,
    });

    if (result.created) created++;
  }

  return { created, total };
}
