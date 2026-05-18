// Strip anything that looks like a secret from a string before letting it
// land in an Error message that may flow back to a user chat or log.
// Patterns cover GitHub PATs, Bearer headers, Telegram bot tokens, and
// OpenAI keys.
const TOKEN_REDACTORS: ReadonlyArray<RegExp> = [
  /ghp_[A-Za-z0-9]{20,}/g,
  /ghs_[A-Za-z0-9]{20,}/g,
  /gho_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /Bearer\s+[A-Za-z0-9_\-.]{10,}/gi,
  /bot\d+:[A-Za-z0-9_-]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
];

export function redactSecrets(s: string): string {
  let out = s;
  for (const re of TOKEN_REDACTORS) out = out.replace(re, "***");
  return out;
}
