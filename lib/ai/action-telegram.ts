/**
 * Telegram verify surface for the Earned Autonomy action register.
 *
 * Renders open ActionProposals to the paired owner chat with inline
 * [Approve] / [Reject] buttons and handles the resulting callbacks. Sits
 * beside manager-telegram.ts and reuses the same channel primitives
 * (sendMessageWithButtons / editMessageText / answerCallbackQuery from
 * lib/channels/telegram.ts — env -> GymSettings token fallback included).
 *
 * Callback data (plain prefixed strings, NOT JSON — kept under Telegram's
 * 64-byte limit and disambiguated from the existing {"t":...} payloads by
 * the "action_" prefix checked before JSON.parse in the webhook):
 *   action_approve:<id>        approve + execute one proposal
 *   action_reject:<id>         reject one proposal, then ask for the reason
 *   action_approve_all:<type>  approve every open proposal of an action type
 *   action_review:<type>       fan out one card per proposal of that type
 *
 * Clubbing v1: when more than 3 open proposals share an actionType they are
 * collapsed into ONE summary message with [Approve all N] [Review one by one].
 */

import {
  sendMessage,
  sendMessageWithButtons,
  editMessageText,
  answerCallbackQuery,
  escapeHtml,
} from "@/lib/channels/telegram";
import {
  getOpenProposals,
  getRecentAutoExecuted,
  decideProposal,
  approveAllOfType,
  markPendingReject,
  isAutonomyEnabled,
  setAutonomyEnabled,
  setPolicyMode,
  getAutonomyStatus,
  isMessageActionType,
  MESSAGE_ACTION_TYPES,
  type ProposalSummary,
} from "@/lib/services/action-loop";

