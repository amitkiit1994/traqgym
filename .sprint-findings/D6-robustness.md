# D6 Robustness Findings — 2026-04-19

Audit scope: 16 shipped PRs (comp, approvals, insights, pt, payment-schedule, upgrade,
refund, cash-shift, joining-fee, multi-location, locker-key, feedback, attendance late-entry,
member-transfer, tally-export, gstr1-export, qr-checkin, manager, telegram).
Mode: read-only, schema frozen. Findings anchor to file:line.

> Output path note: target `/Users/amitkumardas/.claude/plans/sprint-findings/D6-robustness.md`
> was unwritable (Write permission denied for that directory tree, even though other
> agents have written into `/Users/amitkumardas/.claude/plans/`). Saved here in the
> integration worktree under `.sprint-findings/`. Orchestrator: please `mv` the file
> into the canonical sprint-findings directory.

---

## Critical (must fix before any meaningful production traffic)

### R01 — `cash-shift.openShift` TOCTOU lets two open shifts coexist per location
- File: `lib/services/cash-shift.ts:129-169`
- Failure scenario: Two staff tap "Open shift" within the same second on the POS at one location. Both `findFirst` queries (line 129) return null because no shift exists yet. Both then enter the `$transaction` and successfully create two `CashShift` rows with `status="open"` for the same `locationId`. Every subsequent `recordMovement` / `closeShift` call must guess which shift is active; cash variance reports for the day will be wrong and unfixable without manual SQL.
- Severity: critical
- Suggested fix: Wrap the existence check + create inside the same transaction at SERIALIZABLE isolation, or — preferred — add a partial unique index on `CashShift(locationId) WHERE status IN ('open','pending_approval')` (DDL change → flag for next schema window). Until then, in-process: `await prisma.$transaction(async (tx) => { const dup = await tx.cashShift.findFirst({ where:{locationId, status:{in:["open","pending_approval"]}}}); if (dup) throw…; return tx.cashShift.create(…); }, { isolationLevel: "Serializable" })`.
- Effort: small (code), medium if partial unique index is added later.

### R02 — `payment-schedule.recordInstallmentPayment` double-debits balanceDue under concurrent payments
- File: `lib/services/payment-schedule.ts:125-263` (key reads at 174 and 206, writes inside txn at 218-260)
- Failure scenario: Front-desk staff and online member portal both submit a partial payment for the same installment within the same second. Both reads see `installment.paidAmount = 0` and `ticket.balanceDue = 5000`. Both transactions compute `newPaidOnInstallment = 0 + amount` and `newBalanceDue = 5000 - amount`, then write. Result: only the second write's deltas survive, but **two `Payment` rows persist** while the ticket only got debited once → ticket balance is wrong, P&L overstates collection, member sees 2 receipts but installment shows half-paid.
- Severity: critical
- Suggested fix: Move both reads inside the same `prisma.$transaction(...)` and either (a) re-read `installment` and `ticket` inside the txn under `SELECT … FOR UPDATE` via `tx.$queryRaw`, or (b) use Prisma `update` with conditional `where: { id, paidAmount: previouslyReadValue }` and roll back on count=0. Compute the new totals server-side from the just-read row, never from a value captured outside the txn.
- Effort: medium

### R03 — `manager` magic-link confirm allows double-execution under concurrent clicks
- File: `app/m/a/[token]/confirm/route.ts:124-191`
- Failure scenario: Owner taps the same WhatsApp/email "Send recovery message" button twice (or it gets force-tapped on a flaky network and again on retry). Two requests verify the HMAC at the same time, both find `dismissedAt = null` at line 140, both call `executeInsightAction(...)` at line 165 (which is itself non-atomic — see R06), then both update `dismissedAt`. The member receives two recovery WhatsApps; the gym pays twice; audit log shows two "success" rows seconds apart.
- Severity: critical
- Suggested fix: Add a `usedAt` / `noncedAt` column to `Insight` (or a sibling `MagicLinkUse` row keyed by token jti) and bump it inside an atomic claim — `update where insightId = X and dismissedAt is null` returning count; if count=0, render "already done". Alternative without schema change: do the dismiss-update as the first write inside a txn and only execute the action if the update count was 1.
- Effort: small (logic only, no schema if dismiss-first ordering is acceptable)

