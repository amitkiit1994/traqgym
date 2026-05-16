# v3 FitnessBoard → TraqGym nightly sync

This directory contains the runner for mirroring data from the legacy
`v3.fitnessboard.in` dashboard into each gym's TraqGym Postgres instance.
The runner is executed by `.github/workflows/v3-sync-nightly.yml` on a
cron schedule (02:30 IST nightly).

## Pipeline

```
GH Actions (cron 0 21 * * * UTC)
    │
    ├─ for each gym in matrix:
    │
    ├─ python3 sync.py --gym-base-url https://<gym>.traqgym.com
    │                  --internal-secret $INTERNAL_API_SECRET_<GYM>
    │
    │  1. POST /api/internal/v3-credentials  (Bearer auth)
    │       → { mobile, password, syncEnabled }
    │
    │  2. POST https://v3.fitnessboard.in/Account/Login
    │       → 302 Set-Cookie: ASP.NET_SessionId=...
    │
    │  3. GET  https://v3.fitnessboard.in/Dashboard/ExportToExcel
    │             ?exportfor=payment&StartDate=...&EndDate=today
    │       → HTML table → parsed dict rows
    │
    │  4. POST /api/internal/v3-sync  { dataset: "payment", rows: [...] }
    │       → upsert via FB-{BillNo} invoice number
    │
    └─ status persisted to GymSettings (v3_last_sync_at, v3_last_sync_status)
       → surfaced in /admin/settings/integrations/fitnessboard
```

## Required env vars / secrets

Per gym, the runner needs:

| Env var                          | Purpose                                              |
| -------------------------------- | ---------------------------------------------------- |
| `GYM_BASE_URL` / `--gym-base-url` | e.g. `https://freeformfitness.traqgym.com`           |
| `INTERNAL_API_SECRET` / `--internal-secret` | Bearer for `/api/internal/*`             |

In GitHub Actions these come from per-gym secrets:

- `INTERNAL_API_SECRET_FREEFORM` — the freeformfitness instance's secret
- `INTERNAL_API_SECRET_EGYM` — the egymlokhandwala instance's secret

The values must match each gym's deployed `INTERNAL_API_SECRET` env var
on Vercel. Generate with:

```sh
openssl rand -base64 32
```

The v3.fitnessboard.in credentials themselves (mobile + password) are
**not** GitHub secrets — they're stored encrypted in the gym's `GymSettings`
table and pulled fresh on every run via the credentials endpoint. This
way the gym owner can rotate them via the admin UI without touching CI.

## Adding a new gym

1. In the GH repo, add `INTERNAL_API_SECRET_<NAME>` to repository secrets.
2. Edit `.github/workflows/v3-sync-nightly.yml` and append the gym to the
   `matrix.gym` list with the base URL + secret reference.
3. Have the gym admin save their v3 mobile + password at
   `/admin/settings/integrations/fitnessboard` and toggle "Sync from
   FitnessBoard v3 nightly" on.
4. (Optional) Trigger the workflow manually from the Actions tab to
   verify connectivity before waiting for the next nightly run.

## Manual / local run

```sh
GYM_BASE_URL=https://freeformfitness.traqgym.com \
INTERNAL_API_SECRET=<secret> \
  python3 scripts/v3-sync/sync.py
```

Or with flags:

```sh
python3 scripts/v3-sync/sync.py \
  --gym-base-url https://freeformfitness.traqgym.com \
  --internal-secret <secret>
```

The script is stdlib-only (no `pip install` needed). It logs to stdout
and exits non-zero on any v3 / API failure so the GH job is marked red.

## What gets synced

v1 only syncs the **payment** dataset. The API has placeholders that
return HTTP 501 for the other datasets the spec mentions (`members`,
`memberships`, `balance`, `attendance`, `invoices`, `memberDetails`).
Add upsert handlers in `app/api/internal/v3-sync/route.ts` to extend.

Payments are idempotent: each row's `BillNo` becomes `FB-{BillNo}` as
the unique invoice number — already-synced rows are skipped (the API
returns counts for inserted / skipped / errors).

## Known limitations

- Members are matched by phone (`ContactNo` → `User.phone`). If the
  member doesn't exist in TraqGym yet, the row is skipped (not errored)
  so the sync still completes; ops can reconcile manually.
- Payments without a `BillNo` are skipped.
- Payment mode is normalised to `cash` if v3 returns an unknown value.
- The `collectedById` is set to the first active worker, since v3
  doesn't surface the actual cashier per row.
