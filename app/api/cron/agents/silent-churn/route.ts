import { NextRequest } from "next/server";
import { run } from "@/lib/agents/silent-churn";
import { getSetting } from "@/lib/services/settings";
import { requireCronSecret } from "@/lib/auth-cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  const enabled = await getSetting("cron_silent_churn_enabled", "true");
  if (enabled !== "true") {
    return Response.json({ ok: true, skipped: true, reason: "disabled" });
  }

  try {
    const { created, total } = await run();
    return Response.json({ ok: true, created, total });
  } catch (err) {
    console.error("[silent-churn cron] Error:", err);
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Cron failed" },
      { status: 500 }
    );
  }
}
