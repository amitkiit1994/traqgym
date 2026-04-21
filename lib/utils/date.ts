/**
 * Returns the UTC instant equal to today's IST midnight (00:00:00 IST).
 * IST midnight = previous-day 18:30 UTC. Safe to pass to Prisma `gte:` filters.
 */
export function todayIST(): Date {
  const now = new Date();
  // Shift by +5:30 then read UTC fields to get the IST calendar date.
  const shifted = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  // IST midnight = UTC 18:30 of prior day, expressed via negative hour/minute.
  return new Date(Date.UTC(y, m, d, -5, -30, 0));
}

/**
 * Returns the current time in IST.
 */
export function nowIST(): Date {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  return new Date(utcMs + istOffset);
}

/**
 * Returns the IST calendar fields (year/month/day) for a given UTC instant.
 * month is 0-indexed to match JS Date conventions.
 */
export function istCalendar(d: Date = new Date()): {
  year: number;
  month: number;
  day: number;
} {
  const shifted = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

/**
 * Returns the UTC instant equal to IST midnight (00:00:00 IST) of the given
 * IST calendar date. month is 0-indexed.
 */
export function istMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, -5, -30, 0));
}
