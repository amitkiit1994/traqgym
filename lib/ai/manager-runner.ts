/**
 * Shared runner for the manager morning briefing.
 *
 * Used by both the cron route (`/api/cron/manager-morning-briefing`) and the
 * admin "Send test briefing" server action so they share a single code path.
 *
 * Returns a `Response` (JSON) so the cron route can return it directly; the
 * server action consumes it via `.json()`.
 *
 * PR 9: extended with optional `channels` argument so the same composed
 * briefing can be delivered to email AND/OR Telegram in a single run. Default
 * is `["email"]` to preserve PR-8 behaviour for callers that don't specify.
 */

import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import { listActiveInsights, type InsightSeverity } from "@/lib/services/insight";
import { composeBriefing, type Lang, type ComposedBriefing } from "@/lib/ai/manager";
import { renderEmail } from "@/lib/ai/manager-email";
import { send as sendEmail } from "@/lib/channels/email";
import { renderTelegram } from "@/lib/ai/manager-telegram";
import { sendMessageWithButtons } from "@/lib/channels/telegram";

const VALID_LANGS = new Set<Lang>(["en", "hi", "hinglish"]);
const VALID_SEVERITIES = new Set<InsightSeverity>(["critical", "high", "medium", "low"]);

export type BriefingChannel = "email" | "telegram";

export type BriefingChannelResult = {
  channel: BriefingChannel;
  success: boolean;
  mode?: string | null;
  error?: string | null;
  /** For Telegram: the sent message_id, useful for cross-channel edit-sync. */
  messageId?: number;
};

export async function runManagerBriefing(opts?: {
  /** Override which channels to deliver on. Defaults to enabled-by-settings. */
  channels?: BriefingChannel[];
}): Promise<Response> {
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

  // Determine target channels.
  // - Email: gym_owner_email must be set (legacy default).
  // - Telegram: telegram_enabled=true AND gym_owner_telegram_chat_id set.
  const ownerEmail = (await getSetting("gym_owner_email", "")).trim();
  const telegramEnabled = (await getSetting("telegram_enabled", "false")) === "true";
  const telegramChatId = (await getSetting("gym_owner_telegram_chat_id", "")).trim();

  const requestedChannels: BriefingChannel[] = opts?.channels ?? [];
  const channels: BriefingChannel[] = [];
  if (requestedChannels.length > 0) {
    // Caller specified — respect overrides but still gate on prerequisites.
    if (requestedChannels.includes("email") && ownerEmail) channels.push("email");
    if (requestedChannels.includes("telegram") && telegramChatId) channels.push("telegram");
  } else {
    if (ownerEmail) channels.push("email");
    if (telegramEnabled && telegramChatId) channels.push("telegram");
  }

  if (channels.length === 0) {
    console.warn(
      "[manager-briefing] no deliverable channel — skipping (email + telegram both unconfigured)"
    );
    return Response.json({
      ok: true,
      sent: 0,
      insightCount: 0,
      skipped: true,
      reason: "no channel configured",
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

  let briefing: ComposedBriefing;
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

  const results: BriefingChannelResult[] = [];

  // ── Email ────────────────────────────────────────────────────────────────
  if (channels.includes("email")) {
    const rendered = renderEmail({ briefing, ownerName, gymName, baseUrl });
    const sendResult = await sendEmail({
      recipient: ownerEmail,
      subject: rendered.subject,
      html: rendered.html,
    });
    results.push({
      channel: "email",
      success: sendResult.success,
      mode: (sendResult as { mode?: string }).mode ?? null,
      error: sendResult.success
        ? null
        : String((sendResult as { error?: unknown }).error ?? ""),
    });

    // Log to AiProactiveLog with channel="email", feature="manager_briefing".
    try {
      await prisma.aiProactiveLog.create({
        data: {
          feature: "manager_briefing",
          targetType: "owner",
          targetId: 0,
          channel: "email",
          content: rendered.plain.slice(0, 8000),
          status: sendResult.success ? "sent" : "failed",
          error: sendResult.success
            ? null
            : String((sendResult as { error?: unknown }).error ?? ""),
        },
      });
    } catch (err) {
      console.warn("[manager-briefing] AiProactiveLog write failed (email):", err);
    }
  }

  // ── Telegram ─────────────────────────────────────────────────────────────
  if (channels.includes("telegram")) {
    const tg = renderTelegram({ briefing, ownerName, gymName });
    const sendResult = await sendMessageWithButtons({
      chatId: telegramChatId,
      text: tg.text,
      buttons: tg.buttons,
      parseMode: "HTML",
    });
    results.push({
      channel: "telegram",
      success: sendResult.success,
      mode: process.env.TELEGRAM_BOT_TOKEN ? "live" : "dev",
      error: sendResult.success ? null : sendResult.error,
      messageId: sendResult.success ? sendResult.data?.message_id : undefined,
    });

    try {
      await prisma.aiProactiveLog.create({
        data: {
          feature: "manager_briefing",
          targetType: "owner",
          targetId: 0,
          channel: "telegram",
          content: tg.text.slice(0, 8000),
          status: sendResult.success ? "sent" : "failed",
          error: sendResult.success ? null : sendResult.error,
        },
      });
    } catch (err) {
      console.warn("[manager-briefing] AiProactiveLog write failed (telegram):", err);
    }
  }

  const sentCount = results.filter((r) => r.success).length;

  // Mark ownerSeenAt for each included insight (best-effort, single update).
  if (sentCount > 0) {
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

  // Pull the legacy email mode for backward compat with PR-8 callers.
  const emailResult = results.find((r) => r.channel === "email");
  const overallOk = results.length > 0 && results.some((r) => r.success);

  return Response.json({
    ok: overallOk,
    sent: sentCount,
    insightCount: briefing.sections.length,
    subject: briefing.subject,
    mode: emailResult?.mode ?? results[0]?.mode ?? null,
    error: overallOk
      ? null
      : results.map((r) => r.error).filter(Boolean).join("; ") || null,
    channels: results,
  });
}
