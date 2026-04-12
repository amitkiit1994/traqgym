"use server";

import { requireWorker } from "@/lib/auth-guard";
import {
  setTarget as setTargetService,
  getTarget as getTargetService,
  getTargetProgress as getTargetProgressService,
} from "@/lib/services/gym-targets";

export async function setTarget(data: {
  month: number;
  year: number;
  targetRevenue: number;
  targetNewMembers?: number;
  targetRenewals?: number;
  locationId?: number;
}) {
  try {
    await requireWorker(["admin"]);
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  return setTargetService(data);
}

export async function getTarget(month: number, year: number, locationId?: number) {
  try {
    await requireWorker();
  } catch {
    return null;
  }

  return getTargetService(month, year, locationId);
}

export async function getTargetProgress(month: number, year: number, locationId?: number) {
  try {
    await requireWorker();
  } catch {
    return null;
  }

  return getTargetProgressService(month, year, locationId);
}
