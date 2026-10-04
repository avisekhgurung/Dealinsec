/**
 * A transparent lead score out of 100. Pure: no model, no database, no network.
 *
 *   Company fit 20 · Need/pain 25 · Buying signal 20 · Budget potential 15 · Contactability 10 · Timing 10
 *
 * Every point traces to something recorded about the lead, and every component says why.
 * What is not known earns NOTHING and is listed under `missing`: unknown is never guessed
 * and never a mismatch. Because most websites say little about need, signal, budget and
 * timing, the score is shown with how much of the 100 it could be measured against
 * (`knownMax`) and a confidence band, so a low number caused by missing facts is not read
 * as a bad lead. The rule-based fit verdict stays visible beside it (shared/fit.ts).
 *
 * Facts come from the lead itself and from its claims (shared/leads.ts): a confirmed claim
 * (evidence URL + snippet) earns the component's full points, an inferred one half, a
 * conflicting one none, an unknown one counts as not known. Only claims whose field is in
 * FIELD_FAMILIES score, so a free-text note never moves a number.
 */
import type { FitResult, FitVerdict } from "./fit";

export type ComponentKey = "fit" | "need" | "signal" | "budget" | "contact" | "timing";
export const COMPONENTS: { key: ComponentKey; label: string; max: number }[] = [
  { key: "fit", label: "Company fit", max: 20 },
  { key: "need", label: "Need or pain", max: 25 },
  { key: "signal", label: "Buying signal", max: 20 },
  { key: "budget", label: "Budget potential", max: 15 },
  { key: "contact", label: "Contactability", max: 10 },
  { key: "timing", label: "Timing", max: 10 },
];
export const TOTAL_MAX = 100;

/** The claim fields that count, per component. The research pipeline writes exactly these names. */
export const FIELD_FAMILIES: Record<Exclude<ComponentKey, "fit">, readonly string[]> = {
  need: ["pain_point", "need", "opportunity"],
  signal: ["buying_signal", "signal", "recent_news", "hiring", "launch"],
  budget: ["budget", "revenue", "funding", "team_size"],
  contact: ["business_email", "business_phone", "contact_form", "decision_maker"],
  timing: ["timing", "deadline", "timeline", "urgency"],
};

/**
 * Facts a company states about its own ACTIVITY (a launch, a hiring notice, news). They show a business is moving; they
 * are not evidence anyone wants to buy from you, so even when confirmed they earn at most HALF of the buying-signal points.
 * Only a claim of an actual buying signal (shared by the person, or confirmed elsewhere) earns the whole.
 */
export const ACTIVITY_FIELDS = ["recent_news", "hiring", "launch"] as const;

export type ClaimStatus = "confirmed" | "inferred" | "unknown" | "conflicting";
export interface ScoreClaim { id: number; field: string; value: string; status: ClaimStatus | string; evidenceUrl?: string | null; createdAt?: Date | string | null }
export interface ScoreLead { contactEmail?: string | null; contactName?: string | null; estValueMinor?: number | null; doNotContact?: boolean | null }

export interface ScoreComponent {
  key: ComponentKey; label: string; max: number;
  /** null = not known (earns nothing, counts as missing). */
  points: number | null;
  reason: string;
  /** The claims this component rests on. */
  evidenceClaimIds: number[];
}
export type Confidence = "low" | "medium" | "high";
export interface LeadScore {
  total: number; max: 100;
  /** The part of the 100 that could be measured. total/knownMax is the "real" fit of what is known. */
  knownMax: number; unknownPoints: number;
  confidence: Confidence;
  components: ScoreComponent[];
  /** Plain-language things that, if added, would let the score say more. */
  missing: string[];
}

export const normField = (f: string): string => f.trim().toLowerCase().replace(/[\s-]+/g, "_");

/** The latest claim per field (a research re-run appends; the newest wins). */
export function latestPerField(claims: ScoreClaim[]): ScoreClaim[] {
  const when = (c: ScoreClaim) => (c.createdAt ? new Date(c.createdAt).getTime() || 0 : 0);
  const best = new Map<string, ScoreClaim>();
  for (const c of claims) {
    const k = normField(c.field);
    const cur = best.get(k);
    if (!cur || when(c) > when(cur) || (when(c) === when(cur) && c.id > cur.id)) best.set(k, c);
  }
  return Array.from(best.values());
}

const FIT_POINTS: Record<FitVerdict, number | null> = { strong: 20, partial: 12, weak: 4, excluded: 0, unclear: null, no_profile: null };

type Tier = "confirmed" | "inferred" | "conflicting" | "none";
/** The best standing among the latest claims of a family: confirmed beats inferred beats conflicting; unknown is as good as absent. */
function tierOf(claims: ScoreClaim[], fields: readonly string[]): { tier: Tier; ids: number[]; sample?: string } {
  const own = latestPerField(claims).filter((c) => fields.includes(normField(c.field)));
  const pick = (s: string) => own.filter((c) => c.status === s);
  for (const t of ["confirmed", "inferred", "conflicting"] as const) {
    const hit = pick(t);
    if (hit.length) return { tier: t, ids: hit.map((c) => c.id), sample: hit[0].value };
  }
  return { tier: "none", ids: [] };
}

