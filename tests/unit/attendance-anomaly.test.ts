import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    attendanceLog: {
      count: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { detectAttendanceAnomaly } from "@/lib/services/attendance-anomaly";

const mockPrisma = vi.mocked(prisma, true);

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("detectAttendanceAnomaly", () => {
  it("regular member (4 visits/week), visited yesterday → no anomaly", async () => {
    mockPrisma.attendanceLog.count
      .mockResolvedValueOnce(4)   // last7
      .mockResolvedValueOnce(16)  // last30
      .mockResolvedValueOnce(17); // prev30
    mockPrisma.attendanceLog.findFirst.mockResolvedValue({
      checkIn: daysAgo(1),
    } as any);

    const result = await detectAttendanceAnomaly(1);

    expect(result.hasAnomaly).toBe(false);
    expect(result.message).toBeNull();
    expect(result.daysSinceLastVisit).toBe(1);
  });

  it("regular member (4 visits/week), no visit in 15 days → anomaly", async () => {
    // prev30 = 17 → avgVisitsPerWeek = 17/4.3 ≈ 3.95 > 1
    mockPrisma.attendanceLog.count
      .mockResolvedValueOnce(0)   // last7
      .mockResolvedValueOnce(2)   // last30
      .mockResolvedValueOnce(17); // prev30
    mockPrisma.attendanceLog.findFirst.mockResolvedValue({
      checkIn: daysAgo(15),
    } as any);

    const result = await detectAttendanceAnomaly(1);

    expect(result.hasAnomaly).toBe(true);
    expect(result.message).toMatch(/No visit in 15 days/);
  });

  it("attendance dropped >50% (prev30=16, last30=6) → anomaly", async () => {
    // Drop = 62.5%, prev30 > 2, last30 < prev30 * 0.5
    mockPrisma.attendanceLog.count
      .mockResolvedValueOnce(2)   // last7
      .mockResolvedValueOnce(6)   // last30
      .mockResolvedValueOnce(16); // prev30
    mockPrisma.attendanceLog.findFirst.mockResolvedValue({
      checkIn: daysAgo(3),
    } as any);

    const result = await detectAttendanceAnomaly(1);

    expect(result.hasAnomaly).toBe(true);
    expect(result.message).toMatch(/Attendance dropped 63%/);
  });

  it("member who never visited → no anomaly (no baseline)", async () => {
    mockPrisma.attendanceLog.count
      .mockResolvedValueOnce(0)  // last7
      .mockResolvedValueOnce(0)  // last30
      .mockResolvedValueOnce(0); // prev30
    mockPrisma.attendanceLog.findFirst.mockResolvedValue(null);

    const result = await detectAttendanceAnomaly(1);

    expect(result.hasAnomaly).toBe(false);
    expect(result.daysSinceLastVisit).toBeNull();
    expect(result.avgVisitsPerWeek).toBe(0);
  });

  it("0 visits this week but avg >1/week → anomaly", async () => {
    // prev30 = 8 → avgVisitsPerWeek = 8/4.3 ≈ 1.86 > 1
    // last7 = 0, prev30 > 2 triggers the "no visits this week" check
    mockPrisma.attendanceLog.count
      .mockResolvedValueOnce(0)   // last7
      .mockResolvedValueOnce(7)   // last30 (not < prev30*0.5, so drop check won't fire)
      .mockResolvedValueOnce(8);  // prev30
    mockPrisma.attendanceLog.findFirst.mockResolvedValue({
      checkIn: daysAgo(8),
    } as any);

    const result = await detectAttendanceAnomaly(1);

    expect(result.hasAnomaly).toBe(true);
    expect(result.message).toMatch(/No visits this week/);
  });
});
