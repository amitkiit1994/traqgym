# Phase 3a: Float → Decimal Financial Data Migration

> **STATUS: CODE CHANGES SHIPPED — DB MIGRATION PENDING.** Schema, caller arithmetic, and the backfill tool are in main. The DB-side `ALTER COLUMN` + per-gym backfill run is the remaining operational step (still requires user oversight and a maintenance window per gym).

## What's done in code

- `prisma/schema.prisma`: `MemberTicket.amountPaid` and `MemberTicket.balanceDue` are `Decimal @db.Decimal(10, 2)` (verified already at HEAD, the type change pre-dated the current commit series).
- `lib/services/partial-payment.ts`: `recordPartialPayment` now uses `Prisma.Decimal` end-to-end (`.plus()`, `.minus()`, `.gt()`, `.lte()`, `Decimal.max`); plain `Number()` arithmetic on `amountPaid` / `balanceDue` removed inside the transaction; boundary conversion (`.toNumber()`) only at the JSON response. Bundled into commit `b6dd7be`.
- `lib/services/gift-cards.ts`: `redeemGiftCard` uses `Prisma.Decimal` for balance compare and update; exact `.lte(0)` redemption check replaces the `<= 0.005` Float-epsilon hack. Commit `b5d0f9e`.
- `scripts/backfill-decimal-amounts.ts`: idempotent dry-run/`--apply` script — recomputes `amountPaid` from `SUM(Payment.amount WHERE memberTicketId = X)` and `balanceDue = max(totalAmount - amountPaid, 0)`. Type-checks clean. Commit `c61e4e4`.
- `tests/bugs/financial-bugs.test.ts`: docblock updated to record BUG 1 / BUG 3 are fixed at the service layer; helper tests stay as regression witnesses (they exercise raw JS Float, so they still demonstrate the historical bug). No `it.skip` cases existed to flip. Commit `0d8786b`.

`npx tsc --noEmit` baseline before this work was 54 errors; after, still 54 (no regressions introduced). `npx prisma format` + `npx prisma generate` ran clean.

## What's still pending (operational)

The DB cutover is intentionally **not** in the above commits — it must be coordinated per gym:

1. Take per-gym `pg_dump` backups (offsite).
2. Snapshot row count + `SUM("amountPaid")` + `SUM("balanceDue")` per gym before any change (sanity check for post-cutover).
3. Coordinate a short read-only maintenance window with Robin (and any other live gym).
4. Run `DATABASE_URL=$PROD_URL npx prisma migrate deploy` against each gym DB (only needed if any gym DB is still on the old Float types; verify with `\d "MemberTicket"`).
5. Run `npx tsx scripts/backfill-decimal-amounts.ts` **dry-run** against each gym DB, review the drift report.
6. Run with `--apply` if the drift report looks sane (small, bounded by Float epsilon).
7. Verify post-snapshot sums against pre-snapshot (any change > ₹100 = STOP, investigate, possibly rollback).
8. Lift read-only.

See "Rollout" and "Rollback procedure" sections below for the exact steps.

---

**Goal:** Convert `MemberTicket.amountPaid` and `MemberTicket.balanceDue` from `Float` to `Decimal(10, 2)`. Backfill existing rows to recompute `amountPaid = SUM(payments)` and `balanceDue = totalAmount - amountPaid`. Update all caller code from `Number()` arithmetic to `Prisma.Decimal` arithmetic.

**Why:** Floating-point arithmetic accumulates rounding errors → phantom ₹0.0000001 balances → false followup notifications. Documented in `tests/bugs/financial-bugs.test.ts:55-71`.

**Risk:** High. Schema migration + data rewrites across the entire ticket history. A bug in backfill could corrupt the gym's financial ledger.

**Source spec:** `docs/specs/2026-05-16-path-to-prod-design.md` Phase 3a.

---

## Pre-flight (must complete before executing)

