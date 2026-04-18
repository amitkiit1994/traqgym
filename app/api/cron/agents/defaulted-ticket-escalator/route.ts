import { run } from "@/lib/agents/defaulted-ticket-escalator";
import { getSetting } from "@/lib/services/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
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

  const enabled = await getSetting(
    "cron_defaulted_ticket_escalator_enabled",
    "true"
  );
  if (enabled !== "true") {
    return Response.json({ ok: true, skipped: true, reason: "disabled" });
  }

  try {
    const { created, total } = await run();
    return Response.json({ ok: true, created, total });
  } catch (err) {
    console.error("[defaulted-ticket-escalator cron] Error:", err);
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Cron failed" },
      { status: 500 }
    );
  }
}
