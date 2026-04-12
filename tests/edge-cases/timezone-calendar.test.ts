import { describe, it, expect, vi, afterEach } from "vitest";
import { todayIST, nowIST } from "@/lib/utils/date";

/**
 * Helper: simulate what `new Date(); d.setHours(0,0,0,0)` produces on a UTC
 * server (offset=0) for a given instant. This is what churn-detection.ts and
 * plan-change.ts do — they assume the server's local midnight equals IST midnight.
 */
function midnightOnUTCServer(utcIso: string): Date {
  const d = new Date(utcIso);
  // On a UTC server, getFullYear/getMonth/getDate return UTC components.
  // Simulate that by extracting UTC parts explicitly.
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ---------------------------------------------------------------------------
// 1. todayIST vs new Date divergence
// ---------------------------------------------------------------------------
describe("todayIST vs new Date divergence", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("todayIST adds a fixed 5h30m (330 min) offset to UTC", () => {
    vi.useFakeTimers({ now: new Date("2026-06-15T10:00:00Z") });

    const ist = todayIST();
    // At UTC 10:00, IST is 15:30 — same calendar day (June 15)
    expect(ist.getFullYear()).toBe(2026);
    expect(ist.getMonth()).toBe(5); // June = 5
    expect(ist.getDate()).toBe(15);
    // todayIST returns midnight of that IST date
    expect(ist.getHours()).toBe(0);
    expect(ist.getMinutes()).toBe(0);
  });

  it("returns NEXT calendar day vs UTC when UTC is between 18:30 and 00:00", () => {
    // UTC 2026-03-09T18:30:00Z => IST 2026-03-10T00:00:00 (midnight rollover)
    vi.useFakeTimers({ now: new Date("2026-03-09T18:30:00Z") });

    const utcDate = new Date();
    const istDate = todayIST();

    // UTC date is March 9
    expect(utcDate.getUTCDate()).toBe(9);
    // IST date is March 10
    expect(istDate.getDate()).toBe(10);
  });

  it("UTC-server midnight diverges from todayIST near IST midnight", () => {
    // Scenario: UTC 2026-07-19T20:00:00Z => IST 2026-07-20T01:30:00
    // A server in UTC would compute midnight as July 19.
    // todayIST correctly returns July 20.
    const utcInstant = "2026-07-19T20:00:00Z";
    vi.useFakeTimers({ now: new Date(utcInstant) });

    const serverMidnight = midnightOnUTCServer(utcInstant);
    const istDate = todayIST();

    // UTC server says July 19
    expect(serverMidnight.getUTCDate()).toBe(19);
    // IST says July 20
    expect(istDate.getDate()).toBe(20);
  });

  it("nowIST reflects current IST time, not UTC", () => {
    vi.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z") });

    const ist = nowIST();
    // UTC 00:00 => IST 05:30
    expect(ist.getHours()).toBe(5);
    expect(ist.getMinutes()).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// 2. Inconsistent timezone usage across services
// ---------------------------------------------------------------------------
describe("inconsistent timezone usage across services", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Services using `new Date()` (server-local — NOT IST-aware):
   *   - churn-detection.ts    — `const today = new Date(); today.setHours(0,0,0,0);`
   *   - plan-change.ts        — `const today = new Date(); today.setHours(0,0,0,0);`
   *   - invoice.ts            — `new Date().getFullYear()` for invoice prefix
   *   - daily-actions.ts      — `const today = new Date();`
   *   - lead-scoring.ts       — `const today = new Date();`
   *   - member-milestones.ts  — `const today = new Date();`
   *   - ai-briefing.ts        — `const today = new Date();`
   *   - irregular-members.ts  — `const now = new Date();`
   *   - dashboard.ts          — `const now = new Date();`
   *   - anniversary.ts        — `const now = new Date();`
   *   - class.ts              — `const now/today = new Date();`
   *
   * Services using `todayIST()` (correct for India):
   *   - renewal.ts
   *   - attendance.ts
   *   - trial.ts
   *   - freeze.ts
   *   - payment-notification.ts
   *   - enquiry-followup.ts
   *
   * Impact: If the server runs in UTC (e.g., cloud VM), between 00:00 IST
   * and 05:30 IST (i.e., 18:30-00:00 UTC previous day), services using
   * `new Date()` will compute the PREVIOUS calendar day. This means:
   *   - churn-detection may miss members whose ticket expired "today" IST
   *     because the server still thinks it's yesterday.
   *   - plan-change may miscalculate remaining days by 1 near midnight IST.
   *   - invoice prefix may stamp the wrong year on Jan 1 IST when the server
   *     is still Dec 31 UTC.
   */

  it("churn-detection: UTC-server today differs from IST today near midnight IST", () => {
    // UTC 2026-12-31T20:00:00Z => IST 2027-01-01T01:30:00
    const utcInstant = "2026-12-31T20:00:00Z";
    vi.useFakeTimers({ now: new Date(utcInstant) });

    // What churn-detection.ts computes on a UTC server:
    const serverToday = midnightOnUTCServer(utcInstant);
    // What it should compute for IST:
    const istToday = todayIST();

    expect(serverToday.getUTCMonth()).toBe(11); // December
    expect(serverToday.getUTCDate()).toBe(31);
    expect(serverToday.getUTCFullYear()).toBe(2026);

    expect(istToday.getMonth()).toBe(0);  // January
    expect(istToday.getDate()).toBe(1);
    expect(istToday.getFullYear()).toBe(2027);
  });

  it("invoice prefix: wrong year at IST new year boundary on a UTC server", () => {
    // UTC 2026-12-31T20:00:00Z => IST 2027-01-01T01:30
    const utcInstant = "2026-12-31T20:00:00Z";
    vi.useFakeTimers({ now: new Date(utcInstant) });

    // invoice.ts does: new Date().getFullYear() — on UTC server that's 2026
    const serverYear = new Date(utcInstant).getUTCFullYear();
    // Correct IST year:
    const istYear = todayIST().getFullYear();

    expect(serverYear).toBe(2026); // wrong for India
    expect(istYear).toBe(2027);    // correct for India
  });

  it("plan-change: remaining-days off by 1 near midnight IST on a UTC server", () => {
    // UTC 2026-06-15T19:00:00Z => IST 2026-06-16T00:30:00
    const utcInstant = "2026-06-15T19:00:00Z";
    vi.useFakeTimers({ now: new Date(utcInstant) });

    // plan-change.ts on a UTC server:
    const serverToday = midnightOnUTCServer(utcInstant); // June 15 UTC midnight
    // Correct IST:
    const istToday = todayIST(); // June 16 IST midnight

    // Server sees June 15, IST sees June 16 — one day apart
    expect(serverToday.getUTCDate()).toBe(15);
    expect(istToday.getDate()).toBe(16);

    // This 1-day gap means plan-change.ts on a UTC server will overcount
    // remaining days by 1 during the 18:30-00:00 UTC window.
    // For a ticket expiring "June 16", the UTC server thinks there's 1 day
    // left (June 15 -> June 16), while in IST it's already June 16 (0 days).
    const serverDayOfMonth = serverToday.getUTCDate();
    const istDayOfMonth = istToday.getDate();
    expect(istDayOfMonth - serverDayOfMonth).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Month-end rollover and date arithmetic
// ---------------------------------------------------------------------------
describe("month-end rollover edge cases", () => {
  it("Jan 31 + 30 days = March 2 (not Feb 30)", () => {
    const jan31 = new Date(2026, 0, 31); // Jan 31, 2026
    const result = new Date(jan31);
    result.setDate(result.getDate() + 30);

    // Jan has 31 days, Feb has 28 in 2026 => Jan 31 + 30 = Mar 2
    expect(result.getMonth()).toBe(2); // March
    expect(result.getDate()).toBe(2);
  });

  it("Jan 31 + 30 days in leap year (2028) = March 1", () => {
    const jan31 = new Date(2028, 0, 31); // Jan 31, 2028 (leap year)
    const result = new Date(jan31);
    result.setDate(result.getDate() + 30);

    // Feb has 29 days in 2028 => Jan 31 + 30 = Mar 1
    expect(result.getMonth()).toBe(2); // March
    expect(result.getDate()).toBe(1);
  });

  it("Feb 29 (leap year) + 365 days = Feb 28 (non-leap year)", () => {
    const feb29 = new Date(2028, 1, 29); // Feb 29, 2028
    const result = new Date(feb29);
    result.setDate(result.getDate() + 365);

    // 2028 is leap (366 days), so +365 from Feb 29 = Feb 28, 2029
    expect(result.getFullYear()).toBe(2029);
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(28);
  });

  it("Feb 28 (non-leap) + 365 days = Feb 28 (non-leap)", () => {
    const feb28 = new Date(2026, 1, 28);
    const result = new Date(feb28);
    result.setDate(result.getDate() + 365);

    expect(result.getFullYear()).toBe(2027);
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(28);
  });

  it("renewal expiry: setDate arithmetic (baseDate + expireDays) from March 31", () => {
    // renewal.ts lines 80-81:
    //   const newExpiryDate = new Date(baseDate);
    //   newExpiryDate.setDate(newExpiryDate.getDate() + plan.expireDays);
    const baseDate = new Date(2026, 2, 31); // March 31
    const expireDays = 30;

    const newExpiry = new Date(baseDate);
    newExpiry.setDate(newExpiry.getDate() + expireDays);

    // March 31 + 30 = April 30
    expect(newExpiry.getMonth()).toBe(3); // April
    expect(newExpiry.getDate()).toBe(30);
  });

  it("renewal expiry: 90-day plan from Nov 30 crosses year boundary", () => {
    const baseDate = new Date(2026, 10, 30); // Nov 30
    const newExpiry = new Date(baseDate);
    newExpiry.setDate(newExpiry.getDate() + 90);

    // Nov 30 + 90 = Feb 28, 2027
    expect(newExpiry.getFullYear()).toBe(2027);
    expect(newExpiry.getMonth()).toBe(1); // February
    expect(newExpiry.getDate()).toBe(28);
  });

  it("plan-change expiry: 365-day plan from Jan 1 of leap year", () => {
    // plan-change.ts lines 53-54:
    //   const newExpiryDate = new Date(today);
    //   newExpiryDate.setDate(newExpiryDate.getDate() + newPlan.expireDays);
    const today = new Date(2028, 0, 1); // Jan 1, 2028 (leap year)
    const newExpiry = new Date(today);
    newExpiry.setDate(newExpiry.getDate() + 365);

    // 2028 has 366 days, so Jan 1 + 365 = Dec 31, 2028
    expect(newExpiry.getFullYear()).toBe(2028);
    expect(newExpiry.getMonth()).toBe(11); // December
    expect(newExpiry.getDate()).toBe(31);
  });
});

// ---------------------------------------------------------------------------
// 4. IST does NOT observe DST — offset is hardcoded
// ---------------------------------------------------------------------------
describe("IST does not observe DST", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("offset is hardcoded to 5.5 hours (19800000 ms)", () => {
    // todayIST() source: const istOffset = 5.5 * 60 * 60 * 1000;
    const expectedOffsetMs = 5.5 * 60 * 60 * 1000;
    expect(expectedOffsetMs).toBe(19_800_000);
  });

  it("todayIST returns correct date in northern-hemisphere summer", () => {
    // July 15, 2026 at UTC 22:00 => IST July 16 03:30
    vi.useFakeTimers({ now: new Date("2026-07-15T22:00:00Z") });

    const ist = todayIST();
    expect(ist.getDate()).toBe(16);
    expect(ist.getMonth()).toBe(6); // July
  });

  it("todayIST returns correct date in northern-hemisphere winter", () => {
    // Jan 15, 2026 at UTC 22:00 => IST Jan 16 03:30
    vi.useFakeTimers({ now: new Date("2026-01-15T22:00:00Z") });

    const ist = todayIST();
    expect(ist.getDate()).toBe(16);
    expect(ist.getMonth()).toBe(0); // January
  });

  it("IST offset is identical in March and November (DST-change months elsewhere)", () => {
    // Compute the IST offset by comparing nowIST() output to a known UTC anchor.
    // todayIST/nowIST internally neutralize the local timezone via getTimezoneOffset(),
    // so we verify the result relative to UTC.

    // March
    vi.useFakeTimers({ now: new Date("2026-03-15T12:00:00Z") });
    const marchIST = nowIST();
    // nowIST should represent 2026-03-15T17:30 IST
    expect(marchIST.getHours()).toBe(17);
    expect(marchIST.getMinutes()).toBe(30);

    // November
    vi.useFakeTimers({ now: new Date("2026-11-15T12:00:00Z") });
    const novIST = nowIST();
    // nowIST should represent 2026-11-15T17:30 IST
    expect(novIST.getHours()).toBe(17);
    expect(novIST.getMinutes()).toBe(30);
  });

  it("works correctly at year boundary — Dec 31 UTC to Jan 1 IST", () => {
    vi.useFakeTimers({ now: new Date("2026-12-31T18:30:00Z") });
    // IST = Jan 1, 2027 00:00:00

    const ist = todayIST();
    expect(ist.getFullYear()).toBe(2027);
    expect(ist.getMonth()).toBe(0);
    expect(ist.getDate()).toBe(1);
  });
});