### R04 — `refund.requestRefund` allows stacked refund requests after a partial processed
- File: `lib/services/refund.ts:102-221` (gating check at line 140)
- Failure scenario: Member paid ₹5000, gets a ₹2000 refund (request → approve → process; status `processed`). They request another ₹4000 refund. The pending check only blocks `status in ("pending","approved")` — it ignores `processed`. The new request is created and approved, total refunded ₹6000 vs ₹5000 paid. Cash drawer + Tally export show negative member balance but no constraint stopped it.
- Severity: critical
- Suggested fix: Compute `alreadyRefunded = sum(amount where paymentId = X and status = 'processed')` and reject if `alreadyRefunded + requestedAmount > payment.amount`. Add inside the same txn that creates the new RefundRequest. No schema change needed.
- Effort: small

### R05 — `member-transfer` double-counts revenue between source and destination gyms
- File: `lib/services/member-transfer.ts:70-86`
- Failure scenario: Member transferred from Free Form Andheri → E-GYM Lokhandwala. Code copies the source ticket's `totalAmount`, `amountPaid`, `balanceDue` onto a brand-new destination ticket but does **not** create a corresponding `Payment` row at the destination, and does **not** zero/close the source ticket's payments. P&L at the source still shows the original ₹15,000 collected; P&L at destination now shows the same ₹15,000 as `amountPaid` but with no payment row backing it. GSTR-1 + Tally exports diverge from Prisma.
- Severity: critical (financial integrity; cross-instance reporting unreliable)
- Suggested fix: On transfer, either (a) create a `transfer_in` zero-rupee Payment row at destination with reference back to source ticket id, and a `transfer_out` audit-only entry at source, or (b) snapshot `amountPaid` to 0 on destination and require members to re-pay (not desirable). Document choice in code comment + audit log.
- Effort: medium

### R06 — `insight.executeInsightAction` is not atomic with dismissal
- File: `lib/services/insight.ts` (whole `executeInsightAction` body); callers at `app/m/a/[token]/confirm/route.ts:165` and `app/api/webhook/telegram/route.ts:502-583`
- Failure scenario: The action whitelist (e.g. `member.send_recovery_message`) executes side-effects (WhatsApp/email/SMS) before the caller flips `dismissedAt`. Combined with R03 and R07, any duplicate trigger (retry, double-tap, Telegram callback retry) re-fires the side-effect.
- Severity: critical
- Suggested fix: Make `executeInsightAction` itself the dismissal authority — accept `executedById`, atomically `prisma.insight.update({ where:{ id, dismissedAt: null }, data:{ dismissedAt: new Date(), dismissedById }})` first, then dispatch the side-effect only if Prisma reports update count = 1. If side-effect throws, re-open via best-effort.
- Effort: small

### R07 — Telegram webhook lacks `update_id` deduplication
- File: `app/api/webhook/telegram/route.ts` (callback handler around 502-583, message handler higher up)
- Failure scenario: Telegram retries the same update on transient 5xx (and on connection drops) for up to 24h. Without storing seen `update_id`s, the same callback "Send recovery message" or voice transcript can be processed twice across an instance restart or a slow function. Compounds R06.
- Severity: critical
- Suggested fix: Persist `update_id` in a small dedupe table (or reuse `InsightDelivery` with a unique compound key), and short-circuit if the row already exists. Use `prisma.create` with `@@unique([source, externalId])` and catch P2002 → 200 OK no-op.
- Effort: small (one new table) — if schema is frozen this sprint, fall back to a TTL in-memory LRU keyed by `update_id` for partial mitigation, with TODO for table.

