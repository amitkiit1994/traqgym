import { NextRequest } from "next/server";
import { runCompAuditor } from "@/lib/agents/comp-auditor";
import { requireCronSecret } from "@/lib/auth-cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  try {
    const { insightsCreated } = await runCompAuditor();
    return Response.json({ ok: true, insightsCreated });
  } catch (err) {
    console.error("[comp-audit cron] Error:", err);
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Cron failed" },
      { status: 500 }
    );
  }
}
