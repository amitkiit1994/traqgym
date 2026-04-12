# Financial Bug Audit

Identified: 2026-04-11
Test file: `tests/bugs/financial-bugs.test.ts` (20 tests, all passing)

---

## BUG 1 — Partial-payment Float vs Decimal mismatch

**What:** `MemberTicket.totalAmount`, `amountPaid`, and `balanceDue` are `Float` in the schema (lines 122-124), but `Payment.amount` is `Decimal(10,2)` (line 140). The service uses plain JS arithmetic (`ticket.amountPaid + params.amount`, `ticket.balanceDue - params.amount`) with no rounding.

**File/Line:** `prisma/schema.prisma:122-124`, `lib/services/partial-payment.ts:23-24`

**Reproduction:** 299.97 balance, 3 payments of 99.99. `balanceDue` ends up as `2.84e-14` instead of `0`. The `Math.max(0, ...)` guard on line 33 does NOT clamp this because the residual is positive.

**Impact:** Members appear to still owe money after paying in full. The `PaymentFollowup` system (which queries `balanceDue > 0`) would flag these members for collection. Also, `amountPaid` (Float sum) diverges from `SUM(Payment.amount)` (Decimal) in Postgres, causing reconciliation mismatches.

**Recommended fix:** Change `totalAmount`, `amountPaid`, `balanceDue` to `Decimal(10,2)` in the schema. Use `Decimal.js` or integer-paise arithmetic in the service. Short-term: round to 2 decimal places before storing (`Math.round(x * 100) / 100`).

---

## BUG 2 — Tax calculation returns un-rounded totals

**What:** In exclusive tax mode, `calculateTax` returns `totalAmount: amount + taxAmount` (line 20) without rounding. This Float addition produces values like `0.060000000000000005` instead of `0.06`. In inclusive mode, `baseAmount + taxAmount` does not always equal `totalAmount` due to Float addition error, breaking any downstream reconciliation that verifies the identity.

**File/Line:** `lib/services/tax.ts:14-20`

**Reproduction:** `calculateTax(0.05, 18, false)` returns `totalAmount: 0.060000000000000005`. For inclusive mode, thousands of amounts in the 0.01-1000.00 range produce `baseAmount + taxAmount !== totalAmount` at the Float level.

**Impact:** Sub-paisa per transaction, but compounds in reports. `getTaxReport` (lines 61-63) sums Float `taxAmount` fields with `.reduce()`, accumulating drift. Over 1000 records of 33.33, the drift is ~8.5e-13 rupees. Over a full month of mixed transactions (950 records), drift reaches ~1e-11 rupees. While sub-paisa, GST audit tools that verify `base + tax === total` for each row would flag every affected invoice.

**Recommended fix:** Round `totalAmount` on line 20: `totalAmount: Math.round((amount + taxAmount) * 100) / 100`. Better: use integer-paise arithmetic throughout. For reports, use Postgres `SUM()` on Decimal columns instead of JS reduce on Float values.

---

## BUG 3 — Gift card Float balance creates zombie cards

**What:** `GiftCard.amount` and `balance` are `Float` (schema lines 568-569). After multiple redemptions, the `=== 0` check on line 70 fails because the balance is something like `-1.07e-14` instead of `0`. The card stays in `"active"` status with a balance that is effectively zero but cannot be redeemed.

**File/Line:** `prisma/schema.prisma:568-569`, `lib/services/gift-cards.ts:69-70`

**Reproduction:** Gift card of 100.10, 10 redemptions of 10.01. Final balance: `-1.07e-14`. The `newBalance === 0` check returns `false`, so status remains `"active"`. The card becomes a zombie: listed as active, but any redemption attempt with `amount > 0` would fail the balance check.

**Impact:** Customer-facing bug. Members see a gift card listed as "active" but can't use it. Staff must manually mark it as redeemed. With ~100 gift cards/year, potentially 10-30% become zombies depending on redemption patterns.

**Recommended fix:** Change the status check to `newBalance <= 0.005 ? "redeemed" : "active"` (epsilon comparison). Better: change `amount` and `balance` to `Decimal(10,2)` in the schema and use Decimal arithmetic.

---

## BUG 4 — POS Float precision in price * quantity

**What:** `Product.price`, `Sale.unitPrice`, and `Sale.totalAmount` are all `Float`. The total is computed as `product.price * params.quantity` (line 38) with no rounding. For many common prices, this produces values with >2 decimal places.

**File/Line:** `prisma/schema.prisma:634,648-649`, `lib/services/pos.ts:38`

**Reproduction:** `19.99 * 7 = 139.92999999999998` instead of `139.93`. `0.10 * 3 = 0.30000000000000004` instead of `0.30`. Out of 192 tested combinations of 16 common gym retail prices and 12 quantities, 43 (22%) produce inexact results.

**Impact:** Sub-paisa per transaction. Stored `totalAmount` values have trailing garbage decimals. Sales reports (pos.ts line 130) sum these with `.reduce()`, compounding the error. If displayed unrounded, customers see prices like "139.93" becoming "139.92" on receipts.

**Recommended fix:** Round the total: `const totalAmount = Math.round(product.price * params.quantity * 100) / 100`. Better: change `price`, `unitPrice`, `totalAmount` to `Decimal(10,2)` in the schema.

---

## BUG 5 — Report aggregation compounds Float errors

**What:** Both `getTaxReport` (tax.ts lines 61-63) and `getSalesReport` (pos.ts lines 128-131) use `.reduce()` to sum Float fields in JavaScript. Each addition can introduce or compound IEEE-754 error.

**File/Line:** `lib/services/tax.ts:61-63`, `lib/services/pos.ts:128-131`

**Reproduction:** 1000 records of 33.33 summed via reduce: result is `33330.00000000085` instead of `33330`. A simulated monthly report (950 transactions) shows detectable drift.

**Impact:** Financial reports show slightly wrong totals. While the per-report error is sub-paisa, it means JS-computed totals never match Postgres `SUM()` on Decimal columns. This creates confusion during reconciliation and GST filing.

**Recommended fix:** Use Prisma `aggregate()` or raw SQL `SUM()` for financial totals instead of fetching all records and summing in JS. This lets Postgres do exact Decimal arithmetic.

---

## Summary

| Bug | Per-transaction impact | Cumulative risk | Severity |
|-----|----------------------|-----------------|----------|
| 1. Partial-payment ghost balance | Members wrongly flagged as owing | Collection harassment, trust loss | HIGH |
| 2. Tax un-rounded totals | GST audit row failures | Compliance risk during tax audit | MEDIUM |
| 3. Gift card zombie cards | 10-30% cards stuck as "active" | Customer complaints, manual cleanup | HIGH |
| 4. POS price imprecision | Sub-paisa display/storage errors | Receipt discrepancies | LOW |
| 5. Report sum drift | Sub-paisa per report | Reconciliation mismatches | LOW |

## Systemic root cause

All five bugs stem from using `Float` for monetary fields in the Prisma schema. The fix is to migrate all financial fields to `Decimal(10,2)` and use integer-paise arithmetic or `Decimal.js` in service code. Fields to change:

- `MemberTicket.totalAmount`, `amountPaid`, `balanceDue`
- `Payment.baseAmount`, `taxRate`, `taxAmount`
- `GiftCard.amount`, `balance`
- `Product.price`
- `Sale.unitPrice`, `totalAmount`
- `PaymentFollowup.amountDue`
- `Payroll.baseSalary`, `commission`, `deductions`, `bonus`, `netPayable`
- `GymTarget.targetRevenue`
