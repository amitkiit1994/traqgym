/**
 * Renewal Cliff agent.
 *
 * Daily snapshot of MemberTickets expiring in the next 7 days. The aggregate
 * ₹ exposure (sum of ticket totalAmount or plan price) becomes
 * `estimatedImpactRupees`, used by the future Manager ranker.
 *
 * Severity: high if exposure > ₹50k, medium otherwise.
 */

import { prisma } from "@/lib/prisma";
import { upsertInsight, type InsightSeverity } from "./_shared";
import { inr, isoDay } from "./_helpers";

const AGENT = "renewal_cliff";

const HORIZON_DAYS = 7;
const HIGH_EXPOSURE_RUPEES = 50_000;

export async function run(): Promise<{ created: number; total: number }> {
  const now = new Date();
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86400000);

  const tickets = await prisma.memberTicket.findMany({
    where: {
      status: "active",
      expireDate: { gte: now, lte: horizon },
    },
    select: {
      id: true,
      userId: true,
      expireDate: true,
      totalAmount: true,
      user: { select: { firstname: true, lastname: true, phone: true } },
      plan: { select: { name: true, price: true } },
    },
    orderBy: { expireDate: "asc" },
  });

  if (tickets.length === 0) {
    return { created: 0, total: 0 };
  }

  // Use ticket.totalAmount if known, else fall back to plan price.
  let exposure = 0;
  const enriched = tickets.map((t) => {
    const value = Number(t.totalAmount ?? t.plan?.price ?? 0);
    exposure += value;
    return {
      ticketId: t.id,
      userId: t.userId,
      userName: `${t.user.firstname} ${t.user.lastname}`.trim(),
      userPhone: t.user.phone,
      planName: t.plan?.name ?? "Unknown",
      expireDate: isoDay(t.expireDate),
      value,
    };
  });

  const top10 = [...enriched]
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const severity: InsightSeverity =
    exposure > HIGH_EXPOSURE_RUPEES ? "high" : "medium";
  const dateKey = isoDay();

  const result = await upsertInsight({
    agent: AGENT,
    severity,
    title: `${tickets.length} membership(s) expiring in 7 days — ${inr(exposure)} at risk`,
    body:
      `${tickets.length} active ticket(s) expire on or before ` +
      `${isoDay(horizon)}. Total exposure: ${inr(exposure)}. ` +
      `Top renewal: ${top10[0]?.userName ?? "n/a"} (${inr(top10[0]?.value ?? 0)}).`,
    dataJson: {
      ticketsExpiring: tickets.length,
      horizonDays: HORIZON_DAYS,
      estimatedImpactRupees: exposure,
      top10,
    },
    suggestedActions: [
      {
        label: "Open renewals",
        action: "navigate",
        args: { href: "/admin/renewals" },
      },
    ],
    entityType: "global",
    dedupeKey: `${AGENT}:${dateKey}`,
  });

  return { created: result.created ? 1 : 0, total: 1 };
}
