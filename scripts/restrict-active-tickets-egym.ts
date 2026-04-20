/**
 * Cap the EGYM "active members" inflation: ensure at most ONE active
 * MemberTicket per user — the one with the latest expireDate that is still
 * in the future.
 *
 * Why: pg_dump load left every historical ticket with status="active",
 * inflating the active-member count ~5x (10k+ vs ~2k real). Every prior
 * ticket gets demoted to status="expired" or "renewed" so the dashboard
 * tile and renewal cliff agent reflect reality.
 *
 * Rules:
 *   - Per user: take the ticket with MAX(expireDate) where expireDate >= now AND status="active". That ticket stays active.
 *   - All other tickets currently status="active" → status="renewed" if a newer ticket exists for the same user, else "expired".
 *
 * Idempotent: only updates rows that need a change. Re-run = no-op.
 * Default mode: --dry-run. Pass --apply to write.
 *
 * Usage:
 *   DATABASE_URL=...prod-egym... npx tsx scripts/restrict-active-tickets-egym.ts
 *   DATABASE_URL=...prod-egym... npx tsx scripts/restrict-active-tickets-egym.ts --apply
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`[restrict-active-tickets-egym] mode=${APPLY ? "APPLY" : "DRY-RUN"}`);
  const now = new Date();

  // Pull all tickets currently marked active, grouped by user.
  const allActive = await prisma.memberTicket.findMany({
    where: { status: "active" },
    select: { id: true, userId: true, buyDate: true, expireDate: true },
    orderBy: [{ userId: "asc" }, { expireDate: "desc" }],
  });
  console.log(`  total tickets currently status=active : ${allActive.length}`);

  const byUser = new Map<number, typeof allActive>();
  for (const t of allActive) {
    if (!byUser.has(t.userId)) byUser.set(t.userId, []);
    byUser.get(t.userId)!.push(t);
  }
  console.log(`  distinct users with active tickets    : ${byUser.size}`);

  let toRenewed = 0;
  let toExpired = 0;
  const renewedIds: number[] = [];
  const expiredIds: number[] = [];

  for (const [, tickets] of byUser) {
    // Tickets are already sorted by expireDate desc.
    let kept = false;
    for (const t of tickets) {
      if (!kept && t.expireDate >= now) {
        kept = true; // first usable ticket stays active
        continue;
      }
      // Demote: renewed if there's any newer ticket (always true for index>0), else expired.
      if (!kept) {
        // No usable ticket existed for this user — everything is expired.
        expiredIds.push(t.id);
        toExpired++;
      } else {
        renewedIds.push(t.id);
        toRenewed++;
      }
    }
  }

  const retained = allActive.length - toRenewed - toExpired;
  const usersWithUsableTicket = retained;            // exactly 1 per user with at least one expireDate >= now
  const usersFullyExpired = byUser.size - retained;  // every active ticket already past expireDate

  console.log("\nProposed changes:");
  console.log(`  active -> renewed : ${toRenewed}     (older tickets shadowed by a newer usable one)`);
  console.log(`  active -> expired : ${toExpired}     (no usable ticket survives for this user)`);
  console.log(`  active retained   : ${retained}     (${usersWithUsableTicket} users keep 1 active ticket)`);
  console.log(`  fully-expired users: ${usersFullyExpired}  (every "active" row was already past expireDate)`);

  if (!APPLY) {
    if (toRenewed + toExpired > 0) console.log(`\nRun with --apply to commit ${toRenewed + toExpired} status changes.`);
    return;
  }

  const BATCH = 500;
  for (let i = 0; i < renewedIds.length; i += BATCH) {
    const chunk = renewedIds.slice(i, i + BATCH);
    await prisma.memberTicket.updateMany({ where: { id: { in: chunk } }, data: { status: "renewed" } });
    console.log(`  renewed: applied ${Math.min(i + BATCH, renewedIds.length)}/${renewedIds.length}`);
  }
  for (let i = 0; i < expiredIds.length; i += BATCH) {
    const chunk = expiredIds.slice(i, i + BATCH);
    await prisma.memberTicket.updateMany({ where: { id: { in: chunk } }, data: { status: "expired" } });
    console.log(`  expired: applied ${Math.min(i + BATCH, expiredIds.length)}/${expiredIds.length}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
