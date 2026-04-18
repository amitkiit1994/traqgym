/**
 * Escape a value for safe inclusion in HTML text content or double-quoted attributes.
 *
 * - Coerces non-strings via String(...)
 * - null / undefined become an empty string
 * - Replaces &, <, >, ", ' with HTML entities
 */
export function escapeHtml(input: unknown): string {
  if (input === null || input === undefined) return "";
  const s = typeof input === "string" ? input : String(input);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
