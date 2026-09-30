/**
 * Deal Protection Check — the deterministic half of "stay protected".
 *
 * Scans a deal's terms (custom lines + selected standard terms) for the
 * failure modes that actually burn India's freelancers: vague scope
 * hooks ("as per site requirement"), unlimited revisions, pay-when-paid
 * chains, retention without a release date, missing advance/balance/revision
 * /exclusion protections, and self-contradicting payment figures.
 *
 * NO AI here — every flag is computed, so it can never hallucinate a risk or
 * miss one it was taught. The AI layer (risk-suggest endpoint) only PHRASES
 * tailored term wording on top of these computed flags. Copy rule: we count
 * "protections missing", we do not emit pseudo-precise risk scores, and
 * nothing here claims legal sufficiency.
 */
import { STANDARD_TERMS, type Deal, type LocaleSettings } from "@shared/schema";
import { formatMoney } from "@shared/money";
import { audienceForDealType, normalizeBrandTerms, type Audience } from "@shared/audience";
import { findingText } from "@shared/findingCopy";

/** One scale for every place a finding is shown. */
export type FindingLevel = "important" | "attention" | "informational";

export interface ProtectionFlag {
  id: string;
  /** "risk" = a dangerous phrase that invites disputes; "gap" = a missing protection. */
  severity: "risk" | "gap";
  /** How loudly to show it — see levelFor(). */
  level: FindingLevel;
  title: string;
  /** Why it matters. Equal to `why`; kept because the first surfaces read it. */
  detail: string;
  why: string;
  /** The question to ask, or the fix to make. */
  ask: string;
  /** Ready-to-use term line offered when the flag is a gap. */
  suggestedTerm?: string;
}

export interface ProtectionReport {
  flags: ProtectionFlag[];
  risks: number;
  gaps: number;
  audience: Audience;
  /** Ids of the gap checks that were actually run for this deal. A check that
   *  could not run (a brand rule on a client deal, a date the caller did not
   *  supply) is neither a flag nor a pass. */
  checked: string[];
}

const DAYS_RE = /within\s+(\d{1,3})\s*(?:calendar\s+|working\s+|business\s+)?days?/gi;
const ADV_RE = /(\d{1,2})\s*%\s*(?:advance|upfront|up-front|before)/gi;

const uniqMatches = (re: RegExp, text: string): string[] => {
  const seen: string[] = [];
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
};

/** "₹[amount]", "£[amount]", "[amount] €" — a price placeholder written the way
 *  the org's own money is written, because the suggested term is pasted into
 *  the user's terms and printed on their quotation and agreement.
 *
 *  For INR this is "₹[amount]", the exact text Indian users have always been
 *  offered and may already have in issued documents. It is cut out of
 *  formatMoney()'s own rendering of zero, so glyph side and spacing come from
 *  the same formatter as every amount on those documents. Anything that does
 *  not come out as one clean substitution (a locale with its own digits, bidi
 *  marks) gets the bare placeholder: a blank the user fills is better than a
 *  garbled glyph in a contract. */
function pricePlaceholder(settings: LocaleSettings): string {
  const zero = formatMoney(0, settings.currency, settings.locale).replace(/[\u00A0\u202F]/g, " ");
  if (/[\u200E\u200F\u061C]/.test(zero) || (zero.match(/0/g) ?? []).length !== 1) return "[amount]";
  return zero.replace("0", "[amount]");
}

const LEVEL_RANK: Record<FindingLevel, number> = { important: 0, attention: 1, informational: 2 };

/** Gaps whose absence is worth an "important" — money terms and, for a brand
 *  deal, the usage rights that decide what the fee actually buys. */
const IMPORTANT_GAPS = new Set(["no_advance", "no_balance_timeline", "no_usage_rights"]);
/** Gaps that are worth knowing but rarely decide a deal. */
const INFORMATIONAL_GAPS = new Set(["no_exclusions", "no_late_protection", "no_deadline", "no_deliverables"]);

function levelFor(id: string, severity: "risk" | "gap"): FindingLevel {
  if (severity === "risk" || IMPORTANT_GAPS.has(id)) return "important";
  return INFORMATIONAL_GAPS.has(id) ? "informational" : "attention";
}

