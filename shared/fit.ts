/**
 * The ideal client, and how well a lead matches it. Pure: no database, no
 * network, no model.
 *
 * The fit check is deliberately NOT a model's opinion. It compares fields the
 * user entered (their profile, the lead's industry / location / value) with
 * plain rules, and every signal says what it compared. A field the lead does
 * not have is "unknown", never a mismatch: absence of data is not evidence of
 * a bad fit. That keeps the answer explainable and impossible to hallucinate.
 */
import { z } from "zod";

/** How much of what a person writes is kept. Generous on purpose: this is their own description of their business. */
export const IDEAL_ITEM_MAX = 200;
export const IDEAL_ABOUT_MAX = 4000;

/**
 * One list a person typed or pasted, however they laid it out. Nothing is refused for its length or its shape: a
 * pasted column of lines arrives in a one-line box with its line breaks turned into spaces, and an entry that was
 * meant as five items would otherwise be "one item, too long" and an error the person can't act on. So every entry is
 * split on commas, semicolons, line breaks, bullet marks and runs of two or more spaces (a leading dash or star is a
 * bullet and is dropped; a dash inside a phrase is left alone); then each item is trimmed,
 * cut to IDEAL_ITEM_MAX, de-duplicated without regard to case, and the list kept to `maxItems`.
 */
export function tidyList(raw: unknown, maxItems: number, maxLen = IDEAL_ITEM_MAX): string[] {
  const parts = (Array.isArray(raw) ? raw : [raw]).filter((x): x is string => typeof x === "string")
    .flatMap((x) => x.split(/[,;\n\r\u2022\u00b7\u25aa\u25cf\u2023]+|\s{2,}/))
    .map((x) => x.replace(/^[-\u2013\u2014*\s]+/, "").replace(/\s+/g, " ").trim().slice(0, maxLen).trim())
    .filter(Boolean);
  const seen = new Set<string>();
  return parts.filter((x) => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, maxItems);
}
const list = (maxItems: number) => z.union([z.array(z.unknown()), z.string()]).transform((v) => tidyList(v, maxItems));

export const MAX_LIST = 30;

/** What the user typed. Money is in whole units here; the service converts it. */
export const idealClientInputSchema = z.object({
  // Any length is accepted and the first IDEAL_ABOUT_MAX characters kept: a long description is never an error.
  about: z.string().transform((v) => v.trim().slice(0, IDEAL_ABOUT_MAX).trim()).optional(),
  services: list(MAX_LIST).optional(),
  targetIndustries: list(MAX_LIST).optional(),
  targetLocations: list(MAX_LIST).optional(),
  exclusions: list(MAX_LIST).optional(),
  /** The company size the workspace wants, in people. Either end may be left out; both null means no size criterion. */
  minEmployees: z.number().int().positive().max(1_000_000).nullable().optional(),
  maxEmployees: z.number().int().positive().max(1_000_000).nullable().optional(),
  minDealMajor: z.number().positive().max(10_000_000_000).nullable().optional(),
}).refine((x) => x.minEmployees == null || x.maxEmployees == null || x.minEmployees <= x.maxEmployees,
  { path: ["maxEmployees"], message: "The smallest company size must not be bigger than the largest." });
export type IdealClientInput = z.infer<typeof idealClientInputSchema>;

/** A profile as stored. */
export interface IdealClient {
  about: string | null;
  services: string[];
  targetIndustries: string[];
  targetLocations: string[];
  exclusions: string[];
  /** The company size wanted, in people; either end may be null. Judged only against a headcount the company itself states. */
  minEmployees: number | null;
  maxEmployees: number | null;
  minDealMinor: number | null;
  currency: string | null;
}

export const EMPTY_IDEAL_CLIENT: IdealClient = { about: null, services: [], targetIndustries: [], targetLocations: [], exclusions: [], minEmployees: null, maxEmployees: null, minDealMinor: null, currency: null };

