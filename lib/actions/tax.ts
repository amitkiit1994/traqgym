"use server";

import { requireWorker } from "@/lib/auth-guard";
import { getTaxReport, getTaxSettings } from "@/lib/services/tax";

export async function getTaxReportAction(
  startDate: string,
  endDate: string,
  locationId?: number
) {
  try {
    await requireWorker();
  } catch {
    return null;
  }
  return getTaxReport(startDate, endDate, locationId);
}

export async function getTaxSettingsAction() {
  try {
    await requireWorker();
  } catch {
    return null;
  }
  return getTaxSettings();
}
