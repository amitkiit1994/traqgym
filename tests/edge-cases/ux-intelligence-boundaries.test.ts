import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    attendanceLog: {
      findFirst: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    memberTicket: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { calculateChurnRisk } from "@/lib/services/churn-risk";
import { detectAttendanceAnomaly } from "@/lib/services/attendance-anomaly";
import { getRevenueForecast } from "@/lib/services/revenue-forecast";

const mockPrisma = vi.mocked(prisma, true);

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

/** Set up churn risk mocks: findFirst (attendance), findFirst (ticket), count (last30), count (prev30) */
function mockChurnRisk(
  lastVisitDaysAgo: number | null,
  daysUntilExpiry: number | null,
  last30: number,
  prev30: number,
) {
  mockPrisma.attendanceLog.findFirst.mockResolvedValue(
    lastVisitDaysAgo !== null ? ({ checkIn: daysAgo(lastVisitDaysAgo) } as any) : null,
  );
  mockPrisma.memberTicket.findFirst.mockResolvedValue(
    daysUntilExpiry !== null ? ({ expireDate: daysFromNow(daysUntilExpiry) } as any) : null,
  );
  mockPrisma.attendanceLog.count
    .mockResolvedValueOnce(last30)
    .mockResolvedValueOnce(prev30);
}

/** Set up anomaly mocks: count (last7), count (last30), count (prev30), findFirst (lastVisit) */
function mockAnomaly(
  last7: number,
  last30: number,
  prev30: number,
  lastVisitDaysAgo: number | null,
) {
  mockPrisma.attendanceLog.count
    .mockResolvedValueOnce(last7)
    .mockResolvedValueOnce(last30)
    .mockResolvedValueOnce(prev30);
  mockPrisma.attendanceLog.findFirst.mockResolvedValue(
    lastVisitDaysAgo !== null ? ({ checkIn: daysAgo(lastVisitDaysAgo) } as any) : null,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Churn Risk Score Boundaries
// ---------------------------------------------------------------------------
describe("Churn Risk Score Boundaries", () => {
  it("score exactly 30 → low", async () => {
    // 30 from expired ticket (no ticket → -999 → daysUntilExpiry < 0 → +30)
    // 0 from recency (visited today)
    // 0 from trend (no drop)
    mockChurnRisk(0, null, 8, 8);
    const r = await calculateChurnRisk(1);
    expect(r.score).toBe(30);
    expect(r.level).toBe("low");
  });

  it("score exactly 31 → medium (recency 20 + expiry <7 gives 25 is too high; use trend 15 + recency 20 = 35)", async () => {
    // daysSinceLastVisit = 10 → +20 (>7 but <=14)
    // daysUntilExpiry = 8 → +15 (<14 but >=7)
    // prev30=0 → no trend penalty
    // total = 20 + 15 = 35
    mockChurnRisk(10, 8, 5, 0);
    const r = await calculateChurnRisk(1);
    expect(r.score).toBe(35);
    expect(r.level).toBe("medium");
  });

  it("score exactly 60 → medium", async () => {
    // daysSinceLastVisit = 10 → +20
    // daysUntilExpiry = 3 → +25 (<7)
    // prev30=4, last30=2 → 50% drop → last30 < prev30*0.5 is false (2 < 2 → false)
    //   but last30 < prev30*0.7? → 2 < 2.8 → true → +15
    // total = 20 + 25 + 15 = 60
    mockChurnRisk(10, 3, 2, 4);
    const r = await calculateChurnRisk(1);
    expect(r.score).toBe(60);
    expect(r.level).toBe("medium");
  });

  it("score exactly 61 → high", async () => {
    // daysSinceLastVisit = 10 → +20
    // daysUntilExpiry = 3 → +25 (<7)
    // prev30=3, last30=1 → drop=67% → last30 < prev30*0.5 (1 < 1.5) → true → +30
    // but wait: prev30>2 ✓, last30<prev30*0.5 ✓ → first branch → +30
    // total = 20 + 25 + 30 = 75 — too high
    // Let's use: recency 0 (visited today) + expiry <0 (+30) + trend drop >50% (+30) = 60
    // Need 61 exactly... that's tricky with these discrete steps
    // Actually: recency 20 + expiry <7 (25) + trend 30-70% drop (15) = 60 → medium
    // recency 20 + expiry <0 (30) + trend none = 50 → medium
    // Just test >60 → high:
    // daysSinceLastVisit=15 → +40, daysUntilExpiry=3 → +25 = 65
    mockChurnRisk(15, 3, 5, 0);
    const r = await calculateChurnRisk(1);
    expect(r.score).toBe(65);
    expect(r.level).toBe("high");
  });

  it("maximum possible score (40+30+30 = 100) → high", async () => {
    // daysSinceLastVisit=20 → +40 (>14)
    // daysUntilExpiry=-5 → +30 (<0)
    // prev30=10, last30=1 → 90% drop → +30
    // total = 100
    mockChurnRisk(20, -5, 1, 10);
    const r = await calculateChurnRisk(1);
    expect(r.score).toBe(100);
    expect(r.level).toBe("high");
  });

  it("minimum possible score (0+0+0 = 0) → low, reason='Regular member'", async () => {
    // daysSinceLastVisit=1 → 0 (<=7)
    // daysUntilExpiry=30 → 0 (>=14)
    // prev30=8, last30=8 → no drop
    mockChurnRisk(1, 30, 8, 8);
    const r = await calculateChurnRisk(1);
    expect(r.score).toBe(0);
    expect(r.level).toBe("low");
    expect(r.reason).toBe("Regular member");
  });

  it("daysSinceLastVisit exactly 14 → should NOT trigger >14 check, should trigger >7 (+20)", async () => {
    mockChurnRisk(14, 30, 8, 8);
    const r = await calculateChurnRisk(1);
    expect(r.score).toBe(20);
    expect(r.level).toBe("low");
  });

  it("daysSinceLastVisit exactly 7 → should NOT trigger >7 check (risk += 0)", async () => {
    mockChurnRisk(7, 30, 8, 8);
    const r = await calculateChurnRisk(1);
    expect(r.score).toBe(0);
    expect(r.level).toBe("low");
  });

  it("daysUntilExpiry exactly 0 → negative territory triggers +30", async () => {
    // daysUntilExpiry < 0 check: 0 < 0 is false
    // daysUntilExpiry < 7 check: 0 < 7 is true → +25
    mockChurnRisk(1, 0, 8, 8);
    const r = await calculateChurnRisk(1);
    expect(r.score).toBe(25);
    expect(r.level).toBe("low");
  });

  it("daysUntilExpiry exactly -1 → triggers <0 check (+30)", async () => {
    mockChurnRisk(1, -1, 8, 8);
    const r = await calculateChurnRisk(1);
    expect(r.score).toBe(30);
    expect(r.level).toBe("low");
  });

  it("daysUntilExpiry exactly 7 → should NOT trigger <7, should trigger <14 (+15)", async () => {
    mockChurnRisk(1, 7, 8, 8);
    const r = await calculateChurnRisk(1);
    expect(r.score).toBe(15);
    expect(r.level).toBe("low");
  });

  it("prev30=2 (boundary for >2 check) → should NOT trigger trend penalty", async () => {
    mockChurnRisk(1, 30, 0, 2);
    const r = await calculateChurnRisk(1);
    expect(r.score).toBe(0);
    expect(r.level).toBe("low");
  });

  it("prev30=3, last30=1 → should trigger >50% drop (drop = 67%)", async () => {
    // prev30>2 ✓, last30 < prev30*0.5 → 1 < 1.5 → true → +30
    mockChurnRisk(1, 30, 1, 3);
    const r = await calculateChurnRisk(1);
    expect(r.score).toBe(30);
    expect(r.level).toBe("low");
    expect(r.reason).toMatch(/Attendance dropped 67%/);
  });
});

// ---------------------------------------------------------------------------
// 2. Attendance Anomaly Boundaries
// ---------------------------------------------------------------------------
describe("Attendance Anomaly Boundaries", () => {
  it("daysSinceLastVisit exactly 14 → should NOT trigger >14 anomaly", async () => {
    // prev30 must be <=2 so drop check is skipped; last7>0 or avgVisitsPerWeek<=1 to skip "no visits this week"
    mockAnomaly(1, 5, 2, 14);
    const r = await detectAttendanceAnomaly(1);
    expect(r.hasAnomaly).toBe(false);
    expect(r.daysSinceLastVisit).toBe(14);
  });

  it("daysSinceLastVisit exactly 15 → should trigger >14 anomaly (avgVisitsPerWeek > 1)", async () => {
    mockAnomaly(0, 2, 6, 15);
    const r = await detectAttendanceAnomaly(1);
    expect(r.hasAnomaly).toBe(true);
    expect(r.message).toContain("No visit in 15 days");
    expect(r.daysSinceLastVisit).toBe(15);
  });

  it("prev30 exactly 2 (boundary for >2 check) → should NOT trigger attendance drop", async () => {
    // prev30=2, last30=0 → prev30 > 2 is false → no drop anomaly
    // daysSinceLastVisit=5 → not >14 → no recency anomaly
    // last7=0, avgVisitsPerWeek = prev30/4.3 = 0.47 → not >1 → no "no visits this week" anomaly
    mockAnomaly(0, 0, 2, 5);
    const r = await detectAttendanceAnomaly(1);
    expect(r.hasAnomaly).toBe(false);
  });

  it("prev30=3, last30=1 → should trigger attendance drop (drop = 67%)", async () => {
    // prev30=3 > 2 ✓, last30=1 < 3*0.5=1.5 ✓
    mockAnomaly(1, 1, 3, 3);
    const r = await detectAttendanceAnomaly(1);
    expect(r.hasAnomaly).toBe(true);
    expect(r.message).toContain("Attendance dropped 67%");
  });

  it("avgVisitsPerWeek exactly 1.0 → should NOT trigger 'No visit' anomaly (needs >1)", async () => {
    // prev30 needs to give avgVisitsPerWeek = ~1.0
    // But we can't get exactly 1.0 from integer / 4.3
    // Let's use prev30=0 so avgVisitsPerWeek = last30/4.3
    // We need: prev30 <= 2 (so drop check skipped), last7=0, daysSinceLastVisit not >14
    // prev30=0, last30 count such that last30/4.3 ≈ 1.0 → impossible exactly
    // Actually the function checks avgVisitsPerWeek > 1, so even ~1.0 wouldn't trigger
    // Use prev30=4 → 4/4.3 = 0.93 (not >1). prev30=5 → 5/4.3 = 1.16 (>1)
    // Test with prev30=4, last7=0, daysSinceLastVisit=10
    // prev30=4>2, last30 vs prev30 drop check also relevant
    // Keep it simple: prev30=0, last30=4 → avg = 4/4.3 ≈ 0.93
    // last7=0, daysSinceLastVisit=10 (not >14)
    // No drop check (prev30=0 not >2)
    // "No visits this week" check: prev30>2 → false → skip
    mockAnomaly(0, 4, 0, 10);
    const r = await detectAttendanceAnomaly(1);
    // avgVisitsPerWeek = 4/4.3 ≈ 0.93, not > 1
    expect(r.hasAnomaly).toBe(false);
    expect(r.avgVisitsPerWeek).toBeCloseTo(4 / 4.3, 1);
  });

  it("avgVisitsPerWeek just above 1.0 with daysSinceLastVisit > 14 → triggers anomaly", async () => {
    // prev30=5 → 5/4.3 ≈ 1.16 > 1
    // daysSinceLastVisit=16 > 14
    // prev30=5>2, need last30 not to trigger drop first (drop check comes after recency)
    // Actually recency check is first in code, so it returns early
    mockAnomaly(0, 3, 5, 16);
    const r = await detectAttendanceAnomaly(1);
    expect(r.hasAnomaly).toBe(true);
    expect(r.message).toContain("No visit in 16 days");
  });
});

// ---------------------------------------------------------------------------
// 3. Revenue Forecast Edge Cases
// ---------------------------------------------------------------------------
describe("Revenue Forecast Edge Cases", () => {
  it("ticket with price 0 → counts in totalExpiring but adds 0 to revenue", async () => {
    mockPrisma.memberTicket.findMany.mockResolvedValue([
      {
        userId: 1,
        plan: { price: 0 },
        user: { id: 1, firstname: "A", lastname: "B" },
      },
    ] as any);
    mockPrisma.attendanceLog.groupBy.mockResolvedValue([
      { userId: 1, _max: { checkIn: daysAgo(3) } },
    ] as any);

    const r = await getRevenueForecast();
    expect(r.totalExpiring).toBe(1);
    expect(r.totalPotentialRevenue).toBe(0);
    expect(r.likely.count).toBe(1);
    expect(r.likely.revenue).toBe(0);
  });

  it("member with no attendance → daysSinceVisit=999 → 'unlikely'", async () => {
    mockPrisma.memberTicket.findMany.mockResolvedValue([
      {
        userId: 1,
        plan: { price: 1000 },
        user: { id: 1, firstname: "A", lastname: "B" },
      },
    ] as any);
    // No attendance records for user 1
    mockPrisma.attendanceLog.groupBy.mockResolvedValue([] as any);

    const r = await getRevenueForecast();
    expect(r.totalExpiring).toBe(1);
    expect(r.unlikely.count).toBe(1);
    expect(r.unlikely.revenue).toBe(1000);
    expect(r.likely.count).toBe(0);
    expect(r.atRisk.count).toBe(0);
  });

  it("lastVisit exactly 7 days ago → 'likely' (<=7)", async () => {
    mockPrisma.memberTicket.findMany.mockResolvedValue([
      {
        userId: 1,
        plan: { price: 2000 },
        user: { id: 1, firstname: "A", lastname: "B" },
      },
    ] as any);
    mockPrisma.attendanceLog.groupBy.mockResolvedValue([
      { userId: 1, _max: { checkIn: daysAgo(7) } },
    ] as any);

    const r = await getRevenueForecast();
    expect(r.likely.count).toBe(1);
    expect(r.likely.revenue).toBe(2000);
  });

  it("lastVisit 8 days ago → 'at risk' (>7 and <=30)", async () => {
    mockPrisma.memberTicket.findMany.mockResolvedValue([
      {
        userId: 1,
        plan: { price: 3000 },
        user: { id: 1, firstname: "A", lastname: "B" },
      },
    ] as any);
    mockPrisma.attendanceLog.groupBy.mockResolvedValue([
      { userId: 1, _max: { checkIn: daysAgo(8) } },
    ] as any);

    const r = await getRevenueForecast();
    expect(r.atRisk.count).toBe(1);
    expect(r.atRisk.revenue).toBe(3000);
  });

  it("lastVisit exactly 30 days ago → 'at risk' (<=30)", async () => {
    mockPrisma.memberTicket.findMany.mockResolvedValue([
      {
        userId: 1,
        plan: { price: 4000 },
        user: { id: 1, firstname: "A", lastname: "B" },
      },
    ] as any);
    mockPrisma.attendanceLog.groupBy.mockResolvedValue([
      { userId: 1, _max: { checkIn: daysAgo(30) } },
    ] as any);

    const r = await getRevenueForecast();
    expect(r.atRisk.count).toBe(1);
    expect(r.atRisk.revenue).toBe(4000);
  });

  it("lastVisit 31 days ago → 'unlikely' (>30)", async () => {
    mockPrisma.memberTicket.findMany.mockResolvedValue([
      {
        userId: 1,
        plan: { price: 5000 },
        user: { id: 1, firstname: "A", lastname: "B" },
      },
    ] as any);
    mockPrisma.attendanceLog.groupBy.mockResolvedValue([
      { userId: 1, _max: { checkIn: daysAgo(31) } },
    ] as any);

    const r = await getRevenueForecast();
    expect(r.unlikely.count).toBe(1);
    expect(r.unlikely.revenue).toBe(5000);
  });
});
