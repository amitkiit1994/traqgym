# TraqGym Path-to-Production — Master Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each phase's plan task-by-task. Each phase has its own plan file.

**Goal:** Bring TraqGym to production-ready for gym owner demos (Robin as proof + new prospects). 6 phases, ~10-12 days sequential / ~6-7 parallelized.

**Source spec:** `docs/specs/2026-05-16-path-to-prod-design.md` (commit `9e9d20d`)

**Tech stack:** Next.js 16 (App Router), Postgres 16 (Railway per gym), Prisma 6, NextAuth v4, OpenAI agent SDK, shadcn/ui (Base UI), Vercel deploy, GitHub Actions for sync pipeline

---

## Phase Index

| # | Phase | Status | Commits |
|---|---|---|---|
| 1 | Repo cleanup | ✅ DONE | `1641ea6` |
| 2.5 | Encryption foundation | ✅ DONE | `3adef8f`, `2474724`, `be8d716`, `bc34949` |
| 3b | Cash/UPI-only mode | ✅ DONE | `3b75472`, `7532bec` |
| 3c | Telegram one-click setup | ✅ DONE | `0ce5259`, `a97f763` |
| 5a/5b/5c/5g | Security core (authz, validation, NextAuth, notifications) | ✅ DONE | `01f9905`, `c542732`, `b6d735d`, `b4dfd39`, `ab18ae1` |
| 6b/6c/6d | Password reset + mobile drawer (already existed) + empty states | ✅ DONE | `7b1facf`, `087eafc` |
| 2 | V3 nightly sync pipeline | ✅ DONE | `ec66925`, `46f6d8a`, `3467622` |
| Build fix | `/kiosk` made dynamic | ✅ DONE | `a205329` |
| 5 — rate limiting | In-memory limiter + wired to password reset | ✅ DONE | `2b797af` |
| 5d | Telegram pair code 8→16 hex + per-chatId throttle | ✅ DONE | `d09adfe` |
| 5 — CSRF | `lib/services/csrf.ts` helper (wiring still TODO) | ✅ DONE | `b595100` |
| 6a | Gym owner self-serve signup at `/signup` | ✅ DONE | `0d9038c`, `294234e`, `8014c43`, `b6dd7be`, `6ab7445` |
| 3a | Float→Decimal — schema + caller code + backfill script | ✅ CODE DONE; ⚠️ DB cutover pending | `b6dd7be`, `b5d0f9e`, `c61e4e4`, `0d8786b`, `5224f92` |
| 5e | Sentry observability (DSN-gated) | ✅ DONE | `2a1b65a` |
| 5f | `scripts/restore.sh` | ✅ DONE | `7bfe8ca` |
| 4 | Robin polish + demo prep | ✅ Demo script written. Live sync run + AI spot-check pending (operational, needs Robin) | doc + `5963288` |

## Operational state (2026-05-17 autonomous run)

