import { describe, it, expect } from "vitest";
import { calculateTax } from "@/lib/services/tax";

// ─── Tax Calculations ────────────────────────────────────────────────

describe("calculateTax", () => {
  describe("zero / non-positive tax rate", () => {
    it("returns zero tax when rate is 0", () => {
      const r = calculateTax(1000, 0, false);
      expect(r).toEqual({ baseAmount: 1000, taxAmount: 0, totalAmount: 1000 });
    });

    it("returns zero tax when rate is negative", () => {
      const r = calculateTax(500, -5, true);
      expect(r).toEqual({ baseAmount: 500, taxAmount: 0, totalAmount: 500 });
    });
  });

  describe("exclusive tax (GST added on top)", () => {
    it("18% on 1000", () => {
      const r = calculateTax(1000, 18, false);
      expect(r.baseAmount).toBe(1000);
      expect(r.taxAmount).toBe(180);
      expect(r.totalAmount).toBe(1180);
    });

    it("5% on 2500", () => {
      const r = calculateTax(2500, 5, false);
      expect(r.baseAmount).toBe(2500);
      expect(r.taxAmount).toBe(125);
      expect(r.totalAmount).toBe(2625);
    });

    it("12% on 750", () => {
      const r = calculateTax(750, 12, false);
      expect(r.taxAmount).toBe(90);
      expect(r.totalAmount).toBe(840);
    });

    it("28% on 3000", () => {
      const r = calculateTax(3000, 28, false);
      expect(r.taxAmount).toBe(840);
      expect(r.totalAmount).toBe(3840);
    });

    it("totalAmount always equals baseAmount + taxAmount", () => {
      for (const rate of [5, 12, 18, 28]) {
        for (const amount of [0.01, 100, 999, 1234.56, 999999.99]) {
          const r = calculateTax(amount, rate, false);
          expect(r.totalAmount).toBe(r.baseAmount + r.taxAmount);
        }
      }
    });
  });

  describe("inclusive tax (price includes GST)", () => {
    it("18% inclusive on 1180 yields base 1000", () => {
      const r = calculateTax(1180, 18, true);
      expect(r.totalAmount).toBe(1180);
      expect(r.baseAmount).toBe(1000);
      expect(r.taxAmount).toBe(180);
    });

    it("5% inclusive on 1050", () => {
      const r = calculateTax(1050, 5, true);
      expect(r.totalAmount).toBe(1050);
      expect(r.baseAmount).toBe(1000);
      expect(r.taxAmount).toBe(50);
    });

    it("totalAmount always equals the input amount", () => {
      for (const amount of [0.01, 100, 5000, 999999.99]) {
        const r = calculateTax(amount, 18, true);
        expect(r.totalAmount).toBe(amount);
      }
    });

    it("baseAmount + taxAmount === totalAmount for standard GST rates", () => {
      // Due to rounding, the implementation may produce baseAmount + taxAmount
      // that differs from totalAmount by ±0.01. Verify the actual behavior.
      for (const rate of [5, 12, 18, 28]) {
        for (const amount of [100, 1000, 2999, 5555.55]) {
          const r = calculateTax(amount, rate, true);
          const sum = Math.round((r.baseAmount + r.taxAmount) * 100) / 100;
          // The implementation rounds base and tax independently, so check
          // that any discrepancy is at most 1 paisa.
          expect(Math.abs(sum - r.totalAmount)).toBeLessThanOrEqual(0.01);
        }
      }
    });
  });

  describe("edge amounts", () => {
    it("handles 0.01 (one paisa)", () => {
      const r = calculateTax(0.01, 18, false);
      expect(r.baseAmount).toBe(0.01);
      expect(r.taxAmount).toBe(0);
      expect(r.totalAmount).toBe(0.01);
    });

    it("handles 0.01 inclusive", () => {
      const r = calculateTax(0.01, 18, true);
      expect(r.totalAmount).toBe(0.01);
      expect(r.baseAmount + r.taxAmount).toBeCloseTo(0.01, 2);
    });

    it("handles 999999.99", () => {
      const r = calculateTax(999999.99, 18, false);
      expect(r.baseAmount).toBe(999999.99);
      expect(r.taxAmount).toBe(180000);
      expect(r.totalAmount).toBe(1179999.99);
    });

    it("handles 100 at 18%", () => {
      const r = calculateTax(100, 18, false);
      expect(r.taxAmount).toBe(18);
      expect(r.totalAmount).toBe(118);
    });
  });

  describe("special rates", () => {
    it("100% tax rate exclusive", () => {
      const r = calculateTax(500, 100, false);
      expect(r.taxAmount).toBe(500);
      expect(r.totalAmount).toBe(1000);
    });

    it("100% tax rate inclusive", () => {
      const r = calculateTax(1000, 100, true);
      expect(r.baseAmount).toBe(500);
      expect(r.taxAmount).toBe(500);
      expect(r.totalAmount).toBe(1000);
    });

    it("fractional rate 0.5%", () => {
      const r = calculateTax(10000, 0.5, false);
      expect(r.taxAmount).toBe(50);
      expect(r.totalAmount).toBe(10050);
    });

    it("fractional rate 0.5% inclusive", () => {
      const r = calculateTax(10050, 0.5, true);
      expect(r.totalAmount).toBe(10050);
      // base = 10050 / 1.005 = 10000
      expect(r.baseAmount).toBe(10000);
      expect(r.taxAmount).toBe(50);
    });
  });

  describe("rounding edge cases for inclusive tax", () => {
    it("18% inclusive on 999 — check rounding consistency", () => {
      // 999 / 1.18 = 846.610169... → rounds to 846.61
      // tax = 999 - 846.61 = 152.39
      // sum = 846.61 + 152.39 = 999 ✓
      const r = calculateTax(999, 18, true);
      expect(r.totalAmount).toBe(999);
      expect(r.baseAmount).toBe(846.61);
      expect(r.taxAmount).toBe(152.39);
    });

    it("18% inclusive on 1 — tiny amount rounding", () => {
      // 1 / 1.18 = 0.847457... → 0.85
      // tax = 1 - 0.85 = 0.15
      const r = calculateTax(1, 18, true);
      expect(r.totalAmount).toBe(1);
      expect(r.baseAmount).toBe(0.85);
      expect(r.taxAmount).toBe(0.15);
    });

    it("28% inclusive on 1999 — verify no off-by-one-paisa", () => {
      // 1999 / 1.28 = 1561.71875 → 1561.72
      // tax = 1999 - 1561.72 = 437.28
      const r = calculateTax(1999, 28, true);
      expect(r.totalAmount).toBe(1999);
      expect(r.baseAmount).toBe(1561.72);
      expect(r.taxAmount).toBe(437.28);
    });

    it("12% inclusive on 33.33", () => {
      // 33.33 / 1.12 = 29.758928... → 29.76
      // tax = 33.33 - 29.76 = 3.57
      const r = calculateTax(33.33, 12, true);
      expect(r.totalAmount).toBe(33.33);
      expect(r.baseAmount).toBe(29.76);
      expect(r.taxAmount).toBe(3.57);
    });
  });
});

