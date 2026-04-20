"use server";

import { requireWorker } from "@/lib/auth-guard";
import { getTrainerRatingStats } from "@/lib/services/feedback";

type TrainerRatingRow = Awaited<ReturnType<typeof getTrainerRatingStats>>[number];

export async function getTrainerRatingsAction(
  sinceDays = 30
): Promise<TrainerRatingRow[]> {
  try {
    await requireWorker(["admin"]);
  } catch {
    return [];
  }
  return getTrainerRatingStats({ sinceDays });
}