/** True when there is nothing to compare a lead against. */
export const hasCriteria = (p: IdealClient | null | undefined): boolean =>
  !!p && (p.targetIndustries.length > 0 || p.targetLocations.length > 0 || p.exclusions.length > 0 || p.minDealMinor !== null
    || p.minEmployees !== null || p.maxEmployees !== null);

export interface FitLead {
  companyName: string;
  industry?: string | null;
  location?: string | null;
  fitSummary?: string | null;
  estValueMinor?: number | null;
  currency?: string | null;
  /** A headcount the company states about itself ("a team of 12", "400+ employees"), from the team_size fact. */
  employees?: string | null;
  /** Verified facts recorded about the company, used as more of its own words (never as a number this module invents). */
  claims?: { field: string; value: string }[];
}

export type SignalStatus = "match" | "mismatch" | "unknown";
export interface FitSignal { key: "industry" | "location" | "value" | "size" | "market"; label: string; status: SignalStatus; detail: string }
export type FitVerdict = "no_profile" | "excluded" | "strong" | "partial" | "weak" | "unclear";
export interface FitResult {
  verdict: FitVerdict;
  headline: string;
  signals: FitSignal[];
  /** Words from the lead that hit an exclusion on the profile. */
  excludedBy: string[];
  /** What to add to the lead to be able to say more. */
  missing: string[];
  /**
   * Exclusions too wordy to compare: a whole sentence ("large enterprises requiring complex enterprise procurement")
   * can't be matched against a company's own words without guessing, so it is reported rather than silently ignored.
   * The person can shorten it, or use the size and industry criteria, which are compared.
   */
  exclusionsNotCompared?: string[];
}

export const VERDICT_LABEL: Record<FitVerdict, string> = {
  no_profile: "No ideal client set", excluded: "Excluded", strong: "Strong fit", partial: "Partial fit", weak: "Weak fit", unclear: "Can't tell yet",
};

export const normText = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const words = (s: string) => normText(s).split(" ").filter((w) => w.length >= 4);

/** One text matches another when either contains the other, or they share a whole word of 4+ letters. */
export function textMatches(a: string, b: string): boolean {
  const x = normText(a), y = normText(b);
  if (!x || !y) return false;
  if (x.length >= 3 && y.includes(x)) return true;
  if (y.length >= 3 && x.includes(y)) return true;
  const wy = new Set(words(y));
  return words(x).some((w) => wy.has(w));
}

/** A headcount from words a company uses about itself: "a team of 12", "12 people", "11-50 employees", "over 40 staff". */
export function parseHeadcount(textValue: string | null | undefined): { min: number; max: number } | null {
  const t = String(textValue ?? "").toLowerCase().replace(/,/g, "");
  const range = t.match(/(\d{1,6})\s*(?:-|\u2013|\u2014|to)\s*(\d{1,6})/);
  if (range) { const a = Number(range[1]), b = Number(range[2]); return a <= b ? { min: a, max: b } : { min: b, max: a }; }
  const over = t.match(/(?:over|more than|\+|above)\s*(\d{1,6})|(\d{1,6})\s*\+/);
  if (over) { const n = Number(over[1] ?? over[2]); return { min: n + 1, max: Number.MAX_SAFE_INTEGER }; }
  const under = t.match(/(?:under|fewer than|less than|up to)\s*(\d{1,6})/);
  if (under) return { min: 1, max: Number(under[1]) };
  const one = t.match(/(\d{1,6})/);
  if (one) { const n = Number(one[1]); return n > 0 ? { min: n, max: n } : null; }
  return null;
}

/** How a size range reads back to the person who set it. */
export function sizeWanted(min: number | null, max: number | null): string {
  return min !== null && max !== null ? `${min}\u2013${max} people` : max !== null ? `up to ${max} people` : min !== null ? `${min}+ people` : "";
}

