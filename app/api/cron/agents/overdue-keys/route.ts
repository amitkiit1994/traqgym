import { runOverdueKeys } from "@/lib/agents/overdue-keys";
import { getSetting } from "@/lib/services/settings";

export async function GET(request: Request) {
  const secret =
    request.headers.get("x-cron-secret") ||
    new URL(request.url).searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET && process.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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
