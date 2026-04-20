import { NextRequest } from "next/server";
import { runCashShiftVarianceInvestigator } from "@/lib/agents/cash-shift-variance-investigator";
import { requireCronSecret } from "@/lib/auth-cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  try {
    const { insightsCreated, shiftsScanned } =
      await runCashShiftVarianceInvestigator();
    return Response.json({ ok: true, insightsCreated, shiftsScanned });
  } catch (err) {
    console.error("[cash-shift-variance-investigator cron] Error:", err);
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Cron failed",
      },
      { status: 500 }
    );
  }
}
