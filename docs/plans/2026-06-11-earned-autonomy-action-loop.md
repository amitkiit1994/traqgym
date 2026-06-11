# Earned Autonomy v1: The TraqGym Action Loop

Date: 2026-06-11
Status: PLAN (local only — lead reviews, pushes `main`, cherry-picks to `egymlokhandwala`)
Philosophy source: Accelerating Autonomy paper + JioMart OS architecture — agents produce
ACTIONS not insights; humans VERIFY, not operate; every verification is a training signal;
autonomy graduates per action-type and is earned, never declared.

---

## 1. The shift: insights → verifiable actions

### What exists today (the digest-card model)

- 14 deterministic agents in `lib/agents/` (comp-auditor, silent-churn, renewal-cliff,
  defaulted-ticket-escalator, …) run from `app/api/cron/agents/*` (see `vercel.json`)
  and call `upsertInsight()` in `lib/agents/_shared.ts`, which upserts into the
  `Insight` table keyed by `dedupeKey`.
- `app/api/cron/manager-morning-briefing` (cron `30 1 * * *` UTC = 07:00 IST) runs
  `lib/ai/manager-runner.ts`: ranks insights (`rankInsights`, top 5, `lib/ai/manager.ts:132`),
  composes a briefing, renders Telegram cards via `lib/ai/manager-telegram.ts`
  (`renderTelegram`: one row per insight — `[primary action] [Snooze 7d]`), sends through
  `sendMessageWithButtons` in `lib/channels/telegram.ts`, records `InsightDelivery` rows.
- Tapping a button hits `app/api/webhook/telegram/route.ts` → `handleCallbackQuery`
  (payload `{"t":"insight_action","i":<insightId>,"a":<actionIndex>}`) →
  `executeInsightAction` in `lib/services/insight.ts:216`, which atomically claims the
  insight (dismiss-first `updateMany` guarded by `dismissedAt: null`) and runs a
  whitelisted side-effect (`member.send_reminder`, `comp.convert`, `upgrade.send_offer`, …).
- Separately, three legacy crons SEND MESSAGES DIRECTLY with no human in the loop and no
  outcome measurement: `app/api/cron/renewal-reminders` (deterministic, default-on via
  `cron_renewal_reminders_enabled`), `app/api/cron/ai-winback` and
  `app/api/cron/ai-payment-reminder` (LLM-drafted via `lib/ai/proactive-runner.ts`,
  default-off, logged to `AiProactiveLog`).

### What's wrong with it (measured against the paper)

1. **Decision and execution are fused.** Tapping the briefing button executes immediately.
   There is no "proposed" state, so there is nothing to approve or reject — only act or snooze.
2. **Rejection captures zero signal.** "Snooze 7d" is the only no — no reason, no boundary
   condition, nothing the agent learns from.
3. **No projection, no accountability.** `ComposedSection.impactRupees` exists
   (`lib/ai/manager.ts:66`, read from `dataJson.estimatedImpactRupees`) but nothing ever
   compares the projection to what actually happened.
4. **The direct-send crons are unearned autonomy.** `renewal-reminders` already auto-sends
   to members with no approval history justifying it.

### What we build (the action register)

Every agent that wants to touch a member emits an **ActionProposal**:
concrete instruction + likelihood (0–100) + projected impact in rupees + clockspeed-days
(how many days before the opportunity decays). Proposals are clubbed by action-type into
one Telegram message. The owner approves or rejects (with reason). Approval executes through
the existing channel/notification plumbing. A nightly outcome job measures what happened vs
the projection. Per action-type, autonomy graduates from **verify** (owner approves each
batch) to **notify** (auto-execute + inform) only when the numbers earn it — and demotes
on regression.

---

## 2. Data model: `ActionProposal`, `ActionBatch`, `AutonomyPolicy`

### Reuse decisions (explicit, to avoid model duplication)