### Done autonomously
- ✅ `DATA_ENCRYPTION_KEY` set on both Vercel projects (`traqgym-app`, `traqgym-egym`) via `openssl rand -base64 32`
- ✅ `INTERNAL_API_SECRET` set on both Vercel projects + mirrored to GitHub Secrets (`INTERNAL_API_SECRET_FREEFORM`, `INTERNAL_API_SECRET_EGYM`) for the GH Actions sync workflow
- ✅ `NEXTAUTH_SECRET` rotated on `traqgym-egym` (was the literal `CHANGE-ME-egym-secret-key-2026` placeholder — caught by Phase 5c fail-fast guard during redeploy)
- ✅ Both Vercel projects redeployed with new env vars
- ✅ `scripts/encrypt-existing-secrets.ts` run against both gym DBs (both had no plaintext secrets — clean migration)
- ✅ v3 fitnessboard credentials seeded into both gym DBs (mobile plaintext, password AES-256-GCM encrypted, sync enabled)
- ✅ Internal API verified end-to-end on both gyms: `POST /api/internal/v3-credentials` with bearer auth returns decrypted creds (HTTP 200)
- ✅ CSRF `checkOrigin()` guard wired into all 7 state-mutating `/api/admin/*` POST/DELETE routes
- ✅ Runtime defense added: `requireInternalSecret` now `.trim()`s env values (defends against Vercel CLI's `echo`-induced trailing `\n`)
- ✅ `/kiosk` page made dynamic — build no longer fails on DB unreachable

### Still pending (cannot be done autonomously)

1. **Phase 3a DB cutover** — backup → snapshot sums → `prisma migrate deploy` → run `scripts/backfill-decimal-amounts.ts --apply` → verify → lift read-only. Schema may already be Decimal on prod (verified in the spec write-up); if so the script is a no-op safety net. ~15-30 min per gym during off-hours.
2. **First v3 sync run** — nightly cron at 02:30 IST will trigger automatically. To validate sooner, manually trigger via `gh workflow run v3-sync-nightly.yml`.
3. **Pair Robin's Telegram** — Robin must (a) get a bot token from @BotFather, (b) paste it into `/admin/settings/integrations/telegram` on his deployed gym, (c) send `/pair <code>` to the bot from his phone.
4. **Sentry projects + DSN env vars** — create projects at sentry.io, then set `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` on both Vercel projects. SDK is inert until DSN present.
5. **9 npm audit advisories** from Sentry transitive deps — `npm audit` to review, `npm audit fix --force` if comfortable with major bumps.

## Known caveats from autonomous execution

- Two parallel agents had a staging race — `lib/services/partial-payment.ts` Decimal refactor landed in commit `b6dd7be` (which has a "signup tests" message). Commit boundary is off; the code itself is correct.
- 3 pre-existing test failures in `tests/unit/ux-components.test.ts` predate this work; not addressed.
- npm audit shows 9 advisories from Sentry transitive deps (1 low, 5 moderate, 3 high). `npm audit fix --force` would shift majors; left for user judgment.
- Rate limiter is in-memory per-process — on Vercel with multiple lambdas, effective limit scales with N lambdas. Redis swap is the right next step.

*JIT = plan written just-in-time before the phase starts, so file references and code snippets are accurate.*

---

## Execution Order

### Wave 1 — Foundation (must finish first)
- Phase 1 (cleanup)
- Phase 2.5 (encryption foundation)

### Wave 2 — Parallel build (after wave 1)
Can be assigned to different sessions or executed sequentially:
- Phase 2 (v3 sync pipeline)
- Phase 3a (Decimal)
- Phase 3b (cash mode)
- Phase 3c (Telegram one-click)
- Phase 5 (security/ops)
- Phase 6 (onboarding/UX)

### Wave 3 — Finalization
- Phase 4 (Robin's instance polish + demo dry-run)

---

## When to write each detailed plan

| Trigger | Action |
|---|---|
| Before starting any phase in Wave 1 | Already done for Phase 1. Phase 2.5 plan needed once Phase 1 ships. |
| Before starting any Wave 2 phase | Write that phase's detailed plan as the next session's first task. |
| Before Wave 3 | Write Phase 4 plan. |

**Why JIT:** code references stay accurate. Lessons from earlier phases (e.g., what `encrypt()` signature ended up looking like in Phase 2.5) inform later phases (Phase 2 uses it). Plans don't go stale on the shelf.

---

## Phase Summaries

### Phase 1 — Repo cleanup
Delete 27 stray PNGs in parent dir, `worktrees/` (124MB), audit CSVs, `out/`, `.playwright-mcp/`. Consolidate two `freeformfitness-data-export*/` dirs. Tighten `.gitignore` to prevent future cruft. Verify `npm run build` still passes. **Net result:** 1.8GB → ~few hundred MB, cleaner repo for new contributors.

### Phase 2.5 — Encryption foundation
Build `lib/services/crypto.ts` (AES-256-GCM). Migrate existing plaintext secrets in `GymSettings` table (`smtp_pass`, `msg91_auth_key`, `biomax_sdk_api_key`, `telegram_webhook_secret`) to ciphertext. Add `DATA_ENCRYPTION_KEY` env var. Wrap `setSetting/getSetting` to auto-encrypt/decrypt whitelisted keys. **Why before Phase 2:** v3 fitnessboard passwords will live here.

### Phase 2 — V3 nightly sync pipeline
New `/admin/settings/integrations/fitnessboard` page where admin enters v3 mobile + password (now safely encrypted). GitHub Actions workflow at `.github/workflows/v3-sync-nightly.yml` runs nightly: discovers gyms with v3 sync enabled, fetches creds via `/api/internal/v3-credentials`, logs into v3.fitnessboard.in, runs the export pipeline (extracted from this session's `fetch_complete.py`), POSTs upserts to `/api/internal/v3-sync`. Idempotent per `MemberId/BillNo`. Failure → Telegram alert.

### Phase 3a — Float → Decimal migration
Prisma migration converts `MemberTicket.amountPaid` and `balanceDue` from Float to Decimal(10,2). Backfill script recomputes from `Payment` table. Update calling code (`lib/services/partial-payment.ts`, `gift-cards.ts`, etc.) to use `Prisma.Decimal` arithmetic. Tests in `tests/bugs/financial-bugs.test.ts` go from skipped to active. Roll out: local → E-GYM staging → freeform prod with 30-min read-only window.

### Phase 3b — Cash/UPI-only mode
Add `payment_modes_enabled` to `GymSettings` (default `["cash", "upi"]`). UI hides "Pay Online" + Razorpay flows when digital methods absent. Remove `stub_*` placeholders from `lib/services/razorpay.ts` — replace with explicit `ConfigurationError` so never silently mock.

### Phase 3c — Telegram one-click setup
New `/admin/settings/integrations/telegram` page. Admin pastes bot token from @BotFather → backend validates via Telegram `getMe`, stores encrypted in `GymSettings`, calls `setWebhook`, generates 6-char pair code. Owner sends `/pair <code>` to bot → done. Existing webhook handler unchanged.

### Phase 5 — Security & ops basics
Multiple sub-items (executed within one plan):
- 5a Authorization fixes: scope `/api/people` to location for non-admins; require auth on `/api/upi-qr`; staff scoping on invoice PDF route
- 5b Input validation: path-traversal fix in `/api/admin/logo`; SSRF guards in BioMax
- 5c Auth hardening: NextAuth fail-fast secret guard; rate limiting middleware (`lib/services/ratelimit.ts`); CSRF Origin/Host check on `/api/admin/*` POST
- 5d Telegram pair code: 8 hex → 16 hex, rate-limit `/pair` failures per chatId
- 5e Sentry integration with source maps
- 5f `scripts/restore.sh`; quarterly test reminder
- 5g `lib/services/notification.ts` (MSG91 SMS, SMTP email, MSG91 WhatsApp, Telegram channel)

### Phase 6 — Onboarding + UX gaps
- 6a Gym owner signup at `traqgym.com/signup` → `PendingGymProvisioning` table → async provisioning via `onboard-gym.sh`
- 6b Password reset / OTP flow at `/forgot-password` + `/reset-password`
- 6c Mobile admin sidebar drawer (hamburger below `lg`)
- 6d Empty states component + wire into dashboard/lists

### Phase 4 — Robin's instance polish + demo prep
Run v3 sync once manually on freeform → verify all data present. Pair Robin's Telegram, run 3 sample questions through AI, verify outputs match this session's computed numbers. Audit dashboard tiles. Write demo script (`docs/demo/2026-05-pitch-script.md`).

---

## Open Risks / Watch Items

1. **Inter-instance API auth strength** — currently planned: shared HMAC secret in env. If we onboard more than a few gyms, upgrade to short-TTL signed JWTs.
2. **Gym discovery for GH Action** — hard-coded list initially (just freeform + egym). Refactor to central registry endpoint when N > 5.
3. **Decimal migration concurrency** — backfill script runs in transactions; if a payment lands mid-backfill, recompute could miss it. Take brief read-only window during prod cutover.
4. **GH Action secrets** — the workflow needs HMAC secret + per-gym subdomains. Store in GH Secrets initially; revisit when adding 6th gym.

---

## How to use this roadmap

1. **Start with Phase 1 plan** (already written) — `docs/plans/2026-05-16-phase1-cleanup.md`
2. **After each phase completes** — write the next phase's detail plan (instructions in each phase's "Next phase plan trigger" section)
3. **Update this file** — change the Status column as phases ship
4. **Track decisions in the spec** — if a phase's implementation reveals a design issue, update the spec first, then re-write the affected phase plan
