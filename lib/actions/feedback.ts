"use server";

import { requireMember, requireWorker } from "@/lib/auth-guard";
import {
  getFeedback,
  getFeedbackStats,
  recordClassFeedback,
} from "@/lib/services/feedback";

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

// PR 12 audit fix (HIGH): expose class-feedback recording via a Server
// Action so the calling member is identified by NextAuth session — never
// by a userId argument from the request body. (The earlier path was a bare
// service export that any future caller could hand a forged userId to.)
export async function recordClassFeedbackAction(input: {
  classId: number;
  rating: number;
  comment?: string;
}) {
  let session;
  try {
    session = await requireMember();
  } catch {
    return { success: false as const, error: "Unauthorized" };
  }
  const userId = parseInt(session.user.id, 10);
  if (!Number.isFinite(userId) || userId <= 0) {
    return { success: false as const, error: "Invalid session" };
  }
  if (!Number.isInteger(input.classId) || input.classId <= 0) {
    return { success: false as const, error: "Invalid classId" };
  }
  return recordClassFeedback({
    userId,
    classId: input.classId,
    rating: input.rating,
    comment: input.comment,
  });
}
