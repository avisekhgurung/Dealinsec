/**
 * Deal Protection Check — the deterministic half of "stay protected".
 *
 * Scans a deal's terms (custom lines + selected standard terms) for the
 * failure modes that actually burn Indian service businesses: vague scope
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
import { STANDARD_TERMS, type Deal } from "@shared/schema";

export interface ProtectionFlag {
  id: string;
  /** "risk" = a dangerous phrase that invites disputes; "gap" = a missing protection. */
  severity: "risk" | "gap";
  title: string;
  detail: string;
  /** Ready-to-use term line offered when the flag is a gap. */
  suggestedTerm?: string;
}

export interface ProtectionReport {
  flags: ProtectionFlag[];
  risks: number;
  gaps: number;
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

export function analyzeDealProtections(deal: Deal): ProtectionReport {
  const selectedIds = (deal.standardTermIds as string[] | null) ?? [];
  const standardText = STANDARD_TERMS.filter((t) => selectedIds.includes(t.id))
    .map((t) => t.label)
    .join("\n");
  const text = `${deal.customTerms ?? ""}\n${standardText}`;
  const has = (re: RegExp) => re.test(text);

  const flags: ProtectionFlag[] = [];

  /* ── Dangerous phrases (disputes waiting for a trigger) ── */
  if (has(/as per (the )?site (requirement|condition)/i)) {
    flags.push({
      id: "vague_site",
      severity: "risk",
      title: "Vague scope hook",
      detail: '"As per site requirement" lets scope grow without a paper trail — every addition becomes an argument.',
    });
  }
  if (has(/unlimited (revision|change|iteration|modification)/i)) {
    flags.push({
      id: "unlimited_revisions",
      severity: "risk",
      title: "Unlimited revisions promised",
      detail: "Unlimited changes means the project ends when the client feels like it. Cap revisions and price the rest.",
    });
  }
  if (has(/back[\s-]?to[\s-]?back/i) || has(/pa(y|id|yment)[^.\n]{0,40}(when|after|once)[^.\n]{0,40}(client|receiv|realis|clear)/i)) {
    flags.push({
      id: "pay_when_paid",
      severity: "risk",
      title: "Pay-when-paid chain",
      detail: "Your payment is tied to someone else's — a delay upstream becomes your delay, with no recourse.",
    });
  }
  if (has(/as (mutually )?(agreed|decided|discussed) (later|from time|subsequently)/i)) {
    flags.push({
      id: "open_ended",
      severity: "risk",
      title: "Open-ended terms",
      detail: '"To be decided later" clauses decide themselves in the client\'s favour. Pin the number or timeline now.',
    });
  }
  if (has(/retention/i) && !has(/retention[^.\n]{0,80}(release|within|days|month)/i)) {
    flags.push({
      id: "retention_no_release",
      severity: "risk",
      title: "Retention without a release date",
      detail: "Retention money with no release timeline becomes an interest-free loan to your client — put a date on it.",
    });
  }

  const dayFigures = uniqMatches(DAYS_RE, text);
  const advFigures = uniqMatches(ADV_RE, text);
  if (dayFigures.length > 1 || advFigures.length > 1) {
    flags.push({
      id: "conflicting_figures",
      severity: "risk",
      title: "Payment terms contradict themselves",
      detail:
        dayFigures.length > 1
          ? `The terms mention "within ${dayFigures.join(' days" and "within ')} days" — whichever suits the client is the one they'll claim.`
          : `The terms mention ${advFigures.map((a) => `${a}%`).join(" and ")} as the advance — resolve it before sending.`,
    });
  }

  /* ── Missing protections ── */
  if (!has(/advance|upfront|up-front|token|booking amount/i)) {
    flags.push({
      id: "no_advance",
      severity: "gap",
      title: "No advance",
      detail: "Starting without an advance means you carry all the risk — and the awkward conversation happens after the work.",
      suggestedTerm: "50% advance payment is required to confirm the project; work begins on receipt.",
    });
  }
  if (!has(/within\s+\d+\s*days|on (delivery|handover|completion)/i)) {
    flags.push({
      id: "no_balance_timeline",
      severity: "gap",
      title: "No balance timeline",
      detail: "Without a due window, 'balance on completion' quietly becomes 'balance whenever'.",
      suggestedTerm: "The remaining balance is due within 7 days of final delivery.",
    });
  }
  if (!has(/revision|rework|iteration|round of change/i)) {
    flags.push({
      id: "no_revision_limit",
      severity: "gap",
      title: "No revision limit",
      detail: '"Just one more small change" is the most expensive sentence in service work. Cap it in writing.',
      suggestedTerm: "Two rounds of revisions are included; further revisions are billed at ₹[amount] per round.",
    });
  }
  if (!has(/exclud|not includ|out of scope|extra work|additional work/i)) {
    flags.push({
      id: "no_exclusions",
      severity: "gap",
      title: "Nothing is excluded",
      detail: "If the document doesn't say what's NOT included, everything is arguably included.",
      suggestedTerm: "Anything not listed in the deliverables is excluded and will be quoted separately before execution.",
    });
  }
  if (!has(/late payment|interest|pause|suspend|withhold|stop work/i)) {
    flags.push({
      id: "no_late_protection",
      severity: "gap",
      title: "No late-payment protection",
      detail: "There's no stated consequence for paying late — so late payment costs the client nothing.",
      suggestedTerm: "If a due payment is delayed beyond 7 days, work may be paused until the account is settled.",
    });
  }

  return {
    flags,
    risks: flags.filter((f) => f.severity === "risk").length,
    gaps: flags.filter((f) => f.severity === "gap").length,
  };
}
