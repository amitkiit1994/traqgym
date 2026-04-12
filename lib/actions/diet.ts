"use server";

import { requireWorker } from "@/lib/auth-guard";
import {
  createDietPlan,
  getDietPlans,
  assignDietPlan,
  getMemberDiet,
} from "@/lib/services/diet";

export async function createDietPlanAction(params: {
  name: string;
  description?: string;
  meals: {
    mealType: string;
    description: string;
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
    order?: number;
  }[];
  createdById: number;
}) {
  try { await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }
  try {
    return await createDietPlan(params);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function getDietPlansAction(activeOnly?: boolean) {
  try { await requireWorker(); } catch { return []; }
  return getDietPlans(activeOnly);
}

export async function assignDietPlanAction(userId: number, planId: number) {
  try { await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }
  try {
    return await assignDietPlan({ userId, planId });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function getMemberDietAction(userId: number) {
  try { await requireWorker(); } catch { return null; }
  return getMemberDiet(userId);
}
