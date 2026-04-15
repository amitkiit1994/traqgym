"use server";

import { requireWorker } from "@/lib/auth-guard";
import {
  analyzeAttendancePatterns,
  suggestOptimalSchedule,
} from "@/lib/services/smart-scheduling";

export async function getAttendancePatternsAction(locationId?: number) {
  try {
    await requireWorker(["admin"]);
  } catch {
    return { error: "Unauthorized" };
  }
  try {
    const patterns = await analyzeAttendancePatterns(locationId);
    return {
      heatmap: patterns.heatmap,
      peakHours: patterns.peakHours,
      peakDays: patterns.peakDays,
      totalCheckins: patterns.totalCheckins,
      dateRange: {
        from: patterns.dateRange.from.toISOString(),
        to: patterns.dateRange.to.toISOString(),
      },
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to analyze patterns" };
  }
}

export async function suggestScheduleAction(locationId?: number) {
  try {
    await requireWorker(["admin"]);
  } catch {
    return { error: "Unauthorized" };
  }
  try {
    const result = await suggestOptimalSchedule(locationId);
    return result;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to generate suggestions" };
  }
}
