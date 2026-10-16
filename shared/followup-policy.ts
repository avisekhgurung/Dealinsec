/**
 * When follow-ups fall due. Explicit and pure, so the calendar rules are tested rather than assumed.
 *
 * Business days are Monday to Friday counted in UTC: the app doesn't know a recipient's country or holidays, so a
 * follow-up "3 business days" after a Friday 16:00 UTC send is due Wednesday 16:00 UTC. Public holidays are not
 * skipped. The sequence comes from OUTREACH_FOLLOWUP_BUSINESS_DAYS ("3,5" by default: the first follow-up 3 business
 * days after the outreach, the second 5 after the first), so its length is also the most follow-ups ever offered.
 */

export const DEFAULT_FOLLOWUP_GAPS = [3, 5] as const;
export const MAX_FOLLOWUPS = 5;

/** `n` business days (Mon–Fri, UTC) after `from`, at the same time of day. A weekend start counts from Monday. */
export function addBusinessDays(from: Date, n: number): Date {
  const d = new Date(from.getTime());
  let left = Math.max(0, Math.floor(n));
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) left--;
  }
  return d;
}

export type FollowupPolicy = { gaps: number[]; problem: string | null };

/** The configured gaps, or the default with a problem to log when the setting is malformed (never silently). */
export function followupPolicy(raw: string | undefined): FollowupPolicy {
  const v = (raw ?? "").trim();
  if (!v) return { gaps: [...DEFAULT_FOLLOWUP_GAPS], problem: null };
  if (v === "0" || v.toLowerCase() === "off") return { gaps: [], problem: null };
  const parts = v.split(",").map((x) => x.trim());
  const gaps = parts.map(Number);
  if (!parts.length || parts.length > MAX_FOLLOWUPS || gaps.some((g, i) => !/^\d{1,2}$/.test(parts[i]) || g < 1 || g > 30)) {
    return { gaps: [...DEFAULT_FOLLOWUP_GAPS], problem: `OUTREACH_FOLLOWUP_BUSINESS_DAYS must be up to ${MAX_FOLLOWUPS} whole numbers from 1 to 30 separated by commas (or "off"); using ${DEFAULT_FOLLOWUP_GAPS.join(",")}` };
  }
  return { gaps, problem: null };
}

/** When follow-up `step` (1-based) is due, counted from the message it follows; null past the end of the sequence. */
export function followupDueAt(policy: FollowupPolicy, step: number, after: Date): Date | null {
  const gap = policy.gaps[step - 1];
  return gap ? addBusinessDays(after, gap) : null;
}
