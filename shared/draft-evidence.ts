/**
 * What a first message is built ON: the lead's research ranked into "lead items" (one strong, specific point per
 * message) and "profile" context, from the lead's own facts and, when it came from Client Radar, the dated findings
 * Radar kept. Pure (no I/O): server/sales/outreach.ts feeds it and the prompt receives its output.
 *
 * Why (12 Nov 2026): drafts read generic because the writer saw one fact per field, with no dates, and all three versions
 * got the same input. Now each version is built around a different lead item, and every item says how sure it is:
 *   fact   read on the company's own website (or recorded by the person), with its date when the page gave one
 *   guess  Mika's reading of the evidence (a possible need or opportunity): asked about, never stated
 * Nothing older than a year is used as news, an undated item is never called recent, and a guess written as a sales
 * tactic (naming people, "reach out to…") is never handed to the writer.
 */
import { CONTEXT_DAYS, SIGNAL_LABEL, STRONG_TIMING_DAYS, dateLabel, isEventSignal, signalDating, type SignalType } from "./prospect";

export interface EvidenceClaim { id: number; field: string; value: string; status: string; evidenceUrl?: string | null; source?: string | null; createdAt?: Date | string | null }
export interface EvidenceFinding {
  id: number; kind: string; type: string; value: string; status: string; sourceUrl?: string | null; sourceType?: string | null;
  quote?: string | null; observedAt?: Date | string | null; confidence?: string | null; meta?: Record<string, unknown> | null;
}

export type EvidenceGrade = "fact" | "guess";
export type EvidenceDating = "strong" | "context" | "undated";
export interface EvidenceItem {
  /** "c:<claim id>" or "f:<finding id>". */
  key: string;
  grade: EvidenceGrade;
  kind: "profile" | "signal" | "need" | "opportunity";
  label: string;
  value: string;
  /** How the date reads ("14 Sep 2026", "Sep 2026") or null when the evidence states none. */
  date: string | null;
  dating: EvidenceDating;
  sourceUrl: string | null;
  confidence: "high" | "medium" | "low" | null;
  /** How many words it shares with what the sender offers: a reason the item matters to them. */
  offerMatch: number;
  claimId: number | null;
}
export interface DraftEvidence { profile: EvidenceItem[]; leads: EvidenceItem[]; thin: boolean }

const PROFILE_FIELDS: Record<string, string> = { description: "What it does", services: "What it offers", target_customers: "Who it serves", industry: "Industry", location: "Based in", team_size: "Team size" };
const CLAIM_SIGNAL_FIELDS: Record<string, string> = { recent_news: "News", hiring: "Hiring", launch: "Launch", funding: "Funding" };
const CLAIM_GUESS_FIELDS: Record<string, { label: string; kind: "need" | "opportunity" }> = {
  pain_point: { label: "Possible need", kind: "need" }, opportunity: { label: "Possible opportunity", kind: "opportunity" },
  buying_signal: { label: "Possible buying signal", kind: "opportunity" }, timing: { label: "Possible timing", kind: "opportunity" },
};
/** Signal types that, undated, are usually standing site copy ("we always adopt the latest technology"), not news. */
const BOILERPLATE_WHEN_UNDATED = new Set(["TECH_CHANGE", "GROWTH_SIGNAL", "CONTENT_ACTIVITY", "OTHER"]);
/** A guess written for a salesperson rather than about the company: it is never handed to the writer. */
const TACTIC = /\b(?:engage|reach out|open (?:a|the) (?:technical )?conversation|opener|pitch|use (?:their|its)|contact (?:them|their)|approach (?:them|their))\b/i;
const PERSONISH = /\b[A-Z][a-z]+ [A-Z][a-z]+ \((?:[A-Z][^)]{1,40})\)/;
const STOP = new Set(["and", "the", "for", "with", "our", "your", "you", "their", "that", "this", "from", "into", "are", "was", "has", "have", "more", "new", "also", "about", "help", "helps", "offer", "offers", "services", "service", "company", "business", "businesses", "small", "they", "them", "who", "what", "its", "can", "will", "all", "any", "out", "get"]);