---

## High

### R08 — `pt.completePtSession` race overshoots `sessionsTotal`
- File: `lib/services/pt.ts:188-253` (read at line 206)
- Failure scenario: Two trainers mark the same member's last session complete at the same moment. Both read `sessionsUsed = 9, sessionsTotal = 10`, both check `<`, both increment to 10. With a third concurrent submission, package goes to 11/10.
- Severity: high
- Suggested fix: Move the read inside the txn and use conditional update `where: { id, sessionsUsed: { lt: sessionsTotal } }`. Reject when count = 0.
- Effort: small

### R09 — `locker-key.issueKey` / `reissueKey` race issues two keys for one locker
- File: `lib/services/locker-key.ts:14-75` and `198-262`
- Failure scenario: Two staff issue the same locker number at the same moment; both pass the "no outstanding issued key" check, both create `LockerKeyIssuance` rows. Member ends up with two charges; locker history is corrupt.
- Severity: high
- Suggested fix: Same pattern — pull check into txn + conditional update on a sentinel `Locker.currentIssuanceId` column (would require schema). Without schema: SERIALIZABLE txn around check + create.
- Effort: small (in-txn) / medium (schema version)

### R10 — `renewal` joining-fee race charges fee twice for new member
- File: `lib/services/renewal.ts:92-108`
- Failure scenario: New member pays at desk and online portal simultaneously for first plan. Both reads see `priorTicketCount = 0`, both add joining fee, member is overcharged by `gym_joining_fee`. Refund flow then needed.
- Severity: high
- Suggested fix: Pull `priorTicketCount` read inside the renewal txn and compute fee from the in-txn count. Even better: use `User.firstTicketCreatedAt` as a one-shot boolean flag set inside the same txn.
- Effort: small

### R11 — `multi-location-rollup` understates comp ratio and inflates collections via refunds
- File: `lib/services/multi-location-rollup.ts`
- Failure scenarios: (a) `compRatio` is hardcoded to `0` despite `MemberTicket.isComplimentary` existing — owner dashboards understate comps. (b) `collectionsThisPeriod` sums `Payment.amount` without filtering `type != 'refund'`, so refund rows (which we expect to be negative or have type='refund' with positive amount) inflate or deflate net collections inconsistently with P&L.
- Severity: high (owner-facing KPI)
- Suggested fix: (a) `compRatio = ticketsWithIsComplimentary / totalTickets`. (b) Either subtract refunds explicitly or filter `type IN ('cash','card','upi','bank')`.
- Effort: small

### R12 — `gstr1-export` excludes credit notes (refunds) from filings
- File: `lib/services/gstr1-export.ts:225` (`totalAmount <= 0` check)
- Failure scenario: Refunds during the filing period are silently dropped. Filed GSTR-1 overstates sales; CRA reconciliation later discovers the variance.
- Severity: high (compliance)
- Suggested fix: Emit refunds as credit notes (CDNR section) instead of dropping. Map refund payment row → Credit Note with negative taxable value and same GSTIN/place-of-supply lookup as the original invoice.
- Effort: medium

### R13 — `tally-export` half-paise leak on odd GST totals
- File: `lib/services/tally-export.ts:130-141`
- Failure scenario: `gstTotal = 9.01`. `cgst = sgst = round2(9.01 / 2) = round2(4.505) = 4.51`. Sum = 9.02 ≠ 9.01. Tally import flags mismatch; over many invoices, 1-paise drift accumulates.
- Severity: high
- Suggested fix: Mirror the GSTR-1 fix — `cgst = round2(gstTotal / 2); sgst = round2(gstTotal - cgst);` so the residual paise lands on SGST.
- Effort: trivial

