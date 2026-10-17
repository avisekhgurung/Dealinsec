/**
 * The person's own verdict on a researched prospect: the measure of research quality that a model's score can't give.
 * Recorded as given and shown back to them; it changes no score, readiness or allowance. One per prospect per workspace
 * (the latest wins), cleared by sending null.
 */
export const PROSPECT_FEEDBACK = ["relevant", "not_relevant", "duplicate", "already_contacted"] as const;
export type ProspectFeedback = (typeof PROSPECT_FEEDBACK)[number];
export const isProspectFeedback = (x: unknown): x is ProspectFeedback => typeof x === "string" && (PROSPECT_FEEDBACK as readonly string[]).includes(x);
export const PROSPECT_FEEDBACK_LABEL: Record<ProspectFeedback, string> = {
  relevant: "Relevant", not_relevant: "Not relevant", duplicate: "Duplicate", already_contacted: "Already contacted",
};
