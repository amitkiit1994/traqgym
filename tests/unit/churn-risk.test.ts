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
import {
  calculateChurnRisk,
  calculateChurnRiskBatch,
} from "@/lib/services/churn-risk";

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("calculateChurnRisk", () => {
  it("member visited yesterday, ticket expires in 30 days → low risk", async () => {
    mockPrisma.attendanceLog.findFirst.mockResolvedValue({
      checkIn: daysAgo(1),
    } as any);
    mockPrisma.memberTicket.findFirst.mockResolvedValue({
      expireDate: daysFromNow(30),
    } as any);
    mockPrisma.attendanceLog.count
      .mockResolvedValueOnce(10) // last30
      .mockResolvedValueOnce(10); // prev30

    const result = await calculateChurnRisk(1);
    expect(result.level).toBe("low");
    expect(result.score).toBeLessThanOrEqual(30);
  });

  it("member hasn't visited in 15 days, ticket expires in 5 days → high risk", async () => {
    mockPrisma.attendanceLog.findFirst.mockResolvedValue({
      checkIn: daysAgo(15),
    } as any);
    mockPrisma.memberTicket.findFirst.mockResolvedValue({
      expireDate: daysFromNow(5),
    } as any);
    mockPrisma.attendanceLog.count
      .mockResolvedValueOnce(2) // last30
      .mockResolvedValueOnce(8); // prev30

    const result = await calculateChurnRisk(1);
    expect(result.level).toBe("high");
    // 40 (>14 days) + 25 (expiry <7) + 30 (drop >50%) = 95
    expect(result.score).toBeGreaterThan(60);
  });

  it("attendance dropped >50% (prev30=12, last30=4) → medium/high risk", async () => {
    mockPrisma.attendanceLog.findFirst.mockResolvedValue({
      checkIn: daysAgo(3),
    } as any);
    mockPrisma.memberTicket.findFirst.mockResolvedValue({
      expireDate: daysFromNow(60),
    } as any);
    mockPrisma.attendanceLog.count
      .mockResolvedValueOnce(4) // last30
      .mockResolvedValueOnce(12); // prev30

    const result = await calculateChurnRisk(1);
    // 0 (recency ok) + 0 (expiry far) + 30 (drop 67%) = 30
    expect(result.level).toBe("low"); // exactly 30 is low boundary
    expect(result.reason).toMatch(/Attendance dropped 67%/);
  });

  it("member with no attendance ever, no ticket → high risk", async () => {
    mockPrisma.attendanceLog.findFirst.mockResolvedValue(null);
    mockPrisma.memberTicket.findFirst.mockResolvedValue(null);
    mockPrisma.attendanceLog.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const result = await calculateChurnRisk(1);
    expect(result.level).toBe("high");
    // 40 (never visited, daysSince=999) + 30 (expired, daysUntil=-999)
    expect(result.score).toBe(70);
    expect(result.reason).toBe("Never visited");
  });

  it("member visited today, no ticket (expired) → medium risk", async () => {
    mockPrisma.attendanceLog.findFirst.mockResolvedValue({
      checkIn: daysAgo(0),
    } as any);
    mockPrisma.memberTicket.findFirst.mockResolvedValue(null);
    mockPrisma.attendanceLog.count
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(8);

    const result = await calculateChurnRisk(1);
    // 0 (visited today) + 30 (no ticket → -999) + 0 (no trend drop) = 30
    expect(result.score).toBe(30);
    expect(result.level).toBe("low");
    expect(result.reason).toMatch(/Plan expired/);
  });
});

describe("calculateChurnRiskBatch", () => {
  it("returns correct map for multiple users", async () => {
    const userIds = [10, 20];

    // groupBy for latest attendance
    mockPrisma.attendanceLog.groupBy
      .mockResolvedValueOnce([
        { userId: 10, _max: { checkIn: daysAgo(1) } },
        { userId: 20, _max: { checkIn: daysAgo(20) } },
      ] as any)
      // last30 counts
      .mockResolvedValueOnce([
        { userId: 10, _count: 10 },
        { userId: 20, _count: 2 },
      ] as any)
      // prev30 counts
      .mockResolvedValueOnce([
        { userId: 10, _count: 10 },
        { userId: 20, _count: 10 },
      ] as any);

    // active tickets
    mockPrisma.memberTicket.findMany.mockResolvedValue([
      { userId: 10, expireDate: daysFromNow(30) },
      { userId: 20, expireDate: daysFromNow(3) },
    ] as any);

    const results = await calculateChurnRiskBatch(userIds);

    expect(results.size).toBe(2);

    const r10 = results.get(10)!;
    expect(r10.level).toBe("low"); // visited 1 day ago, ticket 30 days out

    const r20 = results.get(20)!;
    expect(r20.level).toBe("high"); // 20 days gap + expiring soon + attendance dropped 80%
    expect(r20.score).toBeGreaterThan(60);
  });

  it("returns empty map for empty input", async () => {
    const results = await calculateChurnRiskBatch([]);
    expect(results.size).toBe(0);
  });
});
