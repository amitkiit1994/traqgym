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
