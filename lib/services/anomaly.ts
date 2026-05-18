import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

/**
 * Owner-trust suite: detectors that surface signals Robin (the gym owner)
 * needs in order to catch staff mistakes or fraud. These run read-only
 * against the live DB and return small, summarised payloads suitable for
 * Telegram / chat. Every detector is bounded by a date range and an
 * optional locationId so the AI can call them safely.
 */

type Range = { from: Date; to: Date; locationId?: number };

// AuditLog has no locationId column — detectors built on it are gym-wide
// only. Keep the type narrow so the AI can't pass a parameter we'd silently
// drop. (See detectCompAbusePatterns and detectAuditAnomalies.)
type AuditRange = { from: Date; to: Date };

// Hard cap to keep a single detector from materialising hundreds of
// thousands of rows on EGYM-scale data inside a Vercel function. If a
// detector hits this limit it returns `truncated: true` so the caller
// knows the answer is partial.
const MAX_ROWS = 100_000;

// detectDiscountOutliers: don't flag a collector as an outlier off a
// handful of payments — small samples produce misleading medians.
const MIN_OUTLIER_PAYMENTS = 5;

function asRupees(d: Prisma.Decimal | number | null | undefined): number {
  if (d == null) return 0;
  if (typeof d === "number") return d;
  return Number(d);
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/* ─── 1. Duplicate payments ─────────────────────────────────────────────── */
/**
 * Same member + same amount within `windowMinutes` (default 10) — usually
 * a staff hit "Save" twice or recorded a refund by re-posting the original.
 *
 * Sorting by (userId, amount, createdAt) so equal-amount payments by the
 * same member end up adjacent regardless of intermediate non-duplicates.
 * The previous implementation sorted only by (userId, createdAt) and only
 * compared the immediately-previous row, so a sequence like
 * [₹500, ₹2000, ₹500] within window missed the two ₹500s.
 */
export async function detectDuplicatePayments(opts: Range & { windowMinutes?: number }) {
  const windowMs = (opts.windowMinutes ?? 10) * 60_000;
  const payments = await prisma.payment.findMany({
    where: {
      createdAt: { gte: opts.from, lte: opts.to },
      ...(opts.locationId != null ? { locationId: opts.locationId } : {}),
      userId: { not: null },
    },
    select: {
      id: true, userId: true, amount: true, createdAt: true,
      paymentMode: true, collectedById: true,
      user: { select: { firstname: true, lastname: true, phone: true } },
      collectedBy: { select: { firstname: true, lastname: true } },
    },
    orderBy: [{ userId: "asc" }, { amount: "asc" }, { createdAt: "asc" }],
    take: MAX_ROWS,
  });
  const truncated = payments.length >= MAX_ROWS;

  const dupes: Array<{
    user: string; phone: string; amount: number; mode: string;
    collector: string; paymentIds: number[]; gapSeconds: number;
  }> = [];

  for (let i = 1; i < payments.length; i++) {
    const a = payments[i - 1];
    const b = payments[i];
    if (a.userId !== b.userId) continue;
    if (asRupees(a.amount) !== asRupees(b.amount)) continue;
    const gapMs = Math.abs(b.createdAt.getTime() - a.createdAt.getTime());
    if (gapMs > windowMs) continue;
    dupes.push({
      user: `${a.user?.firstname ?? ""} ${a.user?.lastname ?? ""}`.trim(),
      phone: a.user?.phone ?? "",
      amount: asRupees(a.amount),
      mode: a.paymentMode,
      collector: `${a.collectedBy.firstname} ${a.collectedBy.lastname}`,
      paymentIds: [a.id, b.id],
      gapSeconds: Math.round(gapMs / 1000),
    });
  }

  return {
    rangeFrom: fmtDate(opts.from),
    rangeTo: fmtDate(opts.to),
    windowMinutes: opts.windowMinutes ?? 10,
    suspectCount: dupes.length,
    suspects: dupes.slice(0, 50),
    truncated,
  };
}

/* ─── 2. Off-shift cash collections ─────────────────────────────────────── */
/**
 * Cash payments not bound to an open CashShift — Robin can't reconcile
 * these against the drawer at end of day. UPI/card/online have a vendor
 * audit trail so we skip them.
 */
export async function detectOffShiftCashPayments(opts: Range) {
  const cashPayments = await prisma.payment.findMany({
    where: {
      createdAt: { gte: opts.from, lte: opts.to },
      ...(opts.locationId != null ? { locationId: opts.locationId } : {}),
      // Case-insensitive — payment_mode is free-text and gets entered as
      // "cash", "Cash", "CASH" depending on staff / source system.
      paymentMode: { equals: "cash", mode: "insensitive" },
      shiftId: null,
    },
    select: {
      id: true, amount: true, createdAt: true,
      user: { select: { firstname: true, lastname: true, phone: true } },
      collectedBy: { select: { id: true, firstname: true, lastname: true } },
    },
    orderBy: { createdAt: "asc" },
    take: MAX_ROWS,
  });
  const truncated = cashPayments.length >= MAX_ROWS;

  const byCollector = new Map<string, { name: string; count: number; total: number }>();
  for (const p of cashPayments) {
    const key = String(p.collectedBy.id);
    const name = `${p.collectedBy.firstname} ${p.collectedBy.lastname}`;
    const e = byCollector.get(key) ?? { name, count: 0, total: 0 };
    e.count++;
    e.total += asRupees(p.amount);
    byCollector.set(key, e);
  }

  return {
    rangeFrom: fmtDate(opts.from),
    rangeTo: fmtDate(opts.to),
    offShiftCount: cashPayments.length,
    offShiftTotal: cashPayments.reduce((s, p) => s + asRupees(p.amount), 0),
    byCollector: [...byCollector.values()].sort((a, b) => b.total - a.total),
    samples: cashPayments.slice(0, 20).map((p) => ({
      id: p.id,
      amount: asRupees(p.amount),
      at: p.createdAt.toISOString(),
      user: `${p.user?.firstname ?? ""} ${p.user?.lastname ?? ""}`.trim(),
      phone: p.user?.phone ?? "",
      collector: `${p.collectedBy.firstname} ${p.collectedBy.lastname}`,
    })),
    truncated,
  };
}

/* ─── 3. Discount outliers by staff ─────────────────────────────────────── */
/**
 * Median + max discount per collector. Flag any collector whose median
 * discount is > 1.5x the gym-wide median — usually "sweethearting" friends.
 * A collector with fewer than MIN_OUTLIER_PAYMENTS discounted payments is
 * never flagged as an outlier: their median is too noisy to be meaningful.
 */
export async function detectDiscountOutliers(opts: Range) {
  const payments = await prisma.payment.findMany({
    where: {
      createdAt: { gte: opts.from, lte: opts.to },
      ...(opts.locationId != null ? { locationId: opts.locationId } : {}),
      discount: { gt: 0 },
    },
    select: {
      amount: true, discount: true, collectedById: true,
      collectedBy: { select: { firstname: true, lastname: true } },
    },
    take: MAX_ROWS,
  });
  const truncated = payments.length >= MAX_ROWS;

  const byCollector = new Map<number, { name: string; discounts: number[]; totalDiscount: number; paymentCount: number }>();
  const allDiscounts: number[] = [];

  for (const p of payments) {
    const d = asRupees(p.discount);
    allDiscounts.push(d);
    const e = byCollector.get(p.collectedById) ?? {
      name: `${p.collectedBy.firstname} ${p.collectedBy.lastname}`,
      discounts: [], totalDiscount: 0, paymentCount: 0,
    };
    e.discounts.push(d);
    e.totalDiscount += d;
    e.paymentCount++;
    byCollector.set(p.collectedById, e);
  }

  function median(xs: number[]): number {
    if (xs.length === 0) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  const gymMedian = median(allDiscounts);
  const breakdown = [...byCollector.values()].map((e) => {
    const med = median(e.discounts);
    return {
      name: e.name,
      paymentCount: e.paymentCount,
      totalDiscount: Math.round(e.totalDiscount),
      medianDiscount: Math.round(med),
      // Guard: empty array would make Math.max return -Infinity. The filter
      // above (discount > 0) plus the `discounts.push` keep this non-empty
      // today, but a future relaxation of that filter shouldn't silently
      // poison the report.
      maxDiscount: e.discounts.length > 0 ? Math.round(Math.max(...e.discounts)) : 0,
      isOutlier:
        gymMedian > 0 &&
        med > gymMedian * 1.5 &&
        e.paymentCount >= MIN_OUTLIER_PAYMENTS,
    };
  }).sort((a, b) => b.totalDiscount - a.totalDiscount);

  return {
    rangeFrom: fmtDate(opts.from),
    rangeTo: fmtDate(opts.to),
    gymMedianDiscount: Math.round(gymMedian),
    gymTotalDiscount: Math.round(allDiscounts.reduce((s, x) => s + x, 0)),
    discountedPaymentCount: payments.length,
    minOutlierPaymentCount: MIN_OUTLIER_PAYMENTS,
    byCollector: breakdown,
    outliers: breakdown.filter((b) => b.isOutlier),
    truncated,
  };
}

/* ─── 4. Refund routing (same staff issued & approved) ──────────────────── */
/**
 * Refunds where the requester is the same person who originally collected
 * the payment — a classic "I'll just route this through myself" pattern.
 */
export async function detectRefundRouting(opts: Range) {
  const refunds = await prisma.refund.findMany({
    where: {
      createdAt: { gte: opts.from, lte: opts.to },
      // Push locationId filter into the query so we don't materialise
      // every refund just to throw most of them out in JS.
      ...(opts.locationId != null
        ? { payment: { is: { locationId: opts.locationId } } }
        : {}),
    },
    select: {
      id: true, amountRefunded: true, amountRequested: true, refundMode: true,
      reason: true, status: true, createdAt: true,
      requestedById: true,
      requestedBy: { select: { firstname: true, lastname: true } },
      payment: {
        select: {
          collectedById: true, locationId: true,
          collectedBy: { select: { firstname: true, lastname: true } },
          user: { select: { firstname: true, lastname: true, phone: true } },
        },
      },
    },
    take: MAX_ROWS,
  });
  const truncated = refunds.length >= MAX_ROWS;

  const sameStaff = refunds.filter((r) => r.requestedById === r.payment.collectedById);

  return {
    rangeFrom: fmtDate(opts.from),
    rangeTo: fmtDate(opts.to),
    totalRefunds: refunds.length,
    sameStaffCount: sameStaff.length,
    sameStaffCashCount: sameStaff.filter((r) => r.refundMode === "cash").length,
    sameStaffTotal: sameStaff.reduce((s, r) => s + asRupees(r.amountRefunded || r.amountRequested), 0),
    suspects: sameStaff.slice(0, 30).map((r) => ({
      refundId: r.id,
      amount: asRupees(r.amountRefunded || r.amountRequested),
      mode: r.refundMode,
      reason: r.reason,
      status: r.status,
      staff: `${r.requestedBy.firstname} ${r.requestedBy.lastname}`,
      member: `${r.payment.user?.firstname ?? ""} ${r.payment.user?.lastname ?? ""}`.trim(),
      phone: r.payment.user?.phone ?? "",
      at: r.createdAt.toISOString(),
    })),
    truncated,
  };
}

/* ─── 5. Comp abuse patterns ────────────────────────────────────────────── */
/**
 * Surfaces staff who issue lots of comps + members who receive comps
 * repeatedly. Built on AuditLog actions `comp.issue` and `comp_pass.issue`.
 *
 * Location-agnostic: AuditLog has no locationId column. The corresponding
 * tool intentionally omits a location parameter so the AI can't pass one
 * we'd silently ignore.
 */
export async function detectCompAbusePatterns(opts: AuditRange) {
  const logs = await prisma.auditLog.findMany({
    where: {
      action: { in: ["comp.issue", "comp_pass.issue"] },
      createdAt: { gte: opts.from, lte: opts.to },
    },
    select: { id: true, action: true, actorId: true, details: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS,
  });
  const truncated = logs.length >= MAX_ROWS;

  // details is JSON-stringified — extract userId/reason where present.
  // Count parse failures so a tampered or schema-drifted details column
  // doesn't silently exclude rows from the recipient histogram.
  type Parsed = { userId?: number; reason?: string };
  let parseFailures = 0;
  function parse(d: string | null): Parsed {
    if (!d) return {};
    try { return JSON.parse(d) as Parsed; } catch {
      parseFailures++;
      return {};
    }
  }

  const byIssuer = new Map<number, { count: number }>();
  const byRecipient = new Map<number, { count: number; reasons: Set<string> }>();

  for (const l of logs) {
    if (l.actorId != null) {
      const e = byIssuer.get(l.actorId) ?? { count: 0 };
      e.count++;
      byIssuer.set(l.actorId, e);
    }
    const p = parse(l.details);
    if (p.userId != null) {
      const e = byRecipient.get(p.userId) ?? { count: 0, reasons: new Set() };
      e.count++;
      if (p.reason) e.reasons.add(p.reason);
      byRecipient.set(p.userId, e);
    }
  }
  if (parseFailures > 0) {
    console.warn(`[anomaly] detectCompAbusePatterns: ${parseFailures} audit-log details rows failed to parse`);
  }

  const issuerIds = [...byIssuer.keys()];
  const recipientIds = [...byRecipient.keys()];

  const [workers, members] = await Promise.all([
    issuerIds.length
      ? prisma.worker.findMany({
          where: { id: { in: issuerIds } },
          select: { id: true, firstname: true, lastname: true },
        })
      : Promise.resolve([]),
    recipientIds.length
      ? prisma.user.findMany({
          where: { id: { in: recipientIds } },
          select: { id: true, firstname: true, lastname: true, phone: true },
        })
      : Promise.resolve([]),
  ]);

  const workerMap = new Map(workers.map((w) => [w.id, `${w.firstname} ${w.lastname}`]));
  const memberMap = new Map(members.map((m) => [m.id, { name: `${m.firstname} ${m.lastname}`, phone: m.phone ?? "" }]));

  const topIssuers = [...byIssuer.entries()]
    .map(([id, v]) => ({ staff: workerMap.get(id) ?? `worker#${id}`, compsIssued: v.count }))
    .sort((a, b) => b.compsIssued - a.compsIssued)
    .slice(0, 15);

  const repeatRecipients = [...byRecipient.entries()]
    .filter(([, v]) => v.count >= 2)
    .map(([id, v]) => ({
      member: memberMap.get(id)?.name ?? `user#${id}`,
      phone: memberMap.get(id)?.phone ?? "",
      compsReceived: v.count,
      reasons: [...v.reasons],
    }))
    .sort((a, b) => b.compsReceived - a.compsReceived)
    .slice(0, 25);

  return {
    rangeFrom: fmtDate(opts.from),
    rangeTo: fmtDate(opts.to),
    totalCompsIssued: logs.length,
    distinctIssuers: byIssuer.size,
    distinctRecipients: byRecipient.size,
    parseFailures,
    topIssuers,
    repeatRecipients,
    truncated,
  };
}

/* ─── 6. Balance / payment reconciliation mismatches ────────────────────── */
/**
 * Sum of payments per ticket vs the ticket's recorded amountPaid. Any
 * mismatch is either: a payment recorded against the wrong ticket, or
 * a ticket where a staff "adjusted" amountPaid manually.
 */
export async function detectBalanceMismatches(opts: {
  locationId?: number;
  limit?: number;
  /** When true, only flag tickets bought in the last `recentDays` (default 90).
   * Filters out the long tail of legacy import drift where the old v3 sync
   * attached every historical payment to the user's newest ticket. */
  recentOnly?: boolean;
  recentDays?: number;
  /** Ignore mismatches smaller than this absolute rupee value. Default 1. */
  minDriftRupees?: number;
}) {
  const recentDays = opts.recentDays ?? 90;
  const since = opts.recentOnly
    ? new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000)
    : null;
  const minDrift = opts.minDriftRupees ?? 1;

  const tickets = await prisma.memberTicket.findMany({
    where: {
      ...(opts.locationId != null ? { locationId: opts.locationId } : {}),
      status: { in: ["active", "cancelled"] },
      ...(since ? { buyDate: { gte: since } } : {}),
    },
    select: {
      id: true, amountPaid: true, balanceDue: true, totalAmount: true, buyDate: true,
      user: { select: { firstname: true, lastname: true, phone: true } },
      plan: { select: { name: true } },
    },
    take: MAX_ROWS,
  });
  const truncated = tickets.length >= MAX_ROWS;

  if (tickets.length === 0) {
    return {
      ticketsScanned: 0, mismatchCount: 0, totalAbsoluteDrift: 0,
      mismatches: [], recentOnly: !!opts.recentOnly, recentDays,
      minDriftRupees: minDrift, truncated,
    };
  }

  const ticketIds = tickets.map((t) => t.id);
  const grouped = await prisma.payment.groupBy({
    by: ["memberTicketId"],
    where: { memberTicketId: { in: ticketIds } },
    _sum: { amount: true },
  });
  const sumMap = new Map<number, number>();
  for (const g of grouped) {
    if (g.memberTicketId != null) sumMap.set(g.memberTicketId, asRupees(g._sum.amount));
  }

  const mismatches: Array<{
    ticketId: number; member: string; phone: string; plan: string;
    recordedPaid: number; actualSum: number; diff: number; recordedBalance: number;
  }> = [];

  for (const t of tickets) {
    const actual = sumMap.get(t.id) ?? 0;
    const recorded = asRupees(t.amountPaid);
    const diff = Math.round((recorded - actual) * 100) / 100;
    if (Math.abs(diff) >= minDrift) {
      mismatches.push({
        ticketId: t.id,
        member: `${t.user.firstname} ${t.user.lastname}`.trim(),
        phone: t.user.phone ?? "",
        plan: t.plan.name,
        recordedPaid: recorded,
        actualSum: Math.round(actual),
        diff,
        recordedBalance: asRupees(t.balanceDue),
      });
    }
  }

  mismatches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const limit = opts.limit ?? 50;

  return {
    ticketsScanned: tickets.length,
    mismatchCount: mismatches.length,
    totalAbsoluteDrift: Math.round(mismatches.reduce((s, m) => s + Math.abs(m.diff), 0)),
    mismatches: mismatches.slice(0, limit),
    recentOnly: !!opts.recentOnly,
    recentDays,
    minDriftRupees: minDrift,
    truncated,
  };
}

/* ─── 7. High-actor audit anomalies ─────────────────────────────────────── */
/**
 * Per-staff rates for sensitive actions (password_reset, member_transfer,
 * refund.request, comp issuance). Robin asks "is anyone unusually busy in
 * the sensitive areas?".
 *
 * Location-agnostic: AuditLog has no locationId column. The corresponding
 * tool intentionally omits a location parameter.
 */
export async function detectAuditAnomalies(opts: AuditRange) {
  const SENSITIVE = [
    "password_reset",
    "member_transfer",
    "member_transfer.transfer_out",
    "refund.request",
    "refund.process",
    "refund.approve",
    "comp.issue",
    "comp_pass.issue",
    "cash_shift.variance_approve",
  ];

  const logs = await prisma.auditLog.findMany({
    where: {
      action: { in: SENSITIVE },
      createdAt: { gte: opts.from, lte: opts.to },
    },
    select: { action: true, actorId: true },
    take: MAX_ROWS,
  });
  const truncated = logs.length >= MAX_ROWS;

  const byActor = new Map<number, Map<string, number>>();
  const byAction = new Map<string, number>();
  for (const l of logs) {
    if (l.actorId == null) continue;
    byAction.set(l.action, (byAction.get(l.action) ?? 0) + 1);
    const m = byActor.get(l.actorId) ?? new Map();
    m.set(l.action, (m.get(l.action) ?? 0) + 1);
    byActor.set(l.actorId, m);
  }

  const actorIds = [...byActor.keys()];
  const workers = actorIds.length
    ? await prisma.worker.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, firstname: true, lastname: true, role: true },
      })
    : [];
  const wm = new Map(workers.map((w) => [w.id, w]));

  const rows = [...byActor.entries()].map(([id, m]) => {
    const w = wm.get(id);
    const counts = Object.fromEntries([...m.entries()]);
    const total = [...m.values()].reduce((s, x) => s + x, 0);
    return {
      staff: w ? `${w.firstname} ${w.lastname}` : `worker#${id}`,
      role: w?.role ?? "?",
      totalSensitive: total,
      counts,
    };
  }).sort((a, b) => b.totalSensitive - a.totalSensitive);

  return {
    rangeFrom: fmtDate(opts.from),
    rangeTo: fmtDate(opts.to),
    totalSensitiveActions: logs.length,
    actionsByType: Object.fromEntries(byAction.entries()),
    byActor: rows.slice(0, 25),
    truncated,
  };
}