const words = (s: string): Set<string> => new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => (w.length >= 3 || w === "ai" || w === "ui") && !STOP.has(w)).map((w) => w.replace(/(?:ing|ers|er|es|s)$/, "")).filter((w) => w.length >= 2));
const overlap = (a: Set<string>, b: Set<string>) => { let n = 0; a.forEach((w) => { if (b.has(w)) n++; }); return n; };
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
/** "Expansion: Opened an office in Pune" → "Opened an office in Pune" (Radar copies findings to claims with a label prefix). */
const stripLabel = (v: string) => v.replace(/^[A-Z][A-Za-z ]{1,24}:\s+/, "").replace(/^(?:New|Latest)\s+(?=[a-z])/i, "").trim();
const norm = (v: string) => stripLabel(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const conf = (c: unknown): EvidenceItem["confidence"] => (c === "high" || c === "medium" || c === "low" ? c : null);

/** The newest confirmed claim per field; a person's own entry beats one Radar or research wrote at the same time. */
function newestConfirmed(claims: EvidenceClaim[]): Map<string, EvidenceClaim> {
  const out = new Map<string, EvidenceClaim>();
  const t = (c: EvidenceClaim) => (c.createdAt ? new Date(c.createdAt).getTime() : 0) + (c.source === "user" ? 1 : 0);
  for (const c of claims) {
    if (c.status !== "confirmed") continue;
    const f = c.field.trim().toLowerCase();
    const cur = out.get(f);
    if (!cur || t(c) > t(cur) || (t(c) === t(cur) && c.id > cur.id)) out.set(f, c);
  }
  return out;
}

export function buildDraftEvidence(i: { claims: EvidenceClaim[]; findings: EvidenceFinding[] | null; offer: { about: string | null; services: string[] }; now: Date }): DraftEvidence {
  const offerWords = words([i.offer.about ?? "", ...i.offer.services].join(" "));
  const match = (v: string) => (offerWords.size ? overlap(words(v), offerWords) : 0);

  /* profile: who the company is */
  const confirmed = newestConfirmed(i.claims);
  const profile: EvidenceItem[] = [];
  for (const [field, label] of Object.entries(PROFILE_FIELDS)) {
    const c = confirmed.get(field);
    if (!c || !c.value.trim()) continue;
    // A team size is a number: the writer is told never to repeat numbers, so it adds nothing.
    if (field === "team_size") continue;
    profile.push({ key: `c:${c.id}`, grade: "fact", kind: "profile", label, value: clip(c.value.trim(), 240), date: null, dating: "undated", sourceUrl: c.evidenceUrl ?? null, confidence: null, offerMatch: match(c.value), claimId: c.id });
  }

  /* signals from Radar: dated, labelled, stale ones dropped */
  const seen = new Set<string>();
  const signals: (EvidenceItem & { days: number | null; event: boolean })[] = [];
  for (const f of i.findings ?? []) {
    if (f.kind !== "signal" || f.status !== "confirmed" || f.sourceType === "provider") continue;
    const d = signalDating({ observedAt: f.observedAt ? new Date(f.observedAt) : null, meta: (f.meta ?? {}) as any }, i.now);
    seen.add(norm(f.value));
    if (d.usable && d.days !== null && d.days > CONTEXT_DAYS) continue; // older than a year: not news
    const event = isEventSignal(f.type);
    if (!d.usable && BOILERPLATE_WHEN_UNDATED.has(f.type)) continue;
    const dating: EvidenceDating = d.usable && event && d.days !== null && d.days <= STRONG_TIMING_DAYS ? "strong" : d.usable ? "context" : "undated";
    const label = SIGNAL_LABEL[f.type as SignalType] ?? "News";
    signals.push({
      key: `f:${f.id}`, grade: "fact", kind: "signal", label, value: clip(stripLabel(f.value), 240),
      date: d.usable ? dateLabel({ observedAt: new Date(f.observedAt!), meta: (f.meta ?? {}) as any }) : null, dating,
      sourceUrl: f.sourceUrl ?? null, confidence: conf(f.confidence), offerMatch: match(f.value), claimId: null, days: d.usable ? d.days : null, event,
    });
  }
  /* signals the lead holds only as claims (research on the lead itself, or older Radar copies): undated */
  for (const c of i.claims) {
    const f = c.field.trim().toLowerCase();
    if (c.status !== "confirmed" || !(f in CLAIM_SIGNAL_FIELDS)) continue;
    const n = norm(c.value);
    if (!n || seen.has(n)) {
      // The same item Radar holds with a date: keep the claim's id on the dated item.
      const twin = signals.find((s) => norm(s.value) === n);
      if (twin && twin.claimId === null) twin.claimId = c.id;
      continue;
    }
    seen.add(n);
    const prefixed = /^(Publishing activity|Other):/i.test(c.value);
    signals.push({ key: `c:${c.id}`, grade: "fact", kind: "signal", label: CLAIM_SIGNAL_FIELDS[f], value: clip(stripLabel(c.value), 240), date: null, dating: "undated", sourceUrl: c.evidenceUrl ?? null, confidence: null, offerMatch: match(c.value), claimId: c.id, days: null, event: !prefixed });
  }

  /* guesses: possible needs and opportunities, never tactics */
  const guesses: EvidenceItem[] = [];
  const guessSeen = new Set<string>();
  const addGuess = (g: EvidenceItem) => { const n = norm(g.value); if (!n || guessSeen.has(n) || TACTIC.test(g.value) || PERSONISH.test(g.value)) return; guessSeen.add(n); guesses.push(g); };
  for (const f of i.findings ?? []) {
    if (f.kind !== "opportunity" && f.kind !== "pain") continue;
    if (f.status !== "inferred" && f.status !== "confirmed") continue;
    const kind = f.kind === "pain" ? "need" : "opportunity";
    addGuess({ key: `f:${f.id}`, grade: "guess", kind, label: kind === "need" ? "What their site talks about" : "Possible opportunity", value: clip(stripLabel(f.value).replace(/^(?:Offer|Provide|Help(?: them)?|Pitch)\s+/i, "Possible need for "), 240), date: null, dating: "undated", sourceUrl: f.sourceUrl ?? null, confidence: conf(f.confidence), offerMatch: match(f.value), claimId: null });
  }
  for (const c of i.claims) {
    const g = CLAIM_GUESS_FIELDS[c.field.trim().toLowerCase()];
    if (!g || (c.status !== "inferred" && c.status !== "confirmed")) continue;
    addGuess({ key: `c:${c.id}`, grade: "guess", kind: g.kind, label: g.label, value: clip(stripLabel(c.value), 240), date: null, dating: "undated", sourceUrl: c.evidenceUrl ?? null, confidence: null, offerMatch: match(c.value), claimId: c.id });
  }

  /* rank what a message can be built around */
  const rank = (x: EvidenceItem & { days?: number | null; event?: boolean }): number => {
    if (x.kind === "signal") {
      if (x.dating === "strong") return 0;
      if (x.dating === "context" && x.event) return 1;
      if (x.dating === "undated" && x.event) return x.offerMatch > 0 ? 3 : 4;
      return x.offerMatch > 0 ? 4 : 6; // dated blog posts and other content
    }
    if (x.kind === "opportunity") return x.offerMatch > 0 ? (x.confidence === "low" ? 3 : 2) : 7;
    return x.confidence === "low" ? 6 : 5; // needs
  };
  const all = [...signals, ...guesses].sort((a, b) =>
    rank(a) - rank(b) || b.offerMatch - a.offerMatch || ((a as { days?: number | null }).days ?? 1e9) - ((b as { days?: number | null }).days ?? 1e9));
  const leads = all.map(({ days: _d, event: _e, ...x }: any) => x as EvidenceItem);
  // Thin: nothing dated, nothing that matches the sender, nothing beyond who the company is.
  const thin = !leads.some((x) => x.dating !== "undated" || x.offerMatch > 0 || (x.kind === "signal" && x.grade === "fact"));
  return { profile: profile.slice(0, 4), leads, thin };
}

/**
 * Up to `n` lead items about DIFFERENT things, best first: two items sharing two or more meaningful words are the same
 * topic, so three versions can't all open on one piece of news written three ways.
 */
export function distinctLeads(leads: EvidenceItem[], n: number): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  for (const x of leads) {
    if (out.length >= n) break;
    const w = words(x.value);
    if (out.some((y) => overlap(w, words(y.value)) >= 2)) continue;
    out.push(x);
  }
  return out;
}

/** What is kept about the evidence a draft was built on (in the timeline event), for "Why Mika wrote this". Never page text beyond the item itself. */
export interface DraftBasis {
  lead: Pick<EvidenceItem, "key" | "grade" | "kind" | "label" | "value" | "date" | "dating" | "sourceUrl" | "confidence" | "offerMatch"> | null;
  also: Pick<EvidenceItem, "label" | "value" | "sourceUrl">[];
  thin: boolean;
}
export function basisOf(lead: EvidenceItem | null, profile: EvidenceItem[], thin: boolean): DraftBasis {
  return {
    lead: lead ? { key: lead.key, grade: lead.grade, kind: lead.kind, label: lead.label, value: lead.value, date: lead.date, dating: lead.dating, sourceUrl: lead.sourceUrl, confidence: lead.confidence, offerMatch: lead.offerMatch } : null,
    also: profile.slice(0, 4).map((p) => ({ label: p.label, value: p.value, sourceUrl: p.sourceUrl })),
    thin,
  };
}
