/**
 * Regression tests for known financial bugs in the codebase.
 *
 * BUG 2 (tax rounding) is FIXED — tests now verify correct behavior.
 * Other bugs (Float vs Decimal) are documented as still present.
 */
import { describe, it, expect } from "vitest";
import { calculateTax } from "@/lib/services/tax";

// ---------------------------------------------------------------------------
// Helpers — replicate the exact arithmetic used in the service layer
// ---------------------------------------------------------------------------

/** Simulates partial-payment balance tracking from lib/services/partial-payment.ts lines 23-24 */
function simulatePartialPayments(
  total: number,
  payments: number[]
): { amountPaid: number; balanceDue: number } {
  let amountPaid = 0;
  let balanceDue = total;
  for (const p of payments) {
    amountPaid = amountPaid + p; // line 23
    balanceDue = balanceDue - p; // line 24
  }
  return { amountPaid, balanceDue: Math.max(0, balanceDue) }; // line 33
}

/** Simulates gift-card redemption from lib/services/gift-cards.ts line 69 */
function simulateGiftCardRedemptions(initial: number, redemptions: number[]): {
  balance: number;
  wouldMarkRedeemed: boolean;
} {
  let balance = initial;
  for (const r of redemptions) {
    balance = balance - r; // line 69
  }
  // line 70: const newStatus = newBalance === 0 ? "redeemed" : "active"
  return { balance, wouldMarkRedeemed: balance === 0 };
}

/** Simulates POS total from lib/services/pos.ts line 38 */
function simulatePosTotal(price: number, quantity: number): number {
  return price * quantity; // line 38
}

// ===========================================================================
// BUG 1 — Float vs Decimal mismatch in partial payments
//
// Payment.amount is Decimal(10,2) but MemberTicket.amountPaid and balanceDue
// are Float. Successive Float addition/subtraction accumulates IEEE-754 error.
//
// Source: prisma/schema.prisma lines 122-124 (Float fields)
//         lib/services/partial-payment.ts lines 23-24 (plain JS arithmetic)
// ===========================================================================
describe("BUG 1 - Partial-payment Float residual", () => {
  it("299.97 balance with 3 payments of 99.99 leaves a ghost balance", () => {
    const result = simulatePartialPayments(299.97, [99.99, 99.99, 99.99]);
    // Mathematically: 299.97 - 3*99.99 = 0
    // IEEE-754: leaves a tiny positive residual that Math.max(0, ...) does NOT clamp
    expect(result.balanceDue).not.toBe(0);
    expect(result.balanceDue).toBeGreaterThan(0);
    expect(result.balanceDue).toBeLessThan(0.0000001);
    // The member's ticket shows a non-zero balance — followup system flags them
  });

  it("139.93 balance with 7 payments of 19.99 leaves a ghost balance", () => {
    const result = simulatePartialPayments(139.93, Array(7).fill(19.99));
    // 139.93 - 7*19.99 should be 0 but Float disagrees
    expect(result.balanceDue).not.toBe(0);
    expect(result.balanceDue).toBeGreaterThan(0);
  });

  it("amountPaid (Float sum) diverges from correct Decimal sum", () => {
    // 5 payments of 19.99 should sum to 99.95
    const result = simulatePartialPayments(99.95, Array(5).fill(19.99));
    // Float: 19.99 + 19.99 + 19.99 + 19.99 + 19.99 !== 99.95
    // amountPaid is computed by repeated Float addition
    let amountPaid = 0;
    for (let i = 0; i < 5; i++) amountPaid += 19.99;
    expect(amountPaid).not.toBe(99.95);
    // Postgres Decimal(10,2) sum of five 19.99 Payment records IS exactly 99.95
    // So MemberTicket.amountPaid (Float) disagrees with SUM(Payment.amount) (Decimal)
  });

  it("7 payments of 19.99: amountPaid Float sum !== 139.93", () => {
    let amountPaid = 0;
    for (let i = 0; i < 7; i++) amountPaid += 19.99;
    expect(amountPaid).not.toBe(139.93);
    // This means the ticket's amountPaid field drifts from the actual Decimal payments
  });
});

