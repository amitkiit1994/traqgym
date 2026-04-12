import { describe, it, expect, vi, afterEach } from "vitest";
import { todayIST, nowIST } from "@/lib/utils/date";

describe("todayIST", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a Date instance", () => {
    expect(todayIST()).toBeInstanceOf(Date);
  });

  it("is midnight-truncated (hours, minutes, seconds, ms are all 0)", () => {
    const d = todayIST();
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });

  it("reflects IST date even when UTC date differs (e.g. UTC 23:00 = IST next day)", () => {
    // 2026-04-11 23:00 UTC = 2026-04-12 04:30 IST
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T23:00:00.000Z"));

    const d = todayIST();
    // IST date should be April 12
    expect(d.getDate()).toBe(12);
    expect(d.getMonth()).toBe(3); // April = 3
    expect(d.getFullYear()).toBe(2026);
  });

  it("returns the same IST date when called early in IST day (e.g. UTC 19:00 = IST 00:30 next day)", () => {
    vi.useFakeTimers();
    // 2026-04-11 19:00 UTC = 2026-04-12 00:30 IST
    vi.setSystemTime(new Date("2026-04-11T19:00:00.000Z"));

    const d = todayIST();
    expect(d.getDate()).toBe(12);
  });

  it("stays on same IST date when UTC is same calendar day but before IST midnight", () => {
    vi.useFakeTimers();
    // 2026-04-11 10:00 UTC = 2026-04-11 15:30 IST
    vi.setSystemTime(new Date("2026-04-11T10:00:00.000Z"));

    const d = todayIST();
    expect(d.getDate()).toBe(11);
    expect(d.getMonth()).toBe(3);
  });
});

describe("nowIST", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a Date instance", () => {
    expect(nowIST()).toBeInstanceOf(Date);
  });

  it("preserves time-of-day (not midnight-truncated)", () => {
    vi.useFakeTimers();
    // 2026-04-11 10:00 UTC = 2026-04-11 15:30 IST
    vi.setSystemTime(new Date("2026-04-11T10:00:00.000Z"));

    const d = nowIST();
    // nowIST computes UTC + offset, then wraps in new Date() which interprets as local.
    // The key property: it should NOT be midnight.
    const totalMinutes = d.getHours() * 60 + d.getMinutes();
    expect(totalMinutes).toBeGreaterThan(0);
  });

  it("differs from todayIST by some amount of time within the same day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T10:00:00.000Z"));

    const now = nowIST();
    const today = todayIST();
    // nowIST should be >= todayIST (same calendar day, but with time component)
    expect(now.getTime()).toBeGreaterThanOrEqual(today.getTime());
  });
});
