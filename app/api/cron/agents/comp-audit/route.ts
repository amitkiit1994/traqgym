import { runCompAuditor } from "@/lib/agents/comp-auditor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  // Auth: support both `Authorization: Bearer <secret>` (matches the task spec)
  // and the legacy `x-cron-secret` header / `?secret=` query string used by
  // other cron routes in this codebase.
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
