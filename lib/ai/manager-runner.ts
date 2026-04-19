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
 *
 * PR 16 hardening:
 *   K.1 — Skip-day rules + insight fatigue dedup. We honour `gym_closed_days`
 *         (CSV of weekday names) and skip individual insights that were
 *         delivered within the last `manager_min_repeat_hours` window.
 *   K.2 — Auto language detection. When `gym_owner_lang === "auto"` we look
 *         at the latest `AiConversation.detectedLang` for the owner's
 *         Telegram channel and use that (default "en" if none).
 *   K.4 — Cross-channel sync. We persist one `InsightDelivery` row per
 *         (insight, channel) so the magic-link confirm route can later edit
 *         the corresponding Telegram message to "Done via email".
 *   K.5 — Multi-recipient fan-out. Additional emails / chat-ids come from
 *         `gym_owner_emails` / `gym_owner_telegram_chat_ids` (CSV). One
 *         failure does not fail the whole run.
 */

import { prisma } from "@/lib/prisma";
import { getSetting, setSetting } from "@/lib/services/settings";
import { listActiveInsights, type InsightSeverity } from "@/lib/services/insight";
import { composeBriefing, type Lang, type ComposedBriefing } from "@/lib/ai/manager";
import { renderEmail } from "@/lib/ai/manager-email";
import { send as sendEmail } from "@/lib/channels/email";
import { renderTelegram } from "@/lib/ai/manager-telegram";
import { sendMessage, sendMessageWithButtons } from "@/lib/channels/telegram";

const VALID_LANGS = new Set<Lang>(["en", "hi", "hinglish"]);
const VALID_SEVERITIES = new Set<InsightSeverity>(["critical", "high", "medium", "low"]);

export type BriefingChannel = "email" | "telegram";

export type BriefingChannelResult = {
  channel: BriefingChannel;
  success: boolean;
  mode?: string | null;
  error?: string | null;
  /** Recipient address / chat-id for this delivery (PR 16 K.5 fan-out). */
  recipient?: string;
  /** For Telegram: the sent message_id, useful for cross-channel edit-sync. */
  messageId?: number;
};

// ─── PR 16 K.1: weekday name → JS getDay() index (0 = Sunday) ──────────────
const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

function parseClosedDays(csv: string): Set<number> {
  const out = new Set<number>();
  for (const raw of csv.split(",")) {
    const k = raw.trim().toLowerCase();
    if (!k) continue;
    const idx = WEEKDAY_INDEX[k];
    if (typeof idx === "number") out.add(idx);
  }
  return out;
}

function todayInIstWeekday(): number {
  // IST = UTC+5:30. JS Date doesn't expose tz-aware weekday cheaply; format and
  // re-parse the weekday string via toLocaleString.
  const istWeekdayName = new Date()
    .toLocaleString("en-US", { timeZone: "Asia/Kolkata", weekday: "long" })
    .toLowerCase();
  return WEEKDAY_INDEX[istWeekdayName] ?? new Date().getDay();
}

