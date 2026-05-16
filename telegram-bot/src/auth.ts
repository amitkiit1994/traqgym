export function isAllowed(chatId: number, allow: ReadonlySet<number>): boolean {
  return allow.has(chatId);
}

export function checkSecretToken(provided: string | undefined, expected: string): boolean {
  return provided !== undefined && provided === expected;
}
