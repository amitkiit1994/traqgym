"use server";

import { requireWorker } from "@/lib/auth-guard";
import { getMemberUsage } from "@/lib/services/member-usage";

export async function fetchMemberUsage(locationId?: number) {
  try { await requireWorker(["admin"]); } catch { return { segments: { heavy: 0, moderate: 0, light: 0 }, members: [] }; }
  return getMemberUsage(locationId);
}
