/**
 * Deactivate TicketPlans that have no active member tickets.
 *
 * EGYM imported 102 plans from CSV — most are legacy / one-off / discontinued.
 * Only plans that some active member is currently on should appear in the
 * "active plan" dropdowns (renewal, comp, plan filter on /admin/members).
 *
 * Logic:
 *   - A plan is "in use" if it has at least one MemberTicket with status='active'.
 *   - Any plan with isActive=true AND zero active tickets gets isActive=false.
 *   - Any plan with isActive=false AND >=1 active ticket gets isActive=true
 *     (re-activation guard — ensures dropdowns aren't empty for live members).
 *
 * Idempotent. Safe to re-run nightly via cron if needed.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/deactivate-unused-plans.ts
 *   DATABASE_URL=... npx tsx scripts/deactivate-unused-plans.ts --dry-run
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}\n`);

  const plans = await prisma.ticketPlan.findMany({
    select: {
      id: true,
      name: true,
      isActive: true,
      memberTickets: {
        where: { status: "active" },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: { name: "asc" },
  });

  const toDeactivate: typeof plans = [];
  const toReactivate: typeof plans = [];

  for (const p of plans) {
    const hasActive = p.memberTickets.length > 0;
    if (p.isActive && !hasActive) toDeactivate.push(p);
    if (!p.isActive && hasActive) toReactivate.push(p);
  }

  console.log(`Total plans: ${plans.length}`);
  console.log(`  Currently active: ${plans.filter((p) => p.isActive).length}`);
  console.log(`  Currently inactive: ${plans.filter((p) => !p.isActive).length}`);
  console.log(`  Plans with ≥1 active ticket: ${plans.filter((p) => p.memberTickets.length > 0).length}\n`);

  console.log(`To DEACTIVATE (active flag → false, no active tickets): ${toDeactivate.length}`);
  for (const p of toDeactivate.slice(0, 10)) {
    console.log(`  - [${p.id}] ${p.name}`);
  }
  if (toDeactivate.length > 10) console.log(`  ... +${toDeactivate.length - 10} more`);

  console.log(`\nTo REACTIVATE (inactive flag → true, has active tickets): ${toReactivate.length}`);
  for (const p of toReactivate.slice(0, 10)) {
    console.log(`  - [${p.id}] ${p.name} (≥1 active ticket)`);
  }
  if (toReactivate.length > 10) console.log(`  ... +${toReactivate.length - 10} more`);

  if (DRY_RUN) {
    console.log("\nDry run — no changes written.");
    return;
  }

  if (toDeactivate.length > 0) {
    const result = await prisma.ticketPlan.updateMany({
      where: { id: { in: toDeactivate.map((p) => p.id) } },
      data: { isActive: false },
    });
    console.log(`\nDeactivated ${result.count} plans.`);
  }
  if (toReactivate.length > 0) {
    const result = await prisma.ticketPlan.updateMany({
      where: { id: { in: toReactivate.map((p) => p.id) } },
      data: { isActive: true },
    });
    console.log(`Reactivated ${result.count} plans.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