| Existing model | Role in the loop |
|---|---|
| `Insight` (schema.prisma:1060) | Optional provenance link (`ActionProposal.insightId`). Insights stay the analysis layer; proposals are the action layer. |
| `Approval` (schema.prisma:1170) | NOT extended. It is the staff→admin workflow for money-touching entities (`comp`, `refund`, `freeze`, … — `lib/services/approvals.ts:22`) with apply-on-approve `payloadJson` semantics. We mirror its decision vocabulary (`status`, `decidedById`, `decidedAt`, reason field) but keep owner-verifies-agent separate from admin-verifies-staff. Money-out stays exclusively in `Approval` and is never reachable from this loop (Section 5). |
| `AuditLog` (schema.prisma:398) | Every propose/approve/reject/execute/graduate/demote/kill writes a row (`action: "autonomy.*"`), same as `telegram.insight_action.execute` does today. |
| `NotificationLog` (schema.prisma:371) | Execution idempotency for free: `@@unique([userId, templateName, deliveryDate])` — the executor dispatches through `lib/services/notification.ts dispatch()` exactly like `app/api/cron/renewal-reminders` does. |
| `AiProactiveLog` (schema.prisma:945) | Continues to log LLM drafting calls + the daily budget gate (`ai_proactive_daily_budget`, `lib/ai/proactive-runner.ts:55`). |
| `InsightDelivery` (schema.prisma:1317) | Pattern donor: `telegramChatId` + `telegramMessageId` for cross-channel message editing lives on `ActionBatch` instead of a new delivery table (one message per batch in v1). |
| `ProcessedTelegramUpdate` (schema.prisma:1331) | Already dedupes callback taps across Vercel replicas — no new dedupe needed. |

**No `RejectReason` table.** The reject-reason library is a query:
`ActionProposal WHERE actionType = ? AND status = 'rejected' AND rejectReason IS NOT NULL`.
One source of truth; curation can come later.

### Exact Prisma (append to `prisma/schema.prisma`, migration `npx prisma migrate dev --name earned_autonomy_action_loop`)