1. **Full backup of each target DB**
   ```bash
   # For Free Form Fitness (Railway):
   pg_dump $DATABASE_URL_FREEFORM > backup_fff_pre-decimal-$(date +%Y%m%d).sql
   # Same for E-GYM
   pg_dump $DATABASE_URL_EGYM > backup_egym_pre-decimal-$(date +%Y%m%d).sql
   ```
   Store backups OFFSITE (not just on the same dev machine).

2. **Snapshot current row count + balance sums** (so we can verify the migration didn't lose money):
   ```sql
   SELECT count(*) AS tickets, SUM("amountPaid") AS sum_paid, SUM("balanceDue") AS sum_due
   FROM "MemberTicket";
   ```
   Save these numbers per gym.

3. **Maintenance window** — coordinate with Robin (and any other live gym). 30-min read-only window minimum.

---

## Tasks

### Task 1 — Local schema migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] Find the `MemberTicket` model and change:
  ```prisma
  amountPaid  Float    @default(0)
  balanceDue  Float    @default(0)
  ```
  to:
  ```prisma
  amountPaid  Decimal  @default(0) @db.Decimal(10, 2)
  balanceDue  Decimal  @default(0) @db.Decimal(10, 2)
  ```

- [ ] Generate migration:
  ```bash
  cd /Users/amitkumardas/freeformOS/freeformfitnessOS
  npx prisma migrate dev --name member_ticket_amounts_to_decimal
  ```
  Verify the generated SQL — it should be `ALTER COLUMN ... TYPE numeric(10,2)` (Postgres). Reject if it looks like a destructive drop+recreate.

- [ ] Generate Prisma client:
  ```bash
  npx prisma generate
  ```

- [ ] Tsc — expect failures in callers that do `Number()` arithmetic on these fields:
  ```bash
  npx tsc --noEmit 2>&1 | grep -i "amountPaid\|balanceDue" | head -20
  ```

### Task 2 — Update caller code

The audit identified these caller files:
- `lib/services/partial-payment.ts` (line 23-24) — uses Number-arithmetic to compute new balance
- `lib/services/gift-cards.ts` (line 69)
- Plus any others surfaced by tsc in Task 1

For each:
- [ ] Replace `Number(x) + Number(y)` with `new Prisma.Decimal(x).plus(y)` etc.
- [ ] When the result must be a number for API/JSON: `.toNumber()` at the boundary (with awareness that this re-introduces float — only do this for display, not for further arithmetic)
- [ ] When comparing: use `.eq()`, `.gt()`, `.lt()` not `===`, `>`, `<`

Commit each file individually:
```bash
git commit -m "fix(decimal): migrate <file> to Prisma.Decimal arithmetic"
```

### Task 3 — Backfill script

**Files:**
- Create: `scripts/backfill-decimal-amounts.ts`

```typescript
/**
 * Backfill MemberTicket.amountPaid and balanceDue from Payment table.
 * Idempotent — running it twice produces the same answer.
 *
 * For each ticket:
 *   amountPaid = SUM(Payment.amount WHERE ticketId = X)
 *   balanceDue = totalAmount - amountPaid (clamped to >=0)
 *
 * Reports total amount delta (should be near-zero if data was already correct;
 * differences = phantom-float drift being cleaned up).
 *
 * Usage:
 *   npx tsx scripts/backfill-decimal-amounts.ts             # dry-run (default)
 *   npx tsx scripts/backfill-decimal-amounts.ts --apply     # actually writes
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (writes)" : "DRY-RUN (read-only)"}`);

  const tickets = await prisma.memberTicket.findMany({
    select: { id: true, totalAmount: true, amountPaid: true, balanceDue: true },
  });
  console.log(`Loaded ${tickets.length} tickets`);

  let drift = 0;
  let changed = 0;

  for (const t of tickets) {
    const paidAgg = await prisma.payment.aggregate({
      where: { ticketId: t.id },
      _sum: { amount: true },
    });
    const newPaid = new Prisma.Decimal(paidAgg._sum.amount ?? 0);
    const newDue = Prisma.Decimal.max(
      new Prisma.Decimal(t.totalAmount ?? 0).minus(newPaid),
      0
    );

    const currentPaid = new Prisma.Decimal(t.amountPaid as unknown as Prisma.Decimal | number);
    const currentDue = new Prisma.Decimal(t.balanceDue as unknown as Prisma.Decimal | number);

    if (!currentPaid.eq(newPaid) || !currentDue.eq(newDue)) {
      changed++;
      const delta = newPaid.minus(currentPaid).abs().plus(newDue.minus(currentDue).abs());
      drift += delta.toNumber();
      if (APPLY) {
        await prisma.memberTicket.update({
          where: { id: t.id },
          data: { amountPaid: newPaid, balanceDue: newDue },
        });
      } else {
        console.log(
          `  ticket ${t.id}: paid ${currentPaid} -> ${newPaid}, due ${currentDue} -> ${newDue}`
        );
      }
    }
  }

  console.log(`\n${changed}/${tickets.length} tickets needed update.`);
  console.log(`Total absolute drift: ${drift.toFixed(2)}`);
  if (!APPLY) {
    console.log(`\nRe-run with --apply to commit these changes.`);
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

### Task 4 — Rollout

**Per gym (in order: local → staging → smallest prod gym → biggest):**

1. **Local dev DB:** run schema migration, run backfill dry-run, inspect output, run with `--apply`, verify financial-bugs.test.ts passes
2. **E-GYM staging** (if available): same
3. **Free Form Fitness prod (smaller):** brief read-only window (set DB user to read-only, or stop the app), run migration + backfill, verify totals match pre-snapshot, lift read-only
4. **E-GYM Lokhandwala prod (bigger):** same

For each prod cutover:
- [ ] Confirm pre-snapshot counts/sums noted in Pre-flight
- [ ] Run migration with `migrate deploy` (not `migrate dev` in prod)
  ```bash
  DATABASE_URL=$PROD_URL npx prisma migrate deploy
  ```
- [ ] Run backfill dry-run; review report
- [ ] Run backfill with `--apply`
- [ ] Verify post-snapshot:
  ```sql
  SELECT count(*), SUM("amountPaid"), SUM("balanceDue") FROM "MemberTicket";
  ```
- [ ] If sum_paid changed by > ₹100 (sanity threshold): STOP. Investigate. Roll back if needed.
- [ ] If counts match: lift read-only; verify app works
- [ ] Run financial-bugs.test.ts against the prod DB if possible

### Task 5 — Activate tests

In `tests/bugs/financial-bugs.test.ts`, change the relevant `it.skip` cases to `it` so they actively run in CI.

```bash
git add tests/bugs/financial-bugs.test.ts
git commit -m "test: activate financial-bugs cases now that Decimal migration shipped"
```

---

## Rollback procedure

If anything looks wrong post-backfill:

1. STOP — don't make further changes
2. Restore from the pre-flight backup:
   ```bash
   psql $DATABASE_URL < backup_fff_pre-decimal-YYYYMMDD.sql
   ```
3. Revert the Prisma schema change (git revert), redeploy

---

## Done criteria

- [ ] `MemberTicket.amountPaid` and `balanceDue` are `Decimal(10, 2)` in schema
- [ ] All caller files use `Prisma.Decimal` arithmetic (no `Number()` on these fields)
- [ ] Backfill ran successfully against each prod gym DB (counts match snapshot)
- [ ] Financial-bugs tests pass
- [ ] No new tsc errors

## Why this isn't auto-executed in the current session

- Touches production financial data
- Requires per-gym maintenance windows + coordination with Robin
- Schema migration generation needs a connected local Postgres (currently not running)
- Verification requires comparing snapshots that must be captured immediately before/after

**Recommended:** execute in a fresh focused session with a local Postgres running and prod DB access ready. Allocate ~1 day per gym.
