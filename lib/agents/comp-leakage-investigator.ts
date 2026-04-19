/**
 * Comp Leakage Investigator agent.
 *
 * Triggers when a critical `comp_auditor` insight already exists. Pulls
 * five contextual data points per active comp ticket (last attendance,
 * days since issue, prior tickets, payment history, comp issuer/approver)
 * and writes a richer "investigated" insight that the manager + admin
 * can act on directly.
 *
 * Severity: high (signals "this is the one to look at first").
 */

import { prisma } from "@/lib/prisma";
import { upsertInsight, type InsightSeverity } from "./_shared";
import { inr, isoDay } from "./_helpers";

const AGENT = "comp_leakage_investigator";
const TRIGGER_AGENT = "comp_auditor";

const MAX_INVESTIGATED = 10;

export async function run(): Promise<{ created: number; total: number }> {
  // Only investigate when a critical comp insight is currently active.
  const now = new Date();
  const trigger = await prisma.insight.findFirst({
    where: {
      agent: TRIGGER_AGENT,
      severity: "critical",
      dismissedAt: null,
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: now } }],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, dataJson: true },
  });
  if (!trigger) return { created: 0, total: 0 };

  // Pull active comp tickets to investigate.
  const comps = await prisma.memberTicket.findMany({
    where: {
      isComplimentary: true,
      status: "active",
      compConvertedToPaidAt: null,
    },
    take: MAX_INVESTIGATED,
    orderBy: { buyDate: "asc" }, // oldest first — biggest leak risk
    select: {
      id: true,
      userId: true,
      buyDate: true,
      expireDate: true,
      compReason: true,
      totalAmount: true,
      user: {
        select: {
          firstname: true,
          lastname: true,
          phone: true,
        },
      },
      plan: { select: { name: true, price: true } },
      compIssuer: { select: { firstname: true, lastname: true } },
      compApprover: { select: { firstname: true, lastname: true } },
    },
  });

  if (comps.length === 0) return { created: 0, total: 0 };

  // Batch fetch the 3 per-user data points in 3 grouped queries instead of
  // 3×N round-trips. Up to ~10 comps but agents must scale to 100s.
  const userIds = Array.from(new Set(comps.map((c) => c.userId)));
  const [attRows, paidTicketRows, paymentRows] = await Promise.all([
    prisma.attendanceLog.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds } },
      _max: { checkIn: true },
    }),
    prisma.memberTicket.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds }, isComplimentary: false },
      _count: { _all: true },
    }),
    prisma.payment.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds } },
      _sum: { amount: true },
    }),
  ]);
  const lastAttendanceByUser = new Map<number, Date | null>();
  for (const r of attRows) {
    if (r.userId != null) lastAttendanceByUser.set(r.userId, r._max.checkIn);
  }
  const priorPaidByUser = new Map<number, number>();
  for (const r of paidTicketRows) {
    if (r.userId != null) priorPaidByUser.set(r.userId, r._count._all);
  }
  const lifetimePaidByUser = new Map<number, number>();
  for (const r of paymentRows) {
    if (r.userId != null) lifetimePaidByUser.set(r.userId, Number(r._sum.amount ?? 0));
  }

  const dateKey = isoDay();
  let created = 0;
  let total = 0;

  for (const c of comps) {
    const lastAttendanceCheckIn = lastAttendanceByUser.get(c.userId) ?? null;
    const priorPaidTickets = priorPaidByUser.get(c.userId) ?? 0;
    const lifetimePaid = lifetimePaidByUser.get(c.userId) ?? 0;

    const daysSinceIssue = Math.floor(
      (now.getTime() - c.buyDate.getTime()) / 86400000
    );
    const daysSinceLastVisit = lastAttendanceCheckIn
      ? Math.floor((now.getTime() - lastAttendanceCheckIn.getTime()) / 86400000)
      : null;
    const planValue = Number(c.totalAmount ?? c.plan?.price ?? 0);
    const userName = `${c.user.firstname} ${c.user.lastname}`.trim();
    const issuerName = c.compIssuer
      ? `${c.compIssuer.firstname} ${c.compIssuer.lastname}`.trim()
      : "unknown";
    const approverName = c.compApprover
      ? `${c.compApprover.firstname} ${c.compApprover.lastname}`.trim()
      : "unapproved";

    // Threshold severity by leak magnitude — avoid alert fatigue from sub-rupee comps.
    const severity: InsightSeverity =
      planValue >= 25_000 ? "critical" : planValue >= 5_000 ? "high" : "medium";

    total++;
    const result = await upsertInsight({
      agent: AGENT,
      severity,
      title: `Investigate comp: ${userName} — ${inr(planValue)} leak, ${daysSinceIssue}d active`,
      body:
        `${userName} is on a comp ${c.plan?.name ?? "plan"} (${inr(planValue)}). ` +
        `Issued by ${issuerName}, approved by ${approverName}. ` +
        `${daysSinceLastVisit === null ? "Never visited." : `Last visit ${daysSinceLastVisit}d ago.`} ` +
        `${priorPaidTickets} prior paid ticket(s), lifetime ${inr(lifetimePaid)} paid. ` +
        `Reason: ${c.compReason ?? "n/a"}.`,
      dataJson: {
        ticketId: c.id,
        userId: c.userId,
        userName,
        userPhone: c.user.phone,
        planValue,
        compReason: c.compReason,
        daysSinceIssue,
        daysSinceLastVisit,
        lastAttendanceAt: lastAttendanceCheckIn,
        priorPaidTickets,
        lifetimePaidRupees: lifetimePaid,
        issuerName,
        approverName,
        triggerInsightId: trigger.id,
        estimatedImpactRupees: planValue,
        requiresInvestigation: false, // already investigated
      },
      suggestedActions: [
        {
          label: "Convert to paid",
          action: "comp.investigate",
          args: { ticketId: c.id, kind: "convert" },
        },
        {
          label: "Revoke",
          action: "comp.revoke",
          args: { ticketId: c.id, reason: "leakage_investigation" },
        },
        {
          label: "Open member",
          action: "navigate",
          args: { href: `/admin/members/${c.userId}` },
        },
      ],
      entityType: "ticket",
      entityId: c.id,
      dedupeKey: `${AGENT}:ticket_${c.id}:${dateKey}`,
    });
    if (result.created) created++;
  }

  return { created, total };
}
