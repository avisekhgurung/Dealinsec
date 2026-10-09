/**
 * Evidence validators for what a model proposes about a prospect. Pure. The model READS pages and PROPOSES; this
 * module decides what is kept. Non-negotiable rule: a finding whose exact words are not on the page it cites is
 * rejected. Judgments (pain points, opportunities) are never better than "inferred". A person needs their name and
 * role on the company's own page. An email is never built from a name.
 *
 * Model output shapes (anything else is ignored):
 *   enrichment: {facts:[{field, value, quote, page}]}
 *   research:   {findings:[{kind:"signal"|"person"|"pain", type?, value?, name?, title?, quote, page, date_quote?}],
 *                opportunities:[{text, supports:["#0","F12"], confidence}]}
 *   angle:      {problem, evidence:["F12"], opportunity, positioning, target_person, reason, confidence}
 */
import { contentIssues } from "./outreach-check";
import { COUNTRIES, roleRank, type Icp } from "./icp";
import { isSignalType, parseEvidenceDate, type SignalType } from "./prospect";
import { checkContact, cleanLine, injectionLike, normalizeForQuote, quoteInPage, LIMITS as QUOTE, type ResearchPage } from "./research";

export type Reason = "not_an_object" | "bad_field" | "bad_page" | "bad_value" | "bad_quote" | "quote_not_found" | "suspicious" | "invalid_contact" | "duplicate" | "bad_type" | "bad_person" | "bad_support" | "bad_text";
export interface Rejection { reason: Reason; what?: string }
const tally = (rs: Rejection[]) => rs.reduce<Record<string, number>>((m, r) => ((m[r.reason] = (m[r.reason] ?? 0) + 1), m), {});

interface Quoted { page: ResearchPage; quote: string }
/** The shared core: a page that exists, a quote of a sane length that is really on it, and nothing instruction-like. */
function quoted(f: Record<string, unknown>, pages: ResearchPage[], ...texts: unknown[]): Quoted | Reason {
  const page = typeof f.page === "number" && Number.isInteger(f.page) ? pages.find((p) => p.index === f.page) : undefined;
  if (!page) return "bad_page";
  if (typeof f.quote !== "string") return "bad_quote";
  const quote = cleanLine(f.quote);
  if (quote.length < QUOTE.quoteMin || quote.length > QUOTE.quoteMax) return "bad_quote";
  if (injectionLike(quote) || texts.some((t) => typeof t === "string" && injectionLike(t))) return "suspicious";
  if (!quoteInPage(f.quote, page.text)) return "quote_not_found";
  return { page, quote };
}
const words = (s: string) => normalizeForQuote(s).toLowerCase().split(/[^a-z0-9À-￿]+/).filter((w) => w.length >= 2);

/* ── enrichment: what the company says about itself ─────────────────────── */

/** What the page says the organization IS. Only "business" goes on; anything else is set aside, and a missing answer never rejects. */
export const BUSINESS_TYPES = ["business", "directory_or_marketplace", "publication", "government_or_nonprofit", "personal_site", "other"] as const;
export const ENRICH_FIELDS = ["business_type", "description", "services", "industry", "location", "country", "team_size", "target_customers", "business_email", "business_phone", "contact_form"] as const;
export type EnrichField = (typeof ENRICH_FIELDS)[number];
export interface FactDraft { field: EnrichField; value: string; quote: string; url: string }

export function normalizeEnrichment(raw: unknown, pages: ResearchPage[], site: string): { facts: FactDraft[]; rejected: Record<string, number> } {
  const rejected: Rejection[] = [];
  const list = raw && typeof raw === "object" && Array.isArray((raw as any).facts) ? ((raw as any).facts as unknown[]) : [];
  const best = new Map<EnrichField, FactDraft>();
  for (const item of list.slice(0, 30)) {
    if (!item || typeof item !== "object") { rejected.push({ reason: "not_an_object" }); continue; }
    const f = item as Record<string, unknown>;
    if (typeof f.field !== "string" || !(ENRICH_FIELDS as readonly string[]).includes(f.field)) { rejected.push({ reason: "bad_field" }); continue; }
    const field = f.field as EnrichField;
    if (typeof f.value !== "string") { rejected.push({ reason: "bad_value", what: field }); continue; }
    let value = cleanLine(f.value).slice(0, 300);
    if (value.length < 2) { rejected.push({ reason: "bad_value", what: field }); continue; }
    const q = quoted(f, pages, value);
    if (typeof q === "string") { rejected.push({ reason: q, what: field }); continue; }
    if (field === "business_type") {
      const v = value.toLowerCase().replace(/[^a-z_]/g, "");
      if (!(BUSINESS_TYPES as readonly string[]).includes(v)) { rejected.push({ reason: "bad_value", what: field }); continue; }
      value = v;
    }
    if (field === "country") {
      const code = /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : COUNTRIES[value.toLowerCase()];
      // The country must be named in the quote, in some spelling, not inferred from a phone prefix or a currency.
      const names = Object.entries(COUNTRIES).filter(([, c]) => c === code).map(([n]) => n);
      if (!code || !names.some((n) => ` ${normalizeForQuote(q.quote).toLowerCase()} `.includes(n))) { rejected.push({ reason: "bad_value", what: field }); continue; }
      value = code;
    }
    // team_size, business_email, business_phone and contact_form are checked the same way as lead research.
    if (["team_size", "business_email", "business_phone", "contact_form"].includes(field) && !checkContact(field as any, value, q.quote, site)) { rejected.push({ reason: "invalid_contact", what: field }); continue; }
    if (best.has(field)) { rejected.push({ reason: "duplicate", what: field }); continue; }
    best.set(field, { field, value, quote: q.quote, url: q.page.url });
  }
  return { facts: Array.from(best.values()), rejected: tally(rejected) };
}

