/**
 * How many AI drafts the plan still has, said beside the button that spends one.
 *
 * Why: the allowance is small (a handful per 30 days), and the page only said it was used up after the click, as a
 * refusal. The numbers are the ones the Client Radar page already shows (GET /api/outbound/usage), counted by the same
 * rule the draft itself is refused by. Advisory only: the server decides, so when the numbers can't be read the note is
 * simply absent and the buttons work as before.
 */
import { featureStatus, type CreditKindView, type WarnView } from "@/lib/credits";

export interface DraftPlan { tier: "free" | "trial" | "pro" | "unlimited"; label: string; windowDays: number; drafts?: { limit: number; remaining: number } | null }
export interface DraftAllowanceNote {
  /** The plan's drafts are used up AND no purchased draft credit covers the next one: AI drafting (only) is blocked. */
  out: boolean;
  text: string;
  /** Offer the plans page (the free plan only). */
  upgrade: boolean;
  /** Offer to buy AI draft credits: shown from the warning threshold on, and when drafting is blocked. Absent otherwise. */
  topUp?: true;
  /** At or over the warning threshold (the plan still has some left). Absent otherwise. */
  warn?: true;
  /** The plan's drafts are used up and purchased credits are paying for the next one. Absent otherwise. */
  credits?: true;
}
/** Purchased credits and the admin's warning settings, from the same usage answer (absent = the pre-credits behaviour). */
export interface DraftCreditContext { credits?: CreditKindView | null; warn?: WarnView | null }

const drafts = (n: number) => `${n} AI draft${n === 1 ? "" : "s"}`;

export function draftAllowanceNote(plan: DraftPlan | null | undefined, ctx?: DraftCreditContext): DraftAllowanceNote | null {
  const d = plan?.drafts;
  if (!plan || plan.tier === "unlimited" || !d || !Number.isFinite(d.limit) || !Number.isFinite(d.remaining) || d.limit <= 0) return null;
  const free = plan.tier === "free";
  const left = Math.max(0, Math.min(d.limit, Math.floor(d.remaining)));
  // Without credit information this is exactly the pre-credits note.
  const status = ctx ? featureStatus({ used: d.limit - left, limit: d.limit, remaining: left, nextFreesAt: null }, ctx.credits, ctx.warn) : null;
  const balance = Math.max(0, ctx?.credits?.balance ?? 0);
  const topUpOffered = ctx?.warn?.exhausted !== false;
  if (left > 0) {
    const base = `${left} of ${drafts(d.limit)} left in this ${plan.windowDays}-day period.`;
    if (status?.state === "warn") return { out: false, upgrade: false, warn: true, topUp: true, text: `${base} You've used ${status.percent}% of them.${balance > 0 ? ` You also have ${balance} purchased AI draft credit${balance === 1 ? "" : "s"}.` : ""}` };
    return { out: false, upgrade: false, text: balance > 0 ? `${base} You also have ${balance} purchased AI draft credit${balance === 1 ? "" : "s"}.` : base };
  }
  if (status?.state === "credits") {
    return { out: false, upgrade: false, credits: true, text: `You've used the ${drafts(d.limit)} included in ${free ? "the free plan" : plan.label} for this ${plan.windowDays}-day period. The next draft uses ${status.cost} of your ${balance} purchased AI draft credit${balance === 1 ? "" : "s"}.` };
  }
  const out = free
    ? { out: true as const, upgrade: true, text: `You've used the free plan's ${drafts(d.limit)} for this ${plan.windowDays}-day period.` }
    : { out: true as const, upgrade: false, text: `You've used the ${drafts(d.limit)} included in ${plan.label} for this ${plan.windowDays}-day period. More become available as earlier drafts pass ${plan.windowDays} days.` };
  return ctx && topUpOffered ? { ...out, topUp: true } : out;
}
