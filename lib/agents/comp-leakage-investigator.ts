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
import { upsertInsight } from "./_shared";
import { inr, todayISO } from "./_helpers";

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

  const dateKey = todayISO();
  let created = 0;
  let total = 0;

  for (const c of comps) {
    // 5 data points per comp:
    //  1. last attendance check-in
    //  2. days since comp issued
    //  3. prior paid tickets for this user
    //  4. lifetime payment total for this user
    //  5. issuer + approver context
    const [lastAttendance, priorPaidTickets, lifetimePayments] =
      await Promise.all([
        prisma.attendanceLog.findFirst({
          where: { userId: c.userId },
          orderBy: { checkIn: "desc" },
          select: { checkIn: true },
        }),
        prisma.memberTicket.count({
          where: {
            userId: c.userId,
            isComplimentary: false,
          },
        }),
        prisma.payment.aggregate({
          where: { userId: c.userId },
          _sum: { amount: true },
        }),
      ]);

    const daysSinceIssue = Math.floor(
      (now.getTime() - c.buyDate.getTime()) / 86400000
    );
    const daysSinceLastVisit = lastAttendance
      ? Math.floor((now.getTime() - lastAttendance.checkIn.getTime()) / 86400000)
      : null;
    const planValue = Number(c.totalAmount ?? c.plan?.price ?? 0);
    const lifetimePaid = Number(lifetimePayments._sum.amount ?? 0);
    const userName = `${c.user.firstname} ${c.user.lastname}`.trim();
    const issuerName = c.compIssuer
      ? `${c.compIssuer.firstname} ${c.compIssuer.lastname}`.trim()
      : "unknown";
    const approverName = c.compApprover
      ? `${c.compApprover.firstname} ${c.compApprover.lastname}`.trim()
      : "unapproved";

    total++;
    const result = await upsertInsight({
      agent: AGENT,
      severity: "high",
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
        lastAttendanceAt: lastAttendance?.checkIn ?? null,
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
