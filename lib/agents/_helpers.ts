/**
 * Shared pure helpers for insight agents. Keep this file dependency-free
 * (no Prisma imports) so it can be unit-tested cheaply.
 *
 * IMPORTANT — timezone:
 * Vercel cron jobs run in UTC. The gym's calendar is IST (UTC+5:30). All
 * date-string and day-window math here lives in IST so that an "01:30 UTC"
 * cron firing (= 07:00 IST) resolves to the correct IST calendar day. Use
 * `isoDay()` for dedupe-key date strings and `istDayWindow()` for "give me
 * the UTC bounds of an IST day".
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Format a number as Indian Rupees, rounded to nearest integer. */
export function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/**
 * Canonical ISO date string `YYYY-MM-DD` for the IST calendar day containing
 * the UTC instant `d`. Defaults to "today in IST".
 *
 * Cron jobs run on Vercel in UTC; raw `.toISOString().slice(0, 10)` would
 * report yesterday's IST date for any cron firing before 18:30 UTC (= 00:00
 * IST next day). Always use this helper for dedupe keys / display dates.
 */
export function isoDay(d: Date = new Date()): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * @deprecated Use `isoDay()` instead. Kept for backward compatibility.
 * Today's date as ISO `YYYY-MM-DD` in IST.
 */
export function todayISO(): string {
  return isoDay();
}

/**
 * Returns the ISO date (YYYY-MM-DD) of the Monday of the IST week containing
 * `d`. Used to build stable weekly dedupe keys.
 */
export function isoWeekStart(d: Date = new Date()): string {
  // Work in IST coordinates so the Monday boundary aligns with the gym's
  // local calendar week, not UTC.
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const day = ist.getUTCDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  const monday = new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + diff)
  );
  return monday.toISOString().slice(0, 10);
}

/**
 * Returns the UTC instant corresponding to 00:00 IST on the IST calendar day
 * containing `d`. Use as a query bound when filtering by an IST day.
 */
export function istStartOfDay(d: Date = new Date()): Date {
  // IST midnight = UTC of (IST date at 00:00) - 5.5h
  // Compute via the IST date string, then subtract the offset.
  const dayStr = isoDay(d); // YYYY-MM-DD in IST
  // Parse as UTC midnight of that date, then subtract 5.5h to get IST midnight
  // as a UTC instant.
  return new Date(Date.parse(`${dayStr}T00:00:00.000Z`) - IST_OFFSET_MS);
}

/**
 * Returns `{ start, end }` UTC instants spanning the IST calendar day
 * containing `d`. `end` is exclusive (start of next IST day).
 */
export function istDayWindow(d: Date = new Date()): { start: Date; end: Date } {
  const start = istStartOfDay(d);
  const end = new Date(start.getTime() + 86_400_000);
  return { start, end };
}

/** Median of a numeric list. Returns 0 for an empty array. */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** First day of the month containing `d` (UTC midnight). */
export function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** First day of the month BEFORE the month containing `d` (UTC midnight). */
export function startOfPrevMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
}