/**
 * The company-size signal, from a headcount the company STATES about itself against the size the person wants. One
 * rule for both the lead fit check and the prospect fit check (shared/icp.ts), so the two can never disagree.
 * No stated headcount is "unknown", never a mismatch: a company that doesn't publish its size is not thereby wrong.
 */
export function sizeSignal(min: number | null, max: number | null, employees: string | null | undefined): FitSignal | null {
  if (min === null && max === null) return null;
  const want = sizeWanted(min, max);
  const hc = parseHeadcount(employees);
  if (!hc) return { key: "size", label: "Company size", status: "unknown", detail: `Its size isn't known yet (you want ${want}).` };
  const lo = min ?? 1, hi = max ?? Number.MAX_SAFE_INTEGER;
  const said = String(employees).trim().slice(0, 60);
  return hc.max >= lo && hc.min <= hi
    ? { key: "size", label: "Company size", status: "match", detail: `"${said}" is within ${want}.` }
    : { key: "size", label: "Company size", status: "mismatch", detail: `"${said}" is outside ${want}.` };
}

/** The words of a phrase worth matching on: 4+ letters, so "and", "the", "for" never carry a hit. */
const sigWords = (s: string) => Array.from(new Set(normText(s).split(" ").filter((w) => w.length >= 4)));
/** More significant words than this and a phrase is a description, not something to match a company's words against. */
const EXCLUSION_WORD_CAP = 4;

/**
 * Which exclusions the company's own words hit, and which were too wordy to compare.
 *
 * Two ways to hit, both strict enough never to invent one:
 *   - the exclusion appears as a whole phrase, as it always has ("online gambling" must not exclude "online retail");
 *   - OR every one of its significant words appears, so a short exclusion still fires when the words are reordered
 *     or split up ("bulk spam email" hits "bulk email, including spam"). At least two words are required, so a single
 *     common word can never exclude a company on its own.
 *
 * An exclusion with more than EXCLUSION_WORD_CAP significant words is a sentence describing a kind of client. Matching
 * it word by word would either never fire or fire on a coincidence, so it is NOT compared and is reported instead.
 */
export function exclusionHits(exclusions: string[], ownWords: string): { hits: string[]; notCompared: string[] } {
  const haystack = ` ${normText(ownWords)} `;
  const present = new Set(haystack.trim().split(" ").filter(Boolean));
  const hits: string[] = [], notCompared: string[] = [];
  for (const raw of exclusions) {
    const norm = normText(raw);
    if (!norm) continue;
    if (haystack.includes(` ${norm} `)) { hits.push(raw); continue; }
    const sig = sigWords(raw);
    if (sig.length > EXCLUSION_WORD_CAP) { notCompared.push(raw); continue; }
    if (sig.length >= 2 && sig.every((w) => present.has(w))) hits.push(raw);
  }
  return { hits, notCompared };
}

function listSignal(key: "industry" | "location", label: string, targets: string[], value: string | null | undefined): FitSignal | null {
  if (!targets.length) return null;
  const v = value?.trim();
  if (!v) return { key, label, status: "unknown", detail: `The lead has no ${label.toLowerCase()} yet, so I can't compare it with your targets.` };
  const hit = targets.find((t) => textMatches(t, v));
  return hit
    ? { key, label, status: "match", detail: `${label} "${v}" matches your target "${hit}".` }
    : { key, label, status: "mismatch", detail: `${label} "${v}" isn't among your targets (${targets.join(", ")}).` };
}

