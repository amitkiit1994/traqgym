/**
 * Cash Shift Variance Investigator agent.
 *
 * Scans shifts closed in the last 24h with non-zero variance, cross-references
 * refund + comp activity within the shift window, and emits one Insight per
 * shift via the shared upsertInsight helper. Dedup key encodes the shift id.
 */
import { prisma } from "@/lib/prisma";
import { upsertInsight, type InsightSeverity } from "./_shared";

const AGENT = "cash_shift_variance_investigator";

function inr(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}₹${Math.round(Math.abs(n)).toLocaleString("en-IN")}`;
}

export async function runCashShiftVarianceInvestigator(): Promise<{
  insightsCreated: number;
  shiftsScanned: number;
}> {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const shifts = await prisma.cashShift.findMany({
    where: {
      status: { in: ["closed", "pending_approval"] },
      closedAt: { gte: dayAgo },
      NOT: { variance: 0 },
      variance: { not: null },
    },
    include: {
      location: { select: { name: true } },
      openedBy: { select: { firstname: true, lastname: true } },
      closedBy: { select: { firstname: true, lastname: true } },
    },
    orderBy: { closedAt: "desc" },
  });

  let insightsCreated = 0;

  for (const s of shifts) {
    if (s.variance == null) continue;
    const variance = Number(s.variance);
    const absV = Math.abs(variance);

    const closedAt = s.closedAt ?? now;

    const [refundCount, compCount, cashPaymentCount] = await Promise.all([
      prisma.refund.count({
        where: {
          createdAt: { gte: s.openedAt, lte: closedAt },
          payment: { locationId: s.locationId },
        },
      }),
      prisma.memberTicket.count({
        where: {
          isComplimentary: true,
          createdAt: { gte: s.openedAt, lte: closedAt },
          locationId: s.locationId,
        },
      }),
      prisma.payment.count({
        where: {
          shiftId: s.id,
          paymentMode: "cash",
        },
      }),
    ]);

    let severity: InsightSeverity = "low";
    if (absV >= 1000) severity = "critical";
    else if (absV >= 500) severity = "high";
    else if (absV >= 100) severity = "medium";

    const direction = variance > 0 ? "over" : "short";
    const title = `Shift #${s.id} (${s.location?.name ?? "Loc " + s.locationId}) ${direction} by ${inr(absV)}`;
    const body = [
      `Closed by ${s.closedBy ? `${s.closedBy.firstname} ${s.closedBy.lastname}` : "—"} on ${closedAt.toISOString().slice(0, 10)}.`,
      `Opening float ${inr(Number(s.openingFloat))}; expected ${inr(Number(s.closingExpected ?? 0))}; counted ${inr(Number(s.closingCounted ?? 0))}.`,
      `Window had ${cashPaymentCount} cash payment(s), ${refundCount} refund(s), ${compCount} comp(s).`,
      s.varianceReason ? `Reason given: "${s.varianceReason}".` : `No variance reason recorded.`,
    ].join(" ");

    const result = await upsertInsight({
      agent: AGENT,
      severity,
      title,
      body,
      dataJson: {
        shiftId: s.id,
        locationId: s.locationId,
        variance,
        openingFloat: Number(s.openingFloat),
        closingExpected: Number(s.closingExpected ?? 0),
        closingCounted: Number(s.closingCounted ?? 0),
        refundCount,
        compCount,
        cashPaymentCount,
        status: s.status,
      },
      suggestedActions: [
        {
          label: "Review shift",
          action: "navigate",
          args: { href: `/admin/shifts?id=${s.id}` },
        },
      ],
      entityType: "CashShift",
      entityId: s.id,
      // Key on shift id only — re-runs within the 24h scan window must
      // refresh (not duplicate) the same insight. Adding a date suffix here
      // proliferates rows (one per IST day the agent runs) for the same
      // shift; rely on upsertInsight's update-on-existing semantics instead.
      dedupeKey: `cash_shift_variance:shift_${s.id}`,
    });
    if (result.created) insightsCreated++;
  }

  return { insightsCreated, shiftsScanned: shifts.length };
}
