"use server";

import { revalidatePath } from "next/cache";
import { requireWorker } from "@/lib/auth-guard";
import {
  dismissInsight,
  snoozeInsight,
  executeInsightAction as executeInsightActionService,
} from "@/lib/services/insight";

type ActionResult<T = undefined> =
  | { success: true; data?: T }
  | { success: false; error: string };

function unauthorized<T = undefined>(): ActionResult<T> {
  return { success: false, error: "Unauthorized" };
}

// ─── dismissInsightAction ─────────────────────────────────────────────────
export async function dismissInsightAction(params: {
  insightId: number;
  reason?: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requireWorker();
  } catch {
    return unauthorized();
  }

  const dismissedById = parseInt(session.user.id, 10);
  const result = await dismissInsight({
    insightId: params.insightId,
    dismissedById,
    reason: params.reason,
  });
  if (!result.success) return { success: false, error: result.error };

  revalidatePath("/admin/dashboard");
  return { success: true };
}

// ─── snoozeInsightAction ──────────────────────────────────────────────────
export async function snoozeInsightAction(params: {
  insightId: number;
  untilIso: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requireWorker();
  } catch {
    return unauthorized();
  }

  const snoozedById = parseInt(session.user.id, 10);
  const until = new Date(params.untilIso);
  if (isNaN(until.getTime())) {
    return { success: false, error: "Invalid untilIso" };
  }

  const result = await snoozeInsight({
    insightId: params.insightId,
    until,
    snoozedById,
  });
  if (!result.success) return { success: false, error: result.error };

  revalidatePath("/admin/dashboard");
  return { success: true };
}

// ─── executeInsightAction ─────────────────────────────────────────────────
export async function executeInsightAction(params: {
  insightId: number;
  actionIndex: number;
}): Promise<ActionResult<{ result?: unknown }>> {
  let session;
  try {
    session = await requireWorker();
  } catch {
    return unauthorized();
  }

  const executedById = parseInt(session.user.id, 10);
  const result = await executeInsightActionService({
    insightId: params.insightId,
    actionIndex: params.actionIndex,
    executedById,
  });
  if (!result.success) return { success: false, error: result.error };

  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/comps");
  return { success: true, data: { result: result.result } };
}
