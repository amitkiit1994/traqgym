/**
 * IST (India Standard Time, UTC+5:30) date helpers.
 *
 * These helpers compute UTC bounds for an IST calendar day or month, so they
 * can be used directly against Date columns stored as UTC instants.
 *
 * IST midnight = UTC 18:30 of the prior day.
 */

export function istDayBoundsUtc(
  d: Date | { year: number; month: number; day: number }
): { startUtc: Date; endUtc: Date } {
  let y: number;
  let m: number;
  let day: number;
  if (d instanceof Date) {
    y = d.getFullYear();
    m = d.getMonth();
    day = d.getDate();
  } else {
    y = d.year;
    m = d.month;
    day = d.day;
  }
  // IST = UTC+5:30. IST midnight = UTC 18:30 of prior day.
  const startUtc = new Date(Date.UTC(y, m, day, -5, -30, 0));
  const endUtc = new Date(Date.UTC(y, m, day + 1, -5, -30, 0));
  return { startUtc, endUtc };
}

/**
 * UTC bounds for an IST calendar month.
 * @param year full year (e.g. 2026)
 * @param month 1-indexed month (1-12)
 */
export function istMonthBoundsUtc(
  year: number,
  month: number
): { startUtc: Date; endUtc: Date } {
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month: ${month}`);
  }
  // IST midnight on the 1st of the month = UTC 18:30 of last day of prior month.
  const startUtc = new Date(Date.UTC(year, month - 1, 1, -5, -30, 0));
  // Start of next month at IST midnight = UTC 18:30 on the last day of this month.
  const endUtc = new Date(Date.UTC(year, month, 1, -5, -30, 0));
  return { startUtc, endUtc };
}

/**
 * Returns the IST calendar (year/month/day) for a given UTC instant.
 */
export function istCalendarFor(d: Date): { year: number; month: number; day: number } {
  // Shift the instant by +5:30 then read its UTC fields.
  const shifted = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}
