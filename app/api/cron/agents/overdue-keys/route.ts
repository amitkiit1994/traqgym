import { NextRequest } from "next/server";
import { runOverdueKeys } from "@/lib/agents/overdue-keys";
import { getSetting } from "@/lib/services/settings";
import { requireCronSecret } from "@/lib/auth-cron";

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  const enabled = await getSetting("cron_overdue_keys_enabled", "true");
  if (enabled !== "true") {
    return Response.json({
      success: true,
      skipped: true,
      reason: "Overdue keys cron disabled",
    });
  }

  const thresholdSetting = await getSetting("locker_key_overdue_threshold_days", "7");
  const threshold = parseInt(thresholdSetting, 10) || 7;

  try {
    const result = await runOverdueKeys(threshold);
    return Response.json({ success: true, ...result });
  } catch (err) {
    console.error("[overdue-keys cron] Error:", err);
    return Response.json(
      { error: "Failed", details: String(err) },
      { status: 500 }
    );
  }
}
