"use server";

import { requireWorker } from "@/lib/auth-guard";
import {
  createTrialMembership as createTrialService,
  convertTrial as convertTrialService,
  getTrialStats as getTrialStatsService,
  getActiveTrials as getActiveTrialsService,
} from "@/lib/services/trial";

export async function createTrialMembership(data: {
  userId: number;
  planId: number;
  locationId: number;
}) {
  let session;
  try {
    session = await requireWorker();
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  return createTrialService({
    ...data,
    createdById: parseInt(session.user.id, 10),
  });
}

export async function convertTrial(data: {
  ticketId: number;
  newPlanId: number;
  paymentMode: string;
  amount: number;
  upiReference?: string;
}) {
  let session;
  try {
    session = await requireWorker();
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  return convertTrialService({
    ...data,
    collectedById: parseInt(session.user.id, 10),
  });
}

export async function getTrialStats(startDate?: string, endDate?: string) {
  try {
    await requireWorker();
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  return getTrialStatsService(startDate, endDate);
}

export async function getActiveTrials(locationId?: number) {
  try {
    await requireWorker();
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  return getActiveTrialsService(locationId);
}