### R14 — `attendance.getDaily` server-local Date vs IST-stored attendanceDate
- File: `lib/services/attendance.ts:158`
- Failure scenario: On Vercel (UTC) at 00:30 IST, `new Date(year, month, date)` constructs a UTC midnight that is +5:30 ahead of IST midnight. Records stored via `todayIST()` for the previous IST day are excluded from "today's" report. Manifests at month-end / month-start as missing check-ins on the daily dashboard.
- Severity: high (silent data loss in UI)
- Suggested fix: Use the same helper that wrote the data — replace `new Date(...)` with `istDayBoundsUtc(date)` returning `{startUtc, endUtc}` and query `attendanceDate >= startUtc AND < endUtc`.
- Effort: small

### R15 — `magic-link` tokens have no single-use guarantee
- File: `lib/ai/manager.ts` (`signMagicLink` / `verifyMagicLink`)
- Failure scenario: HMAC + expiry only. A leaked link (forwarded email, browser history, screenshare) can be replayed until expiry. Combined with R03 / R06, a single leak → repeated execution.
- Severity: high
- Suggested fix: Either treat `dismissedAt` set as the "used" marker (mostly works once R06 lands), or add a `MagicLinkUse(jti, usedAt)` table with unique jti and reject re-use.
- Effort: small (when R06 ships)

---

## Medium / Low

### R16 — `approvals.approveRequest` dispatch can fire twice on race
- File: `lib/services/approvals.ts:137-240`
- Failure scenario: Two admins click Approve at the same moment. Initial status check (outside txn) passes for both; the txn re-check at line ~190 prevents duplicate row updates, but the post-commit dispatch (refund.process / comp.apply / cash-shift.resolveVariance) may already be queued for the losing admin's branch depending on dispatch placement.
- Severity: medium
- Suggested fix: Use the result of the txn-internal `updateMany({ where:{ id, status:'pending' }, data:{...}})` `count` value as the dispatch gate; only dispatch when count=1.
- Effort: small

### R17 — `feedback.submit` lacks idempotency + `getFeedbackStats` uses UTC month
- File: `lib/services/feedback.ts:5-29` (submit) and `174-209` (stats)
- Failure scenarios: (a) Member double-taps Submit on a slow network → two Feedback rows for the same visit. No audit log written either. (b) `getFeedbackStats` uses `new Date()` for month boundaries → on a UTC server, IST-late-evening submissions are bucketed into the next month.
- Severity: medium
- Suggested fix: (a) Add a soft idempotency window keyed by `(memberId, contextType, contextId, dayIST)`; write a `feedback.submit` audit row. (b) Switch month math to IST helper.
- Effort: small

### R18 — `trainer-payout.markPayoutPaid` race
- File: `lib/services/trainer-payout.ts` (`markPayoutPaid`)
- Failure scenario: Two admins click "Mark paid" simultaneously; status check happens outside txn, so both can pass and one of the second writes will overwrite the first's `paidAt` / `paidById`.
- Severity: medium
- Suggested fix: Conditional update `where:{ id, paidAt: null }`; reject on count=0.
- Effort: small

### R19 — `installment-reminder` agent at-least-once duplicates
- File: `lib/agents/installment-reminder.ts:37`
- Failure scenario: Agent sends WhatsApp then writes the cooldown row. Crash mid-send → next agent run resends. Member gets two reminders.
- Severity: medium
- Suggested fix: Write the cooldown row first (within an at-most-once posture), then send. If send fails, log + retry next cycle. Acceptable trade-off for non-financial messages.
- Effort: trivial

### R20 — `qr-checkin` no rate-limit / replay window
- File: (review of QR code check-in route)
- Failure scenario: A QR code (long-lived URL) can be replayed across multiple devices in the same minute, creating duplicate `AttendanceLog` rows. Existing 60s idempotency key is per-payload; if the QR encodes a static memberId + locationId, it dedupes. If it encodes a timestamp, two scans within 60s may both pass.
- Severity: low–medium (depends on QR payload design — verify)
- Suggested fix: Confirm `AttendanceLog` has a unique `(userId, attendanceDate, locationId)` index for "checked in today" semantics, or enforce 60s idempotency via stable key `chkin:{userId}:{minute}`.
- Effort: small to verify, small to fix

