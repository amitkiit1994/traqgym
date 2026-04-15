"use server";

import { requireMember } from "@/lib/auth-guard";
import { submitFeedback, getFeedback } from "@/lib/services/feedback";

export async function submitFeedbackAction(data: {
  rating: number;
  comment?: string;
  category?: string;
}) {
  let session;
  try { session = await requireMember(); } catch { return { success: false, error: "Unauthorized" }; }

  const userId = Number(session.user.id);
  return submitFeedback({ userId, ...data });
}

export async function getMyFeedbackAction() {
  let session;
  try { session = await requireMember(); } catch { return { items: [], total: 0, page: 1, limit: 50, totalPages: 0 }; }

  const userId = Number(session.user.id);
  const result = await getFeedback({ userId, limit: 50 });
  return {
    ...result,
    items: result.items.map((f) => ({
      id: f.id,
      rating: f.rating,
      comment: f.comment,
      category: f.category,
      createdAt: f.createdAt.toISOString(),
    })),
  };
}
