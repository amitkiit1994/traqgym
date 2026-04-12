import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// ---------- 1. DateQuickSelect date calculations ----------

// Copied from components/ui/date-quick-select.tsx (not exported)
function formatDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

describe("DateQuickSelect – formatDateStr", () => {
  it("pads single-digit month (January → 01)", () => {
    expect(formatDateStr(new Date(2026, 0, 15))).toBe("2026-01-15");
  });

  it("pads single-digit day (1st → 01)", () => {
    expect(formatDateStr(new Date(2026, 3, 1))).toBe("2026-04-01");
  });

  it("formats Dec 31 correctly", () => {
    expect(formatDateStr(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("formats Jan 1 correctly", () => {
    expect(formatDateStr(new Date(2026, 0, 1))).toBe("2026-01-01");
  });

  it("preserves year correctly for 2026", () => {
    const result = formatDateStr(new Date(2026, 5, 20));
    expect(result).toMatch(/^2026-/);
    expect(result).toBe("2026-06-20");
  });
});

describe("DateQuickSelect – yesterday calculation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("Jan 1 minus 1 day = Dec 31 of previous year", () => {
    // Simulate todayIST returning Jan 1 2026
    const d = new Date(2026, 0, 1); // Jan 1
    d.setDate(d.getDate() - 1);
    expect(formatDateStr(d)).toBe("2025-12-31");
  });
});

describe("DateQuickSelect – last 7 days calculation", () => {
  it("crosses month boundary: April 2 minus 7 = March 26", () => {
    const d = new Date(2026, 3, 2); // April 2
    d.setDate(d.getDate() - 7);
    expect(formatDateStr(d)).toBe("2026-03-26");
  });
});

// ---------- 2. todayIST and nowIST at key boundaries ----------

import { todayIST, nowIST } from "@/lib/utils/date";

describe("todayIST – IST boundary tests", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("UTC 18:29:59 is still the same IST date as earlier that UTC day", () => {
    vi.useFakeTimers();
    // UTC 18:29:59 on April 10 2026 → IST 23:59:59 April 10
    vi.setSystemTime(new Date(Date.UTC(2026, 3, 10, 18, 29, 59)));
    const d = todayIST();
    expect(d.getMonth()).toBe(3); // April
    expect(d.getDate()).toBe(10);
  });

  it("UTC 18:30:00 flips to next IST date", () => {
    vi.useFakeTimers();
    // UTC 18:30:00 on April 10 2026 → IST 00:00:00 April 11
    vi.setSystemTime(new Date(Date.UTC(2026, 3, 10, 18, 30, 0)));
    const d = todayIST();
    expect(d.getMonth()).toBe(3); // April
    expect(d.getDate()).toBe(11);
  });

  it("year boundary: UTC Dec 31 23:00 = IST Jan 1 04:30 of next year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 11, 31, 23, 0, 0)));
    const d = todayIST();
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(0); // January
    expect(d.getDate()).toBe(1);
  });

  it("leap year: Feb 29 2028 in IST", () => {
    vi.useFakeTimers();
    // UTC Feb 28 2028 18:30 → IST Feb 29 2028 00:00
    vi.setSystemTime(new Date(Date.UTC(2028, 1, 28, 18, 30, 0)));
    const d = todayIST();
    expect(d.getMonth()).toBe(1); // February
    expect(d.getDate()).toBe(29);
  });

  it("todayIST always returns midnight (hours=0, mins=0, secs=0, ms=0)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 15, 10, 45, 30, 500)));
    const d = todayIST();
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });
});

describe("nowIST", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns non-midnight values when current IST time is not midnight", () => {
    vi.useFakeTimers();
    // UTC 10:00 → IST 15:30
    vi.setSystemTime(new Date(Date.UTC(2026, 3, 10, 10, 0, 0)));
    const d = nowIST();
    expect(d.getHours()).toBe(15);
    expect(d.getMinutes()).toBe(30);
  });
});

// ---------- 3. Churn risk via calculateChurnRisk with mocked Prisma ----------

