# Data parity backfill — 2026-04-21

Restores production DB parity with the source CSVs after the audit found:

- **FFF**: Nitin's ₹36,000 PT payment dropped (9-digit phone), 23 zero-amount comp rows skipped, every `User.createdAt` collapsed onto import day.
- **EGYM**: ~3,081 payment rows missing (~₹84.8L), GPay/Paytm/Cheque/Card collapsed to "cash" (~₹81L misclassified), `MemberTicket.balanceDue` empty (~₹1.34L hidden), every `User.createdAt` collapsed, ~5x active-member inflation from un-demoted historical tickets.

All scripts default to `--dry-run`. **Always run dry-run first**, sanity-check the summary numbers against the audit report, then add `--apply`.

## Prereqs (per gym)

```bash
# Pull prod DATABASE_URL into a local file (NEVER commit it)
vercel env pull .env.fff  --environment=production --project traqgym-app
vercel env pull .env.egym --environment=production --project traqgym-egym
```

For every command below, set `DATABASE_URL` from the right file:

```bash
export DATABASE_URL=$(grep '^DATABASE_URL=' .env.fff  | cut -d= -f2-)   # FFF
export DATABASE_URL=$(grep '^DATABASE_URL=' .env.egym | cut -d= -f2-)   # EGYM
```

## Wave B — FFF (`traqgym-app`)

Order matters: createdAt before balance/payment scripts so newly-created
rows in step 2 inherit accurate timestamps.

```bash
# 1. Backfill User.createdAt from CSV "Created On"
DATABASE_URL=$(grep '^DATABASE_URL=' .env.fff | cut -d= -f2-) \
  npx tsx scripts/backfill-user-createdat-fff.ts            # dry-run
DATABASE_URL=$(grep '^DATABASE_URL=' .env.fff | cut -d= -f2-) \
  npx tsx scripts/backfill-user-createdat-fff.ts --apply

# 2. Re-create the 23 dropped zero-amount comp payments
DATABASE_URL=$(grep '^DATABASE_URL=' .env.fff | cut -d= -f2-) \
  npx tsx scripts/backfill-zero-amount-payments-fff.ts
DATABASE_URL=$(grep '^DATABASE_URL=' .env.fff | cut -d= -f2-) \
  npx tsx scripts/backfill-zero-amount-payments-fff.ts --apply

# 3. Import Nitin's missing ₹36,000 PT
DATABASE_URL=$(grep '^DATABASE_URL=' .env.fff | cut -d= -f2-) \
  npx tsx scripts/import-missing-nitin-fff.ts
DATABASE_URL=$(grep '^DATABASE_URL=' .env.fff | cut -d= -f2-) \
  npx tsx scripts/import-missing-nitin-fff.ts --apply
```

Importer source patches in `scripts/migrate-fitnessboard.ts` are applied
already (loosened phone-length filter, write `User.createdAt`, accept
zero-amount comps). They take effect on any future re-run / new gym
onboarded from a FitnessBoard export.

## Wave C — EGYM (`traqgym-egym`)

Order: payment-mode reclassification first (cheap), then balance, then
createdAt, then optionally the recovery script (high risk — review dry-run
diff carefully), and finally the active-tickets cap.

```bash
# 1. Reclassify GPay/Paytm/Cheque/Card from "cash" to correct mode
DATABASE_URL=$(grep '^DATABASE_URL=' .env.egym | cut -d= -f2-) \
  npx tsx scripts/reclassify-paymentmode-egym.ts
DATABASE_URL=$(grep '^DATABASE_URL=' .env.egym | cut -d= -f2-) \
  npx tsx scripts/reclassify-paymentmode-egym.ts --apply

# 2. Backfill MemberTicket.balanceDue
DATABASE_URL=$(grep '^DATABASE_URL=' .env.egym | cut -d= -f2-) \
  npx tsx scripts/backfill-balance-due-egym.ts
DATABASE_URL=$(grep '^DATABASE_URL=' .env.egym | cut -d= -f2-) \
  npx tsx scripts/backfill-balance-due-egym.ts --apply

# 3. Backfill User.createdAt
DATABASE_URL=$(grep '^DATABASE_URL=' .env.egym | cut -d= -f2-) \
  npx tsx scripts/backfill-user-createdat-egym.ts
DATABASE_URL=$(grep '^DATABASE_URL=' .env.egym | cut -d= -f2-) \
  npx tsx scripts/backfill-user-createdat-egym.ts --apply

# 4. Recover the ~3,081 missing Payment+Invoice rows
#    REVIEW DRY-RUN OUTPUT carefully. Compare "to create" against the
#    audit number. Anything wildly off means a join key is wrong.
DATABASE_URL=$(grep '^DATABASE_URL=' .env.egym | cut -d= -f2-) \
  npx tsx scripts/recover-missing-payments-egym.ts
DATABASE_URL=$(grep '^DATABASE_URL=' .env.egym | cut -d= -f2-) \
  npx tsx scripts/recover-missing-payments-egym.ts --apply

# 5. Cap active tickets to 1 per user (fixes ~5x inflated active count)
DATABASE_URL=$(grep '^DATABASE_URL=' .env.egym | cut -d= -f2-) \
  npx tsx scripts/restrict-active-tickets-egym.ts
DATABASE_URL=$(grep '^DATABASE_URL=' .env.egym | cut -d= -f2-) \
  npx tsx scripts/restrict-active-tickets-egym.ts --apply
```

## Idempotency guarantees

Every script:

- Skips work that is already correct (no double-update, no double-create)
- Dedupes on `Invoice.invoiceNumber` for any payment write (`FB-…` for FFF,
  `EGL-…` for EGYM — same convention as the original importers)
- Re-running after `--apply` is a no-op (zero rows updated, summary still
  prints for verification)
- Only the `restrict-active-tickets-egym.ts` script changes state without an
  invoice key; it is also re-runnable because already-demoted rows no longer
  match the `status="active"` selector

## Verification (Wave D)

After all scripts have run on prod, re-execute the parity audit (the same
queries used in the original audit). Targets:

| Metric | Expected post-fix delta vs CSV |
|---|---|
| FFF Payment count            | < 0.1% |
| FFF Cash + UPI sum           | < 0.1% |
| FFF Balance-due sum          | < 0.1% |
| FFF Active members (count)   | exact |
| EGYM Payment count           | < 0.5% (some rows have no user/ticket match) |
| EGYM `paymentMode` mix       | within 1% of CSV mix |
| EGYM Balance-due sum         | < 0.5% |
| EGYM Active members          | within ±5% (depends on how strict "active" is interpreted) |

If any delta exceeds the target, the audit log will show the exact rows
still divergent — fix that input row in the CSV (or adjust the importer
patch) rather than re-tuning the dashboard query.
