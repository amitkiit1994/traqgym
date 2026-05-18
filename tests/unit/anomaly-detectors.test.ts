import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma before importing the service. The detectors only touch
// findMany / count / groupBy on a handful of models; stub each one.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    payment: { findMany: vi.fn(), groupBy: vi.fn() },
    refund: { findMany: vi.fn() },
    auditLog: { findMany: vi.fn() },
    memberTicket: { findMany: vi.fn() },
    worker: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  detectDuplicatePayments,
  detectDiscountOutliers,
} from "@/lib/services/anomaly";

const mockPrisma = vi.mocked(prisma, true);

beforeEach(() => {
  vi.clearAllMocks();
});

const range = {
  from: new Date("2026-05-01T00:00:00Z"),
  to: new Date("2026-05-18T23:59:59Z"),
};

// Shared row factory — mocks the exact select shape used by the detector.
function payment(opts: {
  id: number;
  userId: number;
  amount: number;
  createdAt: Date;
  collectedById?: number;
  paymentMode?: string;
}) {
  return {
    id: opts.id,
    userId: opts.userId,
    amount: opts.amount,
    createdAt: opts.createdAt,
    paymentMode: opts.paymentMode ?? "cash",
    collectedById: opts.collectedById ?? 1,
    user: { firstname: "Test", lastname: "User", phone: "9999999999" },
    collectedBy: { firstname: "Cashier", lastname: "One" },
  };
}

describe("detectDuplicatePayments", () => {
  it("flags [₹500, ₹2000, ₹500] same-user within window as a duplicate", async () => {
    // Regression for the pre-fix bug: the old sort by (userId, createdAt)
    // walked adjacent pairs only, so the two ₹500s were never compared.
    // After the fix, sort is (userId, amount, createdAt) so equal-amount
    // payments by the same user end up adjacent regardless of intermediate
    // non-duplicates.
    const t1 = new Date("2026-05-15T10:00:00Z");
    const t2 = new Date("2026-05-15T10:02:00Z");
    const t3 = new Date("2026-05-15T10:05:00Z");

    // Service calls findMany with orderBy: [userId asc, amount asc,
    // createdAt asc]. We return them in that already-sorted order so the
    // service's contract with Prisma is preserved.
    mockPrisma.payment.findMany.mockResolvedValue([
      payment({ id: 1, userId: 100, amount: 500, createdAt: t1 }),
      payment({ id: 3, userId: 100, amount: 500, createdAt: t3 }),
      payment({ id: 2, userId: 100, amount: 2000, createdAt: t2 }),
    ] as any);

    const result = await detectDuplicatePayments({ ...range, windowMinutes: 10 });

    expect(result.suspectCount).toBe(1);
    expect(result.suspects[0].paymentIds).toEqual([1, 3]);
    expect(result.suspects[0].amount).toBe(500);
    expect(result.suspects[0].gapSeconds).toBe(300); // 5 minutes
  });

  it("does not flag same-amount payments by different users", async () => {
    const t = new Date("2026-05-15T10:00:00Z");
    mockPrisma.payment.findMany.mockResolvedValue([
      payment({ id: 1, userId: 100, amount: 500, createdAt: t }),
      payment({ id: 2, userId: 200, amount: 500, createdAt: t }),
    ] as any);

    const result = await detectDuplicatePayments(range);
    expect(result.suspectCount).toBe(0);
  });

  it("does not flag same-amount payments outside the window", async () => {
    const t1 = new Date("2026-05-15T10:00:00Z");
    const t2 = new Date("2026-05-15T10:30:00Z"); // 30 min apart
    mockPrisma.payment.findMany.mockResolvedValue([
      payment({ id: 1, userId: 100, amount: 500, createdAt: t1 }),
      payment({ id: 2, userId: 100, amount: 500, createdAt: t2 }),
    ] as any);

    const result = await detectDuplicatePayments({ ...range, windowMinutes: 10 });
    expect(result.suspectCount).toBe(0);
  });

  it("reports truncated:true when payment count hits MAX_ROWS", async () => {
    // MAX_ROWS = 100_000 — simulate by returning exactly that many rows.
    const t = new Date("2026-05-15T10:00:00Z");
    const rows = Array.from({ length: 100_000 }, (_, i) =>
      payment({ id: i + 1, userId: i + 1, amount: 100, createdAt: t }),
    );
    mockPrisma.payment.findMany.mockResolvedValue(rows as any);

    const result = await detectDuplicatePayments(range);
    expect(result.truncated).toBe(true);
  });
});

describe("detectDiscountOutliers", () => {
  function discountPayment(opts: { collectedById: number; discount: number; name?: string }) {
    return {
      amount: 1000,
      discount: opts.discount,
      collectedById: opts.collectedById,
      collectedBy: { firstname: opts.name ?? "Staff", lastname: String(opts.collectedById) },
    };
  }

  it("does not flag a collector with fewer than 5 discounted payments even if median is high", async () => {
    // The fix added MIN_OUTLIER_PAYMENTS = 5: a new staffer with 2 high
    // discounts shouldn't look like an outlier.
    // Network has lots of low discounts (median ~₹50) + 2 huge ones from
    // a single new staffer. Without the guard, the new staffer would be
    // flagged. With the guard, they shouldn't be.
    const lowDiscounts = Array.from({ length: 20 }, (_, i) =>
      discountPayment({ collectedById: 1, discount: 50 + i }),
    );
    const newStafferHuge = [
      discountPayment({ collectedById: 99, discount: 5000, name: "New" }),
      discountPayment({ collectedById: 99, discount: 6000, name: "New" }),
    ];
    mockPrisma.payment.findMany.mockResolvedValue([
      ...lowDiscounts,
      ...newStafferHuge,
    ] as any);

    const result = await detectDiscountOutliers(range);

    const newStaffer = result.byCollector.find(c => c.name === "New 99");
    expect(newStaffer).toBeDefined();
    expect(newStaffer!.paymentCount).toBe(2);
    expect(newStaffer!.isOutlier).toBe(false);
    expect(result.outliers.find(o => o.name === "New 99")).toBeUndefined();
    expect(result.minOutlierPaymentCount).toBe(5);
  });

  it("does flag a collector with >=5 discounted payments and 1.5x median", async () => {
    // Same scenario but the outlier staffer has 6 payments — should now
    // cross the guard and be flagged.
    const lowDiscounts = Array.from({ length: 20 }, () =>
      discountPayment({ collectedById: 1, discount: 50 }),
    );
    const heavy = Array.from({ length: 6 }, () =>
      discountPayment({ collectedById: 99, discount: 5000, name: "Heavy" }),
    );
    mockPrisma.payment.findMany.mockResolvedValue([
      ...lowDiscounts,
      ...heavy,
    ] as any);

    const result = await detectDiscountOutliers(range);
    const heavyStaffer = result.outliers.find(o => o.name === "Heavy 99");
    expect(heavyStaffer).toBeDefined();
    expect(heavyStaffer!.paymentCount).toBe(6);
  });
});
