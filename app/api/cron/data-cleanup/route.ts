import { getSetting } from "@/lib/services/settings";
import { runFullCleanup } from "@/lib/services/data-cleanup";

export async function GET(request: Request) {
  const secret =
    request.headers.get("x-cron-secret") ||
    new URL(request.url).searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET && process.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const enabled = await getSetting("data_cleanup_enabled", "true");
  if (enabled !== "true") {
    return Response.json({
      success: true,
      skipped: true,
      reason: "Data cleanup disabled in settings",
    });
  }

  try {
    const result = await runFullCleanup();
    return Response.json({ success: true, ...result });
  } catch (err) {
    console.error("[data-cleanup cron] Error:", err);
    return Response.json(
      { error: "Cleanup failed", details: String(err) },
      { status: 500 }
    );
  }
}
