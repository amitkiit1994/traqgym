"use server";

/**
 * Manager server actions — admin-only "Send test briefing" trigger.
 *
 * Wraps the same compose+render+send pipeline used by the cron route, but
 * returns a plain object (not a Response) so the settings UI can show the
 * result inline.
 */

import { requireWorker } from "@/lib/auth-guard";
import { runManagerBriefing } from "@/lib/ai/manager-runner";

export type TestBriefingResult =
  | {
      success: true;
      sent: number;
      insightCount: number;
      subject?: string;
      mode?: string | null;
      skipped?: boolean;
      reason?: string;
    }
  | { success: false; error: string };

export async function sendTestBriefingAction(): Promise<TestBriefingResult> {
  try {
    await requireWorker(["admin"]);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unauthorized",
    };
  }

  try {
    const res = await runManagerBriefing();
    const data = (await res.json()) as {
      ok?: boolean;
      sent?: number;
      insightCount?: number;
      subject?: string;
      mode?: string | null;
      skipped?: boolean;
      reason?: string;
      error?: string;
    };
    if (data.ok === false) {
      return { success: false, error: data.error || "Briefing failed" };
    }
    return {
      success: true,
      sent: data.sent ?? 0,
      insightCount: data.insightCount ?? 0,
      subject: data.subject,
      mode: data.mode ?? null,
      skipped: data.skipped,
      reason: data.reason,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to send briefing",
    };
  }
}
