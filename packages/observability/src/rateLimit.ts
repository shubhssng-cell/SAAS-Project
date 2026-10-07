/**
 * Rate limiting and concurrency control (Phase 9 Unit 3, D-099). Server-controlled and deterministic: the decision depends only on
 * the key the SERVER derived (an authenticated student id, a peer address), the bucket's configured limit, and the server clock.
 * Nothing the client reports (a header, a body field, a claimed usage) is ever an input.
 *
 * SCOPE, STATED HONESTLY: this is an in-process, fixed-window limiter. With more than one server instance each instance counts on
 * its own, so the effective global limit is `limit x instances`; a deployment that needs a global limit must put a shared store
 * or a gateway in front. This module does not pretend otherwise. Memory is bounded: when `maxKeys` is reached, expired windows
 * are purged and, if the table is still full, the OLDEST window is evicted (never "allow everything").
 */
export interface RateLimit {
  /** Maximum requests per window. */
  limit: number;
  windowMs: number;
}

export interface RateDecision {
  allowed: boolean;
  remaining: number;
  /** Whole seconds until the window resets (always >= 1 when denied). */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Counts one request against (bucket, key) and says whether it may proceed. */
  hit(bucket: string, key: string, rule: RateLimit): RateDecision;
  size(): number;
}

export function createRateLimiter(options: { now?: () => number; maxKeys?: number } = {}): RateLimiter {
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 10_000;
  const windows = new Map<string, { startedAt: number; count: number; windowMs: number }>();

  function makeRoom(t: number): void {
    if (windows.size < maxKeys) return;
    for (const [k, w] of windows) if (t - w.startedAt >= w.windowMs) windows.delete(k);
    while (windows.size >= maxKeys) {
      const oldest = windows.keys().next().value as string | undefined; // Map iterates in insertion order
      if (oldest === undefined) break;
      windows.delete(oldest);
    }
  }

  return {
    hit(bucket, key, rule) {
      if (!(rule.limit >= 1) || !(rule.windowMs >= 1)) throw new Error("invalid rate limit rule");
      const t = now();
      const id = `${bucket}\u0000${key}`;
      let w = windows.get(id);
      if (!w || t - w.startedAt >= rule.windowMs) {
        makeRoom(t);
        w = { startedAt: t, count: 0, windowMs: rule.windowMs };
        windows.delete(id);
        windows.set(id, w);
      }
      w.count += 1;
      const retryAfterSeconds = Math.max(1, Math.ceil((w.startedAt + w.windowMs - t) / 1000));
      return { allowed: w.count <= rule.limit, remaining: Math.max(0, rule.limit - w.count), retryAfterSeconds };
    },
    size: () => windows.size
  };
}

/**
 * Caps how many operations one key may have IN FLIGHT. `acquire` returns a release function, or `null` when the cap is reached
 * (the caller must answer 429, not queue). The release is idempotent, so a double release can never free someone else's slot.
 */
export interface ConcurrencyGate {
  acquire(key: string): (() => void) | null;
  inFlight(key: string): number;
}

export function createConcurrencyGate(options: { max: number }): ConcurrencyGate {
  const active = new Map<string, number>();
  return {
    acquire(key) {
      const n = active.get(key) ?? 0;
      if (n >= options.max) return null;
      active.set(key, n + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const cur = active.get(key) ?? 0;
        if (cur <= 1) active.delete(key);
        else active.set(key, cur - 1);
      };
    },
    inFlight: (key) => active.get(key) ?? 0
  };
}
