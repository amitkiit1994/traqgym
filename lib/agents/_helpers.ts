/**
 * Shared pure helpers for insight agents. Keep this file dependency-free
 * (no Prisma imports) so it can be unit-tested cheaply.
 */

/** Format a number as Indian Rupees, rounded to nearest integer. */
export function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/** Today's date as ISO `YYYY-MM-DD` (server-local, used for dedupe keys). */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Returns the ISO date (YYYY-MM-DD) of the Monday of the week containing
 * `d`. Used to build stable weekly dedupe keys.
 */
export function isoWeekStart(d: Date = new Date()): string {
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  const monday = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff)
  );
  return monday.toISOString().slice(0, 10);
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