/* ── research: signals, people, pain points, opportunities ──────────────── */

export interface SignalDraft { index: number; type: SignalType; value: string; quote: string; url: string; observedAt: Date | null; dateQuote: string | null }
export interface PersonDraft { index: number; name: string; title: string; quote: string; url: string; rank: number }
export interface PainDraft { index: number; value: string; quote: string; url: string }
export interface OpportunityDraft { text: string; supports: { newIndex?: number; findingId?: number }[]; confidence: "low" | "medium" }
export interface ResearchResult { signals: SignalDraft[]; people: PersonDraft[]; pains: PainDraft[]; opportunities: OpportunityDraft[]; rejected: Record<string, number> }

const GENERIC_PERSON = /^(our|the|meet|team|about|contact|founder|ceo|staff|leadership|management|join|careers?)\b/i;

/**
 * `knownFactIds` are the ids of findings already stored for this prospect (shown to the model as F<id>): an
 * opportunity may cite them, or the new findings by their position (#n). A citation of anything else is rejected,
 * and so is an opportunity whose cited new findings were themselves rejected.
 */
export function normalizeResearch(raw: unknown, pages: ResearchPage[], site: string, opts: { retrievedAt: Date; icp: Pick<Icp, "roles">; knownFactIds: number[] }): ResearchResult {
  const rejected: Rejection[] = [];
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(obj.findings) ? (obj.findings as unknown[]).slice(0, 40) : [];
  const signals: SignalDraft[] = [], people: PersonDraft[] = [], pains: PainDraft[] = [];
  const kept = new Map<number, true>();
  const seen = new Set<string>();

  list.forEach((item, idx) => {
    if (!item || typeof item !== "object") { rejected.push({ reason: "not_an_object" }); return; }
    const f = item as Record<string, unknown>;
    if (f.kind === "signal") {
      if (!isSignalType(f.type)) { rejected.push({ reason: "bad_type" }); return; }
      if (typeof f.value !== "string" || cleanLine(f.value).length < 3) { rejected.push({ reason: "bad_value", what: "signal" }); return; }
      const value = cleanLine(f.value).slice(0, 300);
      const q = quoted(f, pages, value);
      if (typeof q === "string") { rejected.push({ reason: q, what: "signal" }); return; }
      // The date: from the quote itself, or from a second exact quote on the SAME page that states it. Never the model's say-so.
      let observedAt = parseEvidenceDate(q.quote, opts.retrievedAt), dateQuote: string | null = null;
      if (!observedAt && typeof f.date_quote === "string" && cleanLine(f.date_quote).length >= 4 && cleanLine(f.date_quote).length <= 120 && normalizeForQuote(q.page.text).includes(normalizeForQuote(f.date_quote))) {
        observedAt = parseEvidenceDate(f.date_quote, opts.retrievedAt);
        if (observedAt) dateQuote = cleanLine(f.date_quote);
      }
      const key = `signal:${f.type}:${normalizeForQuote(q.quote).toLowerCase()}`;
      if (seen.has(key)) { rejected.push({ reason: "duplicate", what: "signal" }); return; }
      seen.add(key); kept.set(idx, true);
      signals.push({ index: idx, type: f.type, value, quote: q.quote, url: q.page.url, observedAt, dateQuote });
    } else if (f.kind === "person") {
      const name = typeof f.name === "string" ? cleanLine(f.name).slice(0, 80) : "";
      const title = typeof f.title === "string" ? cleanLine(f.title).slice(0, 100) : "";
      const q = quoted(f, pages, name, title);
      if (typeof q === "string") { rejected.push({ reason: q, what: "person" }); return; }
      const qw = new Set(words(q.quote));
      const nameWords = name.split(/\s+/).filter(Boolean);
      // A real person's name: 2-4 capitalised words, every one of them in the quote, and the role's words in the quote too.
      const okName = nameWords.length >= 2 && nameWords.length <= 4 && nameWords.every((w) => /^[A-Z\u00C0-\u024F][A-Za-z\u00C0-\uFFFF'.-]*$/.test(w) && qw.has(w.toLowerCase().replace(/[.']/g, "")) ) && !GENERIC_PERSON.test(name);
      const titleWords = words(title).filter((w) => w.length >= 3);
      const okTitle = titleWords.length >= 1 && titleWords.every((w) => qw.has(w));
      if (!okName || !okTitle) { rejected.push({ reason: "bad_person" }); return; }
      const key = `person:${name.toLowerCase()}`;
      if (seen.has(key)) { rejected.push({ reason: "duplicate", what: "person" }); return; }
      seen.add(key); kept.set(idx, true);
      people.push({ index: idx, name, title, quote: q.quote, url: q.page.url, rank: roleRank(opts.icp, title) });
    } else if (f.kind === "pain") {
      if (typeof f.value !== "string" || cleanLine(f.value).length < 5) { rejected.push({ reason: "bad_value", what: "pain" }); return; }
      const value = cleanLine(f.value).slice(0, 300);
      const q = quoted(f, pages, value);
      if (typeof q === "string") { rejected.push({ reason: q, what: "pain" }); return; }
      kept.set(idx, true);
      pains.push({ index: idx, value, quote: q.quote, url: q.page.url });
    } else rejected.push({ reason: "bad_type" });
  });

  const known = new Set(opts.knownFactIds);
  const opportunities: OpportunityDraft[] = [];
  const opps = Array.isArray(obj.opportunities) ? (obj.opportunities as unknown[]).slice(0, 5) : [];
  for (const item of opps) {
    if (!item || typeof item !== "object") { rejected.push({ reason: "not_an_object" }); continue; }
    const o = item as Record<string, unknown>;
    const textValue = typeof o.text === "string" ? cleanLine(o.text).slice(0, 300) : "";
    if (textValue.length < 15 || injectionLike(textValue) || contentIssues(textValue, { to: "", siteHost: site }).length) { rejected.push({ reason: "bad_text", what: "opportunity" }); continue; }
    const refs = Array.isArray(o.supports) ? (o.supports as unknown[]).slice(0, 6) : [];
    const supports: OpportunityDraft["supports"] = [];
    let bad = refs.length === 0;
    for (const r of refs) {
      const s = String(r ?? "").trim();
      const n = s.match(/^#(\d{1,2})$/), id = s.match(/^F(\d{1,9})$/);
      if (n && kept.has(Number(n[1]))) supports.push({ newIndex: Number(n[1]) });
      else if (id && known.has(Number(id[1]))) supports.push({ findingId: Number(id[1]) });
      else { bad = true; break; }
    }
    if (bad || !supports.length) { rejected.push({ reason: "bad_support", what: "opportunity" }); continue; }
    opportunities.push({ text: textValue, supports, confidence: o.confidence === "medium" ? "medium" : "low" });
  }
  people.sort((a, b) => a.rank - b.rank);
  return { signals, people, pains, opportunities, rejected: tally(rejected) };
}

