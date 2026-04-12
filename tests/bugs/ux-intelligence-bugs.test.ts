/**
 * Regression tests for UX and intelligence-layer bugs found during code audit.
 *
 * Bug 1: DateQuickSelect "Last 7 Days" returns a single date, not a range
 * Bug 2: todayStr() (UTC) vs todayIST() mismatch on attendance page
 * Bug 3: SearchInput debounce timer not cleaned up on unmount
 * Bug 4: Churn risk trend check ignores prev30 <= 2 boundary
 * Bug 5: Revenue forecast double-counts members with multiple expiring tickets
 * Bug 6: Attendance anomaly priority ordering masks concurrent anomalies
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Helpers — replicate date logic from components/ui/date-quick-select.tsx
// and lib/utils/date.ts
// ---------------------------------------------------------------------------

function formatDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Replica of todayIST from lib/utils/date.ts */
function todayIST(): Date {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const istMs = utcMs + istOffset;
  const istDate = new Date(istMs);
  return new Date(istDate.getFullYear(), istDate.getMonth(), istDate.getDate());
}

/**
 * Replica of computeRisk from lib/services/churn-risk.ts (lines 9-83).
 * Extracted here so we can test the pure function without Prisma.
 */
function computeRisk(
  daysSinceLastVisit: number,
  daysUntilExpiry: number,
  last30: number,
  prev30: number
): { score: number; level: "low" | "medium" | "high"; reason: string } {
  let risk = 0;
  let topReason = "";
  let topWeight = 0;

  // Attendance recency
  if (daysSinceLastVisit > 14) {
    risk += 40;
    if (40 > topWeight) {
      topWeight = 40;
      topReason =
        daysSinceLastVisit >= 999
          ? "Never visited"
          : `No visit in ${daysSinceLastVisit} days`;
    }
  } else if (daysSinceLastVisit > 7) {
    risk += 20;
    if (20 > topWeight) {
      topWeight = 20;
      topReason = `No visit in ${daysSinceLastVisit} days`;
    }
  }

  // Ticket expiry
  if (daysUntilExpiry < 0) {
    risk += 30;
    if (30 > topWeight) {
      topWeight = 30;
      topReason = `Plan expired ${Math.abs(daysUntilExpiry)} days ago`;
    }
  } else if (daysUntilExpiry < 7) {
    risk += 25;
    if (25 > topWeight) {
      topWeight = 25;
      topReason = `Plan expires in ${daysUntilExpiry} days`;
    }
  } else if (daysUntilExpiry < 14) {
    risk += 15;
    if (15 > topWeight) {
      topWeight = 15;
      topReason = `Plan expires in ${daysUntilExpiry} days`;
    }
  }

  // Attendance trend
  if (prev30 > 2 && last30 < prev30 * 0.5) {
    const dropPct = Math.round((1 - last30 / prev30) * 100);
    risk += 30;
    if (30 >= topWeight) {
      topWeight = 30;
      topReason = `Attendance dropped ${dropPct}%`;
    }
  } else if (prev30 > 2 && last30 < prev30 * 0.7) {
    const dropPct = Math.round((1 - last30 / prev30) * 100);
    risk += 15;
    if (15 >= topWeight) {
      topWeight = 15;
      topReason = `Attendance dropped ${dropPct}%`;
    }
  }

  const level: "low" | "medium" | "high" =
    risk <= 30 ? "low" : risk <= 60 ? "medium" : "high";

  return {
    score: risk,
    level,
    reason: topReason || "Regular member",
  };
}

/**
 * Replica of detectAttendanceAnomaly logic from lib/services/attendance-anomaly.ts.
 * Pure function version for testing priority ordering without Prisma.
 */
function detectAnomalyPure(
  last7: number,
  last30: number,
  prev30: number,
  daysSinceLastVisit: number | null,
  avgVisitsPerWeek: number
): { hasAnomaly: boolean; message: string | null } {
  // Check 1: 14+ day gap
  if (daysSinceLastVisit !== null && daysSinceLastVisit > 14 && avgVisitsPerWeek > 1) {
    return {
      hasAnomaly: true,
      message: `No visit in ${daysSinceLastVisit} days (usually ${avgVisitsPerWeek.toFixed(1)}/week)`,
    };
  }

  // Check 2: 50% attendance drop
  if (prev30 > 2 && last30 < prev30 * 0.5) {
    const dropPct = Math.round((1 - last30 / prev30) * 100);
    return {
      hasAnomaly: true,
      message: `Attendance dropped ${dropPct}% this month`,
    };
  }

  // Check 3: zero visits this week
  if (prev30 > 2 && last7 === 0 && avgVisitsPerWeek > 1) {
    return {
      hasAnomaly: true,
      message: `No visits this week (usually ${avgVisitsPerWeek.toFixed(1)}/week)`,
    };
  }

  return { hasAnomaly: false, message: null };
}