// ===========================================================================
// BUG 2 — Tax rounding: exclusive mode returns un-rounded totalAmount
//
// In exclusive mode (line 20): totalAmount = amount + taxAmount
// This Float addition can produce values with >2 decimal places, which are
// stored in Float fields (Payment.baseAmount, taxAmount are Float).
//
// For inclusive mode, baseAmount + taxAmount can also !== totalAmount due to
// IEEE-754 Float addition, even though both operands are correctly rounded.
//
// Source: lib/services/tax.ts lines 14-20
// ===========================================================================
describe("BUG 2 - Tax calculation precision issues (FIXED)", () => {
  it("inclusive tax: baseAmount + taxAmount === totalAmount (totalAmount is the input)", () => {
    const rate = 18;
    // In inclusive mode, totalAmount is always the input amount,
    // so baseAmount + taxAmount should reconstruct it.
    // Float addition of two rounded values can still drift, but
    // the identity base + tax === total holds because total = input.
    const result = calculateTax(1000, rate, true);
    expect(result.totalAmount).toBe(1000);
    expect(result.baseAmount + result.taxAmount).toBe(1000);
  });

  it("exclusive tax: totalAmount is now properly rounded to 2 decimal places", () => {
    const rate = 18;
    let unroundedCount = 0;

    for (let cents = 1; cents <= 100000; cents++) {
      const amount = cents / 100;
      const result = calculateTax(amount, rate, false);
      // totalAmount is now: Math.round((amount + taxAmount) * 100) / 100
      const rounded = Math.round(result.totalAmount * 100) / 100;
      if (result.totalAmount !== rounded) {
        unroundedCount++;
      }
    }

    // FIX verified: all totalAmount values are properly rounded
    expect(unroundedCount).toBe(0);
  });

  it("specific case: 0.05 exclusive at 18% returns totalAmount 0.06 (FIXED)", () => {
    const result = calculateTax(0.05, 18, false);
    // taxAmount = round(0.05 * 0.18 * 100) / 100 = round(0.9) / 100 = 0.01
    expect(result.taxAmount).toBe(0.01);
    // totalAmount is now rounded: Math.round((0.05 + 0.01) * 100) / 100 = 0.06
    expect(result.totalAmount).toBe(0.06);
  });

  it("tax report sums (Float reduce) compound the error over many transactions", () => {
    // Simulates tax.ts line 62: payments.reduce((sum, p) => sum + (p.taxAmount || 0), 0)
    const rate = 18;
    const amounts: number[] = [];
    for (let i = 0; i < 500; i++) {
      const r = calculateTax(1000 + i, rate, true);
      amounts.push(r.taxAmount);
    }
    const reducedSum = amounts.reduce((s, a) => s + a, 0);
    // Integer arithmetic would give exact sum
    const exactSum = amounts.reduce((s, a) => s + Math.round(a * 100), 0) / 100;
    expect(reducedSum).not.toBe(exactSum);
  });
});

// ===========================================================================
// BUG 3 — Gift card Float balance residual
//
// GiftCard.amount and balance are Float (schema lines 568-569).
// Successive subtractions (line 69) accumulate IEEE-754 error.
// The === 0 check (line 70) fails, leaving cards in "active" status with
// ghost balances that can't be used.
//
// Source: prisma/schema.prisma lines 568-569
//         lib/services/gift-cards.ts lines 69-70
// ===========================================================================
describe("BUG 3 - Gift card Float balance", () => {
  it("100.10 - 3 x 33.37 does not equal exactly -0.01", () => {
    const gc = simulateGiftCardRedemptions(100.10, [33.37, 33.37, 33.37]);
    // Mathematically: 100.10 - 100.11 = -0.01
    // Float: -0.010000000000005116
    expect(gc.balance).not.toBe(-0.01);
    expect(gc.balance).not.toBe(0);
    // The comparison `amount > card.balance` on line 67 could misbehave
    // because the balance is not the expected -0.01
    expect(Math.abs(gc.balance - (-0.01))).toBeGreaterThan(0);
    expect(Math.abs(gc.balance - (-0.01))).toBeLessThan(1e-10);
  });

  it("10 redemptions of 10.01 from 100.10 card: balance !== 0, card stays active", () => {
    const gc = simulateGiftCardRedemptions(100.10, Array(10).fill(10.01));
    // Mathematically: 100.10 - 100.10 = 0
    // Float: ~-1.07e-14
    expect(gc.balance).not.toBe(0);
    // line 70: newBalance === 0 ? "redeemed" : "active"
    expect(gc.wouldMarkRedeemed).toBe(false);
    // Card stays "active" with a ghost balance — user sees it as available
    // but any redemption attempt would fail the `amount > card.balance` check
  });

  it("5 redemptions of 20.02 from 100.10 card: balance !== 0, card stays active", () => {
    const gc = simulateGiftCardRedemptions(100.10, Array(5).fill(20.02));
    // 100.10 - 100.10 = 0, but Float disagrees
    expect(gc.wouldMarkRedeemed).toBe(false);
    expect(gc.balance).not.toBe(0);
  });

  it("the ghost balance is too small to redeem, creating a zombie card", () => {
    const gc = simulateGiftCardRedemptions(100.10, Array(10).fill(10.01));
    // Balance is approximately 0 but negative (or positive by a tiny amount)
    // Any redemption of > 0 would fail the balance check
    // The card is stuck: not redeemed, not usable
    const absBalance = Math.abs(gc.balance);
    expect(absBalance).toBeLessThan(0.01);
    expect(absBalance).toBeGreaterThan(0);
  });
});

