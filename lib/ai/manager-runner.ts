/**
 * Shared runner for the manager morning briefing.
 *
 * Used by both the cron route (`/api/cron/manager-morning-briefing`) and the
 * admin "Send test briefing" server action so they share a single code path.
 *
 * Returns a `Response` (JSON) so the cron route can return it directly; the
 * server action consumes it via `.json()`.
 */

import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import { listActiveInsights, type InsightSeverity } from "@/lib/services/insight";
import { composeBriefing, type Lang } from "@/lib/ai/manager";
import { renderEmail } from "@/lib/ai/manager-email";
import { send as sendEmail } from "@/lib/channels/email";

const VALID_LANGS = new Set<Lang>(["en", "hi", "hinglish"]);
const VALID_SEVERITIES = new Set<InsightSeverity>(["critical", "high", "medium", "low"]);

export async function runManagerBriefing(): Promise<Response> {
  const enabled = await getSetting("manager_briefing_enabled", "false");
  if (enabled !== "true") {
    return Response.json({
      ok: true,
      sent: 0,
      insightCount: 0,
      skipped: true,
      reason: "manager_briefing_enabled=false",
    });
  }

  const ownerEmail = (await getSetting("gym_owner_email", "")).trim();
  if (!ownerEmail) {
    console.warn("[manager-briefing] gym_owner_email not set — skipping");
    return Response.json({
      ok: true,
      sent: 0,
      insightCount: 0,
      skipped: true,
      reason: "gym_owner_email empty",
    });
  }

  const ownerName = (await getSetting("gym_owner_name", "Owner")).trim() || "Owner";
  const gymName = (await getSetting("gym_name", "TraqGym")).trim() || "TraqGym";
  const langRaw = (await getSetting("gym_owner_lang", "en")).trim() as Lang;
  const lang: Lang = VALID_LANGS.has(langRaw) ? langRaw : "en";

  const minSevRaw = (await getSetting(
    "manager_min_severity",
    "high"
  )).trim() as InsightSeverity;
  const minSeverity: InsightSeverity = VALID_SEVERITIES.has(minSevRaw)
    ? minSevRaw
    : "high";

  const topNRaw = await getSetting("manager_briefing_top_n", "5");
  const topN = Math.max(1, Math.min(20, parseInt(topNRaw, 10) || 5));

  const ttlRaw = await getSetting("manager_link_ttl_hours", "24");
  const linkTtlHours = Math.max(1, Math.min(168, parseInt(ttlRaw, 10) || 24));

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const insights = await listActiveInsights({
    minSeverity,
    since,
    limit: 50,
  });

  if (insights.length === 0) {
    return Response.json({
      ok: true,
      sent: 0,
      insightCount: 0,
      skipped: true,
      reason: "no insights in window",
    });
  }

  const baseUrl =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";

  let briefing;
  try {
    briefing = await composeBriefing({
      insights,
      lang,
      ownerName,
      gymName,
      topN,
      baseUrl,
      linkTtlHours,
    });
  } catch (err) {
    console.error("[manager-briefing] compose error:", err);
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "compose failed",
      },
      { status: 500 }
    );
  }

  const rendered = renderEmail({
    briefing,
    ownerName,
    gymName,
    baseUrl,
  });

  const sendResult = await sendEmail({
    recipient: ownerEmail,
    subject: rendered.subject,
    html: rendered.html,
  });

  const sent = sendResult.success ? 1 : 0;

  // Mark ownerSeenAt for each included insight (best-effort, single update).
  if (sent > 0) {
    const ids = briefing.sections.map((s) => s.insightId);
    if (ids.length > 0) {
      await prisma.insight
        .updateMany({
          where: { id: { in: ids } },
          data: { ownerSeenAt: new Date() },
        })
        .catch((err) =>
          console.warn("[manager-briefing] ownerSeenAt update failed:", err)
        );
    }
  }

  // Log to AiProactiveLog with channel="email", feature="manager_briefing".
  // targetType="owner" / targetId=0 since the recipient isn't a Worker row.
  try {
    await prisma.aiProactiveLog.create({
      data: {
        feature: "manager_briefing",
        targetType: "owner",
        targetId: 0,
        channel: "email",
        content: rendered.plain.slice(0, 8000),
        status: sendResult.success ? "sent" : "failed",
        error: sendResult.success ? null : String((sendResult as { error?: unknown }).error ?? ""),
      },
    });
  } catch (err) {
    console.warn("[manager-briefing] AiProactiveLog write failed:", err);
  }

  return Response.json({
    ok: sendResult.success,
    sent,
    insightCount: briefing.sections.length,
    subject: rendered.subject,
    mode: (sendResult as { mode?: string }).mode ?? null,
    error: sendResult.success ? null : (sendResult as { error?: unknown }).error ?? null,
  });
}
