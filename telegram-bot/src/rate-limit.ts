/**
 * Per-chat sliding-window rate limiter.
 *
 * IMPORTANT: state is in-memory per Vercel function instance. Under
 * concurrent webhook invocations Vercel may route to multiple warm
 * containers, so the effective limit becomes (max × N instances). This
 * is acceptable for the current 2-user owner-only bot; if /approve user
 * count grows past ~5-10 active users, migrate this to a shared store
 * (Vercel KV / Upstash Redis) so the cap is global.
 */

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
}

export interface RateLimiter {
  check(chatId: number): boolean;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const hits = new Map<number, number[]>();
  return {
    check(chatId: number): boolean {
      const now = Date.now();
      const cutoff = now - opts.windowMs;
      const arr = (hits.get(chatId) ?? []).filter(t => t > cutoff);
      if (arr.length >= opts.max) {
        hits.set(chatId, arr);
        // Surface every hit so operators see the actual hit rate in logs —
        // bot hammering may indicate misuse OR a webhook retry storm.
        console.warn(
          `[rate-limit] chat=${chatId} blocked: ${arr.length}/${opts.max} requests in last ${opts.windowMs}ms`,
        );
        return false;
      }
      arr.push(now);
      hits.set(chatId, arr);
      return true;
    },
  };
}