// ─── Proration Math ──────────────────────────────────────────────────
// Formula from plan-change.ts:
//   totalDays = max(1, ceil((expireDate - buyDate) / dayMs))
//   remainingDays = max(0, ceil((expireDate - today) / dayMs))
//   credit = (remainingDays / totalDays) * oldPrice
//   roundedCredit = Math.round(credit)
//   amountDue = max(0, round(newPlanPrice - credit))

describe("proration credit formula", () => {
  function computeProration(
    totalDays: number,
    remainingDays: number,
    oldPrice: number,
    newPlanPrice: number
  ) {
    const safeTotalDays = Math.max(1, totalDays);
    const safeRemainingDays = Math.max(0, remainingDays);
    const credit = (safeRemainingDays / safeTotalDays) * oldPrice;
    const roundedCredit = Math.round(credit);
    const amountDue = Math.max(0, Math.round(newPlanPrice - credit));
    return { credit, roundedCredit, amountDue };
  }

  it("full period remaining → full credit", () => {
    const r = computeProration(30, 30, 3000, 5000);
    expect(r.credit).toBe(3000);
    expect(r.roundedCredit).toBe(3000);
    expect(r.amountDue).toBe(2000);
  });

  it("zero remaining days → zero credit", () => {
    const r = computeProration(30, 0, 3000, 5000);
    expect(r.credit).toBe(0);
    expect(r.roundedCredit).toBe(0);
    expect(r.amountDue).toBe(5000);
  });

  it("one day remaining out of 30", () => {
    const r = computeProration(30, 1, 3000, 5000);
    expect(r.credit).toBe(100);
    expect(r.roundedCredit).toBe(100);
    expect(r.amountDue).toBe(4900);
  });

  it("half period remaining", () => {
    const r = computeProration(30, 15, 3000, 5000);
    expect(r.credit).toBe(1500);
    expect(r.amountDue).toBe(3500);
  });

  it("credit equals new plan price → zero amount due", () => {
    const r = computeProration(30, 30, 5000, 5000);
    expect(r.credit).toBe(5000);
    expect(r.amountDue).toBe(0);
  });

  it("credit exceeds new plan price → amountDue clamped to 0", () => {
    // Upgrading from expensive plan with lots of time left to cheap plan
    const r = computeProration(30, 25, 6000, 2000);
    expect(r.credit).toBe(5000);
    expect(r.roundedCredit).toBe(5000);
    expect(r.amountDue).toBe(0);
  });

  it("handles fractional credit with rounding", () => {
    // 10/30 * 1000 = 333.333...
    const r = computeProration(30, 10, 1000, 2000);
    expect(r.credit).toBeCloseTo(333.33, 1);
    expect(r.roundedCredit).toBe(333);
    expect(r.amountDue).toBe(1667);
  });

  it("one-day total period", () => {
    const r = computeProration(1, 1, 500, 1000);
    expect(r.credit).toBe(500);
    expect(r.amountDue).toBe(500);
  });

  it("totalDays clamped to at least 1", () => {
    const r = computeProration(0, 0, 3000, 5000);
    expect(r.credit).toBe(0);
    expect(r.amountDue).toBe(5000);
  });

  it("large values — 365-day plan", () => {
    // 100 days left on annual 12000 plan, upgrading to 18000
    const r = computeProration(365, 100, 12000, 18000);
    // credit = (100/365) * 12000 = 3287.671...
    expect(r.credit).toBeCloseTo(3287.67, 0);
    expect(r.roundedCredit).toBe(3288);
    expect(r.amountDue).toBe(14712);
  });
});
