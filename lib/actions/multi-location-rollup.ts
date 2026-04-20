"use server";

import { requireWorker } from "@/lib/auth-guard";
import { getMultiLocationRollup, type LocationRollupRow } from "@/lib/services/multi-location-rollup";
import { istDayBoundsUtc } from "@/lib/utils/date-ist";

function parseYmd(s: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return {
    year: parseInt(m[1], 10),
    month: parseInt(m[2], 10) - 1, // 0-indexed for istDayBoundsUtc
    day: parseInt(m[3], 10),
  };
}

export async function getMultiLocationRollupAction(params: {
  fromDate: string;
  toDate: string;
}): Promise<LocationRollupRow[]> {
  try {
    await requireWorker(["admin"]);
  } catch {
    return [];
  }

  // Owner picks dates as IST calendar days. Build bounds against IST midnight
  // (=UTC 18:30 of the prior day), NOT against server-local or browser time.
  // The previous setHours()-based computation drifted by 5h30m and mis-bucketed
  // payments made between 18:30–24:00 UTC (the early-evening IST window).
  const fromCal = parseYmd(params.fromDate);
  const toCal = parseYmd(params.toDate);
  if (!fromCal || !toCal) return [];

  const { startUtc: from } = istDayBoundsUtc(fromCal);
  // `to` is the exclusive upper bound: end-of-IST-day(toDate) = start-of-next-IST-day.
  const { endUtc: to } = istDayBoundsUtc(toCal);

  return getMultiLocationRollup({ from, to });
}