const USAGE_RE = /usage right|\busage\b|licen[sc]e|whitelist|paid (media|ads?|advertis)|organic (post|use|only)|use (of )?the (content|video|footage|creative)/i;
const USAGE_DURATION_RE = /(usage|use|licen[sc]e|rights?|whitelist)[^.\n]{0,80}?(\d+\s*(day|week|month|year)s?|perpetu|indefinite|until)|\d+\s*(day|week|month|year)s?[^.\n]{0,40}(usage|licen[sc]e)/i;
const OPEN_USAGE_RE = /in perpetuity|perpetual(ly)?|forever|irrevocabl|all media|any and all (media|channels|platforms|purposes)|unlimited (use|usage|rights)/i;

/** `settings` is the ORG's locale (see copilotSettings) — the one the deal's
 *  documents print in, which is where a suggested term ends up.
 *
 *  `deal` may be a full row or the partial shape a draft or the public demo
 *  builds ({ customTerms, standardTermIds }); a check that needs a field the
 *  caller did not supply is skipped, never guessed. */
export function analyzeDealProtections(deal: Deal, settings: LocaleSettings): ProtectionReport {
  const audience = audienceForDealType(deal.dealType);
  const brand = audience === "brand_collaboration";
  // Wording only: client work reads exactly as it always has.
  const party = brand ? "brand" : "client";
  const terms = normalizeBrandTerms(deal.brandTerms) ?? {};

  const selectedIds = (deal.standardTermIds as string[] | null) ?? [];
  const standardText = STANDARD_TERMS.filter((t) => selectedIds.includes(t.id))
    .map((t) => t.label)
    .join("\n");
  const brandText = Object.values(terms).join("\n");
  const text = `${deal.customTerms ?? ""}\n${standardText}\n${brandText}`;
  // The payment-figure check reads only the payment-bearing text: an approval
  // window ("reply within 2 working days") in the brand terms is not a second
  // payment deadline.
  const paymentText = `${deal.customTerms ?? ""}\n${standardText}`;
  const has = (re: RegExp) => re.test(text);

  const flags: ProtectionFlag[] = [];
  const checked: string[] = [];
  const add = (
    id: string,
    severity: "risk" | "gap",
    title: string,
    why: string,
    ask: string,
    suggestedTerm?: string,
  ) => {
    const f: ProtectionFlag = { id, severity, level: levelFor(id, severity), title, detail: why, why, ask };
    if (suggestedTerm) f.suggestedTerm = suggestedTerm;
    flags.push(f);
  };
  /** Runs a gap check: records that it ran, and raises the flag if it failed. */
  const gap = (id: string, missing: boolean, title: string, why: string, ask: string, suggestedTerm?: string) => {
    checked.push(id);
    if (missing) add(id, "gap", title, why, ask, suggestedTerm);
  };
  // Findings the free Deal Risk Checker can raise too take their wording from
  // one shared source (shared/findingCopy.ts), so the two cannot drift apart.
  const partyKey = brand ? "brand" : "client";
  const addShared = (id: string, severity: "risk" | "gap") => {
    const t = findingText(id, partyKey);
    add(id, severity, t.title, t.why, t.ask);
  };
  const gapShared = (id: string, missing: boolean, suggestedTerm?: string) => {
    const t = findingText(id, partyKey);
    gap(id, missing, t.title, t.why, t.ask, suggestedTerm);
  };

  /* ── Dangerous phrases (disputes waiting for a trigger) ── */
  if (has(/as per (the )?(site|project|client)? ?(requirement|condition)/i)) {
    add(
      "vague_site", "risk", "Vague scope hook",
      '"As per requirement" lets scope grow without a paper trail — every addition becomes an argument.',
      `Ask the ${party} to list exactly what is included, and price anything beyond it separately.`,
    );
  }
  if (has(/unlimited (revision|change|iteration|modification)/i)) {
    addShared("unlimited_revisions", "risk");
  }
  if (has(/back[\s-]?to[\s-]?back/i) || has(/pa(y|id|yment)[^.\n]{0,40}(when|after|once)[^.\n]{0,40}(client|receiv|realis|clear)/i)) {
    add(
      "pay_when_paid", "risk", "Pay-when-paid chain",
      "Your payment is tied to someone else's — a delay upstream becomes your delay, with no recourse.",
      `Agree a payment date that does not depend on when the ${party} is paid by someone else.`,
    );
  }
  if (has(/as (mutually )?(agreed|decided|discussed) (later|from time|subsequently)/i)) {
    add(
      "open_ended", "risk", "Open-ended terms",
      `"To be decided later" clauses decide themselves in the ${party}'s favour. Pin the number or timeline now.`,
      "Replace it with a specific number or date before you agree.",
    );
  }
  if (has(/retention/i) && !has(/retention[^.\n]{0,80}(release|within|days|month)/i)) {
    add(
      "retention_no_release", "risk", "Retention without a release date",
      `Retention money with no release timeline becomes an interest-free loan to your ${party} — put a date on it.`,
      "Put a release date on the retention.",
    );
  }

  const dayFigures = uniqMatches(DAYS_RE, paymentText);
  const advFigures = uniqMatches(ADV_RE, paymentText);
  if (dayFigures.length > 1 || advFigures.length > 1) {
    add(
      "conflicting_figures", "risk", "Payment terms contradict themselves",
      dayFigures.length > 1
        ? `The terms mention "within ${dayFigures.join(' days" and "within ')} days" — whichever suits the ${party} is the one they'll claim.`
        : `The terms mention ${advFigures.map((a) => `${a}%`).join(" and ")} as the advance — resolve it before sending.`,
      "Pick one figure and remove the other before sending.",
    );
  }

  /* ── Brand-deal risks ── */
  if (brand && has(OPEN_USAGE_RE)) {
    addShared("open_ended_usage", "risk");
  }

  /* ── Missing protections ── */
  gapShared(
    "no_advance", !has(/advance|upfront|up-front|token|booking amount/i),
    "50% advance payment is required to confirm the project; work begins on receipt.",
  );
  gap(
    "no_balance_timeline", !has(/within\s+\d+\s*days|on (delivery|handover|completion)/i), "No balance timeline",
    "Without a due window, 'balance on completion' quietly becomes 'balance whenever'.",
    "Confirm when the balance is due, for example within 7 days of final delivery.",
    "The remaining balance is due within 7 days of final delivery.",
  );
  gapShared(
    "no_revision_limit", !has(/revision|rework|iteration|round of change/i),
    // The org's own glyph, never a hardcoded ₹: this string is pasted into the
    // user's own contract, and a ₹ in a British freelancer's terms is wrong.
    `Two rounds of revisions are included; further revisions are billed at ${pricePlaceholder(settings)} per round.`,
  );
  gap(
    "no_exclusions", !has(/exclud|not includ|out of scope|extra work|additional work/i), "Nothing is excluded",
    "If the document doesn't say what's NOT included, everything is arguably included.",
    "List what is not included, so extra work is quoted separately.",
    "Anything not listed in the deliverables is excluded and will be quoted separately before execution.",
  );
  gap(
    "no_late_protection", !has(/late payment|interest|pause|suspend|withhold|stop work/i), "No late-payment protection",
    `There's no stated consequence for paying late — so late payment costs the ${party} nothing.`,
    "State what happens if a payment is late, such as pausing work.",
    "If a due payment is delayed beyond 7 days, work may be paused until the account is settled.",
  );
  gapShared(
    "no_cancellation", !has(/cancel|terminat|kill fee|call off/i),
    "If the project is cancelled after work has started, the advance is non-refundable and any work already delivered is paid for.",
  );
  gapShared(
    "no_ownership", !has(/ownership|intellectual property|\bIP\b|copyright|rights (to|in)|licen[sc]e|assign/i),
    brand
      ? "The creator keeps ownership of the content; the brand's right to use it is limited to what is agreed in writing."
      : "Ownership of the final deliverables passes to the client on full payment; until then the work remains the freelancer's.",
  );
  if (!brand) {
    gapShared(
      "no_acceptance", !has(/accept|approv|sign[- ]?off|deemed/i),
      "Deliverables are treated as accepted if no changes are requested within 5 working days of delivery.",
    );
  }

  /* ── Brand-deal protections ── */
  if (brand) {
    const usageStated = !!terms.usageRights || has(USAGE_RE);
    gapShared(
      "no_usage_rights", !usageStated,
      "The brand may use the approved content on its own social channels only. Paid advertising or any other use needs the creator's written agreement and may be charged separately.",
    );
    if (usageStated) {
      gapShared(
        "no_usage_duration", !terms.usageDuration && !has(USAGE_DURATION_RE),
        "Usage of the content is limited to [number] months from the first publication date.",
      );
    }
    gapShared(
      "no_exclusivity_terms", !terms.exclusivity && !has(/exclusiv|non[- ]?compete|competitor|competing/i),
      "No exclusivity applies unless agreed in writing. If exclusivity is agreed, it covers [category] for [period] and is priced separately.",
    );
    gapShared(
      "no_approval_process", !terms.approval && !has(/approv|sign[- ]?off|review (before|of)/i),
      "The brand approves the content once in advance and responds within 2 working days; up to 2 rounds of changes are included.",
    );
  }

  /* ── Checks that need fields only a saved deal has ── */
  if (Array.isArray(deal.deliverables)) {
    gap(
      "no_deliverables", deal.deliverables.length === 0, "No deliverables are listed",
      brand
        ? "If the content isn't listed, the brand can ask for more posts, formats or platforms than you agreed."
        : "If the deliverables aren't listed, the client can ask for anything and call it part of the price.",
      brand ? "List each piece of content, its platform and the quantity." : "List what you will deliver, one line each.",
    );
  }
  if (typeof deal.endDate === "string") {
    gapShared("no_deadline", !deal.endDate.trim());
  }

  // Most important first; the sort is stable, so the order within a level is
  // the order the checks ran in.
  flags.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);

  return {
    flags,
    risks: flags.filter((f) => f.severity === "risk").length,
    gaps: flags.filter((f) => f.severity === "gap").length,
    audience,
    checked,
  };
}

