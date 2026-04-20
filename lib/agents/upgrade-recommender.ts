import { prisma } from "@/lib/prisma";
import { todayIST } from "@/lib/utils/date";

/**
 * Weekly job: scan active members and recommend plan upgrades when their
 * usage pattern strongly outpaces their current plan tier.
 *
 * Heuristics (any single trigger raises an Insight):
 *  1. High visit frequency on a "weekday only" / restricted plan
 *     (>4 visits/week sustained over the last 30 days).
 *  2. >50% of recent visits fall in peak hours (06:00–09:00 IST) AND
 *     the plan name suggests off-peak access ("off peak", "non-peak",
 *     "afternoon", "evening only").
 *  3. Generic over-utilisation: visits/30d > 4 * weeksDuration of plan,
 *     where weeksDuration = expireDays / 7.
 *
 * Recommendation target: cheapest active plan whose price is strictly
 * higher than the member's current plan, falling back to the most
 * expensive active plan if everything is at or below the current price.
 *
 * Dedupe: `upgrade_recommender:{userId}:{ISO-week}` baked into the
 * notification message; we look back 7 days for an existing notification
 * with the same key before inserting a new one.
 */
export async function runUpgradeRecommender(): Promise<{ insightsCreated: number }> {
  const today = todayIST();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const weekKey = isoWeekKey(today);

  // Active plans (used for upgrade target selection)
  const activePlans = await prisma.ticketPlan.findMany({
    where: { isActive: true, isTrial: false },
    orderBy: { price: "asc" },
  });
  if (activePlans.length === 0) return { insightsCreated: 0 };

  // Active members = users with at least one ticket whose expireDate is in the future
  const activeMembers = await prisma.user.findMany({
    where: {
      isActive: true,
      memberTickets: {
        some: { expireDate: { gte: today }, status: "active" },
      },
    },
    select: { id: true, firstname: true, lastname: true },
  });

  let insightsCreated = 0;

  for (const member of activeMembers) {
    try {
      // Latest active ticket
      const ticket = await prisma.memberTicket.findFirst({
        where: { userId: member.id, status: "active", expireDate: { gte: today } },
        include: { plan: true },
        orderBy: { expireDate: "desc" },
      });
      if (!ticket || !ticket.plan) continue;

      const planNameLower = ticket.plan.name.toLowerCase();
      const planPrice = Number(ticket.plan.price);
      const expireDays = ticket.plan.expireDays;
      if (!expireDays || expireDays <= 0) continue; // skip plans without duration
      const weeksDuration = expireDays / 7;

      // Pick a recommended target: cheapest plan strictly more expensive than current
      const upgradeTarget =
        activePlans.find((p) => Number(p.price) > planPrice && p.id !== ticket.planId) ??
        null;
      if (!upgradeTarget) continue; // already on top plan

      // Recent visits
      const visits = await prisma.attendanceLog.findMany({
        where: {
          userId: member.id,
          attendanceDate: { gte: thirtyDaysAgo, lte: today },
        },
        select: { checkIn: true },
      });
      const visitCount = visits.length;
      if (visitCount < 4) continue; // not enough signal

      // Peak-hour share (06:00–09:00 IST). checkIn is stored UTC; +5:30 to IST.
      let peakVisits = 0;
      for (const v of visits) {
        const istMs = v.checkIn.getTime() + 5.5 * 60 * 60 * 1000;
        const istHour = new Date(istMs).getUTCHours();
        if (istHour >= 6 && istHour < 9) peakVisits++;
      }
      const peakShare = visitCount > 0 ? peakVisits / visitCount : 0;

      // Heuristic triggers
      const restrictedNamePattern = /(weekday|off[- ]?peak|non[- ]?peak|afternoon|evening only|morning only)/i;
      const isRestricted = restrictedNamePattern.test(planNameLower);
      const visitsPerWeek = visitCount / 4.3; // 30 days ≈ 4.3 weeks
      const overUtilised = visitCount > 4 * weeksDuration; // matches the brief

      let reason: string | null = null;
      if (isRestricted && visitsPerWeek > 4) {
        reason = `${visitsPerWeek.toFixed(1)}x/week on restricted "${ticket.plan.name}"`;
      } else if (peakShare > 0.5 && /off[- ]?peak|non[- ]?peak|afternoon|evening only/i.test(planNameLower)) {
        reason = `${Math.round(peakShare * 100)}% of visits are in peak hours (06–09 IST)`;
      } else if (overUtilised) {
        reason = `${visitCount} visits in last 30d (plan implies ~${Math.round(4 * weeksDuration)})`;
      }
      if (!reason) continue;

      // Compute monthly diff for the message.
      const targetPrice = Number(upgradeTarget.price);
      const planMonthly = Math.round((planPrice / Math.max(1, expireDays)) * 30);
      const targetMonthly = Math.round((targetPrice / Math.max(1, upgradeTarget.expireDays || 30)) * 30);
      const monthlyDelta = Math.max(0, targetMonthly - planMonthly);

      const dedupeKey = `upgrade_recommender:${member.id}:${weekKey}`;

      // Dedupe: skip if any insight notification with this key was created in last 7 days
      const existing = await prisma.inAppNotification.findFirst({
        where: {
          type: "insight",
          createdAt: { gte: sevenDaysAgo },
          message: { contains: dedupeKey },
        },
        select: { id: true },
      });
      if (existing) continue;

      const memberName = `${member.firstname} ${member.lastname}`.trim();
      const title = `Upgrade opportunity: ${memberName}`;
      const body = `${memberName} ${reason}. Upgrade to ${upgradeTarget.name} → +₹${monthlyDelta.toLocaleString("en-IN")}/month.`;

      const suggestedActions = [
        {
          label: "Send upgrade offer",
          action: "upgrade.send_offer",
          args: {
            userId: member.id,
            recommendedPlanId: upgradeTarget.id,
            discountPct: 0,
          },
        },
      ];

      const messagePayload = JSON.stringify({
        category: "insight",
        dedupeKey,
        body,
        suggestedActions,
        meta: {
          userId: member.id,
          currentPlanId: ticket.planId,
          recommendedPlanId: upgradeTarget.id,
          monthlyDelta,
          visitCount,
          peakShare: Number(peakShare.toFixed(2)),
        },
      });

      // Notify all active admins.
      const admins = await prisma.worker.findMany({
        where: { role: "admin", isActive: true },
        select: { id: true },
      });
      if (admins.length === 0) continue;

      await prisma.inAppNotification.createMany({
        data: admins.map((a) => ({
          workerId: a.id,
          type: "insight",
          title,
          message: messagePayload,
          link: `/admin/members/${member.id}`,
        })),
      });

      insightsCreated += admins.length;
    } catch (err) {
      console.error(`[UpgradeRecommender] Failed for user ${member.id}:`, err);
    }
  }

  return { insightsCreated };
}

/** ISO-week key like "2026-W16" — calendar week of the given date. */
function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
