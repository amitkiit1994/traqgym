"use server";

/**
 * Insight actions — preliminary implementation that piggybacks on
 * InAppNotification rows (type:"insight"). Marks an insight read so it
 * disappears from the dashboard insight strip.
 *
 * TODO(PR-3-insight-table): replace with real Insight table action once the
 * dedicated Insight schema lands.
 */

import { revalidatePath } from "next/cache";
import { requireWorker } from "@/lib/auth-guard";
import { markRead } from "@/lib/services/in-app-notification";

export async function dismissInsightAction(
  notificationId: number
): Promise<{ success: true } | { success: false; error: string }> {
  let session;
  try {
    session = await requireWorker();
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  const workerId = parseInt(session.user.id, 10);
  if (!Number.isFinite(workerId)) {
    return { success: false, error: "Invalid worker session" };
  }

  try {
    await markRead(notificationId, { workerId });
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to dismiss insight",
    };
  }

  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/in-app-notifications");
  return { success: true };
}