/** How loudly a flag should be shown. Broken money terms and dangerous
 *  phrases are high priority; the other gaps are worth attention.
 *  Kept for the surfaces that predate `level`. */
export type FlagPriority = "high" | "attention";

const HIGH_GAPS = new Set(["no_advance", "no_balance_timeline"]);

export const flagPriority = (f: ProtectionFlag): FlagPriority =>
  f.severity === "risk" || HIGH_GAPS.has(f.id) ? "high" : "attention";

/** The protections a gap-check looks for, phrased as what is already in place.
 *  A check that ran and raised no flag is a check the terms passed. */
const PASS_LABELS: Record<string, string> = {
  no_advance: "Advance payment is defined",
  no_balance_timeline: "Balance timeline is defined",
  no_revision_limit: "Revision limit is defined",
  no_exclusions: "Exclusions are stated",
  no_late_protection: "Late-payment consequence is stated",
  no_cancellation: "Cancellation is covered",
  no_ownership: "Ownership is stated",
  no_acceptance: "Acceptance step is defined",
  no_usage_rights: "Usage rights are specified",
  no_usage_duration: "Usage duration is specified",
  no_exclusivity_terms: "Exclusivity is specified",
  no_approval_process: "Approval process is specified",
  no_deliverables: "Deliverables are listed",
  no_deadline: "A deadline is set",
};

