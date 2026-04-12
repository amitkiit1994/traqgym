"use server";

import { getDailyActions } from "@/lib/services/daily-actions";

export async function fetchDailyActions() {
  return getDailyActions();
}
