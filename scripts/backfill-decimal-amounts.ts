/**
 * Backfill MemberTicket.amountPaid and balanceDue from Payment table.
 * Idempotent. Run dry-run first, --apply to commit.
 *
 *   npx tsx scripts/backfill-decimal-amounts.ts          # dry-run
 *   npx tsx scripts/backfill-decimal-amounts.ts --apply  # actually writes
 */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  const tickets = await prisma.memberTicket.findMany({
    select: { id: true, totalAmount: true, amountPaid: true, balanceDue: true },
  });
  console.log(`Loaded ${tickets.length} tickets`);

  let changed = 0;
  let driftTotal = new Prisma.Decimal(0);

  for (const t of tickets) {
    const paidAgg = await prisma.payment.aggregate({
      where: { memberTicketId: t.id },
      _sum: { amount: true },
    });
    const newPaid = new Prisma.Decimal(paidAgg._sum?.amount ?? 0);
    const totalAmount = new Prisma.Decimal((t.totalAmount as unknown as number | Prisma.Decimal) ?? 0);
    const newDue = Prisma.Decimal.max(totalAmount.minus(newPaid), 0);
    const curPaid = new Prisma.Decimal(t.amountPaid as unknown as number | Prisma.Decimal);
    const curDue = new Prisma.Decimal(t.balanceDue as unknown as number | Prisma.Decimal);

    if (!curPaid.eq(newPaid) || !curDue.eq(newDue)) {
      changed++;
      driftTotal = driftTotal.plus(curPaid.minus(newPaid).abs()).plus(curDue.minus(newDue).abs());
      if (APPLY) {
        await prisma.memberTicket.update({
          where: { id: t.id },
          data: { amountPaid: newPaid, balanceDue: newDue },
        });
      }
    }
  }
  console.log(`Changed: ${changed}/${tickets.length}`);
  console.log(`Total absolute drift: ${driftTotal.toFixed(2)}`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