// ===========================================================================
// BUG 4 — POS Float precision in price * quantity
//
// Product.price, Sale.unitPrice, Sale.totalAmount are all Float.
// pos.ts line 38: totalAmount = product.price * params.quantity
// No rounding is applied, so the stored totalAmount can have >2 decimal places.
//
// Source: prisma/schema.prisma lines 634, 648-649
//         lib/services/pos.ts line 38
// ===========================================================================
describe("BUG 4 - POS price * quantity Float precision", () => {
  it("19.99 * 7 is not exactly 139.93", () => {
    const total = simulatePosTotal(19.99, 7);
    expect(total).not.toBe(139.93);
    // Actual: 139.92999999999998
    expect(total).toBeLessThan(139.93);
  });

  it("19.99 * 5 is not exactly 99.95", () => {
    const total = simulatePosTotal(19.99, 5);
    expect(total).not.toBe(99.95);
  });

  it("0.10 * 3 is not exactly 0.30 (classic IEEE-754)", () => {
    const total = simulatePosTotal(0.10, 3);
    expect(total).not.toBe(0.30);
    expect(total).toBeGreaterThan(0.30);
  });

  it("survey of realistic gym retail prices shows widespread imprecision", () => {
    // Common Indian gym retail items: protein bars, shakes, accessories
    const prices = [
      19.99, 29.99, 39.99, 49.99, 59.99, 79.99, 99.99,
      149.99, 199.99, 249.99, 299.99, 399.99, 499.99,
      149.50, 299.50, 75.50,
    ];
    const quantities = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20];
    let impreciseCount = 0;
    let totalCombinations = 0;

    for (const price of prices) {
      for (const qty of quantities) {
        totalCombinations++;
        const floatResult = price * qty;
        // Correct result via integer arithmetic on paise
        const correctPaise = Math.round(price * 100) * qty;
        const correct = correctPaise / 100;
        if (floatResult !== correct) {
          impreciseCount++;
        }
      }
    }

    expect(impreciseCount).toBeGreaterThan(0);
    console.log(
      `POS imprecision: ${impreciseCount}/${totalCombinations} price*qty combinations are inexact`
    );
  });

  it("sales report totalRevenue accumulates Float error via reduce", () => {
    // Simulates pos.ts line 130: totalRevenue += s.totalAmount
    const saleAmounts = Array(100).fill(simulatePosTotal(19.99, 7));
    const reducedTotal = saleAmounts.reduce((sum: number, a: number) => sum + a, 0);
    const expected = 139.93 * 100; // 13993
    expect(reducedTotal).not.toBe(expected);
  });
});

// ===========================================================================
// BUG 5 — Accumulated Float error in financial reports
//
// Both getTaxReport (tax.ts lines 61-63) and getSalesReport (pos.ts 128-130)
// sum Float fields with .reduce(), compounding IEEE-754 error across
// potentially thousands of records.
//
// Source: lib/services/tax.ts lines 61-63
//         lib/services/pos.ts lines 128-131
// ===========================================================================
describe("BUG 5 - Report aggregation compounds Float errors", () => {
  it("summing 1000 payments of 33.33 via reduce does not equal 33330", () => {
    const amounts = Array(1000).fill(33.33);
    const reducedSum = amounts.reduce((sum: number, a: number) => sum + a, 0);
    expect(reducedSum).not.toBe(33330);
    const drift = Math.abs(reducedSum - 33330);
    expect(drift).toBeGreaterThan(0);
    console.log(`Report drift over 1000 records of 33.33: ${drift.toExponential(4)} rupees`);
  });

  it("summing 5000 payments of 19.99 via reduce drifts from 99950", () => {
    const amounts = Array(5000).fill(19.99);
    const reducedSum = amounts.reduce((sum: number, a: number) => sum + a, 0);
    expect(reducedSum).not.toBe(99950);
    const drift = Math.abs(reducedSum - 99950);
    expect(drift).toBeGreaterThan(0);
    console.log(`Report drift over 5000 records of 19.99: ${drift.toExponential(4)} rupees`);
  });

  it("monthly revenue report with mixed amounts accumulates detectable drift", () => {
    // Simulate a month of gym transactions
    const transactions = [
      ...Array(200).fill(2999.00),  // membership renewals
      ...Array(150).fill(1499.50),  // partial payments
      ...Array(500).fill(49.99),    // POS sales
      ...Array(100).fill(33.33),    // partial followups
    ];
    const reducedTotal = transactions.reduce((s: number, a: number) => s + a, 0);
    // Integer-arithmetic correct total
    const correctTotal = (200 * 299900 + 150 * 149950 + 500 * 4999 + 100 * 3333) / 100;
    expect(reducedTotal).not.toBe(correctTotal);
    const drift = Math.abs(reducedTotal - correctTotal);
    console.log(`Monthly report drift: ${drift.toExponential(4)} rupees`);
  });
});
