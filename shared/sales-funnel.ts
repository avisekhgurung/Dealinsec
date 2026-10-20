/**
 * The sales funnel, from research to revenue, for ONE cohort: the companies Client Radar researched in a window, followed
 * through to what happened with each (their lead, messages, replies, stage, deal). Pure: the server counts, this shapes.
 *
 * Every number is a count of companies (not messages), so each stage is a subset of the one before. A stage counts if
 * the lead is in it now OR ever moved to it (lead_events status_changed), so a lead lost after a meeting still counts as
 * a meeting; "won" is the current state. Nothing here says a message or a signal CAUSED a sale.
 */
export const FUNNEL_STAGES = ["researched", "opportunity", "lead", "drafted", "approved", "sent", "replied", "meeting", "proposal", "won"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
export const FUNNEL_LABEL: Record<FunnelStage, string> = {
  researched: "Researched", opportunity: "Opportunity found", lead: "Added to Leads", drafted: "Message drafted", approved: "Approved by you",
  sent: "Sent", replied: "Replied", meeting: "Meeting", proposal: "Proposal", won: "Won",
};

export type FunnelCounts = Record<FunnelStage, number> & { lost: number; optedOut: number };

export interface FunnelView {
  days: number;
  stages: { key: FunnelStage; label: string; count: number; /** % of the stage before; null for the first or when the one before is 0. */ fromPrevious: number | null }[];
  lost: number; optedOut: number;
  /** Revenue of the won deals, in the workspace's currency (minor units). */
  revenueMinor: number; currency: string;
  notes: string[];
}

export const FUNNEL_WINDOWS = [30, 90, 365] as const;
export const funnelDays = (v: unknown): number => {
  const n = Number(v);
  return (FUNNEL_WINDOWS as readonly number[]).includes(n) ? n : 90;
};

export function funnelView(c: FunnelCounts, revenueMinor: number, days: number, currency = "INR"): FunnelView {
  // Each stage can't exceed the one before (a company replied without a recorded send, e.g. a reply to a mail sent elsewhere).
  let prev: number | null = null;
  const stages = FUNNEL_STAGES.map((key) => {
    const count = prev === null ? c[key] : Math.min(c[key], prev);
    const fromPrevious = prev === null || prev === 0 ? null : Math.round((count / prev) * 100);
    prev = count;
    return { key, label: FUNNEL_LABEL[key], count, fromPrevious };
  });
  const notes = ["A lead counts at every stage it has reached, even if it was later lost."];
  if (stages[0].count < 20) notes.push(`Only ${stages[0].count} researched compan${stages[0].count === 1 ? "y" : "ies"} so far: too few to read rates from.`);
  return { days, stages, lost: c.lost, optedOut: c.optedOut, revenueMinor, currency, notes };
}