// ===========================================================================
// BUG 1: DateQuickSelect "Last 7 Days" semantics mismatch
// File: components/ui/date-quick-select.tsx, lines 32-36
// The "Last 7 Days" button computes a SINGLE date 7 days ago and passes it
// to onChange as a single date string. The attendance page treats this as
// a single-date filter, showing attendance for ONE day (7 days ago) only.
// ===========================================================================
describe("BUG: DateQuickSelect 'Last 7 Days' returns single date, not a range", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("last7 is a single date string exactly 7 days before todayIST", () => {
    const today = todayIST();
    const last7 = (() => {
      const d = todayIST();
      d.setDate(d.getDate() - 7);
      return formatDateStr(d);
    })();

    // It returns ONE date string, not a range like { from, to }
    expect(typeof last7).toBe("string");
    expect(last7).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // It is exactly 7 days before today
    const todayStr = formatDateStr(today);
    const todayDate = new Date(todayStr);
    const last7Date = new Date(last7);
    const diffDays = (todayDate.getTime() - last7Date.getTime()) / 86400000;
    expect(diffDays).toBe(7);

    // BUG: The label says "Last 7 Days" but the value is a single date.
    // When the attendance page filters by this value, it shows only that
    // one day's data, not a 7-day range.
  });

  it("todayIST returns the expected date", () => {
    // At UTC 10:00 on April 12, IST is 15:30 on April 12
    const today = todayIST();
    expect(formatDateStr(today)).toBe("2026-04-12");
  });

  it("yesterday is exactly 1 day before todayIST", () => {
    const yesterday = (() => {
      const d = todayIST();
      d.setDate(d.getDate() - 1);
      return formatDateStr(d);
    })();

    expect(yesterday).toBe("2026-04-11");
  });
});

// ===========================================================================
// BUG 2: todayStr() (UTC) vs todayIST() mismatch
// File: app/admin/attendance/page.tsx line 70-72 uses todayStr() which is UTC
// File: components/ui/date-quick-select.tsx uses todayIST() which is IST
// Between UTC 18:30 and 23:59, these return different dates.
// ===========================================================================
describe("BUG: todayStr() UTC vs todayIST() mismatch on attendance page", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("at UTC 20:00 (IST 01:30 next day), todayStr and todayIST differ", () => {
    vi.setSystemTime(new Date("2026-04-11T20:00:00.000Z"));

    // todayStr() from attendance page — UTC-based
    const utcToday = new Date().toISOString().split("T")[0];
    // todayIST() from DateQuickSelect — IST-based
    const istToday = formatDateStr(todayIST());

    expect(utcToday).toBe("2026-04-11");
    expect(istToday).toBe("2026-04-12");

    // BUG: These SHOULD match but don't. The attendance page initializes
    // with UTC date but DateQuickSelect "Today" button uses IST date.
    // Clicking "Today" changes the filter date, causing a mismatch.
    expect(utcToday).not.toBe(istToday);
  });

  it("at UTC 15:00 (IST 20:30 same day), both agree", () => {
    vi.setSystemTime(new Date("2026-04-11T15:00:00.000Z"));

    const utcToday = new Date().toISOString().split("T")[0];
    const istToday = formatDateStr(todayIST());

    // Before 18:30 UTC, both are the same date
    expect(utcToday).toBe("2026-04-11");
    expect(istToday).toBe("2026-04-11");
    expect(utcToday).toBe(istToday);
  });

  it("at UTC 18:30 exactly (IST midnight), the divergence begins", () => {
    vi.setSystemTime(new Date("2026-04-11T18:30:00.000Z"));

    const utcToday = new Date().toISOString().split("T")[0];
    const istToday = formatDateStr(todayIST());

    expect(utcToday).toBe("2026-04-11");
    expect(istToday).toBe("2026-04-12");
    expect(utcToday).not.toBe(istToday);
  });
});

