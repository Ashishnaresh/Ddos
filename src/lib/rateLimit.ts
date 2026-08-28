/**
 * Small in-process fixed-window rate limiter for auth endpoints.
 *
 * This is deliberately simple and per-process. For multi-instance deployments
 * put a shared limiter (Redis) in front; the DB-backed account lockout in
 * auth.ts is the cross-instance backstop against credential brute force.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const existing = store.get(key);
  if (!existing || existing.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSec: 0 };
  }
  existing.count += 1;
  if (existing.count > limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.ceil((existing.resetAt - now) / 1000),
    };
  }
  return { ok: true, remaining: limit - existing.count, retryAfterSec: 0 };
}

// Periodic cleanup so the map does not grow unbounded.
if (typeof setInterval !== "undefined") {
  const t = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of store) if (v.resetAt <= now) store.delete(k);
  }, 60_000);
  // Do not keep the event loop alive just for cleanup.
  (t as unknown as { unref?: () => void }).unref?.();
}
