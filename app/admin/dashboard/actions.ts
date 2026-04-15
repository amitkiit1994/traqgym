"use server";

import { getSmartDailyActions } from "@/lib/services/smart-assignment";

export async function fetchDailyActions(workerId?: number) {
  return getSmartDailyActions(workerId);
}
