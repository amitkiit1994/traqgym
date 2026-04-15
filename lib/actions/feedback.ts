"use server";

import { requireWorker } from "@/lib/auth-guard";
import { getFeedback, getFeedbackStats } from "@/lib/services/feedback";

export async function getFeedbackAction(params?: {
  userId?: number;
  category?: string;
  page?: number;
  limit?: number;
}) {
  try { await requireWorker(); } catch { return { items: [], total: 0, page: 1, limit: 20, totalPages: 0 }; }

  const result = await getFeedback(params);
  return {
    ...result,
    items: result.items.map((f) => ({
      id: f.id,
      userId: f.userId,
      rating: f.rating,
      comment: f.comment,
      category: f.category,
      createdAt: f.createdAt.toISOString(),
      userName: `${f.user.firstname} ${f.user.lastname}`,
      userPhone: f.user.phone,
    })),
  };
}

export async function getFeedbackStatsAction() {
  try { await requireWorker(); } catch { return null; }
  return getFeedbackStats();
}
