/**
 * Does the evidence say this company is a realistic freelancer prospect? Pure rules over text the company itself
 * published — nothing here is a model's opinion, and SILENCE NEVER COUNTS: a company that states nothing about its
 * size, funding or hiring is left exactly as it was. Two questions are answered:
 *
 *   - "known big": disclosed funding, an accelerator badge or several full-time openings say a company likely has an
 *     in-house team and an investor's hiring budget — an unrealistic client for a freelancer hunting very small teams.
 *     It only applies when the ICP's own size cap is small (knownBigApplies, ≤ 20): someone hunting mid-market
 *     clients keeps funded companies. An explicit ask for OUTSIDE help cancels it (outsideHelpIn) — a funded startup
 *     asking for a freelance MVP build is a good prospect, whatever its size.
 *   - hiring classification: a posting that asks for a freelancer, contractor or white-label partner is a real buying
 *     signal for a freelancer; a plain full-time opening is the opposite (they are building in-house), and wording
 *     that says neither stays "unclear" and is treated as before.
 */

/** The "known big" downgrade applies only when the person asked for small teams: a cap of this many people or fewer. */
export const KNOWN_BIG_CAP = 20;
export const knownBigApplies = (icp: { employeeMax: number | null }): boolean =>
  icp.employeeMax !== null && icp.employeeMax <= KNOWN_BIG_CAP;

/** Words with which a business asks for OUTSIDE help: the override that keeps a prospect in, and a buying signal in itself. */
const OUTSIDE_HELP = /\b(freelancers?|freelance|contract(?:or|ors)?|contract basis|white[- ]?label|outsourc\w*|part[- ]time (?:developer|designer|marketer|help)|project basis|per[- ]project|looking for (?:a |an )?(?:developer|designer|agency|consultant|writer|marketer|expert|partner|virtual assistant)|hire (?:a |an )?(?:freelancer|agency|consultant)|external (?:help|partner|team|developer))\b/i;
/** The matched outside-help phrase, to show why a downgrade was cancelled; null when the text says no such thing. */
export function outsideHelpIn(text: string | null | undefined): string | null {
  const m = String(text ?? "").match(OUTSIDE_HELP);
  return m ? m[0] : null;
}

/** Words a company uses about disclosed funding or an accelerator: things only a funded / scaled company says about itself. */
const BIG_COMPANY = /\b(y ?combinator|yc [ws]\d{2}|techstars|500 (?:startups|global)|antler|venture[- ]backed|vc[- ](?:backed|funded)|(?:raised|closed|announced|secured) (?:our |their |its |a |an )?(?:\$|₹|€|£)?\s?[\d.]*\s?(?:million|billion|crore|[mb]n\b)?\s?(?:seed|pre-seed|series [a-e]|funding round|venture round)|series [a-e] (?:round|funding|investment)|backed by (?:a16z|andreessen|sequoia|accel|tiger global|softbank|lightspeed)|fortune ?500)\b/i;
/** The matched big-company phrase, quoted in the downgrade reason; null when the text claims no such thing. */
export function bigCompanyIn(text: string | null | undefined): string | null {
  const m = String(text ?? "").match(BIG_COMPANY);
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

/**
 * What a hiring notice means FOR A FREELANCER. Outside-help wording wins over full-time wording (a "freelance
 * contract, full-time hours" post is still an ask for a freelancer); wording that says neither is "unclear" and
 * changes nothing anywhere.
 */
export type HiringKind = "outside_help" | "full_time" | "unclear";
const FULL_TIME = /\b(full[- ]time|permanent (?:role|position|hire)|salaried|in[- ]house (?:role|team|position)|on[- ]site (?:role|position)|benefits (?:include|package)|401\(?k\)?|health insurance|join (?:our|the) team as)\b/i;
export function classifyHiring(text: string | null | undefined): HiringKind {
  const t = String(text ?? "");
  if (outsideHelpIn(t)) return "outside_help";
  if (FULL_TIME.test(t)) return "full_time";
  return "unclear";
}
