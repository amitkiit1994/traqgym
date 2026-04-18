import { runCashShiftVarianceInvestigator } from "@/lib/agents/cash-shift-variance-investigator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  // Auth: support `Authorization: Bearer <secret>`, `x-cron-secret`, and
  // `?secret=` query param to match existing cron route conventions.
  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : null;
  const xHeader = request.headers.get("x-cron-secret");
  const queryParam = new URL(request.url).searchParams.get("secret");
  const presented = bearer ?? xHeader ?? queryParam;

  if (process.env.CRON_SECRET && presented !== process.env.CRON_SECRET) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

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
