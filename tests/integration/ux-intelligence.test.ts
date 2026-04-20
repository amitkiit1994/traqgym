import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    paymentFollowup: { count: vi.fn() },
    enquiry: { count: vi.fn() },
    memberTicket: { count: vi.fn(), findMany: vi.fn() },
    leaveRequest: { count: vi.fn() },
    attendanceLog: { groupBy: vi.fn() },
    approval: { count: vi.fn().mockResolvedValue(0) },
    refund: { count: vi.fn().mockResolvedValue(0) },
    cashShift: { count: vi.fn().mockResolvedValue(0) },
  },
}));

// Sprint 8 Agent E added requireWorker() to getSidebarCounts. Stub it so the
// test exercises the data-shape contract without needing a Next request scope.
vi.mock("@/lib/auth-guard", () => ({
  requireWorker: vi.fn().mockResolvedValue({ id: 1, role: "admin" }),
}));

import { prisma } from "@/lib/prisma";
import { getSidebarCounts } from "@/lib/actions/sidebar-counts";
import { getRevenueForecast } from "@/lib/services/revenue-forecast";
import { calculateChurnRiskBatch } from "@/lib/services/churn-risk";

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

// ---------------------------------------------------------------------------
// getSidebarCounts
// ---------------------------------------------------------------------------
describe("getSidebarCounts", () => {
  it("returns all 7 counts", async () => {
    mockPrisma.paymentFollowup.count.mockResolvedValue(3);
    mockPrisma.enquiry.count.mockResolvedValue(5);
    mockPrisma.memberTicket.count.mockResolvedValue(2);
    mockPrisma.leaveRequest.count.mockResolvedValue(1);
    (mockPrisma as any).approval.count.mockResolvedValue(4);
    (mockPrisma as any).refund.count.mockResolvedValue(2);
    (mockPrisma as any).cashShift.count.mockResolvedValue(1);

    const result = await getSidebarCounts();

    expect(result).toEqual({
      pendingFollowups: 3,
      newEnquiries: 5,
      balanceDueCount: 2,
      pendingLeaves: 1,
      pendingApprovalsCount: 4,
      pendingRefundsCount: 2,
      openShiftsCount: 1,
    });
  });

  it("queries each model with the expected filter", async () => {
    mockPrisma.paymentFollowup.count.mockResolvedValue(0);
    mockPrisma.enquiry.count.mockResolvedValue(0);
    mockPrisma.memberTicket.count.mockResolvedValue(0);
    mockPrisma.leaveRequest.count.mockResolvedValue(0);

    await getSidebarCounts();

    // paymentFollowup uses windowed dueDate + non-zero amountDue + multi-status
    const fuCall = mockPrisma.paymentFollowup.count.mock.calls[0][0] as any;
    expect(fuCall.where.status.in).toEqual(["pending", "contacted", "promised"]);
    expect(fuCall.where.amountDue).toEqual({ gt: 0 });
    expect(fuCall.where.dueDate.gte).toBeInstanceOf(Date);
    expect(fuCall.where.dueDate.lt).toBeInstanceOf(Date);

    // enquiry: 120-day window of "new"
    const enqCall = mockPrisma.enquiry.count.mock.calls[0][0] as any;
    expect(enqCall.where.status).toBe("new");
    expect(enqCall.where.createdAt.gte).toBeInstanceOf(Date);

    expect(mockPrisma.memberTicket.count).toHaveBeenCalledWith({
      where: { balanceDue: { gt: 0 }, status: "active" },
    });
    expect(mockPrisma.leaveRequest.count).toHaveBeenCalledWith({
      where: { status: "pending" },
    });
  });

  it("returns 0s when no matching records", async () => {
    mockPrisma.paymentFollowup.count.mockResolvedValue(0);
    mockPrisma.enquiry.count.mockResolvedValue(0);
    mockPrisma.memberTicket.count.mockResolvedValue(0);
    mockPrisma.leaveRequest.count.mockResolvedValue(0);
    (mockPrisma as any).approval.count.mockResolvedValue(0);
    (mockPrisma as any).refund.count.mockResolvedValue(0);
    (mockPrisma as any).cashShift.count.mockResolvedValue(0);

    const result = await getSidebarCounts();

    expect(result).toEqual({
      pendingFollowups: 0,
      newEnquiries: 0,
      balanceDueCount: 0,
      pendingLeaves: 0,
      pendingApprovalsCount: 0,
      pendingRefundsCount: 0,
      openShiftsCount: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// getRevenueForecast
// ---------------------------------------------------------------------------
describe("getRevenueForecast", () => {
  it("passes locationId filter through to memberTicket query", async () => {
    mockPrisma.memberTicket.findMany.mockResolvedValue([]);
    mockPrisma.attendanceLog.groupBy.mockResolvedValue([] as any);

    await getRevenueForecast(99);

    const call = mockPrisma.memberTicket.findMany.mock.calls[0][0] as any;
    expect(call.where.locationId).toBe(99);
  });

  it("without locationId, no locationId in where clause", async () => {
    mockPrisma.memberTicket.findMany.mockResolvedValue([]);
    mockPrisma.attendanceLog.groupBy.mockResolvedValue([] as any);

    await getRevenueForecast();

    const call = mockPrisma.memberTicket.findMany.mock.calls[0][0] as any;
    expect(call.where).not.toHaveProperty("locationId");
  });

  it("tickets where user has no attendance records are classified as unlikely", async () => {
    mockPrisma.memberTicket.findMany.mockResolvedValue([
      {
        userId: 1,
        expireDate: daysFromNow(10),
        plan: { price: 2000 },
        user: { id: 1, firstname: "Ghost", lastname: "Member" },
      },
    ] as any);

    // No attendance records at all
    mockPrisma.attendanceLog.groupBy.mockResolvedValue([] as any);

    const result = await getRevenueForecast();

    expect(result.unlikely).toEqual({ count: 1, revenue: 2000 });
    expect(result.likely).toEqual({ count: 0, revenue: 0 });
    expect(result.atRisk).toEqual({ count: 0, revenue: 0 });
  });
});

// ---------------------------------------------------------------------------
// calculateChurnRiskBatch
// ---------------------------------------------------------------------------
describe("calculateChurnRiskBatch", () => {
  it("handles duplicate userIds gracefully", async () => {
    const userIds = [10, 10, 10];

    mockPrisma.attendanceLog.groupBy
      .mockResolvedValueOnce([
        { userId: 10, _max: { checkIn: daysAgo(1) } },
      ] as any)
      .mockResolvedValueOnce([{ userId: 10, _count: 8 }] as any)
      .mockResolvedValueOnce([{ userId: 10, _count: 8 }] as any);

    mockPrisma.memberTicket.findMany.mockResolvedValue([
      { userId: 10, expireDate: daysFromNow(30) },
    ] as any);

    const results = await calculateChurnRiskBatch(userIds);

    // Should have an entry for userId 10 (duplicates just overwrite the same key)
    expect(results.has(10)).toBe(true);
    const r = results.get(10)!;
    expect(r.level).toBe("low");
  });

  it("large batch (100+ userIds) does not error", async () => {
    const userIds = Array.from({ length: 120 }, (_, i) => i + 1);

    mockPrisma.attendanceLog.groupBy
      .mockResolvedValueOnce(
        userIds.map((id) => ({ userId: id, _max: { checkIn: daysAgo(2) } })) as any
      )
      .mockResolvedValueOnce(
        userIds.map((id) => ({ userId: id, _count: 6 })) as any
      )
      .mockResolvedValueOnce(
        userIds.map((id) => ({ userId: id, _count: 6 })) as any
      );

    mockPrisma.memberTicket.findMany.mockResolvedValue(
      userIds.map((id) => ({ userId: id, expireDate: daysFromNow(20) })) as any
    );

    const results = await calculateChurnRiskBatch(userIds);

    expect(results.size).toBe(120);
    for (const [, risk] of results) {
      expect(risk).toHaveProperty("score");
      expect(risk).toHaveProperty("level");
      expect(risk).toHaveProperty("reason");
    }
  });

  it("users not in attendance/ticket results get default high-risk scores", async () => {
    const userIds = [100, 200];

    // No attendance data at all
    mockPrisma.attendanceLog.groupBy
      .mockResolvedValueOnce([] as any) // latest attendance
      .mockResolvedValueOnce([] as any) // last30
      .mockResolvedValueOnce([] as any); // prev30

    // No active tickets
    mockPrisma.memberTicket.findMany.mockResolvedValue([] as any);

    const results = await calculateChurnRiskBatch(userIds);

    expect(results.size).toBe(2);
    for (const userId of userIds) {
      const r = results.get(userId)!;
      // daysSinceLastVisit=999 → +40, daysUntilExpiry=-999 → +30 = 70 → high
      expect(r.score).toBe(70);
      expect(r.level).toBe("high");
      expect(r.reason).toBe("Never visited");
    }
  });
});