vi.mock("@/lib/prisma", () => ({
  prisma: {
    attendanceLog: { findFirst: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    memberTicket: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    paymentFollowup: { count: vi.fn() },
    enquiry: { count: vi.fn() },
    leaveRequest: { count: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { calculateChurnRisk } from "@/lib/services/churn-risk";

type MockFn = ReturnType<typeof vi.fn>;

function setupChurnMocks(opts: {
  lastVisitDaysAgo: number | null;
  daysUntilExpiry: number | null;
  last30: number;
  prev30: number;
}) {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const lastCheckIn = opts.lastVisitDaysAgo !== null
    ? new Date(today.getTime() - opts.lastVisitDaysAgo * 86400000)
    : null;

  const expireDate = opts.daysUntilExpiry !== null
    ? new Date(today.getTime() + opts.daysUntilExpiry * 86400000)
    : null;

  (prisma.attendanceLog.findFirst as MockFn).mockResolvedValue(
    lastCheckIn ? { checkIn: lastCheckIn } : null
  );
  (prisma.memberTicket.findFirst as MockFn).mockResolvedValue(
    expireDate ? { expireDate } : null
  );

  // count is called twice: first for last30, then for prev30
  (prisma.attendanceLog.count as MockFn)
    .mockResolvedValueOnce(opts.last30)
    .mockResolvedValueOnce(opts.prev30);
}

describe("Churn risk – computeRisk via calculateChurnRisk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("only recency penalty: visited 8 days ago → score 20, low", async () => {
    setupChurnMocks({ lastVisitDaysAgo: 8, daysUntilExpiry: 60, last30: 10, prev30: 10 });
    const result = await calculateChurnRisk(1);
    expect(result.score).toBe(20);
    expect(result.level).toBe("low");
  });

  it("only expiry penalty: visited today, expires in 3 days → score 25, low", async () => {
    setupChurnMocks({ lastVisitDaysAgo: 0, daysUntilExpiry: 3, last30: 10, prev30: 10 });
    const result = await calculateChurnRisk(1);
    expect(result.score).toBe(25);
    expect(result.level).toBe("low");
  });

  it("only trend penalty: visited today, ticket 60 days out, prev30=10, last30=3 → score 30, low", async () => {
    setupChurnMocks({ lastVisitDaysAgo: 0, daysUntilExpiry: 60, last30: 3, prev30: 10 });
    const result = await calculateChurnRisk(1);
    expect(result.score).toBe(30);
    expect(result.level).toBe("low");
  });

  it("recency + expiry combined: 15 days ago, expires in 5 days → score 65, high", async () => {
    setupChurnMocks({ lastVisitDaysAgo: 15, daysUntilExpiry: 5, last30: 10, prev30: 10 });
    const result = await calculateChurnRisk(1);
    expect(result.score).toBe(65);
    expect(result.level).toBe("high");
  });

  it("all three penalties max: 15 days ago, expired 10 days ago, prev30=10, last30=2 → capped at 100, high", async () => {
    setupChurnMocks({ lastVisitDaysAgo: 15, daysUntilExpiry: -10, last30: 2, prev30: 10 });
    const result = await calculateChurnRisk(1);
    expect(result.score).toBe(100);
    expect(result.level).toBe("high");
  });
});

// ---------- 4. Sidebar counts shape validation ----------

import { getSidebarCounts } from "@/lib/actions/sidebar-counts";

describe("getSidebarCounts – shape validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.paymentFollowup.count as MockFn).mockResolvedValue(3);
    (prisma.enquiry.count as MockFn).mockResolvedValue(5);
    (prisma.memberTicket.count as MockFn).mockResolvedValue(2);
    (prisma.leaveRequest.count as MockFn).mockResolvedValue(1);
  });

  it("returns object with exactly 4 keys", async () => {
    const result = await getSidebarCounts();
    expect(Object.keys(result)).toHaveLength(4);
    expect(Object.keys(result).sort()).toEqual(
      ["balanceDueCount", "newEnquiries", "pendingFollowups", "pendingLeaves"].sort()
    );
  });

  it("all values are numbers", async () => {
    const result = await getSidebarCounts();
    for (const val of Object.values(result)) {
      expect(typeof val).toBe("number");
    }
  });

  it("values match what the mocks return", async () => {
    const result = await getSidebarCounts();
    expect(result.pendingFollowups).toBe(3);
    expect(result.newEnquiries).toBe(5);
    expect(result.balanceDueCount).toBe(2);
    expect(result.pendingLeaves).toBe(1);
  });
});
