import { prisma } from "@/lib/prisma";
import { istMonthBoundsUtc, istCalendarFor } from "@/lib/utils/date-ist";

const VALID_CATEGORIES = ["facility", "trainer", "cleanliness", "general"];

export async function submitFeedback(params: {
  userId: number;
  rating: number;
  comment?: string;
  category?: string;
}) {
  if (!Number.isInteger(params.rating) || params.rating < 1 || params.rating > 5) {
    return { success: false, error: "Rating must be between 1 and 5" };
  }

  if (params.category && !VALID_CATEGORIES.includes(params.category)) {
    return { success: false, error: `Category must be one of: ${VALID_CATEGORIES.join(", ")}` };
  }

  const category = params.category || "general";

  // Soft idempotency: if the same member submitted feedback for the same
  // category in the last 60s, return that row instead of creating a new one.
  const sixtySecondsAgo = new Date(Date.now() - 60_000);
  const existing = await prisma.feedback.findFirst({
    where: {
      userId: params.userId,
      category,
      // Only treat general (non-class, non-trainer-targeted) feedback as a
      // dedup target — class feedback goes through recordClassFeedback which
      // has its own idempotency window below.
      classId: null,
      createdAt: { gte: sixtySecondsAgo },
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return { success: true, feedback: existing };
  }

  const feedback = await prisma.feedback.create({
    data: {
      userId: params.userId,
      rating: params.rating,
      comment: params.comment || null,
      category,
    },
  });

  return { success: true, feedback };
}

export async function getFeedback(params?: {
  userId?: number;
  category?: string;
  page?: number;
  limit?: number;
}) {
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 20;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (params?.userId) where.userId = params.userId;
  if (params?.category) where.category = params.category;

  const [items, total] = await Promise.all([
    prisma.feedback.findMany({
      where,
      include: {
        user: { select: { firstname: true, lastname: true, phone: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.feedback.count({ where }),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function recordClassFeedback(params: {
  userId: number;
  classId: number;
  rating: number;
  comment?: string;
  trainerId?: number | null;
}) {
  if (!Number.isInteger(params.rating) || params.rating < 1 || params.rating > 5) {
    return { success: false as const, error: "Rating must be between 1 and 5" };
  }

  const klass = await prisma.classSchedule.findUnique({
    where: { id: params.classId },
    select: {
      id: true,
      classId: true,
      gymClass: { select: { instructorId: true } },
    },
  });
  if (!klass) {
    return { success: false as const, error: "Class not found" };
  }

  // PR 12 audit fix (HIGH): a member must have actually booked + attended
  // the class before they can rate it. Without this guard, anyone with a
  // valid session could spam fake reviews — including members who never
  // attended the class — and tank a trainer's average rating. Treat
  // status="attended" as the only proof of attendance; status="booked" /
  // "cancelled" / "no_show" are not enough.
  const booking = await prisma.classBooking.findFirst({
    where: {
      userId: params.userId,
      classId: klass.classId,
      status: "attended",
    },
    select: { id: true },
  });
  if (!booking) {
    return {
      success: false as const,
      error: "You can only rate classes you have attended",
    };
  }

  const trainerId =
    params.trainerId !== undefined ? params.trainerId : klass.gymClass.instructorId;

  // Soft idempotency: dedupe within 60s on (member, classId).
  const sixtySecondsAgo = new Date(Date.now() - 60_000);
  const existing = await prisma.feedback.findFirst({
    where: {
      userId: params.userId,
      classId: params.classId,
      createdAt: { gte: sixtySecondsAgo },
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return { success: true as const, feedback: existing };
  }

  const feedback = await prisma.feedback.create({
    data: {
      userId: params.userId,
      rating: params.rating,
      comment: params.comment || null,
      category: "trainer",
      classId: params.classId,
      trainerId: trainerId ?? null,
    },
  });

  return { success: true as const, feedback };
}

export async function getTrainerRatingStats(params?: {
  trainerId?: number;
  sinceDays?: number;
}) {
  const sinceDays = params?.sinceDays ?? 30;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const where: Record<string, unknown> = {
    trainerId: { not: null },
    createdAt: { gte: since },
  };
  if (params?.trainerId) where.trainerId = params.trainerId;

  const items = await prisma.feedback.findMany({
    where,
    select: {
      trainerId: true,
      rating: true,
      classId: true,
      class: {
        select: {
          id: true,
          gymClass: { select: { id: true, name: true, classType: true } },
        },
      },
      trainer: {
        select: { id: true, firstname: true, lastname: true },
      },
    },
  });

  const byTrainer = new Map<
    number,
    { trainerId: number; trainerName: string; ratings: number[]; classBreakdown: Record<string, { count: number; sum: number }> }
  >();

  for (const f of items) {
    if (!f.trainerId || !f.trainer) continue;
    const key = f.trainerId;
    const name = `${f.trainer.firstname} ${f.trainer.lastname}`.trim();
    if (!byTrainer.has(key)) {
      byTrainer.set(key, {
        trainerId: key,
        trainerName: name,
        ratings: [],
        classBreakdown: {},
      });
    }
    const entry = byTrainer.get(key)!;
    entry.ratings.push(f.rating);
    const classType = f.class?.gymClass?.classType || "general";
    if (!entry.classBreakdown[classType]) {
      entry.classBreakdown[classType] = { count: 0, sum: 0 };
    }
    entry.classBreakdown[classType].count += 1;
    entry.classBreakdown[classType].sum += f.rating;
  }

  return Array.from(byTrainer.values()).map((e) => ({
    trainerId: e.trainerId,
    trainerName: e.trainerName,
    count: e.ratings.length,
    averageRating:
      e.ratings.length > 0
        ? Math.round((e.ratings.reduce((s, r) => s + r, 0) / e.ratings.length) * 10) / 10
        : 0,
    classBreakdown: Object.entries(e.classBreakdown).map(([classType, v]) => ({
      classType,
      count: v.count,
      averageRating: Math.round((v.sum / v.count) * 10) / 10,
    })),
  }));
}

export async function getFeedbackStats() {
  // IST-aware month boundaries. Without this, "this month" / "last month"
  // would shift by 5h30m and roll into the wrong calendar month around
  // midnight IST.
  const ist = istCalendarFor(new Date());
  // ist.month is 0-indexed; istMonthBoundsUtc takes 1-indexed.
  const thisMonth1Indexed = ist.month + 1;
  const thisMonthBounds = istMonthBoundsUtc(ist.year, thisMonth1Indexed);
  // Compute previous IST month with year rollover.
  const prevYear = thisMonth1Indexed === 1 ? ist.year - 1 : ist.year;
  const prevMonth = thisMonth1Indexed === 1 ? 12 : thisMonth1Indexed - 1;
  const lastMonthBounds = istMonthBoundsUtc(prevYear, prevMonth);

  const [all, thisMonth, lastMonth] = await Promise.all([
    prisma.feedback.findMany({ select: { rating: true, category: true } }),
    prisma.feedback.count({
      where: {
        createdAt: { gte: thisMonthBounds.startUtc, lt: thisMonthBounds.endUtc },
      },
    }),
    prisma.feedback.count({
      where: {
        createdAt: { gte: lastMonthBounds.startUtc, lt: lastMonthBounds.endUtc },
      },
    }),
  ]);

  const totalCount = all.length;
  const averageRating =
    totalCount > 0
      ? Math.round((all.reduce((s, f) => s + f.rating, 0) / totalCount) * 10) / 10
      : 0;

  const countByRating: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const countByCategory: Record<string, number> = {};
  for (const f of all) {
    countByRating[f.rating] = (countByRating[f.rating] || 0) + 1;
    const cat = f.category || "general";
    countByCategory[cat] = (countByCategory[cat] || 0) + 1;
  }

  return {
    averageRating,
    totalCount,
    countByCategory,
    countByRating,
    recentTrend: { thisMonth, lastMonth },
  };
}