```prisma
// ─── Earned Autonomy: action register ───

model ActionProposal {
  id          Int     @id @default(autoincrement())
  actionType  String // "renewal_reminder" | "winback_message" | "dues_nudge" (v1)
  agent       String // producing module, e.g. "renewal_reminder_proposer"
  insightId   Int? // optional provenance link to the analysis layer
  insight     Insight? @relation(fields: [insightId], references: [id], onDelete: SetNull)
  entityType  String // "user" | "ticket" — same vocabulary as Insight.entityType
  entityId    Int
  instruction String  @db.Text // owner-readable: "Send Hinglish renewal reminder to Karan S (Gold expires 14 Jun)"
  payloadJson Json // exact execution params: { action, args, channel, templateName, messageText }

  // The three numbers the paper demands on every action:
  likelihood            Int // 0-100, agent-estimated probability of achieving impact
  projectedImpactRupees Decimal @db.Decimal(10, 2) // matches Payment/MemberTicket precision
  clockspeedDays        Int // days until the opportunity decays; drives expiresAt

  dedupeKey String @unique // e.g. "renewal_reminder:user:123:2026-06-14"
  status    String @default("proposed") // proposed | approved | rejected | expired | auto_executed
  mode      String @default("verify") // AutonomyPolicy.mode snapshot at proposal time

  batchId Int?
  batch   ActionBatch? @relation(fields: [batchId], references: [id], onDelete: SetNull)

  // Decision (mirrors Approval's decidedBy/decidedAt/decisionNote shape)
  decidedById Int?
  decidedBy   Worker?   @relation("ActionProposalDecider", fields: [decidedById], references: [id], onDelete: SetNull)
  decidedAt   DateTime?
  rejectReason String?  @db.Text // REQUIRED on reject — this is the training signal
  // Telegram message that asked "why?" (ForceReply target) — see Section 3.
  rejectPromptMessageId Int?

  // Execution + outcome
  executedAt        DateTime?
  executionResult   Json? // per-channel results, same shape as member.send_reminder audit details
  outcomeStatus     String? // pending | hit | miss | unmeasurable
  outcomeRupees     Decimal?  @db.Decimal(10, 2)
  outcomeMeasuredAt DateTime?
  outcomeJson       Json? // evidence: { paymentId } | { newTicketId } | { balanceDelta }

  expiresAt DateTime // createdAt + clockspeedDays; expiry job flips status to "expired"
  createdAt DateTime @default(now())

  @@index([actionType, status])
  @@index([status, expiresAt])
  @@index([entityType, entityId, actionType])
  @@index([actionType, status, decidedAt]) // approval-rate + reject-library queries
}

model ActionBatch {
  id                Int       @id @default(autoincrement())
  actionType        String
  title             String // "7 renewal reminders — ₹84k projected"
  telegramChatId    String? // InsightDelivery pattern: enables editMessageText sync
  telegramMessageId Int?
  sentAt            DateTime?
  createdAt         DateTime  @default(now())
  proposals         ActionProposal[]

  @@index([actionType, createdAt])
}

model AutonomyPolicy {
  id         Int    @id @default(autoincrement())
  actionType String @unique
  mode       String @default("verify") // verify | notify | killed

  // Rolling counters (recomputed from ActionProposal by the policy service;
  // stored here so the Telegram renderer and admin UI never aggregate inline).
  decisionCount    Int @default(0) // decided proposals considered (rolling window 50)
  approvedCount    Int @default(0)
  rejectedCount    Int @default(0)
  outcomeHitCount  Int @default(0)
  outcomeMissCount Int @default(0)
  // sum(outcomeRupees)/sum(projectedImpactRupees) over measured executions, 0-999%
  calibrationPct   Int @default(0)

  graduatedAt    DateTime?
  demotedAt      DateTime?
  demotionReason String?
  killedAt       DateTime?
  killedById     Int?
  killedBy       Worker?   @relation("AutonomyPolicyKiller", fields: [killedById], references: [id], onDelete: SetNull)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Relation back-fills required: `Insight.actionProposals ActionProposal[]`, and on `Worker`:
`decidedActionProposals ActionProposal[] @relation("ActionProposalDecider")`,
`killedAutonomyPolicies AutonomyPolicy[] @relation("AutonomyPolicyKiller")`.

### New service files (per `.claude/rules/services.md`: plain functions, `{success, error}` returns, `$transaction` for multi-table writes)

- `lib/services/action-proposal.ts` — `proposeAction()` (dedupeKey upsert, mirrors
  `upsertInsight`), `clubProposals()` (group proposed rows of one actionType into an
  `ActionBatch`), `decideProposal()` / `decideBatch()` (atomic claim:
  `updateMany({ where: { id, status: "proposed" } })` — same R03/R06 pattern as
  `executeInsightAction`), `executeProposal()` (whitelist dispatcher, Section 6),
  `expireStale()`.
- `lib/services/autonomy-policy.ts` — `getPolicy()`, `recomputePolicy(actionType)`,
  `getBoundaryConditions(actionType)`, `graduate()`, `demote()`, `kill()`, `killAll()`.
- `lib/services/action-outcomes.ts` — per-type outcome measurers (Section 4).
- `lib/actions/autonomy.ts` — server actions for the admin page, guarded by
  `requireWorker(["admin"])` from `lib/auth-guard.ts`.
- `app/admin/(dashboard)/autonomy/page.tsx` — action register + policy dashboard + kill switch.

---

## 3. The Telegram verify surface

All on top of `lib/channels/telegram.ts` primitives (`sendMessageWithButtons`,
`editMessageText`, `answerCallbackQuery`, `escapeHtml`, HTML parse mode, env →
`GymSettings telegram_bot_token` fallback) and the existing webhook security stack
(secret-token check, owner gate on `gym_owner_telegram_chat_id`, `ProcessedTelegramUpdate`
dedupe — `app/api/webhook/telegram/route.ts:838-893`).

### Clubbing pattern (one message per batch)

New renderer `lib/ai/action-telegram.ts` (sibling of `manager-telegram.ts`, reuses its
`formatRupees` and the 64-byte `callback_data` guard — `MAX_CALLBACK_DATA`,
`manager-telegram.ts:44`):

```
ACTIONS AWAITING YOUR OK — renewal reminders

7 members expire in the next 3 days. Projected save: ₹84k.
Likelihood 70-85%. Window: 3 days.

1. Karan S — Gold, expires 14 Jun — ₹12,000 (80%)
2. Priya M — Silver, expires 14 Jun — ₹8,000 (75%)
   ... (cap at 10 lines, then "+ N more")