export function protectionPasses(report: ProtectionReport): string[] {
  const raised = new Set(report.flags.map((f) => f.id));
  return report.checked
    .filter((id) => !raised.has(id) && PASS_LABELS[id])
    .map((id) => PASS_LABELS[id]);
}

/** Counts across an account's deals, for the dashboard. Every figure is a
 *  count of real deals; nothing here is an estimate or a score. */
export interface ProtectionSummary {
  /** Deals that were checked. */
  checked: number;
  /** Deals with at least one important or attention finding. */
  withIssues: number;
  /** Deals with at least one important finding. */
  important: number;
  /** Brand deals whose usage rights or usage duration are missing, or whose usage is open-ended. */
  usageRights: number;
  /** Brand deals whose exclusivity is not stated. */
  exclusivity: number;
}

const USAGE_IDS = new Set(["no_usage_rights", "no_usage_duration", "open_ended_usage"]);

export function summarizeProtection(reports: readonly ProtectionReport[]): ProtectionSummary {
  const has = (r: ProtectionReport, pred: (f: ProtectionFlag) => boolean) => r.flags.some(pred);
  return {
    checked: reports.length,
    withIssues: reports.filter((r) => has(r, (f) => f.level !== "informational")).length,
    important: reports.filter((r) => has(r, (f) => f.level === "important")).length,
    usageRights: reports.filter((r) => has(r, (f) => USAGE_IDS.has(f.id))).length,
    exclusivity: reports.filter((r) => has(r, (f) => f.id === "no_exclusivity_terms")).length,
  };
}