function byTier(key: ComponentKey, max: number, label: string, claims: ScoreClaim[], noun: string): ScoreComponent {
  const t = tierOf(claims, FIELD_FAMILIES[key as Exclude<ComponentKey, "fit">]);
  if (t.tier === "confirmed") return { key, label, max, points: max, reason: `Confirmed: ${t.sample}`, evidenceClaimIds: t.ids };
  if (t.tier === "inferred") return { key, label, max, points: Math.floor(max / 2), reason: `Likely, not confirmed: ${t.sample}`, evidenceClaimIds: t.ids };
  if (t.tier === "conflicting") return { key, label, max, points: 0, reason: `Sources disagree about ${noun}`, evidenceClaimIds: t.ids };
  return { key, label, max, points: null, reason: `Nothing found about ${noun}`, evidenceClaimIds: [] };
}

/** Buying signal: a real signal counts in full when confirmed; activity on the site (a launch, hiring, news) counts at most half. */
function signal(claims: ScoreClaim[]): ScoreComponent {
  const label = "Buying signal", max = 20;
  const strongFields = FIELD_FAMILIES.signal.filter((f) => !(ACTIVITY_FIELDS as readonly string[]).includes(f));
  const strong = tierOf(claims, strongFields);
  const activity = tierOf(claims, ACTIVITY_FIELDS);
  if (strong.tier === "confirmed") return { key: "signal", label, max, points: max, reason: `Confirmed: ${strong.sample}`, evidenceClaimIds: strong.ids };
  if (strong.tier === "inferred") return { key: "signal", label, max, points: max / 2, reason: `Likely, not confirmed: ${strong.sample}`, evidenceClaimIds: strong.ids };
  if (activity.tier === "confirmed" || activity.tier === "inferred") return { key: "signal", label, max, points: max / 2, reason: `Activity on the site (not proof of intent): ${activity.sample}`, evidenceClaimIds: activity.ids };
  if (strong.tier === "conflicting" || activity.tier === "conflicting") return { key: "signal", label, max, points: 0, reason: "Sources disagree about buying signals", evidenceClaimIds: [...strong.ids, ...activity.ids] };
  return { key: "signal", label, max, points: null, reason: "Nothing found about buying signals", evidenceClaimIds: [] };
}

export function scoreLead(fit: FitResult | null, lead: ScoreLead, claims: ScoreClaim[]): LeadScore {
  const comps: ScoreComponent[] = [];
  const missing: string[] = [];

  // Company fit: the rule-based verdict, nothing else.
  const fitPts = fit ? FIT_POINTS[fit.verdict] : null;
  comps.push({ key: "fit", label: "Company fit", max: 20, points: fitPts, reason: fit ? fit.headline : "No ideal client set to compare with", evidenceClaimIds: [] });
  if (fitPts === null) missing.push(!fit || fit.verdict === "no_profile" ? "Set your ideal client, so fit can be judged" : "More about the company (industry, location), so fit can be judged");

  comps.push(byTier("need", 25, "Need or pain", claims, "a need or pain point"));
  comps.push(signal(claims));

  // Budget: a researched/confirmed figure, or the person's own estimate on the lead (counts as likely, half).
  const budget = byTier("budget", 15, "Budget potential", claims, "budget");
  if (budget.points === null && lead.estValueMinor && lead.estValueMinor > 0) {
    comps.push({ ...budget, points: Math.floor(15 / 2), reason: "Your own estimate of the deal value", evidenceClaimIds: [] });
  } else comps.push(budget);

  // Contactability: a way in (6), a phone (2), a named person (2). Do-not-contact overrides everything.
  if (lead.doNotContact) {
    comps.push({ key: "contact", label: "Contactability", max: 10, points: 0, reason: "Marked do not contact", evidenceClaimIds: [] });
  } else {
    const ids: number[] = []; let pts = 0; const parts: string[] = [];
    const own = latestPerField(claims);
    const confirmed = (f: string) => own.find((c) => normField(c.field) === f && c.status === "confirmed");
    const email = confirmed("business_email"), form = confirmed("contact_form"), phone = confirmed("business_phone"), person = confirmed("decision_maker");
    if (lead.contactEmail || email) { pts += 6; parts.push("an email address"); if (email) ids.push(email.id); }
    else if (form) { pts += 4; parts.push("a contact form"); ids.push(form.id); }
    if (phone) { pts += 2; parts.push("a phone number"); ids.push(phone.id); }
    if (lead.contactName || person) { pts += 2; parts.push("a named contact"); if (person) ids.push(person.id); }
    comps.push(pts > 0
      ? { key: "contact", label: "Contactability", max: 10, points: pts, reason: `Has ${parts.join(", ")}`, evidenceClaimIds: ids }
      : { key: "contact", label: "Contactability", max: 10, points: null, reason: "No way to reach them found yet", evidenceClaimIds: [] });
  }

  comps.push(byTier("timing", 10, "Timing", claims, "timing"));

  for (const c of comps) {
    if (c.points === null && c.key !== "fit") missing.push(c.reason.startsWith("No way") ? "A business email address or contact form" : `${c.label}: ${c.reason.toLowerCase()}`);
  }
  const total = comps.reduce((n, c) => n + (c.points ?? 0), 0);
  const knownMax = comps.filter((c) => c.points !== null).reduce((n, c) => n + c.max, 0);
  const confidence: Confidence = knownMax >= 70 ? "high" : knownMax >= 40 ? "medium" : "low";
  return { total, max: 100, knownMax, unknownPoints: TOTAL_MAX - knownMax, confidence, components: comps, missing };
}
