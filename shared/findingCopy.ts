/**
 * The wording of the Protection Check findings that BOTH the in-app check
 * (server/copilot/riskcheck.ts, which reads a deal's terms) and the free Deal
 * Risk Checker (server/tools/deal-risk.ts, which reads a pasted message) can
 * raise. One source, so a finding says the same thing wherever it appears and
 * the two can never drift apart.
 *
 * Rules and suggested terms stay with their own checks — a message and a deal's
 * terms are different inputs — but the words a person reads are here.
 *
 * Copy rules, kept from the check itself: it describes what is worth
 * clarifying, never a legal conclusion; it never says a deal is safe,
 * protected or compliant; the `ask` is a question to put or a fix to make.
 */
export type Party = "client" | "brand";

export interface FindingText {
  title: string;
  /** Why it matters. */
  why: string;
  /** The question to ask, or the fix to make. */
  ask: string;
}

const TEXT: Record<string, (p: Party) => FindingText> = {
  unlimited_revisions: (p) => ({
    title: "Unlimited revisions promised",
    why: `Unlimited changes means the project ends when the ${p} feels like it. Cap revisions and price the rest.`,
    ask: "Cap revisions at a fixed number of rounds and price any extra round.",
  }),
  no_advance: () => ({
    title: "No advance",
    why: "Starting without an advance means you carry all the risk — and the awkward conversation happens after the work.",
    ask: "Ask for an advance before work starts, for example 50%.",
  }),
  no_revision_limit: () => ({
    title: "No revision limit",
    why: '"Just one more small change" is the most expensive sentence in service work. Cap it in writing.',
    ask: "Agree how many rounds of revisions are included.",
  }),
  no_cancellation: (p) => ({
    title: "Cancellation isn't covered",
    why: `If the ${p} cancels halfway, nothing says what you are still owed for the work already done.`,
    ask: `Agree what happens to the advance and to work already delivered if the ${p} cancels.`,
  }),
  no_ownership: (p) => ({
    title: "Ownership isn't stated",
    why:
      p === "brand"
        ? "If it doesn't say who owns the content, the brand may assume it owns it outright."
        : "If it doesn't say who owns the finished work, both sides may assume it is theirs — usually only found out at the final payment.",
    ask:
      p === "brand"
        ? "Confirm that you keep ownership of the content and the brand only gets the use that is agreed."
        : "Confirm when ownership of the final work passes to the client, for example on full payment.",
  }),
  no_acceptance: () => ({
    title: "No acceptance step",
    why: "Without a point where the client accepts the work, the project has no end and the final payment has no trigger.",
    ask: "Agree how the client confirms the work is accepted and how long they have to respond.",
  }),
  no_deadline: (p) => ({
    title: p === "brand" ? "Campaign deadline isn't specified" : "No deadline is set",
    why:
      p === "brand"
        ? "Without a campaign deadline, the posting dates and the final payment have nothing to hang from."
        : "Without a deadline, the project can drift and the final payment has nothing to hang from.",
    ask: p === "brand" ? "Confirm the posting dates or the campaign deadline." : "Confirm the delivery date.",
  }),
  open_ended_usage: () => ({
    title: "Open-ended usage",
    why: 'Wording like "in perpetuity" or "all media" lets the brand use your content forever and everywhere for the same fee.',
    ask: "Limit usage to named channels and a set period, and price longer or wider use separately.",
  }),
  no_usage_rights: () => ({
    title: "Usage rights aren't specified",
    why: "Without stated usage rights, the brand may assume it can use your content anywhere, including in paid ads.",
    ask: "Ask the brand how long they can use the content and whether paid advertising is included.",
  }),
  no_usage_duration: () => ({
    title: "Usage duration isn't specified",
    why: "Usage with no end date can turn a one-off fee into a permanent licence.",
    ask: "Agree how long the brand may use the content, for example 3 or 6 months, and what renewing it costs.",
  }),
  no_exclusivity_terms: () => ({
    title: "Exclusivity isn't specified",
    why: "If exclusivity isn't stated, it's unclear whether you can work with competing brands during or after the campaign.",
    ask: "Ask whether the brand expects exclusivity, in which category and for how long, and whether that changes the fee.",
  }),
  no_approval_process: () => ({
    title: "Approval process isn't specified",
    why: "Without an agreed approval step, content can be sent back for changes with no limit on rounds or timing.",
    ask: "Confirm who approves the content, how quickly they respond, and how many rounds of changes are included.",
  }),
};

/** The wording for a finding both checks can raise. Throws for an id that is
 *  not shared, so a typo fails a test instead of shipping a blank finding. */
export function findingText(id: string, party: Party): FindingText {
  const make = TEXT[id];
  if (!make) throw new Error(`No shared finding text for "${id}"`);
  return make(party);
}

export const SHARED_FINDING_IDS: readonly string[] = Object.keys(TEXT);

/** Every shared finding's wording for both parties, as plain data — what the
 *  browser-side Deal Risk Checker embeds. */
export function findingTextTable(): Record<string, Record<Party, FindingText>> {
  const out: Record<string, Record<Party, FindingText>> = {};
  for (const id of SHARED_FINDING_IDS) out[id] = { client: findingText(id, "client"), brand: findingText(id, "brand") };
  return out;
}
