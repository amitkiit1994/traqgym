# Runbook: converge `egymlokhandwala` onto `main`

Date: 2026-06-11
State analyzed: `main` = `af06b04`, `egymlokhandwala` = `f54ae94`, merge-base `214fed8` (both branches in sync with origin at time of analysis — re-verify in Preflight).
Goal: ONE production branch (`main`) feeding BOTH Vercel projects (`traqgym-app` for Free Form Fitness, `traqgym-egym` for E-GYM Lokhandwala), with all per-gym differences carried by Vercel env vars and each gym's own Postgres. The `egymlokhandwala` branch is then archived and deleted.

This is an operator runbook for a live-customer cutover. Execute top to bottom; every step has a check. Nothing here is destructive until the explicitly marked post-burn-in section.

---

## 1. Why now (and why it is low risk)

1. **The runtime app is already byte-identical across branches.** `git diff main egymlokhandwala` touches ZERO files in `app/`, `lib/`, `components/`, `prisma/`, `landing/`, `middleware.ts`, `package.json`, `vercel.json`, `next.config.ts`. Branding was made config-driven in `263cc7d` (egym) and its equivalent on main: `app/layout.tsx` reads `NEXT_PUBLIC_GYM_THEME_HUE` (validated 0-360, default 275) and injects `--brand-hue` on `<html>`.
2. **Security: the egym branch HEAD still exposes live admin credentials.** Main commit `af06b04` ("Redact credentials from tracked docs and test fixtures") scrubbed Robin's real admin email/password from 4 tracked files; `egymlokhandwala` never got that commit, so the plaintext credentials sit on the branch tip of a public repo today. Converging removes the exposed ref (rotation still required — section 8).
3. **Cherry-pick tax.** 6 of the 8 egym-only commits had to be hand-cherry-picked to main already (verified via `git cherry`, section 2.3). Every future hotfix doubles work and risks exactly the 4-week theme-leak incident documented in CLAUDE.md.

## 2. Diff inventory (measured, not assumed)

### 2.1 Raw numbers

```bash
cd /Users/amitkumardas/freeformOS/traqgym
git diff main..egymlokhandwala --stat
# => 49 files changed, 588 insertions(+), 5096 deletions(-)
git log --oneline egymlokhandwala..main | wc -l   # 96 commits only on main
git log --oneline main..egymlokhandwala | wc -l   # 8 commits only on egymlokhandwala
```

The deletion-heavy stat reads as "egym is stale": almost all of the diff is main-side additions/rewrites (telegram-bot build-out) that egym lacks.

### 2.2 Classification of all 49 differing files

