/**
 * Morning digest built from the app's own Postgres (Task #78: one chat for
 * the owner — morning brief + action register together).
 *
 * Mirrors the SECTIONS of the standalone telegram-bot CSV digest
 * (telegram-bot/src/digest-prompt.ts is the section/format spec; that
 * project is NOT touched) but computes everything from this app's DB,
 * which v3-sync lands nightly (Payment, MemberTicket.balanceDue, Enquiry,
 * AttendanceLog).
 *
 * DETERMINISTIC BY DESIGN — NO LLM. The CSV digest needs an LLM (and a
 * whole verifier/override/redaction pipeline around it) because an agent
 * composes the text from raw CSVs and has been observed to hallucinate
 * rupee figures. Here the DB is ground truth and every number is a direct
 * Prisma aggregate, so the composition is plain string building: nothing
 * to verify, nothing to override.
 *
 * Section sources (CSV-digest section -> app DB):
 *   1. YESTERDAY'S MONEY   Payment.createdAt in yesterday's IST day window
 *                          (v3-sync stamps createdAt from v3 PaymentDate);
 *                          sum/count + paymentMode split + 7-day average.
 *   2. EXPIRING SOON       MemberTicket active, expireDate in the next 14
 *                          days (task widens the CSV digest's 7d window),
 *                          top 5 by amountPaid — name + amount + phone.
 *                          This goes to the OWNER about his own members.
 *   3. OUTSTANDING DUES    MemberTicket active, balanceDue > 0, top 5 by
 *                          balanceDue — name + balance + phone.
 *   4. NEW LEADS           Enquiry.createdAt in yesterday's IST day window.
 *   5. TODAY'S ACTIONS     top 3 open ActionProposals by projectedImpactInr
 *                          (only when the Earned Autonomy loop is on).
 *
 * IST anchoring: v3-synced Payment rows carry createdAt = UTC midnight of
 * the IST calendar date (00:00Z = 05:30 IST, inside the same IST day), and
 * live in-app payments carry real UTC timestamps — so filtering on the IST
 * day window [00:00 IST, 24:00 IST) expressed as UTC instants captures
 * both correctly.
 *
 * Sections are independent (per the CSV digest contract): a query failure
 * in one section degrades to the exact owner-safe copy
 * "data unavailable today — we are on it." without blocking the others.
 *
 * Output is Telegram-HTML (the in-app bot's house parse mode); all dynamic
 * strings pass through escapeHtml.
 */

import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import { escapeHtml } from "@/lib/channels/telegram";
import { isoDay } from "@/lib/agents/_helpers";
import { istMidnight } from "@/lib/utils/date";
import {
  isAutonomyEnabled,
  getOpenProposals,
} from "@/lib/services/action-loop";

// Exact owner-safe degradation copy from the CSV digest spec — never leak
// query/DB mechanics to the owner.
const UNAVAILABLE = "data unavailable today — we are on it.";

// ─── IST date helpers ────────────────────────────────────────────────────────
// Date windows are built ONLY from the repo's existing IST helpers
// (lib/agents/_helpers.ts isoDay, lib/utils/date.ts istMidnight) — never
// from server-local time. Vercel crons run in UTC; a naive new Date()
// calendar read would put the 03:25 UTC run on the wrong IST day.

/** IST-local calendar date as YYYY-MM-DD (delegates to repo isoDay). */
export function istDateIso(now: Date = new Date()): string {
  return isoDay(now);
}

