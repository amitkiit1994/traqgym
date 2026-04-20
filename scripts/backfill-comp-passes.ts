/**
 * Backfill complimentary flags on legacy MemberTicket rows.
 *
 * Idempotent — safe to re-run. Sets `isComplimentary=true` + comp metadata on
 * tickets that look like comps (zero-amount paid-in-full tickets, or tickets
 * tied to plans whose name matches `%complimentary%`).
 *
 * Usage:
 *   npx tsx scripts/backfill-comp-passes.ts
 *
 * Excludes unpaid balance-due rows (totalAmount > 0 && amountPaid === 0 && balanceDue > 0).
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Counters = {
  scanned: number;
  flagged: number;
  skipped: number;
};

async function main() {
  const counters: Counters = { scanned: 0, flagged: 0, skipped: 0 };

  // 1. Pull candidate tickets in batches.
  //    Candidate = (totalAmount=0 AND amountPaid=0 AND balanceDue=0) OR plan.name ILIKE '%complimentary%'.
  //    Postgres ILIKE is exposed via Prisma `mode: "insensitive"`.
  const candidateTickets = await prisma.memberTicket.findMany({
    where: {
      OR: [
        {
          AND: [
            { totalAmount: { equals: 0 } },
            { amountPaid: { equals: 0 } },
            { balanceDue: { equals: 0 } },
          ],
        },
        { plan: { name: { contains: "complimentary", mode: "insensitive" } } },
      ],
    },
    include: {
      plan: { select: { id: true, name: true } },
      payments: {
        select: {
          id: true,
          amount: true,
          paymentStatus: true,
          collectedById: true,
        },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });

  for (const ticket of candidateTickets) {
    counters.scanned++;

    // Skip already-flagged.
    if (ticket.isComplimentary) {
      counters.skipped++;
      continue;
    }

    // Defensive: skip rows that look like unpaid balance (not comps).
    const total = Number(ticket.totalAmount ?? 0);
    const paid = Number(ticket.amountPaid ?? 0);
    const due = Number(ticket.balanceDue ?? 0);
    if (total > 0 && paid === 0 && due > 0) {
      counters.skipped++;
      continue;
    }

    // Skip if any non-zero, non-refunded payment exists (treat as paid, not comp)
    // — using payments table as authority. Refunded payments are explicitly excluded.
    const nonZeroPayments = await prisma.payment.findMany({
      where: {
        memberTicketId: ticket.id,
        amount: { gt: 0 },
        NOT: { paymentStatus: "refunded" },
      },
      select: { id: true },
    });
    if (nonZeroPayments.length > 0) {
      // Only treat as comp if the plan name itself says complimentary.
      const planLooksComp =
        ticket.plan?.name?.toLowerCase().includes("complimentary") ?? false;
      if (!planLooksComp) {
        counters.skipped++;
        continue;
      }
    }

    // Choose comp reason
    const planName = ticket.plan?.name?.toLowerCase() ?? "";
    let compReason = "legacy_complimentary_plan";
    if (planName.includes("pt") || planName.includes("personal training")) {
      compReason = "legacy_zero_pt";
    }

    // Resolve issuer from the first payment if available.
    const issuerId = ticket.payments[0]?.collectedById ?? null;

    await prisma.memberTicket.update({
      where: { id: ticket.id },
      data: {
        isComplimentary: true,
        compReason,
        compIssuedById: issuerId,
        compExpiresAt: ticket.expireDate,
      },
    });

    counters.flagged++;
  }

  console.log("Backfill complete:", counters);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Backfill failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
