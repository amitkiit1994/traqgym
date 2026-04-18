import { runUpgradeRecommender } from "@/lib/agents/upgrade-recommender";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const secret =
    request.headers.get("x-cron-secret") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    url.searchParams.get("secret");

  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

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