/** Shift a YYYY-MM-DD calendar date by n days (pure calendar math, UTC-anchored). */
function addDays(dateIso: string, n: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** UTC instant of 00:00 IST on the given calendar date (delegates to repo istMidnight). */
function istDayStartUtc(dateIso: string): Date {
  const [y, m, d] = dateIso.split("-").map(Number);
  return istMidnight(y, m - 1, d);
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

/** Indian-style grouping commas with rupee sign (₹3,05,700). */
function inr(n: number): string {
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(n))}`;
}

/** "1 payment" / "0 payments" / "7 payments" — per the CSV digest spec. */
function paymentsNoun(n: number): string {
  return `${n} payment${n === 1 ? "" : "s"}`;
}

const MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  upi: "GPay/UPI",
  card: "Card",
  cheque: "Cheque",
  bank_transfer: "Bank",
  complimentary: "Comp",
};

function modeLabel(mode: string): string {
  return MODE_LABELS[mode] ?? "Other";
}

// ─── Result types ────────────────────────────────────────────────────────────

/**
 * Comparison snapshot stored in DigestRun.metrics. The standalone CSV
 * digest's output cannot be read server-side, so the lead diffs these
 * numbers against the 09:00 IST Telegram messages by eye / via
 * scripts/compare-digest.ts during the shadow window.
 */
export type DigestMetrics = {
  date: string; // IST date the digest was composed on
  yesterday: string; // IST date the money section covers
  yesterdayTotal: number | null;
  yesterdayCount: number | null;
  byMode: Record<string, number> | null;
  sevenDayAvg: number | null;
  expiringTop5Total: number | null;
  expiringCount: number | null;
  duesTop5Total: number | null;
  duesCount: number | null;
  leadsCount: number | null;
  openActionsCount: number | null;
};

export type DigestResult =
  | { success: true; date: string; text: string; metrics: DigestMetrics }
  | { success: false; error: string };

// ─── Section computations (each independent, never throws) ──────────────────

type MoneySection = {
  line: string; // section 1 text (without the "1. " prefix)
  headline: string;
  total: number | null;
  count: number | null;
  byMode: Record<string, number> | null;
  sevenDayAvg: number | null;
};

async function computeMoney(todayIso: string): Promise<MoneySection> {
  const yIso = addDays(todayIso, -1);
  try {
    const yStart = istDayStartUtc(yIso);
    const yEnd = istDayStartUtc(todayIso);
    const sevenStart = istDayStartUtc(addDays(todayIso, -7));

    const [rows, sevenAgg] = await Promise.all([
      prisma.payment.findMany({
        where: { createdAt: { gte: yStart, lt: yEnd } },
        select: { amount: true, paymentMode: true },
      }),
      prisma.payment.aggregate({
        where: { createdAt: { gte: sevenStart, lt: yEnd } },
        _sum: { amount: true },
      }),
    ]);

    let total = 0;
    const byMode: Record<string, number> = {};
    for (const r of rows) {
      const amt = Number(r.amount);
      total += amt;
      const label = modeLabel(r.paymentMode);
      byMode[label] = (byMode[label] ?? 0) + amt;
    }
    const count = rows.length;
    const sevenDayAvg = Number(sevenAgg._sum.amount ?? 0) / 7;

    const breakdown = Object.entries(byMode)
      .filter(([, amt]) => amt > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([label, amt]) => `${label} ${inr(amt)}`)
      .join(" / ");

    // Headline "in (X% above/below avg)" clause only when the 7-day avg is
    // computable — never a hanging "in" (CSV digest spec rule).
    let pctClause = "";
    if (sevenDayAvg > 0) {
      const pct = Math.round(((total - sevenDayAvg) / sevenDayAvg) * 100);
      pctClause = ` (${Math.abs(pct)}% ${pct >= 0 ? "above" : "below"} avg)`;
    }
    const headline =
      count === 0
        ? "Headline: ₹0 yesterday"
        : `Headline: ${inr(total)} in${pctClause}`;

    const line =
      count === 0
        ? `YESTERDAY'S MONEY: ₹0 • no payments recorded`
        : `YESTERDAY'S MONEY: ${inr(total)} • ${breakdown || "no breakdown"} • ${paymentsNoun(count)}` +
          `\n   • 7-day avg ${inr(Math.round(sevenDayAvg))}`;

    return { line, headline, total, count, byMode, sevenDayAvg };
  } catch (err) {
    console.error("[morning-digest] money section failed:", err);
    return {
      line: `YESTERDAY'S MONEY: ${UNAVAILABLE}`,
      headline: "Headline: (collections data unavailable today)",
      total: null,
      count: null,
      byMode: null,
      sevenDayAvg: null,
    };
  }
}

type ExpiringSection = {
  lines: string[];
  top5Total: number | null;
  count: number | null;
};

