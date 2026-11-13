/**
 * Whether the dashboard treats this account as still setting up ("first run": setup cards first, no insights yet).
 *
 * The two sides of the product are separate and either one counts as having started (13 Nov 2026): a person who is
 * finding clients has leads and may never create a deal, and a person using the free Deal Suite has deals and may
 * never run a search. Keying on deals alone kept a working find-clients account on the setup screen forever, which
 * is the bug this rule exists to prevent.
 *
 * A count that hasn't loaded, or couldn't, is never read as "none yet". A failed deals read is handled before this
 * is asked.
 */
export function isFirstRun(o: { leadTotal: number | null; dealsKnown: boolean; dealCount: number }): boolean {
  if (o.leadTotal !== null && o.leadTotal > 0) return false;
  if (o.dealsKnown && o.dealCount > 0) return false;
  // Nothing on either side yet — but only say so once at least one of them has actually answered.
  if (o.leadTotal !== null) return true;
  return o.dealsKnown && o.dealCount === 0;
}