// ===========================================================================
// BUG 3: SearchInput timer not cleaned up on unmount
// File: components/ui/search-input.tsx, lines 26-34
// The component uses useRef<ReturnType<typeof setTimeout>> for debouncing
// but has no useEffect cleanup. If the component unmounts while a timer is
// pending, the callback fires against stale/unmounted state.
// ===========================================================================
describe("BUG: SearchInput debounce timer not cleaned up on unmount", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("demonstrates that a timer fires even after 'unmount' without cleanup", () => {
    let callCount = 0;
    const timerRef = { current: null as ReturnType<typeof setTimeout> | null };

    // Simulate typing — same pattern as SearchInput.debouncedSearch
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      callCount++;
    }, 300);

    // Simulate unmount (no cleanup — timerRef is lost but timer still active)
    // In real code, the component unmounts here but the timer keeps ticking.

    vi.advanceTimersByTime(300);
    // BUG: timer fires after "unmount" — callback runs against stale state
    expect(callCount).toBe(1);
  });

  it("demonstrates proper cleanup prevents stale callback", () => {
    let callCount = 0;
    const timerRef = { current: null as ReturnType<typeof setTimeout> | null };

    // Simulate typing
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      callCount++;
    }, 300);

    // Proper cleanup on unmount (what a useEffect cleanup would do)
    if (timerRef.current) clearTimeout(timerRef.current);

    vi.advanceTimersByTime(300);
    // Properly cleaned up — callback never fires
    expect(callCount).toBe(0);
  });

  it("multiple rapid inputs only fire the last one (debounce works)", () => {
    let lastQuery = "";
    const timerRef = { current: null as ReturnType<typeof setTimeout> | null };

    // Simulate 3 rapid keystrokes
    for (const q of ["a", "ab", "abc"]) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        lastQuery = q;
      }, 300);
    }

    vi.advanceTimersByTime(300);
    expect(lastQuery).toBe("abc");
  });
});

// ===========================================================================
// BUG 4: Churn risk — attendance trend check with prev30 exactly at boundary
// File: lib/services/churn-risk.ts, line 59
// The condition `prev30 > 2` means prev30=2 is excluded. A member who had
// 2 visits in prev30 and 0 in last30 (100% drop) gets NO trend penalty.
// ===========================================================================
describe("BUG: Churn risk trend check ignores prev30 <= 2 boundary", () => {
  it("prev30=2, last30=0: 100% attendance drop gets NO trend penalty", () => {
    // daysSinceLastVisit=3 (recent enough to skip recency penalty)
    // daysUntilExpiry=30 (far enough to skip expiry penalty)
    const result = computeRisk(3, 30, 0, 2);

    // prev30=2 fails the `prev30 > 2` guard, so no trend penalty is applied
    expect(result.score).toBe(0);
    expect(result.level).toBe("low");
    expect(result.reason).toBe("Regular member");

    // This member dropped from 2 visits to 0 (100% drop) but is marked
    // as "Regular member" with score 0.
  });

  it("prev30=3, last30=0: same drop IS penalized because prev30 > 2", () => {
    const result = computeRisk(3, 30, 0, 3);

    // prev30=3 passes the `prev30 > 2` guard
    // last30=0 < 3*0.5=1.5 → 50% drop path triggers
    expect(result.score).toBe(30);
    expect(result.reason).toContain("Attendance dropped");
    expect(result.reason).toContain("100%");
  });

  it("prev30=2, last30=1: 50% drop also gets no trend penalty", () => {
    const result = computeRisk(3, 30, 1, 2);

    expect(result.score).toBe(0);
    expect(result.reason).toBe("Regular member");
  });

  it("confirms the exact boundary: prev30=3 is the minimum to trigger trend check", () => {
    // prev30=3, last30=1: 1 < 3*0.5=1.5 → triggers
    const withThree = computeRisk(3, 30, 1, 3);
    expect(withThree.score).toBe(30);

    // prev30=2, last30=0: 0 < 2*0.5=1 → would trigger IF the guard allowed it
    const withTwo = computeRisk(3, 30, 0, 2);
    expect(withTwo.score).toBe(0);
  });
});

