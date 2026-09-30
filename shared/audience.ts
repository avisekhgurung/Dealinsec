/**
 * Audience — which kind of work a DealInSec account does.
 *
 * DealInSec is ONE product with one Deal → Protection Check → Quotation →
 * Agreement → Invoice → Payment workflow. The audience only changes the words
 * around that workflow and which optional fields are offered; it never forks
 * an entity or an engine.
 *
 *   client_work            freelancers, consultants, service professionals
 *   brand_collaboration    creators, UGC creators, influencers doing paid
 *                          brand deals
 *
 * Two places decide it, and they never disagree about existing data:
 *  - the ACCOUNT default (organizations.audience, null = client_work) drives
 *    lists, the dashboard and what the new-deal picker offers first;
 *  - a DEAL's audience is derived from its deal type (audienceForDealType), so
 *    a creator who also freelances just picks a different deal type. There is
 *    no per-deal audience column to fall out of sync.
 *
 * Pure data and functions: read by the server, the client and the tests.
 */
import { z } from "zod";
import { brandDealTypeOptions, dealTypeOptions } from "./dealTypeTaxonomy";

export const AUDIENCES = ["client_work", "brand_collaboration"] as const;
export type Audience = (typeof AUDIENCES)[number];

/** Every account and deal that predates the audience concept reads as this. */
export const DEFAULT_AUDIENCE: Audience = "client_work";

export const isAudience = (v: unknown): v is Audience =>
  typeof v === "string" && (AUDIENCES as readonly string[]).includes(v);

/** Anything unrecognised — null, an old row, a tampered value — is client work. */
export const normalizeAudience = (v: unknown): Audience => (isAudience(v) ? v : DEFAULT_AUDIENCE);

/** Deal types that belong to the brand-collaboration audience. "Creator" is the
 *  retired type; existing deals keep it and are treated as brand deals. */
const BRAND_DEAL_TYPES: readonly string[] = [...brandDealTypeOptions, "Creator"];

export function audienceForDealType(dealType?: string | null): Audience {
  return dealType && BRAND_DEAL_TYPES.includes(dealType) ? "brand_collaboration" : "client_work";
}

/** The deal types the new-deal picker offers. For a brand account the brand
 *  type comes first and the client-work types stay available behind it. */
export function pickerDealTypes(audience: Audience): readonly string[] {
  return audience === "brand_collaboration"
    ? [...brandDealTypeOptions, ...dealTypeOptions]
    : dealTypeOptions;
}

export interface AudienceLabels {
  audience: Audience;
  /** "Client" / "Brand" — the other party. */
  party: string;
  partyLower: string;
  /** "client deal" / "brand deal". */
  dealNoun: string;
  /** "Project" / "Campaign" — what the deal is about. */
  project: string;
  /** "Client payment" / "Brand payment". */
  payment: string;
  /** Dashboard and deal-list call to action. */
  newDealCta: string;
  /** Dashboard empty state. */
  emptyState: string;
  /** AI composer prompt. */
  composerPrompt: string;
}

const LABELS: Record<Audience, AudienceLabels> = {
  client_work: {
    audience: "client_work",
    party: "Client",
    partyLower: "client",
    dealNoun: "client deal",
    project: "Project",
    payment: "Client payment",
    newDealCta: "Create a client deal",
    emptyState: "Start with a client conversation, project request, or scope of work.",
    composerPrompt: "Paste a client message",
  },
  brand_collaboration: {
    audience: "brand_collaboration",
    party: "Brand",
    partyLower: "brand",
    dealNoun: "brand deal",
    project: "Campaign",
    payment: "Brand payment",
    newDealCta: "Create a brand deal",
    emptyState: "Start with a brand offer, campaign brief, or collaboration message.",
    composerPrompt: "Paste a brand message",
  },
};

export const audienceLabels = (audience?: unknown): AudienceLabels => LABELS[normalizeAudience(audience)];

/** Labels for a specific deal: its deal type decides, not the account. */
export const dealAudienceLabels = (dealType?: string | null): AudienceLabels =>
  LABELS[audienceForDealType(dealType)];

/**
 * The optional, brand-deal-only terms. Everything is optional and bounded; an
 * empty string means "not stated" and is dropped by normalizeBrandTerms, so a
 * deal either carries a term or genuinely has none. Free text on purpose: what
 * a brand asked for is theirs to word, and the Protection Check reads it.
 */
