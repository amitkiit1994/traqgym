import { prisma } from "@/lib/prisma";
import { notifyWorkersByRole } from "@/lib/services/in-app-notification";

/**
 * Weekly agent: flags trainers whose average rating drops below 3.5/5
 * across at least 5 ratings in the last 30 days. Creates an in-app
 * insight for admins (high severity), idempotent within 7 days.
 */
export async function runTrainerRating(params?: {
  threshold?: number;
  minRatings?: number;
  windowDays?: number;
}) {
  const threshold = params?.threshold ?? 3.5;
  const minRatings = params?.minRatings ?? 5;
  const windowDays = params?.windowDays ?? 30;

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const items = await prisma.feedback.findMany({
    where: {
      trainerId: { not: null },
      createdAt: { gte: since },
    },
    select: {
      trainerId: true,
      rating: true,
      trainer: {
        select: { id: true, firstname: true, lastname: true },
      },
    },
  });

  const aggregates = new Map<
    number,
    { trainerName: string; ratings: number[] }
  >();

  for (const f of items) {
    if (!f.trainerId || !f.trainer) continue;
    const name = `${f.trainer.firstname} ${f.trainer.lastname}`.trim();
    if (!aggregates.has(f.trainerId)) {
      aggregates.set(f.trainerId, { trainerName: name, ratings: [] });
    }
    aggregates.get(f.trainerId)!.ratings.push(f.rating);
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  let insightsCreated = 0;
  const flagged: Array<{ trainerId: number; trainerName: string; avg: number; count: number }> = [];

  for (const [trainerId, info] of aggregates.entries()) {
    if (info.ratings.length < minRatings) continue;
    const avg =
      Math.round((info.ratings.reduce((s, r) => s + r, 0) / info.ratings.length) * 10) / 10;
    if (avg >= threshold) continue;

    flagged.push({ trainerId, trainerName: info.trainerName, avg, count: info.ratings.length });

    // De-dupe: skip if an insight for this trainer was already created in the last 7 days
    const existing = await prisma.inAppNotification.findFirst({
      where: {
        type: "trainer_rating_low",
        link: `/admin/reports/trainer-ratings?trainerId=${trainerId}`,
        createdAt: { gte: sevenDaysAgo },
      },
    });
    if (existing) continue;

    const result = await notifyWorkersByRole({
      role: "admin",
      type: "trainer_rating_low",
      title: `Low trainer rating: ${info.trainerName}`,
      message: `Average ${avg}/5 across ${info.ratings.length} ratings in last ${windowDays} days (threshold ${threshold})`,
      link: `/admin/reports/trainer-ratings?trainerId=${trainerId}`,
    });

    if (result.success && result.count > 0) {
      insightsCreated += result.count;
    }
  }

  return {
    insightsCreated,
    flaggedCount: flagged.length,
    trainersAnalyzed: aggregates.size,
    flagged,
  };
}
