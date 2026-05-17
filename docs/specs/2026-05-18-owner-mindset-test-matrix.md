# Owner-Mindset E2E Test Matrix — Robin's POV

**Scope:** end-to-end via the live AI chat API (`/api/admin/ai/chat`),
not via Playwright. Each question is something Robin (gym owner) would
ask either himself, his manager, or the AI on his Telegram.

**Two audiences for the matrix:**

1. **Daily ops** — Robin checking pulse: how much PT money, who renewed,
   who's about to expire, who has balance.
2. **Owner trust** — Robin watching staff: duplicate charges, off-shift
   cash, refund routing, comp abuse, discount sweethearts, balance drift.

Fraud taxonomy reference: 9 patterns (Tavily research, 2026-05-18) —
diverted payments, fake refunds, discount manipulation, duplicate splits,
skimming, backdated edits, off-shift collections, manual receipts,
teeming/lading.

This stack already prevents some of those (payments cannot be deleted
from the UI; backdated edits are not exposed; manual receipts route
through `Payment` + `Invoice` atomically). The remaining surface is what
the detectors target.

---

## A. Revenue mix (Robin's "money pulse")

| # | Question | Expected primary tool(s) |
|---|----------|-------------------------|
| A1 | "How much did we collect this month?" | `get_collections_in_range` |
| A2 | "How much of this month is PT vs normal?" | `get_collections_in_range` (returns split) |
| A3 | "PT collection by trainer, last 30 days" | `get_pt_revenue_by_trainer` |
| A4 | "Top 10 spenders this year" | `get_top_spenders_in_range` |
| A5 | "How many new members joined this week?" | `get_new_members_in_range` |
| A6 | "Show me churn for last month" | `get_churn_metrics_in_range` |
| A7 | "How many memberships expired last 30 days?" | `get_expired_memberships_in_range` |
| A8 | "Plan-wise revenue this month" | `get_collections_in_range` + `get_plan_performance` |

## B. Balance & receivables ("who owes us")

| # | Question | Expected primary tool(s) |
|---|----------|-------------------------|
| B1 | "Total balance due across all members" | `get_balance_due_report` |
| B2 | "Top 10 balance defaulters" | `get_balance_due_report` |
| B3 | "Defaulters with balance > ₹5,000" | `get_balance_due_report` (filter) |
| B4 | "How many cheques are still pending?" | `get_pending_cheques` |
| B5 | "Followups assigned but never closed" | `get_overdue_followups` |

## C. Comp / free-access pulse

| # | Question | Expected primary tool(s) |
|---|----------|-------------------------|
| C1 | "How many comp members are active right now?" | `get_active_comps` + `get_active_comp_passes` |
| C2 | "Top reasons for comp issuance" | `get_comp_stats` |
| C3 | "Comp revenue leak — what's the ₹ value?" | `get_comp_stats` (revenueLeak field) |
| C4 | "Who issued the most comps in last 30 days?" | `detect_comp_abuse_patterns` |
| C5 | "Any member who's gotten 2+ comps in a row?" | `detect_comp_abuse_patterns` (repeatRecipients) |

## D. Anomaly / staff-trust suite (the headline)

| # | Question | Expected primary tool(s) |
|---|----------|-------------------------|
| D1 | "Anything I should worry about this week?" | `get_owner_anomaly_summary` |
| D2 | "Any duplicate charges this month?" | `detect_duplicate_payments` |
| D3 | "Cash collected without an open shift?" | `detect_off_shift_cash` |
| D4 | "Which staff is giving the biggest discounts?" | `detect_discount_outliers` |
| D5 | "Any refund where the staff refunded their own collection?" | `detect_refund_routing` |
| D6 | "Tickets where amountPaid doesn't match the payments?" | `detect_balance_mismatches` |
| D7 | "Who's most active in sensitive areas like password resets and member transfers?" | `detect_audit_anomalies` |
| D8 | "Daily owner trust briefing for yesterday" | `get_owner_anomaly_summary` (yesterday range) |

## E. Daily ops snapshots

| # | Question | Expected primary tool(s) |
|---|----------|-------------------------|
| E1 | "Good morning — what's my dashboard say?" | `get_morning_briefing` |
| E2 | "End of day summary" | `get_end_of_day_summary` |
| E3 | "Who's checked in today?" | `get_daily_attendance` |
| E4 | "Today's collection by payment mode" | `get_daily_collection` |
| E5 | "Members who haven't been to the gym in 2 weeks" | `get_irregular_members` |
| E6 | "Today's birthdays" | `get_todays_birthdays` |

## F. Cross-checks (consistency probes)

These ask the AI for the *same number* via two different paths. If the
two answers disagree, either a tool is wrong or the AI is hallucinating.

| # | Question A | Question B | Should match |
|---|-----------|-----------|--------------|
| F1 | "Total cash collected this month" (`get_collections_in_range`) | "Sum of cash payments this month" (`get_daily_collection` aggregated) | Yes |
| F2 | "PT money May 1-7" (`get_collections_in_range`) | "PT revenue by trainer May 1-7" (`get_pt_revenue_by_trainer` sum) | Yes |
| F3 | "Total balance due" (`get_balance_due_report`) | "Sum of balanceDue across active tickets" (raw if exposed) | Yes |

---

## Test harness

Each question is fired via `/tmp/ai-ask.sh "<Q>"`. Set
`BASE=https://egymlokhandwala.traqgym.com` and Robin's creds (the
defaults in the script). Capture stdout, grade PASS / FAIL / GAP:

- **PASS** — AI calls the right tool(s), answer matches expected schema.
- **FAIL** — AI answers wrong number or uses wrong tool.
- **GAP** — AI has no tool that fits; we need to add one.

The test results live in `/tmp/owner_matrix_results.md` (generated
fresh each run; not checked in).