const CLUB_THRESHOLD = 3; // >3 proposals of one type -> one summary message
const REVIEW_FANOUT_CAP = 10; // max individual cards when reviewing one by one

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function pct(likelihood: number | null): string {
  return likelihood === null ? "n/a" : `${Math.round(likelihood * 100)}%`;
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderProposalCard(p: ProposalSummary): string {
  const lines = [
    `\u{1F4CB} <b>Action #${p.id} — ${escapeHtml(p.title)}</b>`,
    escapeHtml(p.instruction),
    `Impact: <b>${p.projectedImpactInr !== null ? inr(p.projectedImpactInr) : "n/a"}</b> | Likelihood: ${pct(p.likelihood)} | Window: ${p.clockspeedDays ?? "?"}d`,
  ];
  return lines.join("\n");
}

async function sendProposalCard(chatId: string | number, p: ProposalSummary) {
  return sendMessageWithButtons({
    chatId,
    text: renderProposalCard(p),
    buttons: [
      [
        { text: "\u2705 Approve", callback_data: `action_approve:${p.id}` },
        { text: "\u274C Reject", callback_data: `action_reject:${p.id}` },
      ],
    ],
  });
}

/**
 * Send the action register: every open proposal, clubbed by actionType.
 * Groups of <= CLUB_THRESHOLD render one card per proposal; bigger groups
 * render a single summary message with [Approve all N] [Review one by one].
 *
 * Notify-mode / legacy-capture executions appear as "Done (auto): ..." lines
 * (last 24h, no buttons) so autonomous sends stay visible to the owner.
 */
export async function sendActionRegister(
  chatId: string | number
): Promise<{ success: true; sent: number } | { success: false; error: string }> {
  if (!(await isAutonomyEnabled())) {
    return { success: false, error: "autonomy_disabled" };
  }
  const [open, recentAuto] = await Promise.all([
    getOpenProposals(),
    getRecentAutoExecuted(24),
  ]);

  // "Done (auto)" digest first \u2014 informational, no buttons. One message for
  // all auto-executed proposals of the last 24h, clubbed by actionType.
  if (recentAuto.length > 0) {
    const byType = new Map<string, ProposalSummary[]>();
    for (const p of recentAuto) {
      const list = byType.get(p.actionType) ?? [];
      list.push(p);
      byType.set(p.actionType, list);
    }
    const lines: string[] = [`\u2699\ufe0f <b>Done (auto) \u2014 last 24h</b>`];
    for (const [actionType, proposals] of byType) {
      const total = proposals.reduce((s, p) => s + (p.projectedImpactInr ?? 0), 0);
      lines.push(
        "",
        `<b>${escapeHtml(actionType.replace(/_/g, " "))}</b> \u2014 ${proposals.length} sent, projected ${inr(total)}`
      );
      for (const p of proposals.slice(0, 8)) {
        lines.push(`Done (auto): ${escapeHtml(p.title)} \u2014 ${p.projectedImpactInr !== null ? inr(p.projectedImpactInr) : "n/a"}`);
      }
      if (proposals.length > 8) {
        lines.push(`\u2026 +${proposals.length - 8} more`);
      }
    }
    lines.push(
      "",
      `<i>Auto-executed (notify mode or captured legacy cron). "/autonomy verify &lt;type&gt;" puts a type back behind your approval.</i>`
    );
    await sendMessage({ chatId, text: lines.join("\n").slice(0, 4000), parseMode: "HTML" });
  }

  if (open.length === 0) {
    if (recentAuto.length === 0) {
      await sendMessage({
        chatId,
        text: "\u2705 No actions awaiting your verification.",
      });
    }
    return { success: true, sent: recentAuto.length > 0 ? 1 : 0 };
  }

  const byType = new Map<string, ProposalSummary[]>();
  for (const p of open) {
    const list = byType.get(p.actionType) ?? [];
    list.push(p);
    byType.set(p.actionType, list);
  }

  let sent = 0;
  for (const [actionType, proposals] of byType) {
    if (proposals.length > CLUB_THRESHOLD) {
      const total = proposals.reduce((s, p) => s + (p.projectedImpactInr ?? 0), 0);
      const top = proposals.slice(0, 8);
      const lines = [
        `\u{1F4E5} <b>${proposals.length} proposed actions — ${escapeHtml(actionType.replace(/_/g, " "))}</b>`,
        `Projected impact: <b>${inr(total)}</b> total`,
        "",
        ...top.map(
          (p, i) =>
            `${i + 1}. ${escapeHtml(p.title)} — ${p.projectedImpactInr !== null ? inr(p.projectedImpactInr) : "n/a"} (${pct(p.likelihood)})`
        ),
      ];
      if (proposals.length > top.length) {
        lines.push(`… +${proposals.length - top.length} more`);
      }
      const r = await sendMessageWithButtons({
        chatId,
        text: lines.join("\n"),
        buttons: [
          [
            {
              text: `\u2705 Approve all ${proposals.length}`,
              callback_data: `action_approve_all:${actionType}`,
            },
            {
              text: "\u{1F50D} Review one by one",
              callback_data: `action_review:${actionType}`,
            },
          ],
        ],
      });
      if (r.success) sent++;
    } else {
      for (const p of proposals) {
        const r = await sendProposalCard(chatId, p);
        if (r.success) sent++;
      }
    }
  }
  return { success: true, sent };
}

// ─── Callback handling (invoked from the webhook) ────────────────────────────

/**
 * Handle an `action_*` callback. Returns true when the payload was an
 * action-register callback (handled here), false when the webhook should
 * fall through to its existing JSON-payload dispatcher.
 *
 * The caller (webhook) has already enforced the owner gate and update_id
 * dedupe; decideProposal adds the atomic status-claim so duplicate taps and
 * cross-replica races stay single-execution.
 */
export async function handleActionCallback(args: {
  data: string;
  chatId: string | number;
  messageId?: number;
  callbackQueryId: string;
  workerId: number;
}): Promise<boolean> {
  const { data } = args;
  if (!data.startsWith("action_")) return false;

  const sep = data.indexOf(":");
  const verb = sep > 0 ? data.slice(0, sep) : data;
  const arg = sep > 0 ? data.slice(sep + 1) : "";

  // ── Approve one ───────────────────────────────────────────────────────────
  if (verb === "action_approve") {
    const id = parseInt(arg, 10);
    if (!Number.isFinite(id)) {
      await answerCallbackQuery({ callbackQueryId: args.callbackQueryId, text: "Bad action id." });
      return true;
    }
    const result = await decideProposal(id, args.workerId, true);
    if (!result.success) {
      await answerCallbackQuery({
        callbackQueryId: args.callbackQueryId,
        text: `Failed: ${result.error.slice(0, 180)}`,
        showAlert: true,
      });
      return true;
    }
    if (result.alreadyDecided) {
      await answerCallbackQuery({
        callbackQueryId: args.callbackQueryId,
        text: `Already ${result.status} \u2713`,
      });
      return true;
    }
    const ok = result.status === "executed";
    await answerCallbackQuery({
      callbackQueryId: args.callbackQueryId,
      text: ok ? "Approved & sent \u2713" : `Approved but execution failed`,
      showAlert: !ok,
    });
    if (args.messageId) {
      await editMessageText({
        chatId: args.chatId,
        messageId: args.messageId,
        text: ok
          ? `\u2705 <b>Action #${id}</b>\n<i>Approved — message sent to the member.</i>`
          : `\u26A0\uFE0F <b>Action #${id}</b>\n<i>Approved, but execution failed: ${escapeHtml((result.executionError ?? "unknown").slice(0, 200))}</i>`,
      }).catch(() => {});
    }
    return true;
  }

  // ── Reject one (reason captured from the next text message, 10 min) ──────
  if (verb === "action_reject") {
    const id = parseInt(arg, 10);
    if (!Number.isFinite(id)) {
      await answerCallbackQuery({ callbackQueryId: args.callbackQueryId, text: "Bad action id." });
      return true;
    }
    const result = await decideProposal(id, args.workerId, false);
    if (!result.success) {
      await answerCallbackQuery({
        callbackQueryId: args.callbackQueryId,
        text: `Failed: ${result.error.slice(0, 180)}`,
        showAlert: true,
      });
      return true;
    }
    if (result.alreadyDecided) {
      await answerCallbackQuery({
        callbackQueryId: args.callbackQueryId,
        text: `Already ${result.status} \u2713`,
      });
      return true;
    }
    await markPendingReject({ proposalId: id, chatId: String(args.chatId) });
    await answerCallbackQuery({
      callbackQueryId: args.callbackQueryId,
      text: "Rejected. Reply with the reason.",
    });
    if (args.messageId) {
      await editMessageText({
        chatId: args.chatId,
        messageId: args.messageId,
        text:
          `\u274C <b>Action #${id} rejected</b>\n` +
          `<i>Reply with the reason (your next message within 10 minutes is recorded). ` +
          `Your reasons become hard boundary conditions for future proposals.</i>`,
      }).catch(() => {});
    }
    return true;
  }

  // ── Approve all of one type (clubbed summary) ─────────────────────────────
  if (verb === "action_approve_all") {
    const actionType = arg;
    const { approved, failed, skipped } = await approveAllOfType(
      actionType,
      args.workerId
    );
    await answerCallbackQuery({
      callbackQueryId: args.callbackQueryId,
      text: failed === 0 ? `Approved ${approved} \u2713` : `${approved} sent, ${failed} failed`,
      showAlert: failed > 0,
    });
    if (args.messageId) {
      await editMessageText({
        chatId: args.chatId,
        messageId: args.messageId,
        text:
          `\u2705 <b>${escapeHtml(actionType.replace(/_/g, " "))}</b>\n` +
          `<i>Approved ${approved} action(s)` +
          `${skipped > 0 ? `, ${skipped} already handled` : ""}` +
          `${failed > 0 ? `, ${failed} failed (see audit log)` : ""}.</i>`,
      }).catch(() => {});
    }
    return true;
  }

  // ── Review one by one (fan out individual cards) ──────────────────────────
  if (verb === "action_review") {
    const actionType = arg;
    const open = (await getOpenProposals())
      .filter((p) => p.actionType === actionType)
      .slice(0, REVIEW_FANOUT_CAP);
    await answerCallbackQuery({
      callbackQueryId: args.callbackQueryId,
      text: open.length > 0 ? `Sending ${open.length} card(s)…` : "Nothing left to review.",
    });
    for (const p of open) {
      await sendProposalCard(args.chatId, p);
    }
    if (args.messageId && open.length > 0) {
      await editMessageText({
        chatId: args.chatId,
        messageId: args.messageId,
        text: `\u{1F50D} <i>Reviewing ${open.length} ${escapeHtml(actionType.replace(/_/g, " "))} action(s) one by one below.</i>`,
      }).catch(() => {});
    }
    return true;
  }

  await answerCallbackQuery({
    callbackQueryId: args.callbackQueryId,
    text: "Unknown action callback.",
  });
  return true;
}

// ─── /autonomy command (owner control surface) ──────────────────────────────

function modeGlyph(mode: string): string {
  if (mode === "notify") return "auto";
  if (mode === "off") return "OFF";
  return "verify";
}

async function sendAutonomyStatus(chatId: string | number): Promise<void> {
  const { enabled, rows } = await getAutonomyStatus();
  const lines: string[] = [
    `\u{1F39B} <b>Autonomy status</b> — global: <b>${enabled ? "ON" : "OFF"}</b>`,
    "",
  ];
  for (const r of rows) {
    const approval =
      r.approvalRatePct === null ? "—" : `${r.approvalRatePct}%`;
    const calibration =
      r.calibrationPct === null ? "—" : `${r.calibrationPct}%`;
    lines.push(
      `<b>${escapeHtml(r.actionType)}</b>: ${modeGlyph(r.mode)}`,
      `  decisions ${r.approvals + r.rejections} (${r.approvals}✓/${r.rejections}✗, approval ${approval}) | sent ${r.executedCount} | open ${r.openCount}`,
      `  measured ${r.measuredCount} | calibration ${calibration}${r.outcomeHitRatePct !== null ? ` | hit-rate ${r.outcomeHitRatePct}%` : ""}`
    );
    if (r.demotedAt && r.demotionReason) {
      lines.push(`  demoted: ${escapeHtml(r.demotionReason)}`);
    }
  }
  lines.push(
    "",
    `<b>owner_bot_qa</b>: autonomous (Reactions tier — this Telegram chat answers your questions with live gym data today, no approval loop; it is read-only).`,
    "",
    `Commands: /autonomy on | off | status | verify &lt;type&gt; | notify &lt;type&gt; | off &lt;type&gt;`
  );
  await sendMessage({
    chatId,
    text: lines.join("\n").slice(0, 4000),
    parseMode: "HTML",
  });
}

/**
 * Handle the owner-only `/autonomy` command. The webhook has already
 * enforced the security stack (webhook secret, owner chat gate, update_id
 * dedupe) — same as /actions.
 *
 *   /autonomy | /autonomy status      per-type table
 *   /autonomy on | off                global kill-switch (GymSettings)
 *   /autonomy verify <type>           type back to human verification
 *   /autonomy notify <type>           grant auto-mode (the graduation accept)
 *   /autonomy off <type>              kill one type (no proposals at all)
 */
export async function handleAutonomyCommand(args: {
  chatId: string | number;
  text: string;
  workerId: number;
}): Promise<void> {
  const parts = args.text
    .replace(/^\/autonomy(@\w+)?/i, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const sub = (parts[0] ?? "status").toLowerCase();
  const typeArg = (parts[1] ?? "").toLowerCase();

  if (sub === "" || sub === "status") {
    await sendAutonomyStatus(args.chatId);
    return;
  }

  if (sub === "on" && !typeArg) {
    const r = await setAutonomyEnabled(true, args.workerId);
    await sendMessage({
      chatId: args.chatId,
      text: r.success
        ? "✅ Autonomy is <b>ON</b>. Agents will propose actions; nothing executes without your approval until a type graduates to notify mode."
        : `⚠️ ${escapeHtml(r.error)}`,
      parseMode: "HTML",
    });
    return;
  }

  if (sub === "off" && !typeArg) {
    const r = await setAutonomyEnabled(false, args.workerId);
    await sendMessage({
      chatId: args.chatId,
      text: r.success
        ? "\u{1F6D1} Autonomy is <b>OFF</b>. No proposals, no executions, no auto-sends. Legacy reminder crons resume their original behavior."
        : `⚠️ ${escapeHtml(r.error)}`,
      parseMode: "HTML",
    });
    return;
  }

  if ((sub === "verify" || sub === "notify" || sub === "off") && typeArg) {
    if (!isMessageActionType(typeArg)) {
      await sendMessage({
        chatId: args.chatId,
        text:
          `⚠️ Unknown action type "${escapeHtml(typeArg)}". Valid: ` +
          MESSAGE_ACTION_TYPES.join(", "),
        parseMode: "HTML",
      });
      return;
    }
    const r = await setPolicyMode(typeArg, sub, args.workerId);
    if (!r.success) {
      await sendMessage({
        chatId: args.chatId,
        text: `⚠️ ${escapeHtml(r.error)}`,
        parseMode: "HTML",
      });
      return;
    }
    const desc =
      sub === "notify"
        ? "auto-executes on creation; you get a Done (auto) line instead of buttons. Auto-demotion flips it back to verify on calibration collapse or execution failures."
        : sub === "off"
          ? "killed — no proposals of this type will be created."
          : "every proposal waits for your approval.";
    await sendMessage({
      chatId: args.chatId,
      text: `✅ <b>${escapeHtml(typeArg)}</b>: ${escapeHtml(r.previousMode)} → <b>${sub}</b>. Now ${desc}`,
      parseMode: "HTML",
    });
    return;
  }

  await sendMessage({
    chatId: args.chatId,
    text:
      "Usage: /autonomy [status] | on | off | verify &lt;type&gt; | notify &lt;type&gt; | off &lt;type&gt;\n" +
      `Types: ${MESSAGE_ACTION_TYPES.join(", ")}`,
    parseMode: "HTML",
  });
}