async function computeExpiring(todayIso: string): Promise<ExpiringSection> {
  try {
    // Next 14 days, starting tomorrow IST (task widens the CSV digest's
    // 7-day window to 14).
    const windowStart = istDayStartUtc(addDays(todayIso, 1));
    const windowEnd = istDayStartUtc(addDays(todayIso, 15));
    const [top5, count] = await Promise.all([
      prisma.memberTicket.findMany({
        where: {
          status: "active",
          expireDate: { gte: windowStart, lt: windowEnd },
        },
        orderBy: { amountPaid: "desc" },
        take: 5,
        select: {
          amountPaid: true,
          expireDate: true,
          user: { select: { firstname: true, lastname: true, phone: true } },
        },
      }),
      prisma.memberTicket.count({
        where: {
          status: "active",
          expireDate: { gte: windowStart, lt: windowEnd },
        },
      }),
    ]);

    if (count === 0) {
      return {
        lines: ["EXPIRING SOON (next 14d): none"],
        top5Total: 0,
        count: 0,
      };
    }

    const top5Total = top5.reduce((s, t) => s + Number(t.amountPaid), 0);
    const lines = [
      `EXPIRING SOON (next 14d): ${inr(top5Total)} total (top ${top5.length} of ${count} expiring)`,
      ...top5.map((t) => {
        const name = escapeHtml(`${t.user.firstname} ${t.user.lastname}`.trim());
        const phone = escapeHtml(t.user.phone ?? "no phone");
        const exp = istDateIso(t.expireDate);
        return `   ${name} — ${inr(Number(t.amountPaid))} — ${phone} (exp ${exp})`;
      }),
    ];
    return { lines, top5Total, count };
  } catch (err) {
    console.error("[morning-digest] expiring section failed:", err);
    return {
      lines: [`EXPIRING SOON (next 14d): ${UNAVAILABLE}`],
      top5Total: null,
      count: null,
    };
  }
}

type DuesSection = {
  lines: string[];
  top5Total: number | null;
  count: number | null;
};

async function computeDues(): Promise<DuesSection> {
  try {
    const [top5, count] = await Promise.all([
      prisma.memberTicket.findMany({
        where: { status: "active", balanceDue: { gt: 0 } },
        orderBy: { balanceDue: "desc" },
        take: 5,
        select: {
          balanceDue: true,
          user: { select: { firstname: true, lastname: true, phone: true } },
        },
      }),
      prisma.memberTicket.count({
        where: { status: "active", balanceDue: { gt: 0 } },
      }),
    ]);

    if (count === 0) {
      return { lines: ["OUTSTANDING DUES: none"], top5Total: 0, count: 0 };
    }

    const top5Total = top5.reduce((s, t) => s + Number(t.balanceDue), 0);
    const lines = [
      `OUTSTANDING DUES: ${inr(top5Total)} total (top ${top5.length} of ${count} with dues)`,
      ...top5.map((t) => {
        const name = escapeHtml(`${t.user.firstname} ${t.user.lastname}`.trim());
        const phone = escapeHtml(t.user.phone ?? "no phone");
        return `   ${name} — ${inr(Number(t.balanceDue))} — ${phone}`;
      }),
    ];
    return { lines, top5Total, count };
  } catch (err) {
    console.error("[morning-digest] dues section failed:", err);
    return {
      lines: [`OUTSTANDING DUES: ${UNAVAILABLE}`],
      top5Total: null,
      count: null,
    };
  }
}

type LeadsSection = {
  lines: string[];
  count: number | null;
};

async function computeLeads(todayIso: string): Promise<LeadsSection> {
  try {
    const yStart = istDayStartUtc(addDays(todayIso, -1));
    const yEnd = istDayStartUtc(todayIso);
    const enquiries = await prisma.enquiry.findMany({
      where: { createdAt: { gte: yStart, lt: yEnd } },
      orderBy: { createdAt: "asc" },
      select: { name: true, source: true, phone: true },
      take: 25,
    });
    if (enquiries.length === 0) {
      return { lines: ["NEW LEADS: 0"], count: 0 };
    }
    const lines = [
      `NEW LEADS: ${enquiries.length}`,
      ...enquiries.slice(0, 10).map((e) => {
        const src = e.source && e.source !== "walk_in" ? e.source : "walk-in";
        return `   ${escapeHtml(e.name)} (${escapeHtml(src)}) — ${escapeHtml(e.phone)}`;
      }),
    ];
    if (enquiries.length > 10) {
      lines.push(`   … +${enquiries.length - 10} more`);
    }
    return { lines, count: enquiries.length };
  } catch (err) {
    console.error("[morning-digest] leads section failed:", err);
    return { lines: [`NEW LEADS: ${UNAVAILABLE}`], count: null };
  }
}

type ActionsSection = {
  lines: string[];
  openCount: number | null;
};

