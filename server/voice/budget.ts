/**
 * Keeping the voice bill bounded. Two limits, both in memory (per server process, so they
 * reset on a restart and are not shared across instances; fine for one instance, and the
 * documented limit if the app ever runs on several):
 *   - a per-person rate (a runaway loop or a script),
 *   - a per-workspace daily number of characters (the actual cost driver).
 * The day is the UTC day: simple and the same for everyone.
 */
export function createVoiceBudget(opts: { perMinute: number; dailyChars: number; now?: () => number }) {
  const now = opts.now ?? Date.now;
  const calls = new Map<string, number[]>();
  const used = new Map<string, { day: string; chars: number }>();
  const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
  return {
    /** Counts a request; false when this person is over their rate. */
    allowRate(userId: string): boolean {
      const t = now();
      const recent = (calls.get(userId) ?? []).filter((x) => t - x < 60_000);
      if (recent.length >= opts.perMinute) { calls.set(userId, recent); return false; }
      recent.push(t); calls.set(userId, recent);
      if (calls.size > 5_000) calls.forEach((v, k) => { if (!v.some((x) => t - x < 60_000)) calls.delete(k); });
      return true;
    },
    /** Reserves `chars` for this workspace today; false (and nothing reserved) when it would pass the daily cap. */
    reserve(orgId: string, chars: number): boolean {
      const day = dayOf(now());
      const cur = used.get(orgId);
      const base = cur && cur.day === day ? cur.chars : 0;
      if (base + chars > opts.dailyChars) return false;
      used.set(orgId, { day, chars: base + chars });
      return true;
    },
    /** Gives back a reservation when nothing was spoken (the provider failed). */
    refund(orgId: string, chars: number) {
      const cur = used.get(orgId);
      if (cur) used.set(orgId, { day: cur.day, chars: Math.max(0, cur.chars - chars) });
    },
    remaining(orgId: string): number {
      const cur = used.get(orgId);
      return Math.max(0, opts.dailyChars - (cur && cur.day === dayOf(now()) ? cur.chars : 0));
    },
  };
}
