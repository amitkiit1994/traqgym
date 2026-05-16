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
        return false;
      }
      arr.push(now);
      hits.set(chatId, arr);
      return true;
    },
  };
}
