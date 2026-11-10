/**
 * The two small vocabularies a saved client profile adds to a search profile (shared/icp.ts): which buying signals
 * the person cares about, and what a company must have before they call it worth their time. A leaf module (no
 * imports) so that both shared/icp.ts and shared/prospect.ts can read it without importing each other.
 *
 * WANTED_SIGNALS is a subset of SIGNAL_TYPES (shared/prospect.ts) — a test holds the two together. "Publishing
 * activity" and "Other" are left out: a blog post is context, never a reason to buy.
 */
export const WANTED_SIGNALS = ["HIRING", "FUNDING", "NEW_SERVICE", "EXPANSION", "NEW_LOCATION", "NEW_LEADERSHIP", "NEW_CASE_STUDY", "TECH_CHANGE", "GROWTH_SIGNAL", "PARTNERSHIP"] as const;
export type WantedSignal = (typeof WANTED_SIGNALS)[number];

export const REQUIREMENT_KEYS = ["contact_route", "decision_maker", "verified_email", "recent_signal", "wanted_signal"] as const;
export type RequirementKey = (typeof REQUIREMENT_KEYS)[number];
export const REQUIREMENT_LABEL: Record<RequirementKey, string> = {
  contact_route: "A way to reach them",
  decision_maker: "A named decision-maker",
  verified_email: "A verified email address",
  recent_signal: "A dated reason from the last 12 months",
  wanted_signal: "One of your buying signals",
};
export const REQUIREMENT_HELP: Record<RequirementKey, string> = {
  contact_route: "A decision-maker named on their site, a business email, or a contact form we confirmed.",
  decision_maker: "A senior person (founder, owner, head of a team) named on their own site or by a contact provider.",
  verified_email: "An email address a contact provider itself verified. Needs a contact provider connected.",
  recent_signal: "A confirmed signal dated to the day or month, from the last 12 months.",
  wanted_signal: "At least one of the buying signals you ticked was found, and it isn't over a year old.",
};
