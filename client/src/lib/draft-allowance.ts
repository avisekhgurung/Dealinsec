/**
 * How many AI drafts the plan still has, said beside the button that spends one.
 *
 * Why: the allowance is small (a handful per 30 days), and the page only said it was used up after the click, as a
 * refusal. The numbers are the ones the Client Radar page already shows (GET /api/outbound/usage), counted by the same
 * rule the draft itself is refused by. Advisory only: the server decides, so when the numbers can't be read the note is
 * simply absent and the buttons work as before.
 */
export interface DraftPlan { tier: "free" | "trial" | "pro" | "unlimited"; label: string; windowDays: number; drafts?: { limit: number; remaining: number } | null }
export interface DraftAllowanceNote { out: boolean; text: string; /** Offer the plans page (the free plan only). */ upgrade: boolean }

const drafts = (n: number) => `${n} AI draft${n === 1 ? "" : "s"}`;

export function draftAllowanceNote(plan: DraftPlan | null | undefined): DraftAllowanceNote | null {
  const d = plan?.drafts;
  if (!plan || plan.tier === "unlimited" || !d || !Number.isFinite(d.limit) || !Number.isFinite(d.remaining) || d.limit <= 0) return null;
  const free = plan.tier === "free";
  const left = Math.max(0, Math.min(d.limit, Math.floor(d.remaining)));
  if (left > 0) return { out: false, upgrade: false, text: `${left} of ${drafts(d.limit)} left in this ${plan.windowDays}-day period.` };
  return free
    ? { out: true, upgrade: true, text: `You've used the free plan's ${drafts(d.limit)} for this ${plan.windowDays}-day period.` }
    : { out: true, upgrade: false, text: `You've used the ${drafts(d.limit)} included in ${plan.label} for this ${plan.windowDays}-day period. More become available as earlier drafts pass ${plan.windowDays} days.` };
}
