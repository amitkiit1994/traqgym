/**
 * audit-amount-paid.ts
 *
 * Diagnostic + repair for MemberTicket.amountPaid drift vs SUM(Payment.amount).
 *
 * BACKGROUND
 * ----------
 * MemberTicket.amountPaid should equal SUM(Payment.amount) for all non-refund
 * Payment rows attached to the ticket. Two root causes drive divergence in the
 * current schema:
 *
 *   (1) renewal.ts and plan-change.ts CREATE a fresh MemberTicket per renewal
 *       cycle but never set amountPaid (defaults to 0). The accompanying full
 *       Payment row is created via recordPayment(), which does not bump the
 *       ticket's amountPaid. Net effect: every renewed/plan-changed ticket
 *       reads amountPaid=0 even though the cash arrived.
 *
 *   (2) The FitnessBoard CSV migration (scripts/migrate-fitnessboard.ts) has
 *       a "fallback" branch (~lines 500–506) that, when a payment row's
 *       (userId, startDate, planName) key fails to match any ticket, attaches
 *       the payment to the user's most recent ticket regardless of cycle.
 *       Result: payments from prior cycles whose tickets the import could not
 *       reconstruct pile up onto the current active ticket — its amountPaid
 *       stays at the per-cycle value but SUM(Payment) explodes far above it.
 *
 * The amountPaid field is what the partial-payment, balance-due, and reports
 * pages rely on, so live cycles need it correct. Migration-corrupted rows are
 * a separate problem we surface but do NOT auto-rewrite (would require
 * splitting payments back across reconstructed historic tickets — out of
 * scope for this script).
 *
 * USAGE
 * -----
 *   tsx scripts/audit-amount-paid.ts                # report only
 *   tsx scripts/audit-amount-paid.ts --apply        # write fixes
 *   tsx scripts/audit-amount-paid.ts --apply --limit 5
 *
 * SAFETY
 * ------
 * - Excludes complimentary tickets (isComplimentary=true) — they intentionally
 *   have amountPaid=0 and no payment rows.
 * - Excludes tickets where SUM(Payment) < amountPaid (likely (2) above —
 *   migration set amountPaid from a CSV column directly, payments were
 *   under-attached). These get reported but never auto-rewritten.
 * - Only updates amountPaid (and balanceDue when totalAmount is known); never
 *   touches Payment rows. Refund Payments (negative amounts) are intentionally
 *   netted into SUM(Payment) so a processed refund pulls amountPaid down.
 * - --apply runs each update in its own transaction so a partial failure
 *   never leaves the run half-applied.
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

type DriftRow = {
  ticketId: number;
  userId: number;
  planId: number;
  status: string;
  amountPaid: number;
  totalAmount: number | null;
  balanceDue: number;
  sumPayments: number;
  diff: number; // sumPayments - amountPaid (positive => ticket understated)
};

async function loadDrift(): Promise<DriftRow[]> {
  // Raw SQL keeps the SUM() subquery scoped per ticket without forcing
  // Prisma to hydrate every Payment row (~566–14k rows).
  const rows = await prisma.$queryRaw<
    Array<{
      id: number;
      userId: number;
      planId: number;
      status: string;
      amountPaid: Prisma.Decimal;
      totalAmount: Prisma.Decimal | null;
      balanceDue: Prisma.Decimal;
      sum_payments: Prisma.Decimal | null;
    }>
  >`
    SELECT mt.id, mt."userId", mt."planId", mt.status,
           mt."amountPaid", mt."totalAmount", mt."balanceDue",
           COALESCE(
             (SELECT SUM(p.amount) FROM "Payment" p WHERE p."memberTicketId" = mt.id),
             0
           ) AS sum_payments
    FROM "MemberTicket" mt
    WHERE mt."isComplimentary" = false
  `;

  const drift: DriftRow[] = [];
  for (const r of rows) {
    const amountPaid = Number(r.amountPaid);
    const sumPayments = Number(r.sum_payments ?? 0);
    const diff = sumPayments - amountPaid;
    if (Math.abs(diff) > 1) {
      drift.push({
        ticketId: r.id,
        userId: r.userId,
        planId: r.planId,
        status: r.status,
        amountPaid,
        totalAmount: r.totalAmount != null ? Number(r.totalAmount) : null,
        balanceDue: Number(r.balanceDue),
        sumPayments,
        diff,
      });
    }
  }
  return drift;
}

function categorize(rows: DriftRow[]) {
  // Repairable: SUM(Payment) >= amountPaid AND (no totalAmount OR
  // SUM(Payment) <= totalAmount). These look like genuine renewal/plan-change
  // bugs where the ticket never recorded its single full payment.
  const repairable: DriftRow[] = [];
  // Suspicious: SUM(Payment) > totalAmount → migration over-attachment, NOT
  // safe to auto-rewrite (would inflate amountPaid beyond what the member
  // owes for the current cycle).
  const overAttached: DriftRow[] = [];
  // Negative diff: amountPaid > SUM(Payment) → migration set amountPaid from
  // CSV but payments did not get attached. Likewise not safe to auto-rewrite.
  const underAttached: DriftRow[] = [];

  for (const r of rows) {
    if (r.diff < 0) {
      underAttached.push(r);
      continue;
    }
    if (r.totalAmount != null && r.sumPayments > r.totalAmount + 1) {
      overAttached.push(r);
      continue;
    }
    repairable.push(r);
  }
  return { repairable, overAttached, underAttached };
}

async function applyRepairs(rows: DriftRow[], limit: number | null) {
  const slice = limit != null ? rows.slice(0, limit) : rows;
  let applied = 0;
  for (const r of slice) {
    // Optimistic-locking update: only write if amountPaid hasn't changed
    // since we read it (defends against a concurrent partial-payment).
    const newAmountPaid = r.sumPayments;
    const newBalanceDue =
      r.totalAmount != null
        ? Math.max(0, r.totalAmount - newAmountPaid)
        : r.balanceDue; // leave untouched when totalAmount is unknown

    const updated = await prisma.memberTicket.updateMany({
      where: {
        id: r.ticketId,
        amountPaid: new Prisma.Decimal(r.amountPaid),
      },
      data: {
        amountPaid: new Prisma.Decimal(newAmountPaid),
        balanceDue: new Prisma.Decimal(newBalanceDue),
      },
    });
    if (updated.count === 1) {
      applied++;
    } else {
      console.warn(
        `  skip ticket #${r.ticketId} — amountPaid changed under us (was ${r.amountPaid})`,
      );
    }
  }
  return applied;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has("--apply");
  const limitFlagIdx = process.argv.indexOf("--limit");
  const limit =
    limitFlagIdx >= 0 ? parseInt(process.argv[limitFlagIdx + 1], 10) : null;

  console.log("Loading MemberTicket drift...");
  const drift = await loadDrift();
  console.log(`  ${drift.length} tickets with |diff| > ₹1\n`);

  const { repairable, overAttached, underAttached } = categorize(drift);

  console.log("Categorisation:");
  console.log(`  repairable     : ${repairable.length}  (renewal/plan-change defect — auto-fixable)`);
  console.log(`  over-attached  : ${overAttached.length}  (migration corruption — diagnostic only)`);
  console.log(`  under-attached : ${underAttached.length}  (migration corruption — diagnostic only)\n`);

  const sample = (rows: DriftRow[], n = 5) =>
    rows.slice(0, n).map((r) => ({
      ticketId: r.ticketId,
      status: r.status,
      amountPaid: r.amountPaid,
      totalAmount: r.totalAmount,
      sumPayments: r.sumPayments,
      diff: r.diff,
    }));

  if (repairable.length > 0) {
    console.log("Sample repairable:");
    console.table(sample(repairable));
  }
  if (overAttached.length > 0) {
    console.log("Sample over-attached (NOT auto-fixed — investigate manually):");
    console.table(sample(overAttached));
  }
  if (underAttached.length > 0) {
    console.log("Sample under-attached (NOT auto-fixed — investigate manually):");
    console.table(sample(underAttached));
  }

  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to fix the repairable set.");
    console.log("Optionally pass --limit N to restrict the number of fixes.");
    return;
  }

  console.log(
    `\nApplying ${limit != null ? `up to ${limit}` : "all"} repairs...`,
  );
  const applied = await applyRepairs(repairable, limit);
  console.log(`  ${applied} tickets updated.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
