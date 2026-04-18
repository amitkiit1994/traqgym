import { NextRequest } from "next/server";
import { runTrainerRating } from "@/lib/agents/trainer-rating";
import { getSetting } from "@/lib/services/settings";
import { requireCronSecret } from "@/lib/auth-cron";

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  const enabled = await getSetting("cron_trainer_rating_enabled", "true");
  if (enabled !== "true") {
    return Response.json({
      success: true,
      skipped: true,
      reason: "Trainer rating cron disabled",
    });
  }

  const thresholdSetting = await getSetting("trainer_rating_threshold", "3.5");
  const threshold = parseFloat(thresholdSetting) || 3.5;
  const minRatingsSetting = await getSetting("trainer_rating_min_ratings", "5");
  const minRatings = parseInt(minRatingsSetting, 10) || 5;
  const windowSetting = await getSetting("trainer_rating_window_days", "30");
  const windowDays = parseInt(windowSetting, 10) || 30;

  try {
    const result = await runTrainerRating({ threshold, minRatings, windowDays });
    return Response.json({ success: true, ...result });
  } catch (err) {
    console.error("[trainer-rating cron] Error:", err);
    return Response.json(
      { error: "Failed", details: String(err) },
      { status: 500 }
    );
  }
}
