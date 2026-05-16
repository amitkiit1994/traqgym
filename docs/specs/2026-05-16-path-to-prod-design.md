# TraqGym — Path to Production Design

**Date:** 2026-05-16
**Author:** Amit + Claude
**Status:** Draft v2 — expanded after security & gap audits

## Audit cross-references

This spec was expanded after two parallel audits found additional gaps:
- Security audit (agent: general-purpose) — surfaced encryption gap, path-traversal, SSRF, CSRF, rate-limiting gaps
- Gap analysis (agent: Explore) — surfaced missing onboarding flow, password reset, error tracking, notifications shell

A third agent (code-reviewer) failed (model unavailable). May rerun on next iteration.

## Goal

Bring TraqGym to a state where:
1. Free Form Fitness (Robin's gym) is a polished showcase running on real, fresh data
2. New gym owner prospects can be onboarded with a believable migration story (give us your v3 fitnessboard credentials → see your full data in TraqGym tomorrow morning)

No fixed deadline. Production-quality over speed.

## Non-Goals

- Razorpay integration (deferred — ship cash/UPI-only mode instead)
- WhatsApp Business bot (Telegram serves the AI conversation use case)
- Multi-currency, multi-language (post-launch)
- Mobile native app polish (Capacitor wrapper exists but not part of this scope)

## Decisions

| Area | Decision | Rationale |
|---|---|---|
| Online payments | **Skip Razorpay; ship cash/UPI-only mode** | Indian gym market predominantly cash + UPI VPA. Razorpay adds compliance burden + cost. Add back only when a real customer asks. |
| Nightly v3 sync host | **GitHub Actions scheduled workflow** | Free, isolated from Vercel function limits, can run for arbitrary number of gyms from one workflow file. |
| v3 credentials storage | **Encrypted in Postgres `GymSettings`, entered via admin UI** | Self-service onboarding. Scales to N gyms with zero per-gym ops work. |
| Decimal data migration | **Local → staging → prod with brief read-only window** | Low risk, well-understood, avoids dual-write complexity at current scale. |
| Secret encryption | **AES-256-GCM via `lib/services/crypto.ts`, key in `DATA_ENCRYPTION_KEY` env** | No encryption helpers exist today; secrets in `GymSettings` are plaintext. Must build before storing v3 creds. |
| Inter-instance API auth | **Shared secret in env + HMAC signature** | Simpler than JWT, sufficient for current threat model, can upgrade later. |
| Gym discovery for GH Action | **Hard-coded list in workflow YAML** | Fine for ≤10 gyms; refactor to central registry endpoint when N grows. |
| Error tracking | **Sentry** (free tier sufficient initially) | Industry standard, easy Next.js integration, alerts to Telegram. |
| Rate limiting | **In-memory `lib/services/ratelimit.ts` for v1; pluggable interface for Redis later** | Single-instance deployment per gym means in-memory is sufficient. Clean interface lets us swap to Upstash/Redis when we go multi-instance. |

## Phase 1 — Repo cleanup

### What gets deleted

**Parent dir `/Users/amitkumardas/freeformOS/`:**
- 27 stray PNGs (egym screenshots, traqgym screenshots, mobile UI captures)
- `fb-vs-traqgym-comparison.md` (one-off comparison doc, no longer relevant)
- `worktrees/` (124MB stale dev worktrees)

Review-then-decide:
- `FreeFormOSMemory/` (28KB) — keep if it has useful notes; delete if empty/stale
- `competitor-data-export` symlink — already points to `freeformfitnessOS/freeformfitness-data-export/`; keep

**Inside `freeformfitnessOS/`:**
- `_audit_EGYM_math_mismatch.csv`, `_audit_EGYM_write_offs.csv` (root-level audit artifacts) → move to `docs/audits/` or delete
- `out/` build artifact directory (regenerated)
- `tsconfig.tsbuildinfo` (regenerated)
- `.playwright-mcp/` cache (89 entries from old Playwright sessions — already in .gitignore but on disk)
- Consolidate `freeformfitness-data-export/` (April 11 baseline) and `freeformfitness-data-export-fresh/` (today) — keep the fresh one as canonical, archive April or delete

### Hygiene additions to `.gitignore`

```
# Local data exports + audits — never commit
freeformfitness-data-export*/
egymlokhandwala-data-export/
*_audit_*.csv

# Playwright cache
.playwright-mcp/

# Stray screenshots in parent dir (caught at commit time)
*.png
!public/**/*.png
!landing/public/**/*.png
```

## Phase 2 — Nightly v3 sync pipeline

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ GitHub Actions (scheduled, 03:00 IST nightly)              │
│                                                             │
│  1. Fetch list of "v3-sync-enabled" gyms via API           │
│     GET https://traqgym.com/api/internal/gyms-with-v3-sync │
│     Auth: shared secret (GH Secret)                         │
│                                                             │
│  2. For each gym, fetch encrypted v3 creds from gym's DB   │
│     GET https://{gym-subdomain}.traqgym.com/api/internal/  │
│         v3-credentials                                      │
│     Auth: shared secret + gym-id                            │
│                                                             │
│  3. Login to v3.fitnessboard.in with creds                 │
│  4. Run fetch_complete.py → JSON payloads                  │
│  5. POST results to gym's TraqGym instance                 │
│     POST https://{gym-subdomain}.traqgym.com/api/internal/ │
│          v3-sync                                            │
│     Body: { dataset, rows[] }                              │
│  6. TraqGym instance upserts into its Postgres             │
│  7. On failure → notify gym's Telegram bot (if enabled)    │
└─────────────────────────────────────────────────────────────┘
```

### Components

**`.github/workflows/v3-sync-nightly.yml`**
- Triggered by cron `0 21 * * *` UTC (= 02:30 IST)
- Sets up Python 3, runs `scripts/v3-sync/run.py`
- One workflow run iterates all gyms (small N initially; can shard later)

**`scripts/v3-sync/run.py`** (new — extracted from this session's `fetch_complete.py`)
- Entry point: discover gyms → loop → sync each
- Internal modules: `fetch.py`, `parse.py`, `push.py`

**API routes (new):**
- `app/api/internal/gyms-with-v3-sync/route.ts` — central list endpoint (lives at `traqgym.com` central deployment, OR replaced by env-config of gym subdomains)
- `app/api/internal/v3-credentials/route.ts` — per-gym, returns decrypted v3 creds
- `app/api/internal/v3-sync/route.ts` — per-gym, accepts dataset upserts

**Schema changes:**
- New `GymSettings` keys: `v3_fitnessboard_mobile`, `v3_fitnessboard_password_encrypted`, `v3_sync_enabled`, `v3_last_sync_at`, `v3_last_sync_status`
- Encryption: use `node:crypto` AES-256-GCM with key from `V3_CREDS_ENCRYPTION_KEY` env var (per-instance)

### UI changes
- New page `/admin/settings/integrations/fitnessboard`:
  - Toggle: "Sync from FitnessBoard v3 nightly"
  - Mobile + Password fields
  - "Test connection" button → posts to `/api/admin/v3-test-login`
  - Last sync time + status
  - "Run sync now" button (admin-triggered manual sync)

### Sync semantics
- **Idempotent.** Always full re-fetch from v3 (small data volumes, ~10MB per gym), upsert by stable keys (`MemberId`, `BillNo`).
- **Conflict resolution:** v3 is the source-of-truth for migration period. TraqGym local-only records (manually added in TraqGym after v3 was decommissioned) are protected by checking a `source` field (`v3` vs `traqgym`).
- **Schema drift:** if v3 returns unexpected columns, log warning + skip the dataset (don't break the run).

### Failure handling
- HTTP error from v3 → retry up to 3 times with backoff
- Cookie expired mid-run → re-login once
- v3 server 500 (known to happen with wide date ranges) → fall back to year-by-year
- Catastrophic failure → record `v3_last_sync_status: "failed: <reason>"`, send Telegram alert if bot is configured for this gym

### Costs
- GitHub Actions: free tier (~2000 min/mo) — sync of 5 gyms × ~10 min/gym × 30 days = 1500 min, fits comfortably
- Network: negligible

## Phase 2.5 — Foundation hardening (NEW — must precede Phase 2)

**Why this exists:** the security audit discovered there are NO encryption helpers in the codebase. Existing secrets in `GymSettings` (smtp_pass, msg91_auth_key, biomax_sdk_api_key, telegram_webhook_secret) are stored in plaintext today. We must build encryption infra **before** Phase 2 lands v3 credentials.

### Steps

1. **Build `lib/services/crypto.ts`**
   - `encrypt(plaintext: string): string` — returns `iv:tag:ciphertext` (hex)
   - `decrypt(ciphertext: string): string`
   - Uses `node:crypto` AES-256-GCM
   - Key from `process.env.DATA_ENCRYPTION_KEY` (32 bytes base64)
   - Fail-fast at boot if key missing in production

2. **Migrate existing plaintext secrets**
   - Add migration script `scripts/encrypt-existing-secrets.ts`
   - For each gym DB: read each plaintext secret, encrypt, write back, log changes
   - Idempotent (skip if already ciphertext-format)

3. **Update `lib/services/settings.ts`**
   - `setSetting()` for encrypted-keys whitelist → encrypt before write
   - `getSetting()` for encrypted-keys whitelist → decrypt after read
   - Whitelist: `smtp_pass`, `msg91_auth_key`, `biomax_sdk_api_key`, `telegram_webhook_secret`, `telegram_bot_token`, `v3_fitnessboard_password`, `razorpay_key_secret` (future)

4. **Add `DATA_ENCRYPTION_KEY` to all environment configs**
   - Generate per-instance via `openssl rand -base64 32`
   - Store in Vercel env (per project) and `.env.example`

**Risk:** medium. Migration must run cleanly across all gym DBs. Have backup before running.

**Estimate:** 1 day.

## Phase 3 — Three production fixes

### 3a. Float → Decimal financial bug

**Problem:** `MemberTicket.amountPaid` and `balanceDue` are `Float` in `prisma/schema.prisma`. Floating-point arithmetic accumulates rounding errors → phantom ₹0.000001 balances → false followup notifications. Documented in `tests/bugs/financial-bugs.test.ts` lines 55-71.

**Fix steps:**
1. Add Prisma migration: `MemberTicket.amountPaid` and `balanceDue` → `Decimal(10, 2)`
2. Backfill script: recompute `amountPaid = SUM(payments where ticketId = X)` and `balanceDue = totalAmount - amountPaid` for all existing tickets
3. Update all calling code:
   - `lib/services/partial-payment.ts` line 23-24
   - `lib/services/gift-cards.ts` line 69
   - Any service using these fields — convert from `Number()` arithmetic to `Prisma.Decimal` arithmetic
4. Tests pass (financial-bugs.test.ts already has cases — change them from `it.todo` to `it`)

**Rollout (per gym):**
1. Test on local DB
2. Run on E-GYM staging (the bigger dataset)
3. Brief read-only window on freeform prod, run migration, verify, lift read-only

**Risk:** ~30 min read-only window per gym. Backfill script must handle nulls and edge cases (gift-card-paid tickets, freeze-adjusted tickets).

### 3b. Cash/UPI-only mode (replaces Razorpay scope)

**Problem:** `lib/services/razorpay.ts` returns mock `stub_*` data when `RAZORPAY_KEY_ID` is unset. Users see online-payment UI but it doesn't work.

**Fix:**
1. Add `GymSettings` flag: `payment_modes_enabled` = `["cash", "upi", "card"]` (or subset)
2. UI: hide "Pay Online" button + Razorpay-related flows when flag doesn't include digital methods
3. Remove the `stub_` placeholders from `razorpay.ts` — replace with explicit `throw new ConfigurationError("Razorpay not configured for this gym")` so it can never silently mock data
4. New gym onboarding: defaults to `["cash", "upi"]` only

**Risk:** Low. Removes broken functionality cleanly.

### 3c. Telegram one-click setup

**Problem:** Telegram bot is fully built (1,002-line webhook) but requires 4-step manual config. Most gym owners won't do this.

**Fix:** Streamline to 2 steps for the gym admin:
1. Admin opens `/admin/settings/integrations/telegram`
2. Pastes bot token from @BotFather (we provide a 1-paragraph guide on the page with @BotFather link)
3. Backend automatically:
   - Validates token via Telegram `getMe`
   - Stores in `GymSettings.telegram_bot_token` (env-prefixed if not in Vercel)
   - Calls Telegram `setWebhook` → `https://{gym}.traqgym.com/api/webhook/telegram`
   - Generates a 6-char pair code, displays it on screen
4. Owner opens the bot in Telegram → sends `/pair <code>` → done

**Implementation:**
- New page `/admin/settings/integrations/telegram`
- New action `lib/actions/telegram-setup.ts` (separate from existing `telegram.ts`)
- Existing webhook handler unchanged

**Risk:** Low. All AI tooling already wired.

## Phase 5 — Security & ops basics (NEW)

Findings from the security audit. None individually catastrophic, but collectively any one of them surfacing during a demo or after onboarding a real gym would erode trust.

### 5a. Authorization fixes
- **`/api/people` cross-tenant leak** (`app/api/people/route.ts:11-20`) — currently returns ALL members to ANY worker. Scope by `session.user.locationId` for non-admin. Add pagination.
- **`/api/upi-qr` unauthenticated** (`app/api/upi-qr/route.ts`) — anyone can generate UPI QR for any amount/name → invoice fraud. Require session + scope to session member.
- **Invoice PDF route worker access** (`app/api/invoices/[id]/pdf/route.ts:69-73`) — verify staff can only see invoices for their assigned location.

### 5b. Input validation
- **Path traversal in logo upload** (`app/api/admin/logo/route.ts:42-47`) — sanitize filename, whitelist extensions from MIME, use `randomUUID()`. Migrate uploads off Vercel disk → use object storage (Vercel Blob or S3).
- **SSRF in BioMax** (`lib/services/biometric.ts:218-268`) — DNS-resolve URL, block RFC1918/localhost/link-local before fetch.

### 5c. Auth hardening
- **NextAuth fail-fast** (`lib/auth.ts:6-128`) — throw on boot if `NEXTAUTH_SECRET` is unset or matches `.env.example` placeholder when `NODE_ENV === "production"`. Add explicit `cookies` config with `Secure/SameSite`.
- **Rate limiting** (`lib/services/ratelimit.ts` — NEW) — wrap auth endpoints (login, OTP, password reset) and admin endpoints. Per-IP (5/min for auth) and per-account (10/hour). In-memory backed for v1.
- **CSRF Origin/Host check** — kiosk endpoint (`app/api/kiosk/checkin/route.ts:19-37`) does this correctly. Extract to middleware, apply to all `/api/admin/*` POST routes.

### 5d. Telegram pair code strength
- Lengthen pair code from 8 hex chars (32 bits) → 16 hex chars (64 bits). Rate-limit `/pair` failures per chatId (5/day → silent drop). `lib/channels/telegram.ts:300-304`.

### 5e. Observability
- **Sentry integration** — install `@sentry/nextjs`, configure DSN per gym project, wrap server actions and API routes. Source maps uploaded on build.
- **Cron health checks** — log start/end/status of each cron run to a `CronExecution` table; surface in `/admin/audit`.

### 5f. Backup/restore
- **Add `scripts/restore.sh`** — pair to existing `backup.sh`. Streams gzip → psql with confirmation prompts.
- **Test restore quarterly** — add a calendar reminder, document procedure.

### 5g. Notifications wiring
- **Build `lib/services/notification.ts`** — currently a shell. Methods: `sendSMS()` (MSG91), `sendEmail()` (nodemailer + SMTP env), `sendWhatsApp()` (MSG91 WA), `sendTelegram()` (uses existing channel).
- **Wire into renewal reminders, balance reminders, manager briefings** — these currently log-only or no-op.

**Estimate:** 2 days.

## Phase 6 — Onboarding + UX gaps (NEW)

### 6a. Gym owner self-serve signup
**Currently:** new gym onboarding is a manual run of `scripts/onboard-gym.sh` with 3 required + 22 optional flags. No prospect-facing way to sign up.

**Build:**
- `/signup` route on `traqgym.com` (landing site): collect gym name, owner email, phone, location, GSTIN
- `/api/signup` action on landing → adds row to a central `PendingGymProvisioning` table (lives at `traqgym.com` or a small ops Postgres)
- Async provisioning worker (could be GitHub Action triggered on new row, or manual approval first) that runs `onboard-gym.sh` with collected fields
- Confirmation email to owner with subdomain URL + admin login

**Estimate:** 1 day.

### 6b. Password reset / OTP flow
**Currently:** missing. Forgot-password = manual ops.

**Build:**
- `/forgot-password` page → email/phone input
- `/api/auth/password-reset/request` → generate OTP, store hashed in `PasswordResetToken` table with 15min TTL, send via SMS (MSG91) or email
- `/reset-password?token=...` page → verify OTP, set new bcrypt-hashed password
- Rate-limited (1 request per email/min, 5/hour)

**Estimate:** half day.

### 6c. Mobile admin sidebar drawer
**Currently:** `components/admin-sidebar.tsx` is fixed-vertical, eats half the screen on phones.

**Build:**
- Below `lg` breakpoint: hamburger button in top bar → off-canvas drawer with backdrop
- Existing collapsed state (56px) stays for tablet/desktop
- Test on iPhone Safari, Android Chrome

**Estimate:** half day.

### 6d. Empty states
**Currently:** dashboard with no members shows blank charts; lists show empty tables; new gyms look broken.

**Build:**
- New `components/empty-state.tsx` — icon + heading + body + CTA button
- Wire into: dashboard charts (when 0 members), members list, plans list, attendance list, payments list
- Each empty state has a sensible CTA: "Add your first member", "Create a plan", etc.

**Estimate:** half day.

**Phase 6 total estimate:** 2.5 days.

## Phase 4 — Robin's instance polish + demo prep

### Steps
1. **Run nightly v3 sync once manually** for Free Form Fitness — verify all data flows in correctly
2. **Spot-check the AI bot** — pair Robin's Telegram, ask the 3 sample questions we computed in this session ("PT collected last week", "expired memberships", "renewal calls") — verify AI returns same numbers
3. **Audit Robin's `/admin/dashboard`** — confirm KPI tiles, recent activity, churn signals all populate with real numbers
4. **Pre-seed any demo content** — if any pages look thin (e.g., empty announcements), populate with realistic content
5. **Write 1-page demo script** — sequence of 8-10 clicks/messages that walks a prospect through the value prop in 5 min

### Deliverable
- `docs/demo/2026-05-pitch-script.md` — the demo script
- A clean recording (loom or similar) for async pitches

## Sequencing & Dependencies

```
Phase 1 (cleanup) ──────────┐
                            │
Phase 2.5 (encryption) ─────┼──┐
                            │  │
                            │  ├──→ Phase 2 (pipeline) ──┐
                            │  │                          │
Phase 3a (Decimal) ─────────┤  │                          │
Phase 3b (cash mode) ───────┤  │                          ├──→ Phase 4 (polish + demo)
Phase 3c (Telegram) ────────┤  │                          │
                            │  │                          │
Phase 5 (security/ops) ─────┤──┘                          │
Phase 6 (UX/onboarding) ────┤                             │
                            │                             │
                            └─────────────────────────────┘
```

**Critical path:** Phase 1 → Phase 2.5 → Phase 2 → Phase 4
**Parallel-runnable:** Phase 3a/b/c, Phase 5, Phase 6 can all run alongside Phase 2 once 2.5 is done.

## Estimates (calendar time)

| Phase | Effort | Why |
|---|---:|---|
| Phase 1 — Cleanup | 1-2 hours | Mostly mechanical, plus .gitignore tightening |
| Phase 2.5 — Encryption infra | 1 day | New crypto service + migrate plaintext secrets + tests |
| Phase 2 — V3 sync pipeline | 1.5-2 days | New API endpoints + GitHub workflow + admin UI + tests |
| Phase 3a — Decimal | 1 day | Prisma migration + backfill + test on staging + prod cutover |
| Phase 3b — Cash mode | half day | UI toggle + remove stubs + a few tests |
| Phase 3c — Telegram one-click | half day | New admin page + setWebhook automation |
| Phase 5 — Security/ops | 2 days | Auth fixes + rate limiting + Sentry + restore script + notifications wiring |
| Phase 6 — Onboarding/UX | 2.5 days | Signup flow + password reset + mobile drawer + empty states |
| Phase 4 — Polish + demo | half day | Sync run + spot-check + demo script |
| **Total sequential** | **~10-12 working days** | |
| **Total parallelized** | **~6-7 days** | If we run Phase 3+5+6 alongside Phase 2 |

## Risks & open questions

1. **`api/internal/*` security model** — the inter-instance API endpoints (called by GitHub Action) need a hardened auth model. Current proposal: shared secret in env. Better: signed JWT with short TTL. **Decision needed before Phase 2 implementation.**
2. **Multi-instance gym discovery** — how does the GH Action know which subdomains exist? Either:
   - Hard-coded list in workflow YAML (simple, works for ≤10 gyms)
   - Central registry endpoint at `traqgym.com` (requires the landing site to host the list)
   - Decision: start with hard-coded, refactor later when N>5
3. **v3 cookie persistence across runs** — currently we re-login each run. Cheap and reliable. No optimization needed.
4. **TraqGym Decimal arithmetic conventions** — code currently uses `Number()` arithmetic in many places. Audit needed to convert to `Prisma.Decimal` consistently. Could be larger than estimated.

## Out of scope (deferred)

- Razorpay integration (revisit when first paying customer asks)
- WhatsApp Business bot
- Multi-tenant single-instance architecture (current per-gym Vercel project model is fine for first 10-20 gyms)
- Real-time biometric integration (CSV import works for now)
- Mobile app polish
