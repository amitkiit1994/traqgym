import { timingSafeEqual } from "node:crypto";

export function isAllowed(chatId: number, allow: ReadonlySet<number>): boolean {
  return allow.has(chatId);
}

export function checkSecretToken(provided: string | undefined, expected: string): boolean {
  if (provided === undefined) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