/* ── outreach angle ─────────────────────────────────────────────────────── */

export interface Angle {
  problem: string; opportunity: string; positioning: string; targetPerson: string | null; reason: string;
  evidenceIds: number[]; confidence: "low" | "medium";
}

/**
 * The angle a first message should take, built ONLY from findings already stored (cited by id). Every text passes the
 * outreach content rules (no prices, links, addresses, false history or instruction text). The target person must be
 * one of the people found, or none.
 */
export function normalizeAngle(raw: unknown, ctx: { allowedIds: number[]; people: string[]; siteHost: string }): { angle: Angle | null; reason?: string } {
  if (!raw || typeof raw !== "object") return { angle: null, reason: "not_an_object" };
  const a = raw as Record<string, unknown>;
  const t = (k: string, min: number, max = 300) => { const v = typeof a[k] === "string" ? cleanLine(a[k] as string).slice(0, max) : ""; return v.length >= min ? v : null; };
  const problem = t("problem", 10), opportunity = t("opportunity", 10), positioning = t("positioning", 10), reason = t("reason", 10);
  if (!problem || !opportunity || !positioning || !reason) return { angle: null, reason: "missing_text" };
  const all = [problem, opportunity, positioning, reason].join("\n");
  if (contentIssues(all, { to: "", siteHost: ctx.siteHost }).length) return { angle: null, reason: "content_rules" };
  const allowed = new Set(ctx.allowedIds);
  const ev = Array.isArray(a.evidence) ? (a.evidence as unknown[]).slice(0, 8).map((x) => String(x ?? "").trim().match(/^F(\d{1,9})$/)) : [];
  if (!ev.length || ev.some((m) => !m || !allowed.has(Number(m[1])))) return { angle: null, reason: "bad_evidence" };
  const tp = typeof a.target_person === "string" ? cleanLine(a.target_person) : "";
  const targetPerson = tp ? (ctx.people.find((p) => p.toLowerCase() === tp.toLowerCase() || tp.toLowerCase().startsWith(p.toLowerCase())) ?? null) : null;
  if (tp && !targetPerson && !/^(none|null|unknown|n\/a)$/i.test(tp)) return { angle: null, reason: "unknown_person" };
  return { angle: { problem, opportunity, positioning, reason, targetPerson, evidenceIds: Array.from(new Set(ev.map((m) => Number(m![1])))), confidence: a.confidence === "medium" ? "medium" : "low" } };
}