| # | Files | Category | Verdict |
|---|-------|----------|---------|
| 39 | `telegram-bot/**` (src, api, scripts, tests — incl. `src/gyms.ts`, `src/gyms.json`, `scripts/migrate-blob-layout.mjs` which exist on main only) | genuine code drift | Main strictly newer. The bot runs from a SEPARATE Vercel project (`freeform-telegram-bot`) that deploys from main; the egym copies are dead code. Take main. |
| 3 | `.github/workflows/auto-deploy-bot.yml` (main only), `morning-digest.yml`, `refresh-export.yml` | genuine code drift (CI) | Main strictly newer (soft-failure detection, cron de-collision to 01:15 UTC, retry-once wrapper, shrunk-snapshot guard). Scheduled workflows only execute from the DEFAULT branch, so egym's stale copies were already inert. Take main. |
| 2 | `freeformfitness-data-export-fresh/fetch_complete.py`, `scripts/v3-sync/sync.py` | genuine code drift (data pipeline) | Main strictly newer (1-year payment lookback + single-retry vs egym's full-range-since-2012 + year-by-year fallback). These run from main checkouts in Actions. Take main. |
| 3 | `CLAUDE.md`, `docs/demo/2026-05-pitch-script.md`, `docs/plans/2026-05-16-phase2.5-encryption.md` | genuine drift — **credential redaction** | Main redacted Robin's live admin email + password (`af06b04`); egym still carries them in plaintext. Take main. SECURITY follow-up in section 8. |
| 2 | `tests/unit/crypto.test.ts` (egym uses the real admin password as a test fixture; main redacted it), `tests/unit/anomaly-detectors.test.ts` (exists on main only) | genuine drift (tests) | Take main. |
| **0** | — | **env-var-able config** | **None remaining.** The only thing that was ever branch-specific config — the brand hue — was migrated to `NEXT_PUBLIC_GYM_THEME_HUE` + `--brand-hue` in May. Verified: `git diff main egymlokhandwala -- app/ lib/ components/` is empty. |
| **0** | — | **data** | **None.** All gym data lives in each gym's Postgres (FFF DB vs E-GYM Railway DB). No data files differ between branches. |

Summary: **49 genuine-drift files (all resolved by "take main"), 0 env-var-able config files, 0 data files.** There is no egym-unique application behavior to preserve.

### 2.3 The 8 egym-only commits — none need rescuing

```bash
git cherry -v main egymlokhandwala
# "-" = patch-equivalent commit already exists on main
- 436b99a fix(anomaly): real bugs in owner-trust suite + tighten contract
- 0b0ac0b fix(v3-sync): stop silent row drops + extend ticket attribution
- f8dfb46 fix(dashboard): surface forecast failure + move banner Prisma into service
- ff5bc2d ci(deploy): set VERCEL_PROJECT_ID on Build + Deploy steps
- 7fbcf3d ops(auth): reset-admin-password script + fix FFF admin docs
- f54ae94 fix(prisma): add rhel-openssl-3.0.x binary target for Vercel runtime
+ 86497f5 fix(bot): strip scratchpad from history to unblock gpt-5 multi-turn
+ 263cc7d fix(theme): config-driven brand hue via --brand-hue + NEXT_PUBLIC_GYM_THEME_HUE
```

- The 6 `-` commits are already on main (cherry-picked).
- `86497f5` touches only `telegram-bot/src/history.ts`-era code that main has since rewritten wholesale (the bot's history/llm modules were rebuilt during the 96-commit main run). Superseded; nothing to carry.
- `263cc7d` has a different patch-id but its CONTENT is on main — proven by the empty `app/ lib/ components/` diff above. Nothing to carry.

Conclusion: convergence = "the `traqgym-egym` Vercel project starts consuming `main`". No merge, no cherry-picks. Do NOT merge `egymlokhandwala` into `main` — that would re-open the credential-redaction conflicts in the 4 files above for zero benefit.

## 3. How deploys actually work today (read before touching anything)

`.github/workflows/auto-deploy-vercel.yml` (identical on BOTH branches — it is not part of the 49-file drift) deploys via CI because the team's Vercel-GitHub git integration is broken/missing:

- push to `main` -> `vercel pull/build/deploy --prebuilt --prod` against project `VERCEL_PROJECT_ID` (traqgym-app)
- push to `egymlokhandwala` -> same against `VERCEL_EGYM_PROJECT_ID` (traqgym-egym)
- `vercel pull --environment=production` pulls EACH project's own env vars at build time — this is where `NEXT_PUBLIC_GYM_THEME_HUE=25` enters the EGYM bundle.

Therefore the cutover is primarily a WORKFLOW EDIT on main (deploy both projects from main), not a Vercel dashboard branch flip. The dashboard "Production Branch" setting is defense-in-depth only, since git-integration deploys are not happening.

## 4. Env-var migrations needed

**No new env vars are required.** The migration to env-driven config already happened. What IS required is verifying the existing per-project env state before cutover, because `NEXT_PUBLIC_*` values are inlined at build time:

`traqgym-egym` (E-GYM Lokhandwala) production env must contain:

| Var | Expected | Why it matters at cutover |
|-----|----------|---------------------------|
| `NEXT_PUBLIC_GYM_THEME_HUE` | `25` | CRITICAL. Missing => the rebuilt-from-main bundle renders FFF purple (the 4-week incident). |
| `DATABASE_URL` | Railway EGYM Postgres URL | The main build runs `prisma db push` against it (see 5.1.4). |
| `NEXTAUTH_URL` | `https://egymlokhandwala.traqgym.com` | Login redirects. |
| `NEXTAUTH_SECRET` | present | Session validity (unchanged => sessions survive). |
| `NEXT_PUBLIC_GYM_NAME` / `GYM_NAME` | E-GYM Lokhandwala identity | White-label login page. |
| `CRON_SECRET`, MSG91/SMTP/BIOMAX vars | as currently set | Crons + integrations (some live in GymSettings DB instead — also unchanged). |

`traqgym-app` (FFF): `NEXT_PUBLIC_GYM_THEME_HUE=275` or absent (defaults to 275 in `app/layout.tsx`). Not touched by this cutover.

Check command (or use dashboard -> project -> Settings -> Environment Variables):

```bash
VERCEL_ORG_ID=<team> VERCEL_PROJECT_ID=<traqgym-egym id> vercel env ls production --token "$VERCEL_TOKEN"
```

## 5. Cutover

Window: 18:00-19:00 UTC (23:30-01:00 IST) — both gyms closed; after the 17:00 UTC `cash-shift-variance` cron, before the 21:00 UTC `ai-revenue-anomaly`/23:00 UTC `auto-checkout` crons, and well clear of the 00:30-04:00 UTC nightly sync/digest pipeline.

### 5.1 Preflight (no changes yet)

1. Fresh state + record the rollback anchors:
   ```bash
   cd /Users/amitkumardas/freeformOS/traqgym
   git fetch origin
   git rev-parse origin/main origin/egymlokhandwala   # record both SHAs in the ops log
   ```
2. Confirm the drift is still only the known 49 files / app surface still identical:
   ```bash
   git diff --name-only origin/main origin/egymlokhandwala -- ':!telegram-bot' ':!freeformfitness-data-export-fresh' ':!.github'
   # expect EXACTLY: CLAUDE.md, docs/demo/2026-05-pitch-script.md,
   #   docs/plans/2026-05-16-phase2.5-encryption.md, scripts/v3-sync/sync.py,
   #   tests/unit/anomaly-detectors.test.ts, tests/unit/crypto.test.ts
   git diff --quiet origin/main origin/egymlokhandwala -- prisma/ package.json vercel.json middleware.ts next.config.ts && echo SCHEMA-AND-BUILD-PARITY-OK
   ```
   If anything NEW appears here, STOP — someone shipped an app commit to one branch only; reconcile that first.
3. Verify `traqgym-egym` env per section 4 (especially `NEXT_PUBLIC_GYM_THEME_HUE=25`).
4. Prove the deploy's `prisma db push` will be a no-op against the EGYM DB:
   ```bash
   DATABASE_URL="<railway egym url>" npx prisma migrate diff \
     --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
   # exit 0 / "No difference detected" expected. Non-empty => STOP and investigate.
   ```
5. Record the current EGYM production deployment for instant rollback: Vercel dashboard -> traqgym-egym -> Deployments -> note the current Production deployment URL + id.
6. Backup the EGYM Railway DB (belt and braces; schema is a proven no-op):
   ```bash
   pg_dump "<railway egym url>" -Fc -f /tmp/egym-pre-convergence-$(date +%Y%m%d).dump
   ```
7. Snapshot baseline numbers for the verification checklist: log into `https://egymlokhandwala.traqgym.com/admin`, record dashboard member/plan/ticket/payment counts (expected order: ~10,275 users / 102 plans / 9,803 tickets / 14,771 payments, plus whatever has accrued since).

### 5.2 The change (one commit on main)

Edit `.github/workflows/auto-deploy-vercel.yml` on `main` so a push to main deploys BOTH projects, and the egym branch trigger is removed:

```yaml
on:
  push:
    branches:
      - main          # egymlokhandwala trigger REMOVED
    paths-ignore: [...unchanged...]
  workflow_dispatch:

jobs:
  deploy:
    strategy:
      fail-fast: false
      matrix:
        include:
          - gym: freeformfitness
            project_id_secret: VERCEL_PROJECT_ID
          - gym: egymlokhandwala
            project_id_secret: VERCEL_EGYM_PROJECT_ID
    # concurrency must become per-gym:
    #   group: deploy-${{ github.ref }}-${{ matrix.gym }}
    # each vercel step uses:
    #   VERCEL_PROJECT_ID: ${{ secrets[matrix.project_id_secret] }}
    # and the "Determine target" branch-switch step is deleted.
```

Commit message suggestion: `ops(deploy): fan out main deploys to traqgym-app + traqgym-egym (branch convergence)`. Push to `main`.

Defense-in-depth (dashboard, optional but recommended): traqgym-egym -> Settings -> Git -> Production Branch -> `main`. Note: this is NOT settable via `PATCH /v9/projects` (confirmed against the Vercel REST API reference, 2026-06-10 — `link.productionBranch` is response-only); use the dashboard.

### 5.3 Execute and watch

1. The push from 5.2 triggers the workflow; both matrix legs build. Watch: repo -> Actions -> "Deploy to Vercel".
2. In the egym leg's build log, confirm `prisma db push` reports the DB is already in sync (matches preflight 4).
3. Both legs deploy `--prod`. Confirm in Vercel dashboard that traqgym-egym's new Production deployment is from the main-built artifact (timestamp matches the run).

### 5.4 Verification checklist — per gym, immediately after deploy

E-GYM Lokhandwala (`https://egymlokhandwala.traqgym.com`):
- [ ] `/login` loads, shows E-GYM logo + name (white-label from GymSettings, NOT TraqGym branding)
- [ ] Theme is red/black: in devtools, `getComputedStyle(document.documentElement).getPropertyValue('--brand-hue')` is `25`. THIS IS THE REGRESSION TEST for the 4-week purple-leak incident — if purple, roll back (env was missing at build).
- [ ] Admin login works (Robin's account from the password manager); existing sessions still valid (NEXTAUTH_SECRET unchanged)
- [ ] `/admin` dashboard counts match the 5.1.7 snapshot (proves DATABASE_URL untouched)
- [ ] Open one member profile, one invoice PDF (new tab), the Renewals page, Balance Due page
- [ ] `/api/health` returns 200
- [ ] Settings -> Cron Jobs: all vercel.json crons listed
- [ ] Next morning: `v3-sync-nightly` Actions run green for the `egymlokhandwala` matrix leg (it POSTs to `https://egymlokhandwala.traqgym.com` — unchanged); morning digest delivered; daily-briefing cron fired in Vercel logs.

Free Form Fitness (`https://freeformfitness.traqgym.com`) — blast-radius guard, should be untouched:
- [ ] Loads, theme purple (`--brand-hue` = 275), admin login OK, dashboard counts ~303 users
- [ ] Its production deployment also rebuilt fine from the same push (matrix leg green)

### 5.5 Rollback (any check fails)

Immediate mitigation (seconds): Vercel dashboard -> traqgym-egym -> Deployments -> the deployment recorded in 5.1.5 -> Instant Rollback / Promote to Production. The app is back on the pre-cutover egym-branch build. Sessions and DB are unaffected (nothing in this cutover migrates data).

Full rollback (minutes):
1. `git revert` the 5.2 workflow commit on main, push (restores the egym-branch trigger).
2. If the dashboard Production Branch was flipped, flip it back to `egymlokhandwala`.
3. Re-run "Deploy to Vercel" via workflow_dispatch FROM the `egymlokhandwala` branch (the branch still exists and still contains the dual-branch workflow) to confirm the old path still deploys.
4. DB: nothing to roll back (schema no-op proven in preflight); the pg_dump from 5.1.6 exists if paranoia demands.

The rollback window stays open for the whole burn-in because the `egymlokhandwala` branch is NOT deleted until section 7.

## 6. Burn-in

7 days. During burn-in:
- No deletion of the `egymlokhandwala` branch, no Vercel project changes.
- Each main push now redeploys both gyms — watch the first couple of routine deploys.
- Re-check the section 5.4 morning items once mid-week.

## 7. Post burn-in: archive and delete the branch (destructive — only after 7 green days)

```bash
cd /Users/amitkumardas/freeformOS/traqgym
git fetch origin
git tag archive/egymlokhandwala-pre-convergence origin/egymlokhandwala
git push origin archive/egymlokhandwala-pre-convergence
git push origin --delete egymlokhandwala
git branch -D egymlokhandwala
```

Then update docs on main:
- `CLAUDE.md`: Production Data section — both projects deploy `main`; delete the "Branch drift between main and egymlokhandwala is expected and OK" paragraph and its drift-check command; update the E-GYM header line (no more branch mention).
- Keep (forever) the "Never reintroduce a hardcoded brand hue" invariant block.

## 8. Security follow-up (required regardless of cutover outcome)

The plaintext admin credentials (email + password) that egym's tip exposed remain in git HISTORY of a public repo even after the branch is deleted (objects persist via the archive tag, clones, and forks). Per CLAUDE.md the password is burned:
1. Rotate Robin's admin password on BOTH databases: `npx tsx scripts/reset-admin-password.ts` (shipped to main as `7fbcf3d`'s cherry-pick) against the FFF DB and the EGYM Railway DB.
2. Store new credentials only in the shared password manager.
3. Optional hardening: rotate `NEXTAUTH_SECRET` on both projects afterwards (forces re-login for everyone; schedule for a quiet hour).

## 9. End state

- One branch (`main`), two Vercel projects, two databases.
- Per-gym differences: Vercel env vars (`NEXT_PUBLIC_GYM_THEME_HUE`, `DATABASE_URL`, `NEXTAUTH_URL`, identity vars) + each gym's GymSettings rows. Nothing per-gym in git.
- New gyms join the fleet via `scripts/provision-gym-vercel.sh` (project + env + domain + DB + seed from `main`) plus a matrix entry in `auto-deploy-vercel.yml`.
