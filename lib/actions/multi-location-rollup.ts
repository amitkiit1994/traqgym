"use server";

import { requireWorker } from "@/lib/auth-guard";
import { getMultiLocationRollup, type LocationRollupRow } from "@/lib/services/multi-location-rollup";

export async function getMultiLocationRollupAction(params: {
  fromDate: string;
  toDate: string;
}): Promise<LocationRollupRow[]> {
  try {
    await requireWorker(["admin"]);
  } catch {
    return [];
  }

  const from = new Date(params.fromDate);
  from.setHours(0, 0, 0, 0);
  const to = new Date(params.toDate);
  to.setHours(23, 59, 59, 999);

  return getMultiLocationRollup({ from, to });
}
