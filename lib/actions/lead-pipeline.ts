"use server";

import { requireWorker } from "@/lib/auth-guard";
import {
  getPipeline as getPipelineService,
  moveStage as moveStageService,
} from "@/lib/services/lead-pipeline";

export async function getPipelineAction(locationId?: number) {
  try {
    await requireWorker();
  } catch {
    return { pipeline: {}, total: 0 };
  }

  return getPipelineService(locationId);
}

export async function moveStageAction(enquiryId: number, newStage: string) {
  try {
    await requireWorker(["admin"]);
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  return moveStageService(enquiryId, newStage);
}
