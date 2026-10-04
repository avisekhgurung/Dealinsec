/**
 * A small sliding-window limiter for the endpoints that cost something (fetching a
 * page, reading a PDF). In memory, per server process: enough to stop a loop or a
 * runaway script on one instance, not a global quota. Entries older than the window
 * are dropped as keys are touched, so the map cannot grow without bound.
 */
export function createRateLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return {
    /** True when this call is allowed (and counted); false when the key is over its limit. */
    take(key: string): boolean {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
      if (recent.length >= max) { hits.set(key, recent); return false; }
      recent.push(t);
      hits.set(key, recent);
      if (hits.size > 5_000) hits.forEach((v, k) => { if (!v.some((x) => t - x < windowMs)) hits.delete(k); });
      return true;
    },
  };
}
