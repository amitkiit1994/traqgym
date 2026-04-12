"use server";

import { requireWorker } from "@/lib/auth-guard";
import {
  createWorkoutPlan,
  getWorkoutPlans,
  assignWorkoutPlan,
  getMemberWorkout,
} from "@/lib/services/workout";

export async function createWorkoutPlanAction(params: {
  name: string;
  description?: string;
  exercises: {
    name: string;
    sets?: number;
    reps?: number;
    weight?: number;
    day: string;
    order?: number;
    notes?: string;
  }[];
  createdById: number;
}) {
  try { await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }
  try {
    return await createWorkoutPlan(params);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function getWorkoutPlansAction(activeOnly?: boolean) {
  try { await requireWorker(); } catch { return []; }
  return getWorkoutPlans(activeOnly);
}

export async function assignWorkoutPlanAction(userId: number, planId: number) {
  try { await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }
  try {
    return await assignWorkoutPlan({ userId, planId });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function getMemberWorkoutAction(userId: number) {
  try { await requireWorker(); } catch { return null; }
  return getMemberWorkout(userId);
}
