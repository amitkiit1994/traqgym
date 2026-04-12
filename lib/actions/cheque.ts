"use server";

import { requireWorker } from "@/lib/auth-guard";
import {
  updateChequeStatus as updateChequeStatusService,
  getPendingCheques as getPendingChequesService,
  getBouncedCheques as getBouncedChequesService,
} from "@/lib/services/cheque";

export async function updateChequeStatusAction(
  paymentId: number,
  status: "cleared" | "bounced",
  notes?: string
) {
  try {
    await requireWorker(["admin"]);
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  return updateChequeStatusService(paymentId, status, notes);
}

export async function getPendingChequesAction(locationId?: number) {
  try {
    await requireWorker();
  } catch {
    return [];
  }

  return getPendingChequesService(locationId);
}

export async function getBouncedChequesAction(locationId?: number) {
  try {
    await requireWorker();
  } catch {
    return [];
  }

  return getBouncedChequesService(locationId);
}
