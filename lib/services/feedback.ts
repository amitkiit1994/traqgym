import { prisma } from "@/lib/prisma";

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

  const feedback = await prisma.feedback.create({
    data: {
      userId: params.userId,
      rating: params.rating,
      comment: params.comment || null,
      category: params.category || "general",
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
      gymClass: { select: { instructorId: true } },
    },
  });
  if (!klass) {
    return { success: false as const, error: "Class not found" };
  }

  const trainerId =
    params.trainerId !== undefined ? params.trainerId : klass.gymClass.instructorId;

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
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  const [all, thisMonth, lastMonth] = await Promise.all([
    prisma.feedback.findMany({ select: { rating: true, category: true } }),
    prisma.feedback.count({ where: { createdAt: { gte: thisMonthStart } } }),
    prisma.feedback.count({
      where: { createdAt: { gte: lastMonthStart, lte: lastMonthEnd } },
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
