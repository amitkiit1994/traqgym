import { NextRequest } from "next/server";
import { runUpgradeRecommender } from "@/lib/agents/upgrade-recommender";
import { requireCronSecret } from "@/lib/auth-cron";

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  try {
    const { insightsCreated } = await runUpgradeRecommender();
    return Response.json({ ok: true, insightsCreated });
  } catch (err) {
    console.error("[Cron] upgrade-recommender failed:", err);
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