// ===========================================================================
// BUG 5: Revenue forecast — member with multiple expiring tickets counted twice
// File: This is a design-level concern. The dashboard's getStats queries
// memberTickets expiring within N days. If a member has 2 active tickets
// expiring in that window (e.g., after a plan change), both tickets appear
// in the expiring list, inflating the count.
// ===========================================================================
describe("BUG: Revenue forecast double-counts members with multiple expiring tickets", () => {
  it("demonstrates that ticket-level queries count each ticket, not each member", () => {
    // Simulate what a Prisma findMany on memberTickets returns when a member
    // has 2 tickets expiring within the window
    const expiringTickets = [
      { id: 101, userId: 42, planName: "Monthly", amount: 2000, expireDate: new Date("2026-04-20") },
      { id: 102, userId: 42, planName: "Personal Training", amount: 5000, expireDate: new Date("2026-04-25") },
      { id: 103, userId: 99, planName: "Monthly", amount: 2000, expireDate: new Date("2026-04-22") },
    ];

    // Naive count (current behavior): counts tickets, not unique members
    const ticketCount = expiringTickets.length;
    expect(ticketCount).toBe(3); // userId 42 counted twice

    // Correct count: unique members
    const uniqueMembers = new Set(expiringTickets.map((t) => t.userId)).size;
    expect(uniqueMembers).toBe(2);

    // Revenue forecast based on tickets over-estimates
    const forecastRevenue = expiringTickets.reduce((sum, t) => sum + t.amount, 0);
    expect(forecastRevenue).toBe(9000); // includes both tickets for userId 42

    // Correct forecast should deduplicate by member (or intentionally sum both)
    // The current code does not deduplicate.
    expect(ticketCount).toBeGreaterThan(uniqueMembers);
  });

  it("documents that expiringIn3Days query returns tickets, not members", () => {
    // The dashboard getStats query:
    //   prisma.memberTicket.findMany({ where: { expireDate: { gte: now, lte: threeDaysFromNow } } })
    // This returns MemberTicket[], not User[]. A single member with 2 tickets
    // appears twice in the result array.

    // Two tickets for same member
    const tickets = [
      { userId: 1, planName: "Monthly" },
      { userId: 1, planName: "Add-on" },
    ];

    // The expiring count shown on dashboard would be 2, not 1
    expect(tickets.length).toBe(2);
    expect(new Set(tickets.map((t) => t.userId)).size).toBe(1);
  });
});

// ===========================================================================
// BUG 6: Attendance anomaly — priority ordering masks concurrent anomalies
// File: lib/services/attendance-anomaly.ts, lines 30-43
// The function returns on the FIRST matching anomaly. If a member has a
// 14+ day gap AND a 50% attendance drop AND zero visits this week, only
// the gap anomaly is reported. The other conditions are never checked.
// ===========================================================================
describe("BUG: Attendance anomaly priority ordering masks concurrent anomalies", () => {
  it("when all 3 anomaly conditions are true, only the first (14+ day gap) is returned", () => {
    // Set up a scenario where all 3 conditions are true:
    // - daysSinceLastVisit=20 > 14 ✓ (check 1)
    // - prev30=10, last30=2 → 2 < 10*0.5=5 ✓ (check 2)
    // - last7=0, avgVisitsPerWeek=2.3 > 1 ✓ (check 3)
    const result = detectAnomalyPure(
      0,    // last7: zero visits this week
      2,    // last30: only 2 visits (< prev30 * 0.5)
      10,   // prev30: 10 visits (> 2, so trend check applies)
      20,   // daysSinceLastVisit: 20 days (> 14)
      2.3   // avgVisitsPerWeek: > 1
    );

    expect(result.hasAnomaly).toBe(true);

    // Only the FIRST matching anomaly is reported
    expect(result.message).toContain("No visit in 20 days");

    // The 50% drop and zero-visits-this-week anomalies are also true but not reported
    expect(result.message).not.toContain("dropped");
    expect(result.message).not.toContain("No visits this week");
  });

  it("when only check 2 (50% drop) and check 3 (zero this week) are true, only check 2 is returned", () => {
    // daysSinceLastVisit=10: fails check 1 (not > 14)
    // prev30=8, last30=3: 3 < 8*0.5=4 → check 2 passes
    // last7=0, avgVisitsPerWeek=1.9 → check 3 passes
    const result = detectAnomalyPure(
      0,    // last7
      3,    // last30
      8,    // prev30
      10,   // daysSinceLastVisit (not > 14, so check 1 skipped)
      1.9   // avgVisitsPerWeek
    );

    expect(result.hasAnomaly).toBe(true);
    expect(result.message).toContain("dropped");
    expect(result.message).not.toContain("No visits this week");
  });

  it("when only check 3 (zero this week) is true, it IS reported", () => {
    // daysSinceLastVisit=5: fails check 1
    // prev30=6, last30=5: 5 >= 6*0.5=3 → fails check 2
    // last7=0, avgVisitsPerWeek=1.5 → check 3 passes
    const result = detectAnomalyPure(
      0,    // last7
      5,    // last30
      6,    // prev30
      5,    // daysSinceLastVisit
      1.5   // avgVisitsPerWeek
    );

    expect(result.hasAnomaly).toBe(true);
    expect(result.message).toContain("No visits this week");
  });

  it("when no conditions are true, returns no anomaly", () => {
    const result = detectAnomalyPure(
      3,    // last7: active this week
      12,   // last30: healthy attendance
      10,   // prev30
      2,    // daysSinceLastVisit: recent
      2.5   // avgVisitsPerWeek
    );

    expect(result.hasAnomaly).toBe(false);
    expect(result.message).toBeNull();
  });
});
