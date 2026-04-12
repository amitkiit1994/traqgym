import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    memberTicket: { findMany: vi.fn() },
    attendanceLog: { groupBy: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { getRevenueForecast } from "@/lib/services/revenue-forecast";

const mockPrisma = vi.mocked(prisma, true);

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getRevenueForecast", () => {
  it("no expiring tickets → all zeros", async () => {
    mockPrisma.memberTicket.findMany.mockResolvedValue([]);
    mockPrisma.attendanceLog.groupBy.mockResolvedValue([] as any);

    const result = await getRevenueForecast();

    expect(result.totalExpiring).toBe(0);
    expect(result.totalPotentialRevenue).toBe(0);
    expect(result.likely).toEqual({ count: 0, revenue: 0 });
    expect(result.atRisk).toEqual({ count: 0, revenue: 0 });
    expect(result.unlikely).toEqual({ count: 0, revenue: 0 });
  });

  it("3 tickets expiring, all visited within 7 days → all likely", async () => {
    mockPrisma.memberTicket.findMany.mockResolvedValue([
      { userId: 1, expireDate: daysFromNow(10), plan: { price: 1000 }, user: { id: 1, firstname: "A", lastname: "A" } },
      { userId: 2, expireDate: daysFromNow(15), plan: { price: 2000 }, user: { id: 2, firstname: "B", lastname: "B" } },
      { userId: 3, expireDate: daysFromNow(20), plan: { price: 1500 }, user: { id: 3, firstname: "C", lastname: "C" } },
    ] as any);

    mockPrisma.attendanceLog.groupBy.mockResolvedValue([
      { userId: 1, _max: { checkIn: daysAgo(2) } },
      { userId: 2, _max: { checkIn: daysAgo(5) } },
      { userId: 3, _max: { checkIn: daysAgo(1) } },
    ] as any);

    const result = await getRevenueForecast();

    expect(result.totalExpiring).toBe(3);
    expect(result.likely).toEqual({ count: 3, revenue: 4500 });
    expect(result.atRisk).toEqual({ count: 0, revenue: 0 });
    expect(result.unlikely).toEqual({ count: 0, revenue: 0 });
    expect(result.totalPotentialRevenue).toBe(4500);
  });

  it("mixed: likely, at risk, unlikely based on last visit", async () => {
    mockPrisma.memberTicket.findMany.mockResolvedValue([
      { userId: 1, expireDate: daysFromNow(10), plan: { price: 1000 }, user: { id: 1, firstname: "A", lastname: "A" } },
      { userId: 2, expireDate: daysFromNow(15), plan: { price: 2000 }, user: { id: 2, firstname: "B", lastname: "B" } },
      { userId: 3, expireDate: daysFromNow(20), plan: { price: 3000 }, user: { id: 3, firstname: "C", lastname: "C" } },
    ] as any);

    mockPrisma.attendanceLog.groupBy.mockResolvedValue([
      { userId: 1, _max: { checkIn: daysAgo(3) } },   // likely (<=7)
      { userId: 2, _max: { checkIn: daysAgo(15) } },  // at risk (<=30)
      { userId: 3, _max: { checkIn: daysAgo(45) } },  // unlikely (>30)
    ] as any);

    const result = await getRevenueForecast();

    expect(result.likely).toEqual({ count: 1, revenue: 1000 });
    expect(result.atRisk).toEqual({ count: 1, revenue: 2000 });
    expect(result.unlikely).toEqual({ count: 1, revenue: 3000 });
    expect(result.totalPotentialRevenue).toBe(6000);
  });

  it("location filter is passed through to the query", async () => {
    mockPrisma.memberTicket.findMany.mockResolvedValue([]);
    mockPrisma.attendanceLog.groupBy.mockResolvedValue([] as any);

    await getRevenueForecast(42);

    const call = mockPrisma.memberTicket.findMany.mock.calls[0][0] as any;
    expect(call.where.locationId).toBe(42);
  });

  it("revenue sums are correct with known plan prices", async () => {
    mockPrisma.memberTicket.findMany.mockResolvedValue([
      { userId: 1, expireDate: daysFromNow(5), plan: { price: 1500 }, user: { id: 1, firstname: "A", lastname: "A" } },
      { userId: 2, expireDate: daysFromNow(5), plan: { price: 2500 }, user: { id: 2, firstname: "B", lastname: "B" } },
    ] as any);

    mockPrisma.attendanceLog.groupBy.mockResolvedValue([
      { userId: 1, _max: { checkIn: daysAgo(1) } },   // likely
      { userId: 2, _max: { checkIn: daysAgo(1) } },   // likely
    ] as any);

    const result = await getRevenueForecast();

    expect(result.likely.revenue).toBe(4000);
    expect(result.totalPotentialRevenue).toBe(4000);
    expect(result.totalExpiring).toBe(2);
  });
});
