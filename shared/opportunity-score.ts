/**
 * The opportunity score: "why contact this company now, and what can I credibly offer?" as 100 points, by fixed rules
 * over what is stored. Pure and deterministic: the same evidence and plan always give the same score, and the model
 * never chooses a number. It scores the OPPORTUNITY (the angle and its plan), next to the company's own lead score
 * (shared/lead-score.ts), which it doesn't replace.
 *
 *   evidence   30  the findings the angle cites: confirmed (quoted from a page) earn far more than inferred; a dated
 *                  finding and a second independent page add a little. Nothing confirmed caps this at 9.
 *   fit        25  the company's fit with who you want (15) and how directly the proposed solution is something you
 *                  sell (10).
 *   value      20  the plan's impact (the model's low/medium/high judgment, by fixed points) plus a concrete business
 *                  change among the cited signals (hiring, funding, a launch). Capped at 8 without confirmed evidence:
 *                  a big claim on a guess stays small.
 *   timing     15  the best timing among the cited signals: a concrete event in the last 90 days, context, undated.
 *   feasibility 10 the plan's effort, and whether a small proof-of-value sample was proposed.
 *
 * Confidence (how sure the idea is) is reported apart from value (how much it could be worth): a valuable idea on thin
 * evidence is shown as exactly that. The weights are a starting hypothesis, not validated: tune them with real outcomes
 * (OPPORTUNITY_WEIGHTS, or `weights`), never by a model.
 */
import type { OpportunityPlan } from "./prospect-intel";
import type { SignalType } from "./prospect";

export const OPPORTUNITY_SCORE_VERSION = "opp-v1";

export type OppKey = "evidence" | "fit" | "value" | "timing" | "feasibility";
export const DEFAULT_WEIGHTS: Record<OppKey, number> = { evidence: 30, fit: 25, value: 20, timing: 15, feasibility: 10 };
export const OPP_LABEL: Record<OppKey, string> = { evidence: "Evidence", fit: "Fit with what you sell", value: "Potential value", timing: "Timing", feasibility: "Feasibility" };

export interface CitedFinding {
  id: number;
  kind: string;                 // fact | signal | opportunity | ...
  type: string;
  status: string;               // confirmed | inferred | ...
  url: string | null;
  quote: string | null;
  /** A date the evidence itself states, usable for timing. */
  dated: boolean;
  /** Timing of a signal (shared/prospect.ts timingOf): strong | context | stale | undated | none. */
  timing?: string;
}

export interface OppComponent { key: OppKey; label: string; max: number; points: number; reasons: string[] }
export interface OpportunityScore {
  version: string; total: number; confidence: "high" | "medium" | "low";
  components: OppComponent[];
  /** What would make this stronger, or what is unknown. */
  limits: string[];
}

/** Concrete business changes among signal types (shared/prospect.ts SIGNAL_TYPES); publishing activity or a case study isn't one. */
const CHANGE_SIGNALS = new Set<string>(["HIRING", "FUNDING", "NEW_SERVICE", "EXPANSION", "NEW_LOCATION", "NEW_LEADERSHIP", "TECH_CHANGE", "PARTNERSHIP"] satisfies SignalType[]);

/** "30,25,20,15,10" → weights; anything malformed falls back to the defaults. */
export function weightsFrom(spec: string | undefined): Record<OppKey, number> {
  const n = String(spec ?? "").split(",").map((x) => Number(x.trim()));
  if (n.length !== 5 || n.some((x) => !Number.isFinite(x) || x < 0) || n.reduce((a, b) => a + b, 0) <= 0) return DEFAULT_WEIGHTS;
  const [evidence, fit, value, timing, feasibility] = n;
  return { evidence, fit, value, timing, feasibility };
}

const round = (x: number) => Math.round(x * 10) / 10;