async function computeActions(): Promise<ActionsSection> {
  try {
    if (!(await isAutonomyEnabled())) {
      // Loop off — section omitted entirely (no internal jargon for the
      // owner; /autonomy on is the control surface).
      return { lines: [], openCount: 0 };
    }
    const open = await getOpenProposals();
    if (open.length === 0) {
      return {
        lines: ["TODAY'S ACTIONS: none open — all caught up."],
        openCount: 0,
      };
    }
    const top3 = [...open]
      .sort(
        (a, b) => (b.projectedImpactInr ?? 0) - (a.projectedImpactInr ?? 0)
      )
      .slice(0, 3);
    const lines = [
      `TODAY'S ACTIONS (top ${top3.length} of ${open.length} open by impact — /actions to approve):`,
      ...top3.map((p, i) => {
        const impact =
          p.projectedImpactInr !== null ? inr(p.projectedImpactInr) : "n/a";
        return `   ${i + 1}. ${escapeHtml(p.title)} — ${impact}`;
      }),
    ];
    return { lines, openCount: open.length };
  } catch (err) {
    console.error("[morning-digest] actions section failed:", err);
    return { lines: [`TODAY'S ACTIONS: ${UNAVAILABLE}`], openCount: null };
  }
}

/**
 * "Data as of" footer from the v3-sync marker. v3-sync writes
 * GymSettings.v3_last_sync_at (ISO timestamp) after every chunk
 * (markStatus in app/api/internal/v3-sync/route.ts). Omitted when the
 * marker doesn't exist (gym not on v3-sync).
 */
async function dataAsOfFooter(): Promise<string | null> {
  try {
    const iso = (await getSetting("v3_last_sync_at", "")).trim();
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const stamp = d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `Data as of ${escapeHtml(stamp)} IST (nightly sync).`;
  } catch {
    return null; // footer is optional — never block the digest on it
  }
}

// ─── buildDigest ─────────────────────────────────────────────────────────────

/**
 * Build the owner's morning digest from the app DB. Never throws — returns
 * { success: false } only when composition itself fails catastrophically;
 * individual section failures degrade in-message per the CSV digest's
 * owner-safe copy rule.
 */
export async function buildDigest(now: Date = new Date()): Promise<DigestResult> {
  try {
    const todayIso = istDateIso(now);
    const yIso = addDays(todayIso, -1);

    const gymName =
      process.env.NEXT_PUBLIC_GYM_NAME ||
      process.env.GYM_NAME ||
      (await getSetting("gym_name", "").catch(() => "")) ||
      "Your gym";

    const [money, expiring, dues, leads, actions, footer] = await Promise.all([
      computeMoney(todayIso),
      computeExpiring(todayIso),
      computeDues(),
      computeLeads(todayIso),
      computeActions(),
      dataAsOfFooter(),
    ]);

    const expiringHeadline =
      expiring.count !== null && expiring.count > 0
        ? ` • ${expiring.count} expiring in 14d`
        : "";

    const lines: string[] = [
      `<b>GOOD MORNING — ${todayIso}</b>`,
      `<b>${escapeHtml(gymName)}</b>`,
      "",
      `${money.headline}${expiringHeadline}`,
      `1. ${money.line}`,
      `2. ${expiring.lines[0]}`,
      ...expiring.lines.slice(1),
      `3. ${dues.lines[0]}`,
      ...dues.lines.slice(1),
      `4. ${leads.lines[0]}`,
      ...leads.lines.slice(1),
    ];
    if (actions.lines.length > 0) {
      lines.push(`5. ${actions.lines[0]}`, ...actions.lines.slice(1));
    }
    if (footer) {
      lines.push("", `<i>${footer}</i>`);
    }

    const metrics: DigestMetrics = {
      date: todayIso,
      yesterday: yIso,
      yesterdayTotal: money.total,
      yesterdayCount: money.count,
      byMode: money.byMode,
      sevenDayAvg:
        money.sevenDayAvg === null ? null : Math.round(money.sevenDayAvg),
      expiringTop5Total: expiring.top5Total,
      expiringCount: expiring.count,
      duesTop5Total: dues.top5Total,
      duesCount: dues.count,
      leadsCount: leads.count,
      openActionsCount: actions.openCount,
    };

    return {
      success: true,
      date: todayIso,
      // Telegram caps messages at 4096 chars; 4000 leaves headroom and
      // matches the webhook handler's existing slice.
      text: lines.join("\n").slice(0, 4000),
      metrics,
    };
  } catch (err) {
    console.error("[morning-digest] buildDigest failed:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "digest build failed",
    };
  }
}
