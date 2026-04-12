"use server";

import { getStaffPerformance } from "@/lib/services/dashboard";
import { requireWorker } from "@/lib/auth-guard";

export async function getStaffPerformanceAction(
  monthStartISO: string,
  monthEndISO: string
) {
  try { await requireWorker(["admin"]); } catch { return { staff: [], totalCheckIns: 0 }; }
  return getStaffPerformance(new Date(monthStartISO), new Date(monthEndISO));
}
