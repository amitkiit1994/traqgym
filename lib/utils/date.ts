/**
 * Returns today's date at midnight in IST (UTC+5:30).
 * Use this instead of `new Date()` + `setHours(0,0,0,0)` which uses server timezone.
 */
export function todayIST(): Date {
  const now = new Date();
  // IST is UTC+5:30
  const istOffset = 5.5 * 60 * 60 * 1000;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const istMs = utcMs + istOffset;
  const istDate = new Date(istMs);
  // Return midnight of that IST date
  return new Date(istDate.getFullYear(), istDate.getMonth(), istDate.getDate());
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