export const BRAND_TERM_LIMITS = {
  campaign: 120,
  usageRights: 500,
  usageDuration: 120,
  exclusivity: 500,
  approval: 500,
} as const;

export type BrandTermKey = keyof typeof BRAND_TERM_LIMITS;
export const BRAND_TERM_KEYS = Object.keys(BRAND_TERM_LIMITS) as BrandTermKey[];

const term = (max: number) => z.string().trim().max(max).optional();

export const brandTermsSchema = z.object({
  campaign: term(BRAND_TERM_LIMITS.campaign),
  usageRights: term(BRAND_TERM_LIMITS.usageRights),
  usageDuration: term(BRAND_TERM_LIMITS.usageDuration),
  exclusivity: term(BRAND_TERM_LIMITS.exclusivity),
  approval: term(BRAND_TERM_LIMITS.approval),
});

export type BrandTerms = z.infer<typeof brandTermsSchema>;

/** A value that only says "we don't know". An AI extraction or a form can
 *  hand one back; storing it would make the Protection Check believe the term
 *  is stated, so it is treated as not stated. */
const PLACEHOLDER_RE = /^(not (specified|stated|mentioned)|unspecified|unknown|n\/?a|tbd|tba|none stated|-+)\.?$/i;

/** Drops blank and placeholder fields; returns null when nothing is stated.
 *  Unknown keys are discarded. Safe on any input, including a value read back
 *  from the database. */
export function normalizeBrandTerms(input: unknown): BrandTerms | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const out: BrandTerms = {};
  for (const key of BRAND_TERM_KEYS) {
    const raw = (input as Record<string, unknown>)[key];
    if (typeof raw !== "string") continue;
    const value = raw.trim().slice(0, BRAND_TERM_LIMITS[key]);
    if (value && !PLACEHOLDER_RE.test(value)) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

export const BRAND_TERM_LABELS: Record<BrandTermKey, string> = {
  campaign: "Campaign",
  usageRights: "Usage rights",
  usageDuration: "Usage duration",
  exclusivity: "Exclusivity",
  approval: "Approval process",
};

/** The terms a deal actually states, in a fixed order, for showing to the
 *  other party. Unstated terms are left out — a quotation does not print
 *  "Not specified" to a brand; the creator sees what is missing in Protection
 *  Check. The campaign is excluded by default because documents show it next
 *  to the title. */
export function brandTermRows(
  terms: unknown,
  opts: { withCampaign?: boolean } = {},
): { key: BrandTermKey; label: string; value: string }[] {
  const t = normalizeBrandTerms(terms);
  if (!t) return [];
  return BRAND_TERM_KEYS.filter((k) => (opts.withCampaign || k !== "campaign") && t[k]).map((key) => ({
    key,
    label: BRAND_TERM_LABELS[key],
    value: t[key]!,
  }));
}

/** What to store in deals.brand_terms: the normalised terms for a brand deal,
 *  null for any other deal type (the terms mean nothing there, and keeping
 *  them would let a stale value resurface if the type ever changed). */
export function brandTermsForDeal(dealType: string | null | undefined, input: unknown): BrandTerms | null {
  return audienceForDealType(dealType) === "brand_collaboration" ? normalizeBrandTerms(input) : null;
}

// A negation of exclusivity, not merely a sentence that starts with "No":
// "No exclusivity", "None", "Non-exclusive", "Not required" say there is none,
// while "No other skincare brands for 30 days" is a real exclusivity term.
const NO_EXCLUSIVITY_RE =
  /^\s*(?:(?:no|none)(?:\s+exclusiv\w*(?:\s+(?:is\s+)?(?:required|needed|applies|asked))?)?[\s.!]*$|non[- ]?exclusive|no\s+exclusiv|not\s+(?:required|applicable|needed|exclusive))/i;

/** Whether an agreement made from this deal starts out exclusive.
 *
 *  Every type but Brand Collaboration keeps the long-standing default (true),
 *  so nothing existing changes. A brand collaboration is exclusive only when
 *  the deal actually states an exclusivity term other than "none" — a creator
 *  is not made to consent to exclusivity nobody asked for. */
export function defaultExclusive(dealType: string | null | undefined, brandTerms: unknown): boolean {
  if (dealType !== "Brand Collaboration") return true;
  const stated = normalizeBrandTerms(brandTerms)?.exclusivity;
  return !!stated && !NO_EXCLUSIVITY_RE.test(stated);
}

/** Shown wherever a brand term the deal does not state would otherwise be blank. */
export const NOT_SPECIFIED = "Not specified";
