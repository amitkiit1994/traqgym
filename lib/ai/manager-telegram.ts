/**
 * Manager Telegram renderer — converts a ComposedBriefing into:
 *  - HTML-formatted message text (parse_mode: "HTML")
 *  - An inline keyboard with one row per insight (primary action + Snooze 7d)
 *
 * We use HTML parse_mode because MarkdownV2 escaping rules are very strict and
 * easy to get wrong (every `.`, `-`, `(`, `)`, etc. needs escaping). HTML only
 * requires escaping `<`, `>`, and `&` — much safer.
 *
 * Callback data format (controlled by us, parsed by the webhook handler):
 *   {"t":"insight_action","i":<insightId>,"a":<actionIndex>}
 *   {"t":"snooze","i":<insightId>,"h":<hours>}
 */

import type { ComposedBriefing, ComposedSection } from "./manager";
import { escapeHtml } from "@/lib/channels/telegram";

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "\u{1F534}", // red circle
  high: "\u{1F7E0}", // orange circle
  medium: "\u{1F7E1}", // yellow circle
  low: "\u{1F535}", // blue circle
};

function formatRupees(n: number): string {
  if (n <= 0) return "";
  if (n >= 100000) return `\u20B9${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `\u20B9${Math.round(n / 1000)}k`;
  return `\u20B9${Math.round(n)}`;
}

export type RenderedTelegram = {
  text: string;
  /** Inline keyboard rows. Each row is [primary action, snooze]. */
  buttons: Array<Array<{ text: string; callback_data: string }>>;
};

/**
 * Telegram has a 4096-char limit on message text and a ~64-byte limit on
 * callback_data per button. Keep payloads tiny (we only encode insightId +
 * actionIndex + type).
 */
const MAX_TG_MESSAGE = 4000; // leave headroom
const MAX_CALLBACK_DATA = 64;

function buildCallbackData(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  if (json.length > MAX_CALLBACK_DATA) {
    // Should never happen with our tight schema, but guard regardless.
    console.warn("[manager-telegram] callback_data too long:", json);
  }
  return json;
}

function renderSection(s: ComposedSection): string {
  const emoji = SEVERITY_EMOJI[s.severity] ?? SEVERITY_EMOJI.low;
  const impact = formatRupees(s.impactRupees);
  const impactSuffix = impact ? `  <i>(${escapeHtml(impact)})</i>` : "";
  const title = `${emoji} <b>${escapeHtml(s.title)}</b>${impactSuffix}`;
  // Keep body to ~500 chars per section so 5 insights fit comfortably.
  let body = s.body.trim();
  if (body.length > 500) body = body.slice(0, 497) + "...";
  return `${title}\n${escapeHtml(body)}`;
}

export function renderTelegram(args: {
  briefing: ComposedBriefing;
  ownerName: string;
  gymName: string;
  /** Snooze duration in hours for the secondary button. Default 168 (7 days). */
  snoozeHours?: number;
}): RenderedTelegram {
  const snoozeHours = args.snoozeHours ?? 168;

  const header = `<b>Morning briefing — ${escapeHtml(args.gymName)}</b>`;
  const intro = escapeHtml(args.briefing.intro);

  const sectionTexts = args.briefing.sections.map(renderSection);
  let text = `${header}\n\n${intro}\n\n${sectionTexts.join("\n\n")}`;
  if (text.length > MAX_TG_MESSAGE) {
    text = text.slice(0, MAX_TG_MESSAGE - 80) + "\n\n<i>(truncated — see dashboard)</i>";
  }

  const buttons: RenderedTelegram["buttons"] = [];
  for (const s of args.briefing.sections) {
    if (s.actions.length === 0) continue;
    const primary = s.actions[0];
    const row: Array<{ text: string; callback_data: string }> = [
      {
        text: primary.label.length > 30 ? primary.label.slice(0, 27) + "..." : primary.label,
        callback_data: buildCallbackData({
          t: "insight_action",
          i: s.insightId,
          a: 0,
        }),
      },
      {
        text: "Snooze 7d",
        callback_data: buildCallbackData({
          t: "snooze",
          i: s.insightId,
          h: snoozeHours,
        }),
      },
    ];
    buttons.push(row);
  }

  return { text, buttons };
}

/**
 * Render a single short status update for cross-channel sync (e.g. "Action
 * already done via email"). Used to edit a sent Telegram briefing message
 * after an action is taken elsewhere — keeps both channels in sync.
 */
export function renderActionDoneText(args: {
  insightTitle: string;
  via: "telegram" | "email" | "dashboard";
  actionLabel?: string;
}): string {
  const verb =
    args.via === "telegram"
      ? "Done via Telegram"
      : args.via === "email"
        ? "Done via email"
        : "Done via dashboard";
  const action = args.actionLabel ? ` — ${escapeHtml(args.actionLabel)}` : "";
  return `\u2705 <b>${escapeHtml(args.insightTitle)}</b>\n<i>${verb}${action}</i>`;
}
