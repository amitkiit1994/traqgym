import { NextRequest } from "next/server";
import { runInstallmentReminder } from "@/lib/agents/installment-reminder";
import { getSetting } from "@/lib/services/settings";
import { requireCronSecret } from "@/lib/auth-cron";

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  const enabled = await getSetting("cron_installment_reminder_enabled", "true");
  if (enabled !== "true") {
    return Response.json({
      success: true,
      skipped: true,
      reason: "Cron disabled in settings",
    });
  }

  try {
    const result = await runInstallmentReminder();
    return Response.json({ success: true, ...result });
  } catch (err) {
    console.error("[Cron installment-reminder] failed:", err);
    return Response.json(
      { success: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