[ Approve all 7 ]  [ Review 1-by-1 ]
[ Reject all ]
```

Callback payloads (kept tiny like `{"t":"insight_action","i":..,"a":..}`):

| Payload | Meaning |
|---|---|
| `{"t":"apb","b":<batchId>,"d":"a"}` | approve all in batch |
| `{"t":"apb","b":<batchId>,"d":"r"}` | reject all (then ask one reason for the batch) |
| `{"t":"apb","b":<batchId>,"d":"s"}` | enter review mode (step through) |
| `{"t":"app","p":<proposalId>,"d":"a"\|"r"\|"k"}` | approve / reject / skip one proposal |
| `{"t":"apr","p":<proposalId>,"r":<code>}` | quick reject-reason chip |

Review mode uses `editMessageText` to paginate the SAME message one proposal per screen —
no message spam, identical to how briefing cards get edited to "Done via Telegram" today.

### Reject-reason capture flow (the part that makes rejection a training signal)

1. Owner taps Reject → `answerCallbackQuery` dismisses the spinner; proposal status flips
   to `rejected` atomically (claim guard `status: "proposed"`).
2. Bot edits the message to show quick-reason chips (`{"t":"apr",...}`):
   `wrong person` / `too soon` / `bad tone` / `wrong amount` / `not now` — each maps to a
   canonical `rejectReason` string — plus a final chip `type a reason`.
3. `type a reason` (or batch-level reject) sends a NEW message via Telegram **ForceReply**
   (`reply_markup: {force_reply: true}` — add a `forceReply` option to `sendMessage` in
   `lib/channels/telegram.ts`); its `message_id` is stored on
   `ActionProposal.rejectPromptMessageId`.
4. Webhook change: in the plain-text branch of `POST`
   (`app/api/webhook/telegram/route.ts:1005`), BEFORE routing to `processAgentMessage`,
   check `msg.reply_to_message?.message_id` against open `rejectPromptMessageId` rows.
   Match → save the text as `rejectReason`, ack with an edited "Reason recorded" message,
   and do NOT invoke the AI agent. (Requires adding `reply_to_message?: { message_id }`
   to the `TgMessage` type at route.ts:81.)
5. Every decision writes `AuditLog` (`autonomy.proposal.approve` / `.reject` /
   `.batch_approve`), `actorType: "worker"`, `actorId` = `resolveSystemWorkerId()` —
   identical attribution to today's `telegram.insight_action.execute` (route.ts:676).

Notify-mode messages (post-graduation) are informational with an undo lever:
`Sent 5 renewal reminders (auto — 97% approval over last 31). [Looks wrong — demote]`
where the demote button is `{"t":"apd","y":"renewal_reminder"}` → `autonomy-policy.ts demote()`.

---

## 4. Learning v1 — no ML, three feedback loops

### a) Per action-type approval stats

`recomputePolicy(actionType)` in `lib/services/autonomy-policy.ts` aggregates the rolling
last 50 decided `ActionProposal` rows (`@@index([actionType, status, decidedAt])`) into
`AutonomyPolicy` counters. Called after every decision and by the outcomes cron. Batch
approval counts each contained proposal as one decision (clubbing must not starve the
>=20-decision graduation gate).

### b) Reject-reason library → prompt boundary conditions

`getBoundaryConditions(actionType)` returns the distinct `rejectReason` strings from the
last 90 days. Injection points:

- **LLM drafting layer:** extend `buildProactivePrompt` in `lib/ai/proactive-prompt.ts`
  with a `boundaryConditions: string[]` param rendered as a hard-constraint block:

  ```
  OWNER CORRECTIONS — HARD CONSTRAINTS (violating any of these gets the action rejected):
  - "too pushy, members complained about discount language" (rejected 3x)
  - "never message Dr. Mehta's family plan members" (rejected 1x)
  ```

  Same prompt block is reused by `manager-runner.ts` so the morning briefing's tone also
  inherits corrections.
- **Deterministic selection layer:** the canonical quick-reason codes compile to filters
  in the proposers — `too soon` raises the per-member contact cooldown (checked against
  `NotificationLog`/`AiProactiveLog`, the same dedupe sources `ai-winback` uses today);
  `wrong person` adds `entityId` to a per-type exclusion list (stored as a `GymSettings`
  JSON key `autonomy_exclusions_<actionType>` — reusing the existing key-value settings
  store rather than a new table).

### c) Outcome deltas vs projection

New cron `app/api/cron/autonomy-outcomes/route.ts` (nightly, `requireCronSecret` from
`lib/auth-cron.ts` like every other cron) calls `lib/services/action-outcomes.ts`:

| actionType | hit definition (measured within `clockspeedDays` + grace) | outcomeRupees |
|---|---|---|
| `renewal_reminder` | new `MemberTicket` or `Payment` for the user after `executedAt` | renewal payment amount |
| `winback_message` | new active `MemberTicket` within 30d of `executedAt` | new ticket payment |
| `dues_nudge` | `Payment` against the ticket OR `MemberTicket.balanceDue` decreased | amount collected |

`calibrationPct = 100 * sum(outcomeRupees) / sum(projectedImpactRupees)` over measured
executions feeds graduation (below) and is shown on every batch header so the owner sees
whether the agent's promises hold ("last 30 days: projected ₹2.1L, realized ₹1.6L — 76%").

---

## 5. Graduation, demotion, kill-switch, and the TraqGym autonomy ladder

### Graduation (verify → notify), per action-type, evaluated by `recomputePolicy`

ALL of:
1. >= 20 decided proposals in the rolling window;
2. approval rate > 95% over those decisions;
3. >= 10 measured outcomes with `calibrationPct >= 70`;
4. policy not currently `killed`, never demoted in the last 30 days.

Graduation is **proposed, not silently applied**: the bot sends
`renewal_reminder qualifies for auto-mode (96% approval / 81% calibration). [Enable auto] [Keep verifying]`.
Autonomy is earned by the agent AND granted by the owner. `graduatedAt` set on accept;
`AuditLog autonomy.policy.graduate`.

### Demotion (notify → verify), automatic, fail-toward-human

ANY of: owner taps the demote button on a notify card; rolling approval of post-hoc
"looks wrong" flags; `calibrationPct < 50` over the last 10 measured outcomes; any
execution error rate > 20% in a batch. Writes `demotedAt` + `demotionReason`;
re-graduation requires re-earning the full gate from a fresh window.

### Kill-switch (three levels)

1. Per-type: `AutonomyPolicy.mode = "killed"` (admin UI or `/autonomy kill <type>`).
2. Global: `GymSettings autonomy_enabled = "false"` — checked first by every proposer
   cron, the executor, and the webhook decision handlers (same pattern as
   `cron_renewal_reminders_enabled` gating in `app/api/cron/renewal-reminders/route.ts:14`).
3. Telegram `/autonomy off` command (new webhook command branch beside `/snooze`,
   route.ts:946) — owner can pull the cord from bed.

### Hard floor: money-out NEVER auto

`executeProposal()` dispatches ONLY a whitelist of message-only actions
(v1: `autonomy.send_member_message`). Anything that creates/changes `Payment`, `Refund`,
`CompPass`, discounts, freezes, or payroll is structurally unreachable from this loop —
those remain in the `Approval` workflow (`lib/services/approvals.ts`) with human
`approveRequest()` forever. This is a code-level invariant (dispatcher whitelist, like
`executeInsightAction`'s), not a config flag.

### The TraqGym autonomy ladder (Reactions / Actions / Decisions / Strategy)

| Rung | Gym ops mapping | Autonomy ceiling |
|---|---|---|
| **Reactions** | FAQ auto-replies (timings, fees, class schedule — data already exposed by `lib/ai/tools/`), check-in confirmations | First notify-mode graduates; v2 |
| **Actions** | renewal reminders, winback messages, dues nudges, milestone/birthday messages | **v1 scope** — verify → notify per type |
| **Decisions** | discounts, comp conversions (`comp.convert` in `lib/services/insight.ts:326`), freezes, pricing changes, write-offs | Permanently verify-mode; money paths additionally gated through `Approval` |
| **Strategy** | plan-mix changes (today's `lib/agents/plan-mix-drift.ts`), pricing strategy, expansion | NEVER autonomous — agents stay insight-only here |

---

## 6. Scope — the complete shipped system (one phase, no deferrals)

Everything below is BUILT and live in the codebase. There is no v1/v2/v3 ladder: the
loop ships whole — producers, verify surface, executor, outcomes measurement,
graduation, demotion, kill-switches, and legacy capture.

### 6.1 Five message-only action types (the executor whitelist)

Each producer is wired INTO the cron/agent that already owns the proven selection query —
we changed who pulls the trigger, not how targets are found. Drafting is deterministic
(template-grade personalized text built from the same fields the legacy LLM prompts used):
proposals must cost nothing to produce, and the owner verifies the exact text that will be
sent. Owner reject-reasons still flow into every LLM surface as boundary conditions
(`getAllBoundaryConditionLines` → `system-prompt.ts`).

| actionType | Producer lives in | Projected impact (honest) | Likelihood prior | Clockspeed |
|---|---|---|---|---|
| `renewal_reminder` | `lib/agents/renewal-cliff.ts` (tickets expiring ≤7d) + captured legacy path in `app/api/cron/renewal-reminders` | ticket value (the renewal at risk) | 0.70 | 7d |
| `winback_message` | `app/api/cron/ai-winback/route.ts` (lapsed > `ai_winback_expired_days`, no active ticket, `AiProactiveLog` 30d dedupe) | plan value × likelihood (a win-back is probabilistic recovery, not a booked renewal) | 0.20 | 30d |
| `dues_nudge` | `app/api/cron/ai-payment-reminder/route.ts` (`balanceDue > 0`, due date past or null+3d, top 10 by balance) | balanceDue (money already owed) | 0.50 | 14d |
| `enquiry_followup` | `app/api/cron/ai-lead-followup/route.ts` (`getColdLeads`: stage not converted/lost, quiet > `gap_hours`) | 90-day avg ticket value × likelihood; omitted when no recent sales exist to base it on | 0.10 | 7d |
| `payment_followup` | `app/api/cron/ai-payment-reminder/route.ts` (`PaymentFollowup` pending/contacted/promised and due for a touch; skips members already holding a live dues_nudge) | amountDue | 0.50 | 7d |

Every proposal carries: instruction (exact owner-readable consequence), draft message in
`params`, the three numbers, `gymContext` selection evidence (including the snapshots the
outcome measurers need: `balanceDueAtProposal`, `stageAtProposal`), and Insight provenance
(`insightId` → an analysis-layer row upserted per producer run).

Executor (`executeAction`, `lib/services/action-loop.ts`): message-only whitelist, member
sends via `dispatch()`/NotificationLog idempotency + WhatsApp/SMS channels + in-app
fallback; enquiry sends via Enquiry.phone + `AiProactiveLog` record (leads have no User
row or in-app surface). Money-out is structurally unreachable — no code path here can
touch Payment, Refund, CompPass, discounts, or payroll. Those remain exclusively in the
`Approval` workflow, forever.

### 6.2 Outcomes cron (the accountability half)

`app/api/cron/autonomy-outcomes/route.ts`, nightly `50 20 * * *` UTC = 02:20 IST
(off-peak). For each executed/auto_executed proposal past `executedAt + clockspeedDays`:

| actionType | hit | measured rupees |
|---|---|---|
| `renewal_reminder` | new Payment or new active MemberTicket for the member in-window | actual payments (or amountPaid on the new ticket) |
| `winback_message` | new active MemberTicket within 30d | what the returning member actually paid |
| `dues_nudge` | ticket balanceDue decreased vs proposal-time snapshot | the delta |
| `enquiry_followup` | stage advanced past the proposal-time snapshot, or converted | conversion payments in-window (0-rupee hit for a non-converting advance — honest under-credit) |
| `payment_followup` | payment received in-window, or followup resolved | payments in-window |

Writes `outcomeStatus` (hit/miss/unmeasurable) + `outcomeImpactInr`, AuditLogs every
measurement with evidence (`autonomy.outcome.measure`), expires stale proposals, then
recomputes per-type `AutonomyPolicy`: `outcomeHitRate`, `measuredCount`, and
`calibrationPct = 100 × Σrealized / Σprojected` over measured rows with projections.

### 6.3 Graduation and auto-demotion (complete)

Nightly inside the outcomes cron. Graduation gate (ALL of): ≥20 decisions AND >95%
approval AND ≥10 measured outcomes AND calibration ≥70% AND no demotion in the last 30
days. Meeting the gate upserts an Insight; the owner ACCEPTS via `/autonomy notify <type>`
on Telegram (chosen over insight buttons — it reuses the existing owner-gated command
stack end-to-end with zero new whitelist surface). The mode never auto-flips up.

Notify-mode execution: proposals auto-execute on creation and appear as
"Done (auto): ..." lines in the register message instead of buttons, with the demote path
one command away.

Auto-demotion (ANY of, runs even while the kill-switch is off): calibration <50% over ≥10
measured outcomes; execution failure rate >20% over the last 20 attempts; or the owner
issuing `/autonomy verify <type>` / `/autonomy off <type>`. All demotions stamp
`demotedAt` + `demotionReason` + AuditLog; re-graduation requires re-earning the full gate
after the 30-day cooldown.

### 6.4 /autonomy Telegram command (owner control surface)

Same security stack as `/actions` (webhook secret, owner chat gate, update_id dedupe):

- `/autonomy` or `/autonomy status` — per-type table: mode, decisions, approval %,
  sent/open counts, measured count, calibration %, hit-rate, demotion reason if any.
- `/autonomy on` / `/autonomy off` — global kill-switch (GymSettings `autonomy_enabled`).
- `/autonomy verify <type>` / `/autonomy notify <type>` / `/autonomy off <type>` —
  per-type mode (off = no proposals of that type at all).

### 6.5 Legacy autonomy captured (cutover, no double-sending)

The three direct-send paths this plan called "unearned autonomy" are all accounted for
when `autonomy_enabled` is on; when it is off, legacy behavior is byte-identical:

- `renewal-reminders` (deterministic, default-on): each send is routed through the
  executor as an **auto_executed ActionProposal** — visible as "Done (auto)" in the
  register and measured by the outcomes cron. The raw direct send is disabled. Dedupe
  gives the verify loop priority: members already holding a live renewal-cliff proposal
  are skipped (the owner's pending decision owns them — no duplicate, no unearned send).
  Birthday greetings in the same route are not renewal reminders and are untouched. The
  three "Smart AI Renewal" LLM sections are disabled while the loop is on (duplicate
  renewal_reminder senders).
- `ai-winback` and `ai-payment-reminder` (LLM, default-off): become the winback_message /
  dues_nudge producers — same selection, proposals instead of sends, legacy send disabled.
- `ai-lead-followup` (LLM, default-ON — also unearned autonomy, caught in this pass):
  becomes the enquiry_followup producer the same way.

### 6.6 The Reactions tier, honestly

Owner-bot Q&A (the Telegram agent answering "kitna collection hua aaj?" with live gym
data) is ALREADY fully autonomous today — read-only, no approval loop — and is now
visible as such in `/autonomy status`. That is the Reactions rung in production.

Member-facing reactions (FAQ auto-replies to members) do not exist because no
member-facing conversational CHANNEL exists — members get WhatsApp/SMS templates and
in-app notifications, none of which carry inbound replies into this system. That is a
channel gap, not an autonomy gap: the moment a member channel exists, its message-tier
actions plug into this same register, whitelist, and measurement loop with no new
architecture.

---

## 7. Why this is the moat

- **Every owner correction is proprietary labeled data.** A reject + reason on a concrete
  proposal ("too pushy for Dr. Mehta's family plan") is a boundary condition no foundation
  model and no competitor scraping public data can produce. It accrues in OUR Postgres,
  per gym, structured (`ActionProposal.rejectReason` keyed by `actionType`, `entityType`,
  `entityId`) — the beginnings of the per-gym knowledge graph.
- **Calibration is per-gym ground truth.** `outcomeRupees / projectedImpactRupees` per
  action-type per gym tells us what a winback message is actually worth in Lokhandwala vs
  anywhere else. Competitors shipping generic "AI reminders" have projections; we have
  realized deltas.
- **The flywheel compounds:** more verified actions → richer boundary conditions → higher
  approval rates → graduation → higher action volume at zero owner cost → more outcome
  data → better projections. Switching away means abandoning a policy state
  (`AutonomyPolicy` + reject library + calibration history) that took months of the
  owner's own judgment to build. The product gets harder to leave the longer it runs —
  not because of lock-in, but because the owner's accumulated corrections ARE the product.
- **Trust is auditable.** Full `AuditLog` trail per action, graduation thresholds that are
  numbers not vibes, and a kill-switch the owner controls. "Autonomy is earned, not
  declared" is also the sales pitch to every gym owner who has been burned by spammy
  auto-messaging tools.

---

## As built (where each piece landed)

### Deviations from the planned design above (sections 2-3 are the PLAN; this is what shipped)

- **No `ActionBatch` model.** Clubbing is render-time: `sendActionRegister`
  groups open proposals by `actionType` and collapses groups larger than 3
  into one summary message. No batch rows, no batch message-id tracking.
- **Dedupe is a query window, not a `dedupeKey` column.** `createProposal`
  refuses a new proposal when a live one (`proposed | approved | executed |
  auto_executed | rejected`) exists for the same `(actionType, target)`
  within the clockspeed window. A rejection therefore also suppresses
  re-proposal AND the legacy auto-capture for that member until the window
  lapses — the owner's "no" owns the target.
- **Rupee fields are `Int` (`projectedImpactInr`, `outcomeImpactInr`), not
  `Decimal`,** and `likelihood` is a 0-1 `Float`, not 0-100 `Int`.
- **No `expiresAt` column / `expired` flip job on the table** — expiry is
  computed from `createdAt + clockspeedDays` by `expireStaleProposals()` in
  the nightly outcomes cron.
- **Callback payloads are plain prefixed strings** (`action_approve:<id>`,
  `action_reject:<id>`, `action_approve_all:<type>`, `action_review:<type>`),
  not the JSON `{"t":"apb",...}` scheme — disambiguated from the existing
  JSON payloads by the `action_` prefix, all <= 35 bytes.
- **Reject-reason capture uses a 10-minute GymSettings marker**
  (`autonomy_pending_reject`: the owner's next plain-text message in the
  paired chat is recorded as the reason), not Telegram ForceReply /
  `rejectPromptMessageId`. No quick-reason chips in v1 — typed reasons only.
- **`AutonomyPolicy.mode` vocabulary is `verify | notify | off`** ("off"
  replaces the planned "killed"), with rolling counters simplified to
  lifetime `approvals/rejections/executedCount` plus measured-outcome
  aggregates (`measuredCount`, `calibrationPct`, `outcomeHitRate`).
- **Graduation acceptance is `/autonomy notify <type>`** (no inline
  Enable-auto button), exactly as section 6.3 records.

1. Migrations: `20260611090000_earned_autonomy_action_loop` (`ActionProposal` +
   `AutonomyPolicy`), `20260611150000_earned_autonomy_complete` (`outcomeStatus`,
   `calibrationPct`, `measuredCount`, `graduatedAt`, `demotedAt`, `demotionReason`).
2. Service: `lib/services/action-loop.ts` — propose/decide/execute/auto-execute,
   outcome recording + policy recompute, graduation/demotion, mode + kill-switch
   management, boundary conditions, reject-reason capture.
3. Producers wired into their selection owners: `lib/agents/renewal-cliff.ts`,
   `app/api/cron/ai-winback`, `app/api/cron/ai-payment-reminder` (dues_nudge +
   payment_followup), `app/api/cron/ai-lead-followup` (enquiry_followup).
4. Verify surface: `lib/ai/action-telegram.ts` (register + "Done (auto)" digest +
   `/autonomy` handler) + callback/command/reject-reason branches in
   `app/api/webhook/telegram/route.ts`.
5. Outcomes + graduation engine: `app/api/cron/autonomy-outcomes` (vercel.json
   `50 20 * * *` = 02:20 IST).
6. Legacy capture: `app/api/cron/renewal-reminders` routes renewal sends through the
   executor as auto_executed proposals when the loop is on.
7. Rollout: flip `autonomy_enabled` for E-GYM via `/autonomy on`; expect 2 weeks of
   clean verify-mode operation before accepting any graduation suggestion.