export function assessFit(profile: IdealClient | null | undefined, lead: FitLead, money: (minor: number, currency: string) => string = (m, c) => `${m / 100} ${c}`): FitResult {
  if (!profile || !hasCriteria(profile)) {
    return { verdict: "no_profile", headline: "Set your ideal client first, so there is something to compare this lead with.", signals: [], excludedBy: [], missing: [] };
  }
  const signals: FitSignal[] = [];
  const ind = listSignal("industry", "Industry", profile.targetIndustries, lead.industry);
  const loc = listSignal("location", "Location", profile.targetLocations, lead.location);
  if (ind) signals.push(ind);
  if (loc) signals.push(loc);

  if (profile.minDealMinor !== null && profile.currency) {
    if (!lead.estValueMinor) signals.push({ key: "value", label: "Value", status: "unknown", detail: "The lead has no estimated value yet." });
    else if (lead.currency !== profile.currency) signals.push({ key: "value", label: "Value", status: "unknown", detail: `The lead's value is in ${lead.currency ?? "an unknown currency"} and your minimum is in ${profile.currency}, so I haven't compared them.` });
    else if (lead.estValueMinor >= profile.minDealMinor) signals.push({ key: "value", label: "Value", status: "match", detail: `Estimated ${money(lead.estValueMinor, lead.currency)} meets your minimum of ${money(profile.minDealMinor, profile.currency)}.` });
    else signals.push({ key: "value", label: "Value", status: "mismatch", detail: `Estimated ${money(lead.estValueMinor, lead.currency)} is below your minimum of ${money(profile.minDealMinor, profile.currency)}.` });
  }

  // Company size, from a headcount the company states about itself (the team_size fact), never a guess.
  const employees = lead.employees?.trim() || lead.claims?.find((c) => c.field === "team_size")?.value || null;
  const size = sizeSignal(profile.minEmployees, profile.maxEmployees, employees);
  if (size) signals.push(size);

  // Exclusions are stricter than targets, and compared only against the company's OWN words: its name, industry,
  // place, summary and the facts recorded about it.
  const ownWords = [lead.companyName, lead.industry, lead.location, lead.fitSummary, ...(lead.claims ?? []).map((c) => c.value)].filter(Boolean).join(" ");
  const { hits: excludedBy, notCompared } = exclusionHits(profile.exclusions, ownWords);

  const missing = [
    ind?.status === "unknown" ? "an industry" : null, loc?.status === "unknown" ? "a location" : null,
    size?.status === "unknown" ? "how many people it has" : null,
    signals.find((s) => s.key === "value" && s.status === "unknown") ? "an estimated value" : null,
  ].filter((x): x is string => !!x);

  const { verdict, headline } = verdictFrom(signals, excludedBy);
  return { verdict, headline, signals, excludedBy, missing, ...(notCompared.length ? { exclusionsNotCompared: notCompared } : {}) };
}

/**
 * The verdict from a list of compared signals and any exclusion hits. Shared by the lead fit check above and by the
 * prospect fit check (shared/icp.ts), which adds company-size and target-market signals: one rule, never two.
 */
export function verdictFrom(signals: FitSignal[], excludedBy: string[]): { verdict: FitVerdict; headline: string } {
  const matches = signals.filter((s) => s.status === "match").length;
  const mismatches = signals.filter((s) => s.status === "mismatch").length;
  const unknowns = signals.filter((s) => s.status === "unknown").length;
  let verdict: FitVerdict;
  let headline: string;
  if (excludedBy.length) { verdict = "excluded"; headline = `Matches something you exclude: ${excludedBy.join(", ")}.`; }
  else if (!signals.length) { verdict = "unclear"; headline = "Your profile has no industry, location or minimum value to compare."; }
  else if (mismatches > 0 && matches === 0) { verdict = "weak"; headline = "Doesn't match what you're looking for."; }
  else if (mismatches > 0) { verdict = "partial"; headline = "Matches some of what you're looking for, not all."; }
  // "Strong" is only said when everything that could be checked was checked: an unknown is never rounded up to a match.
  else if (matches >= 2 && unknowns === 0) { verdict = "strong"; headline = "Matches what you're looking for."; }
  else if (matches >= 1) { verdict = "partial"; headline = unknowns ? `Matches on ${matches === 1 ? "one thing" : `${matches} things`} so far; the rest can't be checked yet.` : "Matches on the one thing you set."; }
  else { verdict = "unclear"; headline = "There isn't enough on the lead to compare yet."; }
  return { verdict, headline };
}