/* ─── 8. Owner anomaly summary (one-shot, "anything I should know?") ────── */
export async function getOwnerAnomalySummary(opts: Range) {
  const [dupes, offShift, discounts, refunds, comps, audit, mismatches] = await Promise.all([
    detectDuplicatePayments(opts),
    detectOffShiftCashPayments(opts),
    detectDiscountOutliers(opts),
    detectRefundRouting(opts),
    // Comp/audit detectors are location-agnostic (AuditLog has no
    // locationId). Pass only the date range — locationId is ignored.
    detectCompAbusePatterns({ from: opts.from, to: opts.to }),
    detectAuditAnomalies({ from: opts.from, to: opts.to }),
    detectBalanceMismatches({
      locationId: opts.locationId,
      limit: 10,
      recentOnly: true,
      recentDays: 90,
      minDriftRupees: 100,
    }),
  ]);

  return {
    rangeFrom: fmtDate(opts.from),
    rangeTo: fmtDate(opts.to),
    duplicatePayments: { count: dupes.suspectCount, top: dupes.suspects.slice(0, 5) },
    offShiftCash: { count: offShift.offShiftCount, total: offShift.offShiftTotal, byCollector: offShift.byCollector },
    discountOutliers: { gymMedian: discounts.gymMedianDiscount, outliers: discounts.outliers },
    refundRouting: { sameStaff: refunds.sameStaffCount, sameStaffCash: refunds.sameStaffCashCount },
    compAbuse: {
      totalIssued: comps.totalCompsIssued,
      topIssuers: comps.topIssuers.slice(0, 5),
      repeatRecipients: comps.repeatRecipients.slice(0, 5),
    },
    sensitiveAudit: { total: audit.totalSensitiveActions, top: audit.byActor.slice(0, 5) },
    balanceReconcile: {
      ticketsScanned: mismatches.ticketsScanned,
      mismatchCount: mismatches.mismatchCount,
      totalAbsoluteDrift: mismatches.totalAbsoluteDrift,
      worst: mismatches.mismatches,
    },
  };
}
