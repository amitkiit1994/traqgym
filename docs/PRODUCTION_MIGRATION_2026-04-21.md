# Production Migration — 2026-04-21

Schema changes accumulated over the recent integration cycle that are present
in `prisma/schema.prisma` on `main` but have not yet been pushed to either of
the production Railway databases. Roll these out to **both** Free Form Fitness
(`traqgym-app`) and E-GYM Lokhandwala (`traqgym-egym`) before promoting the
next deploy.

## What changed in `prisma/schema.prisma`

### New table

- **`ProcessedTelegramUpdate`** — Telegram bot deduplication ledger. Webhook
  handler refused to insert without it earlier (QA caught the missing table
  on local first, since pushed locally — production still missing).

  ```
  model ProcessedTelegramUpdate {
    updateId    BigInt   @id        // Telegram update_id (64-bit)
    processedAt DateTime @default(now())

    @@index([processedAt])
  }
  ```

### `Sale` — two new optional fields (Agent 3 / POS hardening)

- `paymentId   Int?  @unique`  — 1:1 link to the universal `Payment` ledger
  row that POS sales now create. `onDelete: SetNull`.
- `shiftId     Int?`           — link to the open `CashShift` at the seller's
  location, so cash sales reconcile against the drawer in `closeShift()`.
  `onDelete: SetNull`.
- New indices: `@@index([shiftId])`, `@@index([locationId, createdAt])`.

### `Payment` — two FKs relaxed to nullable

- `userId          Int?` (was `Int`)  — POS walk-in sales create a Payment
  with no member attached.
- `memberTicketId  Int?` (was `Int`)  — same: POS sales have no ticket.

Member-bound payments (renewals, PT, freezes, refunds) continue to populate
both fields. The change is purely **additive permissibility**; no existing row
becomes invalid.

## Per-instance rollout

Both projects use Railway PostgreSQL behind the scenes; we use `prisma db
push` (not `migrate deploy`) because the production DBs are not under
migration version control yet. `--skip-generate` because Vercel's build step
already runs `prisma generate`.

```bash
# ── FFF (Free Form Fitness, traqgym-app) ────────────────────────────────
vercel env pull .env.fff --environment=production --project traqgym-app
DATABASE_URL=$(grep '^DATABASE_URL=' .env.fff | cut -d= -f2-) \
  npx prisma db push --skip-generate

# ── EGYM (E-GYM Lokhandwala, traqgym-egym) ──────────────────────────────
vercel env pull .env.egym --environment=production --project traqgym-egym
DATABASE_URL=$(grep '^DATABASE_URL=' .env.egym | cut -d= -f2-) \
  npx prisma db push --skip-generate
```

After each `db push`, `prisma db push` should report **no data loss** because
all changes are additive (new table, new optional columns, relaxed
nullability). If it warns about data loss, **stop** and investigate before
typing `y`.

## Backfill notes

### `Payment.userId` / `Payment.memberTicketId` nullability

No backfill required. Every existing `Payment` row in both production DBs was
written under the old non-nullable schema, so every row already has non-null
values for both columns. Relaxing the column to `NULL`-able is a metadata-only
DDL change in PostgreSQL — no row rewrite, no data movement.

### `Sale.paymentId` / `Sale.shiftId`

- **FFF**: there are very few (likely zero) `Sale` rows in production today —
  POS rollout has been local-only. Any pre-existing rows will sit with
  `paymentId = NULL` and `shiftId = NULL`, which is the same as the migrated
  schema's default. Cashflow reports will simply skip them when joining via
  `paymentId`.
- **EGYM**: same story. If there are any historical `Sale` rows already in
  the EGYM DB, they will be visible in `/admin/pos` history but will not
  appear in P&L or cash-shift reconciliation (no linked `Payment`, no linked
  `CashShift`). Owner can choose to either re-import via the new flow or
  accept the gap. Going forward, every new POS sale created via
  `sellProduct()` writes both fields, so the gap is bounded to pre-migration
  rows.

### `ProcessedTelegramUpdate`

New empty table; nothing to backfill. The first incoming Telegram update
after the migration will populate the first row.

### `MemberTicket.isComplimentary` + `MemberTicket.compReason` (NEW — 2026-04-21)

- `isComplimentary  Boolean   @default(false)` — flags free passes / staff
  comps. The dashboard "Active members" tile and the cash collections tile
  filter these out; without the column the C3 calc-fix throws `column does
  not exist` at runtime.
- `compReason       String?`  — free-text reason captured at issuance.

`prisma db push` will add both columns with the schema default
(`isComplimentary = false`), so every existing ticket is treated as paid —
which is what the dashboards already assumed before the column existed.

### `CompPass` (NEW table — 2026-04-21)

Lightweight comp-pass model for cases without a paid ticket (Phase G.1 of
the GOD-MODE plan). Empty after `db push`; populated only by the new comp
issuance flow + the optional `scripts/backfill-comp-passes.ts` one-shot.

### `Insight` (NEW table — 2026-04-21)

Insight surface populated by background agents (comp-auditor, silent-churn,
etc.). Empty after `db push`; first cron run after deploy will populate it.

## Operational sequence (IMPORTANT)

The dashboard code in `lib/services/dashboard.ts` references
`isComplimentary` in two queries (cash collections filter + active member
ticket aggregate). If the **code deploy** lands before the **schema push**,
the dashboard endpoint will 500 with `column "isComplimentary" does not
exist`. Therefore for THIS rollout, run in this order per instance:

1. `vercel env pull` for the project
2. `prisma db push --skip-generate` against the prod DB
3. Run the verification SQL block below
4. THEN promote the Vercel deploy that contains the C1–C4 / M1–M7
   dashboard fixes

## Verification after push

For each instance:

```bash
DATABASE_URL=... psql "$DATABASE_URL" -c \
  "SELECT column_name, is_nullable FROM information_schema.columns
     WHERE table_name='Payment' AND column_name IN ('userId','memberTicketId');"
# Expect both rows with is_nullable = YES

DATABASE_URL=... psql "$DATABASE_URL" -c \
  "SELECT column_name FROM information_schema.columns
     WHERE table_name='Sale' AND column_name IN ('paymentId','shiftId');"
# Expect 2 rows

DATABASE_URL=... psql "$DATABASE_URL" -c \
  "SELECT to_regclass('\"ProcessedTelegramUpdate\"');"
# Expect a non-NULL oid

DATABASE_URL=... psql "$DATABASE_URL" -c \
  "SELECT column_name FROM information_schema.columns
     WHERE table_name='MemberTicket'
       AND column_name IN ('isComplimentary','compReason');"
# Expect 2 rows

DATABASE_URL=... psql "$DATABASE_URL" -c \
  "SELECT to_regclass('\"CompPass\"'), to_regclass('\"Insight\"');"
# Expect both non-NULL oids
```

Once verified, redeploy the project on Vercel so the freshly generated
Prisma client (with the new types) replaces the running instance.
