"use server";

import { requireWorker } from "@/lib/auth-guard";
import { getKPIData } from "@/lib/services/kpi-dashboard";

export async function fetchKPIData(months: number = 6, locationId?: number) {
  try { await requireWorker(["admin"]); } catch { return []; }
  return getKPIData(months, locationId);
}
