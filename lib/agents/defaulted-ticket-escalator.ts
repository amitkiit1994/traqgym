/**
 * Defaulted Ticket Escalator agent.
 *
 * Walks every MemberTicket with `balanceDue > 0` whose `createdAt` is older
 * than the configured grace window (default 14 days) and emits a tiered
 * escalation insight per ticket:
 *
 *   stage 1 (14–21d): friendly member reminder. severity = medium
 *   stage 2 (21–30d): member reminder + admin alert. severity = high
 *   stage 3 (>30d):   write-off candidate. severity = critical
 *
 * Stage is encoded into dataJson AND the dedupeKey so escalating from
 * stage 1 → 2 produces a *new* insight (not just an update of the old one).
 */

import { prisma } from "@/lib/prisma";
import { upsertInsight, type InsightSeverity } from "./_shared";
import { getSetting } from "@/lib/services/settings";
import { inr, todayISO } from "./_helpers";

const AGENT = "defaulted_ticket_escalator";

type Stage = 1 | 2 | 3;

function stageFor(daysOverdue: number, grace: number): Stage | null {
  if (daysOverdue < grace) return null;
  if (daysOverdue < grace + 7) return 1;
  if (daysOverdue < grace + 16) return 2;
  return 3;
}

function severityFor(stage: Stage): InsightSeverity {
  switch (stage) {
    case 1:
      return "medium";
    case 2:
      return "high";
    case 3:
      return "critical";
  }
}

export async function run(): Promise<{ created: number; total: number }> {
  const graceStr = await getSetting("default_grace_days", "14");
  const grace = Number.parseInt(graceStr, 10) || 14;
  const now = new Date();
  const graceCutoff = new Date(now.getTime() - grace * 86400000);

  const tickets = await prisma.memberTicket.findMany({
    where: {
      balanceDue: { gt: 0 },
      createdAt: { lt: graceCutoff },
      status: "active",
    },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      balanceDue: true,
      totalAmount: true,
      amountPaid: true,
      user: { select: { firstname: true, lastname: true, phone: true } },
      plan: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const dateKey = todayISO();
  let created = 0;
  let total = 0;

  for (const t of tickets) {
    const daysOverdue = Math.floor(
      (now.getTime() - t.createdAt.getTime()) / 86400000
    );
    const stage = stageFor(daysOverdue, grace);
    if (stage === null) continue;

    const severity = severityFor(stage);
    const balance = Number(t.balanceDue);
    const userName = `${t.user.firstname} ${t.user.lastname}`.trim();

    const stageLabel =
      stage === 1
        ? "1st reminder"
        : stage === 2
          ? "2nd reminder + admin alert"
          : "Write-off candidate";

    const actions: Array<{
      label: string;
      action: string;
      args: Record<string, unknown>;
    }> = [
      {
        label: "Send recovery message",
        action: "member.send_recovery_message",
        args: { userId: t.userId, ticketId: t.id, stage },
      },
      {
        label: "Open member",
        action: "navigate",
        args: { href: `/admin/members/${t.userId}` },
      },
    ];

    if (stage === 3) {
      actions.unshift({
        label: "Flag for write-off",
        action: "ticket.flag_writeoff",
        args: { ticketId: t.id, reason: `${daysOverdue}d overdue` },
      });
    }

    total++;
    const result = await upsertInsight({
      agent: AGENT,
      severity,
      title: `${userName} — ${inr(balance)} overdue ${daysOverdue}d (${stageLabel})`,
      body:
        `Ticket #${t.id} (${t.plan?.name ?? "plan"}) has a balance of ${inr(balance)} ` +
        `unpaid for ${daysOverdue} day(s). Total owed: ${inr(Number(t.totalAmount ?? 0))}, ` +
        `paid so far: ${inr(Number(t.amountPaid))}. Stage ${stage} — ${stageLabel.toLowerCase()}.`,
      dataJson: {
        ticketId: t.id,
        userId: t.userId,
        userName,
        userPhone: t.user.phone,
        balanceDue: balance,
        daysOverdue,
        stage,
        graceDays: grace,
        estimatedImpactRupees: balance,
      },
      suggestedActions: actions,
      entityType: "ticket",
      entityId: t.id,
      dedupeKey: `${AGENT}:ticket_${t.id}:stage_${stage}:${dateKey}`,
    });
    if (result.created) created++;
  }

  return { created, total };
}
