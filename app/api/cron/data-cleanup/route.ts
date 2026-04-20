import { NextRequest } from "next/server";
import { getSetting } from "@/lib/services/settings";
import { runFullCleanup } from "@/lib/services/data-cleanup";
import { requireCronSecret } from "@/lib/auth-cron";

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

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
