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

const list = (maxItems: number, maxLen: number) =>
  z.array(z.string().trim().min(1).max(maxLen)).max(maxItems)
    .transform((xs) => Array.from(new Set(xs.map((x) => x.trim()).filter(Boolean))));

export const MAX_LIST = 10;

/** What the user typed. Money is in whole units here; the service converts it. */
export const idealClientInputSchema = z.object({
  about: z.string().trim().max(600).optional(),
  services: list(MAX_LIST, 60).optional(),
  targetIndustries: list(MAX_LIST, 60).optional(),
  targetLocations: list(MAX_LIST, 60).optional(),
  exclusions: list(MAX_LIST, 60).optional(),
  minDealMajor: z.number().positive().max(10_000_000_000).nullable().optional(),
});
export type IdealClientInput = z.infer<typeof idealClientInputSchema>;

/** A profile as stored. */
export interface IdealClient {
  about: string | null;
  services: string[];
  targetIndustries: string[];
  targetLocations: string[];
  exclusions: string[];
  minDealMinor: number | null;
  currency: string | null;
}

export const EMPTY_IDEAL_CLIENT: IdealClient = { about: null, services: [], targetIndustries: [], targetLocations: [], exclusions: [], minDealMinor: null, currency: null };

/** True when there is nothing to compare a lead against. */
export const hasCriteria = (p: IdealClient | null | undefined): boolean =>
  !!p && (p.targetIndustries.length > 0 || p.targetLocations.length > 0 || p.exclusions.length > 0 || p.minDealMinor !== null);

export interface FitLead {
  companyName: string;
  industry?: string | null;
  location?: string | null;
  fitSummary?: string | null;
  estValueMinor?: number | null;
  currency?: string | null;
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

  // Exclusions are stricter than targets: a lead is only called Excluded on an exact whole-phrase hit in
  // what it says about itself ("online gambling" must not exclude "online retail").
  const haystack = ` ${normText([lead.companyName, lead.industry, lead.location, lead.fitSummary].filter(Boolean).join(" "))} `;
  const excludedBy = profile.exclusions.filter((x) => normText(x) && haystack.includes(` ${normText(x)} `));

  const missing = [
    ind?.status === "unknown" ? "an industry" : null, loc?.status === "unknown" ? "a location" : null,
    signals.find((s) => s.key === "value" && s.status === "unknown") ? "an estimated value" : null,
  ].filter((x): x is string => !!x);

  const { verdict, headline } = verdictFrom(signals, excludedBy);
  return { verdict, headline, signals, excludedBy, missing };
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
