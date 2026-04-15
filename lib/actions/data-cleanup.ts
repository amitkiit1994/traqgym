"use server";

import { requireWorker } from "@/lib/auth-guard";
import { runFullCleanup } from "@/lib/services/data-cleanup";

export async function runDataCleanupAction() {
  try {
    await requireWorker(["admin"]);
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const result = await runFullCleanup();
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