function parseCsvList(csv: string): string[] {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** PR 16 K.2 — resolve the owner's language, honouring the "auto" sentinel. */
async function resolveOwnerLang(opts: {
  raw: string;
  ownerChatId: string;
}): Promise<Lang> {
  const trimmed = opts.raw.trim().toLowerCase();
  if (trimmed === "auto") {
    if (opts.ownerChatId) {
      const conv = await prisma.aiConversation
        .findFirst({
          where: { channel: "telegram", telegramChatId: opts.ownerChatId },
          orderBy: { id: "desc" },
          select: { detectedLang: true },
        })
        .catch(() => null);
      const detected = (conv?.detectedLang ?? "").toLowerCase();
      if (detected && VALID_LANGS.has(detected as Lang)) return detected as Lang;
    }
    return "en";
  }
  return VALID_LANGS.has(trimmed as Lang) ? (trimmed as Lang) : "en";
}

export async function runManagerBriefing(opts?: {
  /** Override which channels to deliver on. Defaults to enabled-by-settings. */
  channels?: BriefingChannel[];
}): Promise<Response> {
  // Telegram /snooze command writes `briefing_quiet_until` (ISO datetime) to
  // silence the next briefing. Honour it before any other work.
  const quietUntil = await getSetting("briefing_quiet_until", "");
  if (quietUntil) {
    const quietDate = new Date(quietUntil);
    if (!Number.isNaN(quietDate.getTime()) && quietDate > new Date()) {
      console.log(
        `[manager-runner] briefing_quiet_until in effect: ${quietUntil}, skipping`
      );
      return Response.json({
        ok: true,
        sent: 0,
        insightCount: 0,
        skipped: true,
        reason: "quiet_until",
        quietUntil,
      });
    }
    // expired or invalid — clear it so it doesn't accumulate
    await setSetting("briefing_quiet_until", "");
  }

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

  // ── Recipients (legacy single + PR 16 K.5 multi) ──────────────────────────
  const primaryEmail = (await getSetting("gym_owner_email", "")).trim();
  const extraEmailsCsv = (await getSetting("gym_owner_emails", "")).trim();
  const emailList = Array.from(
    new Set(
      [primaryEmail, ...parseCsvList(extraEmailsCsv)].filter(
        (e) => e.length > 0
      )
    )
  );

  const telegramEnabled = (await getSetting("telegram_enabled", "false")) === "true";
  const primaryChatId = (await getSetting("gym_owner_telegram_chat_id", "")).trim();
  const extraChatIdsCsv = (await getSetting("gym_owner_telegram_chat_ids", "")).trim();
  const telegramChatList = Array.from(
    new Set(
      [primaryChatId, ...parseCsvList(extraChatIdsCsv)].filter(
        (c) => c.length > 0
      )
    )
  );

  const requestedChannels: BriefingChannel[] = opts?.channels ?? [];
  const channels: BriefingChannel[] = [];
  if (requestedChannels.length > 0) {
    if (requestedChannels.includes("email") && emailList.length > 0) channels.push("email");
    if (requestedChannels.includes("telegram") && telegramChatList.length > 0)
      channels.push("telegram");
  } else {
    if (emailList.length > 0) channels.push("email");
    if (telegramEnabled && telegramChatList.length > 0) channels.push("telegram");
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
  // PR 16 K.2 — accept "auto" sentinel and resolve via AiConversation.
  const langRaw = await getSetting("gym_owner_lang", "en");
  const lang: Lang = await resolveOwnerLang({
    raw: langRaw,
    ownerChatId: primaryChatId,
  });

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

  // PR 16 K.3 — per-action TTL. Reads two keys; both default to safe values.
  const ttlDefaultRaw = await getSetting("manager_link_ttl_default_hours", String(linkTtlHours));
  const ttlRevokeRaw = await getSetting("manager_link_ttl_revoke_hours", "4");
  const perActionTtlHours = {
    defaultHours: Math.max(
      1,
      Math.min(168, parseInt(ttlDefaultRaw, 10) || linkTtlHours)
    ),
    revokeHours: Math.max(1, Math.min(168, parseInt(ttlRevokeRaw, 10) || 4)),
  };

  // PR 16 K.1 — fatigue dedup window.
  const minRepeatHoursRaw = await getSetting("manager_min_repeat_hours", "48");
  const minRepeatHours = Math.max(0, parseInt(minRepeatHoursRaw, 10) || 48);
  const minRepeatMs = minRepeatHours * 60 * 60 * 1000;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const allInsights = await listActiveInsights({
    minSeverity,
    since,
    limit: 50,
  });

  // PR 16 K.1 — drop insights surfaced too recently.
  const now = Date.now();
  const insights = allInsights.filter((ins) => {
    if (!ins.lastNotifiedAt) return true;
    return now - ins.lastNotifiedAt.getTime() >= minRepeatMs;
  });

  // PR 16 K.1 — skip-day rules. On a closed day we send only a single
  // abbreviated Telegram line with the count, and skip the long email entirely.
  const closedDays = parseClosedDays(
    await getSetting("gym_closed_days", "")
  );
  const todayWeekday = todayInIstWeekday();
  const isClosedToday = closedDays.has(todayWeekday);

  if (isClosedToday) {
    if (!telegramEnabled || telegramChatList.length === 0) {
      return Response.json({
        ok: true,
        sent: 0,
        insightCount: insights.length,
        skipped: true,
        reason: "closed_day (no telegram configured)",
      });
    }
    const summaryText =
      insights.length === 0
        ? `\u{1F4A4} <b>${gymName}</b> closed today \u2014 no new insights to act on.`
        : `\u{1F4A4} <b>${gymName}</b> closed today \u2014 ${insights.length} insight${insights.length === 1 ? "" : "s"} pending. Visit dashboard.`;
    const tgResults = await Promise.all(
      telegramChatList.map(async (chatId) => {
        try {
          const r = await sendMessage({ chatId, text: summaryText, parseMode: "HTML" });
          return { chatId, ok: r.success, error: r.success ? null : r.error };
        } catch (err) {
          return {
            chatId,
            ok: false,
            error: err instanceof Error ? err.message : "send failed",
          };
        }
      })
    );
    return Response.json({
      ok: tgResults.some((r) => r.ok),
      sent: tgResults.filter((r) => r.ok).length,
      insightCount: insights.length,
      skipped: false,
      mode: "closed_day_summary",
      channels: tgResults.map((r) => ({
        channel: "telegram" as const,
        success: r.ok,
        recipient: r.chatId,
        error: r.error,
      })),
    });
  }

  if (insights.length === 0) {
    return Response.json({
      ok: true,
      sent: 0,
      insightCount: 0,
      skipped: true,
      reason: allInsights.length > 0 ? "all insights within fatigue window" : "no insights in window",
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
      perActionTtlHours,
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

  // ── Email — fan out to every recipient (PR 16 K.5) ───────────────────────
  if (channels.includes("email")) {
    const rendered = renderEmail({ briefing, ownerName, gymName, baseUrl });
    const emailResults = await Promise.all(
      emailList.map(async (addr) => {
        try {
          const sendResult = await sendEmail({
            recipient: addr,
            subject: rendered.subject,
            html: rendered.html,
          });
          // Best-effort log + delivery row.
          await prisma.aiProactiveLog
            .create({
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
            })
            .catch((err) =>
              console.warn("[manager-briefing] AiProactiveLog email write failed:", err)
            );
          if (sendResult.success) {
            // PR 16 K.4 — one InsightDelivery row per (insight, email recipient).
            await Promise.all(
              briefing.sections.map((s) =>
                prisma.insightDelivery
                  .create({
                    data: {
                      insightId: s.insightId,
                      channel: "email",
                      recipient: addr,
                    },
                  })
                  .catch((err) =>
                    console.warn(
                      "[manager-briefing] InsightDelivery email write failed:",
                      err
                    )
                  )
              )
            );
          }
          return {
            channel: "email" as const,
            success: sendResult.success,
            mode: (sendResult as { mode?: string }).mode ?? null,
            recipient: addr,
            error: sendResult.success
              ? null
              : String((sendResult as { error?: unknown }).error ?? ""),
          };
        } catch (err) {
          return {
            channel: "email" as const,
            success: false,
            mode: null,
            recipient: addr,
            error: err instanceof Error ? err.message : "send failed",
          };
        }
      })
    );
    results.push(...emailResults);
  }

  // ── Telegram — fan out to every chat-id (PR 16 K.5) ──────────────────────
  if (channels.includes("telegram")) {
    const tg = renderTelegram({ briefing, ownerName, gymName });
    const tgResults = await Promise.all(
      telegramChatList.map(async (chatId) => {
        try {
          const sendResult = await sendMessageWithButtons({
            chatId,
            text: tg.text,
            buttons: tg.buttons,
            parseMode: "HTML",
          });
          await prisma.aiProactiveLog
            .create({
              data: {
                feature: "manager_briefing",
                targetType: "owner",
                targetId: 0,
                channel: "telegram",
                content: tg.text.slice(0, 8000),
                status: sendResult.success ? "sent" : "failed",
                error: sendResult.success ? null : sendResult.error,
              },
            })
            .catch((err) =>
              console.warn(
                "[manager-briefing] AiProactiveLog telegram write failed:",
                err
              )
            );
          const messageId = sendResult.success
            ? sendResult.data?.message_id
            : undefined;
          if (sendResult.success && typeof messageId === "number") {
            // PR 16 K.4 — log delivery so the email confirm route can later
            // edit this exact message ("Done via email").
            await Promise.all(
              briefing.sections.map((s) =>
                prisma.insightDelivery
                  .create({
                    data: {
                      insightId: s.insightId,
                      channel: "telegram",
                      recipient: chatId,
                      telegramChatId: chatId,
                      telegramMessageId: messageId,
                    },
                  })
                  .catch((err) =>
                    console.warn(
                      "[manager-briefing] InsightDelivery telegram write failed:",
                      err
                    )
                  )
              )
            );
          }
          return {
            channel: "telegram" as const,
            success: sendResult.success,
            mode: process.env.TELEGRAM_BOT_TOKEN ? "live" : "dev",
            recipient: chatId,
            error: sendResult.success ? null : sendResult.error,
            messageId,
          };
        } catch (err) {
          return {
            channel: "telegram" as const,
            success: false,
            mode: process.env.TELEGRAM_BOT_TOKEN ? "live" : "dev",
            recipient: chatId,
            error: err instanceof Error ? err.message : "send failed",
          };
        }
      })
    );
    results.push(...tgResults);
  }

  const sentCount = results.filter((r) => r.success).length;

  // PR 16 K.1 — mark fatigue + ownerSeenAt for each delivered insight.
  if (sentCount > 0) {
    const ids = briefing.sections.map((s) => s.insightId);
    if (ids.length > 0) {
      await prisma.insight
        .updateMany({
          where: { id: { in: ids } },
          data: { ownerSeenAt: new Date(), lastNotifiedAt: new Date() },
        })
        .catch((err) =>
          console.warn(
            "[manager-briefing] ownerSeenAt/lastNotifiedAt update failed:",
            err
          )
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
