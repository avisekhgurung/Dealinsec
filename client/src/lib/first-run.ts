/**
 * Whether the dashboard treats this account as still setting up ("first run": setup cards first, no
 * insights yet). With the deal suite hidden (shared/flags.ts) deals can't be created, so the question
 * is whether any leads exist; keying on deals there would keep a working find-clients account on the
 * setup screen forever. A count that hasn't loaded (or couldn't) is never read as "none yet": the
 * deals rule stands, and a failed deals read is handled before this is asked.
 */
export function isFirstRun(o: { suiteHidden: boolean; leadTotal: number | null; dealsKnown: boolean; dealCount: number }): boolean {
  if (o.suiteHidden && o.leadTotal !== null) return o.leadTotal === 0;
  return o.dealsKnown && o.dealCount === 0;
}
