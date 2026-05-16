/**
 * In-memory token-bucket rate limiter. Per-key keyed (IP, email, etc.).
 * For single-instance deployments (current per-gym model). Swap for Redis
 * later via the same interface.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(opts: {
  key: string;
  limit: number;       // max requests
  windowMs: number;    // per this many ms
}): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const b = buckets.get(opts.key);
  if (!b || b.resetAt <= now) {
    const fresh: Bucket = { count: 1, resetAt: now + opts.windowMs };
    buckets.set(opts.key, fresh);
    return { ok: true, remaining: opts.limit - 1, resetAt: fresh.resetAt };
  }
  if (b.count >= opts.limit) {
    return { ok: false, remaining: 0, resetAt: b.resetAt };
  }
  b.count++;
  return { ok: true, remaining: opts.limit - b.count, resetAt: b.resetAt };
}

/** Test helper — clears all buckets. */
export function _resetRateLimits() {
  buckets.clear();
}

/** Pull caller IP from headers (Vercel/CF set common ones). */
export function getRequestIp(req: Request): string {
  const h = req.headers;
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    h.get("cf-connecting-ip") ||
    "unknown"
  );
}
