"use server";

import { requireWorker } from "@/lib/auth-guard";
import { getRevenueChartData, getMonthlyRevenueTrend } from "@/lib/services/dashboard";

export async function getRevenueChartAction(
  startDate: string,
  endDate: string,
  locationId?: number
) {
  try { await requireWorker(); } catch { return []; }
  return getRevenueChartData(new Date(startDate), new Date(endDate), locationId);
}

export async function getMonthlyRevenueTrendAction(
  months: number = 12,
  locationId?: number
) {
  try { await requireWorker(); } catch { return []; }
  return getMonthlyRevenueTrend(months, locationId);
}