### R21 — `comp` and `upgrade` audit rows omit IP/user-agent
- File: `lib/services/comp.ts`, `lib/services/upgrade.ts` (audit log writes)
- Failure scenario: Forensics on disputed comp / mid-cycle upgrade ("who approved this?") relies solely on `actorId`. No `ip` / `userAgent` / `requestId` captured → can't tell desktop staff vs. compromised admin token.
- Severity: low
- Suggested fix: Plumb request context (NextRequest headers) through the action layer into the service; add to audit `details` JSON.
- Effort: medium (action surface area)

### R22 — Magic-link `resolveSystemWorkerId` attribution drift
- File: `app/m/a/[token]/confirm/route.ts:77-92`
- Failure scenario: All magic-link executions are attributed to "lowest-id active admin" — typically the gym owner. Owner sees their own audit trail polluted with actions they never performed. If that admin is deactivated, fallback drifts to a different admin silently.
- Severity: low
- Suggested fix: Bake the intended `executedById` into the signed token at send time (it's known when the WhatsApp/email goes out). Confirm route then uses the embedded actor.
- Effort: small

### R23 — `cash-shift.closeShift` variance auto-approve threshold not audited
- File: `lib/services/cash-shift.ts:96-102`
- Failure scenario: Threshold is parsed on every call. If env var is missing or NaN, defaults to `DEFAULT_VARIANCE_AUTO_APPROVE_MAX` silently. No audit row notes which threshold value was applied — disputes later cannot tell whether a borderline variance was auto-approved on the old or new policy.
- Severity: low
- Suggested fix: Persist the threshold value used into the cash-shift audit details JSON for auditability.
- Effort: trivial

---

## Services audited (clean — no robustness gaps found)

- `lib/services/comp.ts` — atomic txn, 60s idempotency, full audit. Solid.
- `lib/services/upgrade.ts` — atomic, status-check idempotent, single audit row.
- `lib/agents/_shared.ts` — Insight upsert via unique `dedupeKey` is safe to re-run.
- `lib/utils/date.ts` — `todayIST()` is self-consistent within the helper family; gaps are at call sites that bypass it (R14, R17b).
- `app/api/cron/trainer-payout-monthly/route.ts` — month boundary math acceptable for 1st-of-month UTC schedule.
- `lib/services/gstr1-export.ts` (IST handling specifically) — correct beyond the refund omission flagged in R12.

---

## Cross-cutting recommendations

1. **Adopt a `claimAndAct(prisma, where, data, action)` helper** — `updateMany` with conditional `where`, dispatch only if count=1. Eliminates R03, R06, R08, R09, R10, R16, R18 with one shape.
2. **Promote `todayIST()` siblings** — `istDayBoundsUtc(date)`, `istMonthBoundsUtc(year,month)` — to a single source of truth and ESLint-ban naked `new Date(year, month, day)` in app/services code. Eliminates R14 / R17b class.
3. **Universal webhook dedupe table** — `(source, externalId, receivedAt)` with unique constraint. Reuse for Telegram update_id, future Stripe events, future WhatsApp callbacks. Address R07 once across providers.
4. **Refund-aware exports** — both `tally-export` and `gstr1-export` need explicit credit-note handling; build a shared `iterFinancialEvents()` that yields invoices and credit notes uniformly.
5. **Schema window asks** (defer until next):
   - Partial unique on `CashShift(locationId) WHERE status IN ('open','pending_approval')`
   - `MagicLinkUse(jti UNIQUE, usedAt)`
   - `WebhookEvent(source, externalId, UNIQUE(source, externalId))`