export function scoreOpportunity(i: {
  cited: CitedFinding[];
  fitVerdict: string | null;
  plan: OpportunityPlan | null | undefined;
  weights?: Record<OppKey, number>;
}): OpportunityScore {
  const w = i.weights ?? DEFAULT_WEIGHTS;
  const limits: string[] = [];
  const confirmed = i.cited.filter((f) => f.status === "confirmed" && !!f.url && !!f.quote);
  const inferred = i.cited.filter((f) => !confirmed.includes(f));

  // Evidence (as a fraction of 30, then scaled to the weight).
  const ev: string[] = [];
  let e = confirmed.length * 9 + Math.min(inferred.length, 2) * 2;
  if (confirmed.length) ev.push(`${confirmed.length} confirmed finding${confirmed.length === 1 ? "" : "s"} quoted from a page`);
  if (inferred.length) ev.push(`${inferred.length} inferred finding${inferred.length === 1 ? "" : "s"} (guesses, worth little)`);
  const dated = confirmed.filter((f) => f.dated).length;
  if (dated) { e += Math.min(dated, 2) * 2; ev.push(`${dated} dated by the page itself`); }
  const pages = new Set(confirmed.map((f) => f.url));
  if (pages.size >= 2) { e += 3; ev.push(`${pages.size} separate pages agree`); }
  if (!confirmed.length) { e = Math.min(e, 9); limits.push("Nothing the angle rests on is confirmed on a page yet."); }
  if (!i.cited.length) ev.push("no findings cited");
  e = Math.min(30, e);

  // Fit (of 25): the company 15, the solution 10.
  const fr: string[] = [];
  const companyFit = ({ strong: 15, partial: 9, weak: 3, excluded: 0 } as Record<string, number>)[i.fitVerdict ?? ""] ?? 4;
  fr.push(i.fitVerdict ? `company fit: ${i.fitVerdict}` : "company fit not judged");
  if (!i.fitVerdict || i.fitVerdict === "unclear") limits.push("The company's fit with who you want is unclear.");
  const plan = i.plan ?? null;
  const match = plan ? ({ direct: 10, adjacent: 5, none: 0, unknown: 0 } as const)[plan.serviceMatch] : 0;
  fr.push(plan ? (plan.serviceMatch === "unknown" ? "you haven't said what you sell" : `solution is ${plan.serviceMatch === "direct" ? "what you sell" : plan.serviceMatch === "adjacent" ? "close to what you sell" : "not what you sell"}`) : "no plan yet");
  if (plan?.serviceMatch === "none") limits.push("The solution isn't something you say you offer.");
  if (plan?.serviceMatch === "unknown") limits.push("Describe what you sell (your ideal client profile) so a plan can be matched to it.");
  const f = companyFit + match;

  // Value (of 20).
  const vr: string[] = [];
  let v = plan ? ({ high: 12, medium: 8, low: 4 } as const)[plan.impact] : 0;
  if (plan) vr.push(`impact judged ${plan.impact}`);
  const change = confirmed.find((x) => x.kind === "signal" && CHANGE_SIGNALS.has(x.type));
  if (change) { v += 8; vr.push("a confirmed business change backs it"); }
  if (!confirmed.length && v > 8) { v = 8; vr.push("capped: nothing confirmed"); }
  if (!plan) { vr.push("no plan yet"); limits.push("Generate the angle again to get a plan (solution, sample, how to test it)."); }
  v = Math.min(20, v);

  // Timing (of 15): the best cited signal.
  const order = ["strong", "context", "undated", "stale", "none"];
  const best = i.cited.filter((x) => x.kind === "signal" && x.timing).map((x) => x.timing!).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] ?? "none";
  const t = ({ strong: 15, context: 7, undated: 3, stale: 0, none: 0 } as Record<string, number>)[best] ?? 0;
  const tr = [best === "strong" ? "a concrete event in the last 90 days" : best === "context" ? "background from the last year (not urgency)" : best === "undated" ? "a signal with no known date" : best === "stale" ? "only old signals" : "no dated signal cited"];
  if (best !== "strong") limits.push("No recent, dated event: there's no clear reason it has to be now.");

  // Feasibility (of 10).
  const qr: string[] = [];
  let q = plan ? ({ small: 6, medium: 4, large: 1 } as const)[plan.effort] : 0;
  if (plan) qr.push(`effort ${plan.effort}`);
  if (plan?.demo) { q += 4; qr.push(`a ${plan.demo.effort === "small" ? "few-hours" : "day or two"} sample to show it`); }
  else if (plan) { qr.push("no small sample proposed"); }
  q = Math.min(10, q);

  const raw: Record<OppKey, [number, number, string[]]> = { evidence: [e, 30, ev], fit: [f, 25, fr], value: [v, 20, vr], timing: [t, 15, tr], feasibility: [q, 10, qr] };
  const sumW = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const components: OppComponent[] = (Object.keys(raw) as OppKey[]).map((k) => {
    const [pts, max, reasons] = raw[k];
    const scaledMax = (w[k] / sumW) * 100;
    return { key: k, label: OPP_LABEL[k], max: round(scaledMax), points: round((pts / max) * scaledMax), reasons };
  });
  const total = Math.round(components.reduce((a, c) => a + c.points, 0));
  // Confidence is about the evidence alone: how sure we are the idea is real. High needs two confirmed findings AND a
  // date: a recent event, or two separate pages with at least one dated finding. Undated pages alone are medium.
  const confidence: OpportunityScore["confidence"] = confirmed.length >= 2 && (best === "strong" || (pages.size >= 2 && dated >= 1)) ? "high" : confirmed.length >= 1 ? "medium" : "low";
  return { version: OPPORTUNITY_SCORE_VERSION, total, confidence, components, limits };
}
