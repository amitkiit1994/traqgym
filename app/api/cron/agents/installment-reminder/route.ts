import { runInstallmentReminder } from "@/lib/agents/installment-reminder";
import { getSetting } from "@/lib/services/settings";

export async function GET(request: Request) {
  const secret =
    request.headers.get("x-cron-secret") ||
    new URL(request.url).searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET && process.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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
