"use server";

import { requireWorker } from "@/lib/auth-guard";
import { getStaffSchedule } from "@/lib/services/staff-calendar";

export async function getStaffScheduleAction(
  month: number,
  year: number,
  locationId?: number
) {
  try {
    await requireWorker();
  } catch {
    return { workers: [], days: [] };
  }
  return getStaffSchedule({ month, year, locationId });
}
