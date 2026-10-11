/**
 * Prospects: what a search result must go through before it is treated as a company worth contacting. Pure: no
 * network, no database, no model. Server code feeds it search results, page facts and findings; this module decides.
 *
 *   result -> canonical URL + registrable domain -> junk filter -> one candidate per company (provenance kept)
 *          -> pre-rank (words only) -> [verified site] -> [findings] -> score + ready
 */
import { JUNK_PATH, JUNK_TITLE, cleanName, hostOf, isBlockedSite, looksLikeCompanyHost, registrableDomain, type SearchResult } from "./discovery";
import { normText } from "./fit";
import { countryLabel, isSeniorDecisionMaker, type Icp } from "./icp";
import type { ScoreClaim } from "./lead-score";

/* ── URLs and domains ───────────────────────────────────────────────────── */

const TRACKING = /^(utm_[a-z]+|gclid|fbclid|msclkid|mc_cid|mc_eid|ref|ref_src|source|igshid|_hsenc|_hsmi|hsctatracking|yclid|dclid|srsltid)$/i;

/** One spelling per page: https, lowercase host without www, no fragment, no tracking parameters, no trailing slash (except the root). */
export function canonicalUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(String(raw ?? "").trim()); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (!host.includes(".")) return null;
  const params = new URLSearchParams();
  const keys = Array.from(u.searchParams.keys()).filter((k) => !TRACKING.test(k)).sort();
  for (const k of keys) for (const v of u.searchParams.getAll(k)) params.append(k, v);
  const path = u.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
  const q = params.toString();
  return `https://${host}${path === "/" ? "" : path}${q ? `?${q}` : ""}`;
}

/** The company's own domain for a URL ("https://blog.acme.co.uk/x" -> "acme.co.uk"), or null. */
export function domainOf(url: string): string | null {
  const h = hostOf(url);
  return h ? registrableDomain(h) : null;
}

/* ── junk ───────────────────────────────────────────────────────────────── */

export type RejectReason =
  | "not_a_url" | "blocked_site" | "non_business_host" | "listing_page" | "file" | "excluded_word"
  | "duplicate" | "already_lead" | "unreachable" | "not_html" | "offsite_redirect" | "parked" | "no_identity" | "thin_site"
  | "poor_fit" | "unclear" | "off_topic" | "not_a_company" | "budget" | "daily_limit" | "failed";

export const REJECT_LABEL: Record<RejectReason, string> = {
  not_a_url: "Not a web address", blocked_site: "A directory, social or news site", non_business_host: "Not a business website",
  listing_page: "An article or list, not a company", file: "A file, not a website", excluded_word: "Matches something you exclude",
  duplicate: "Same company as another result", already_lead: "Already one of your leads", unreachable: "Website didn't load",
  not_html: "Not a web page", offsite_redirect: "Website redirects to another company", parked: "Domain parked or for sale",
  no_identity: "Couldn't tell whose site it is", thin_site: "Too little on the site to judge", poor_fit: "Doesn't fit who you want",
  unclear: "Couldn't tell what they do", off_topic: "Nothing about what you asked for", not_a_company: "A directory, marketplace, publication or institution",
  budget: "Not checked (this run's limit was reached)", daily_limit: "Not checked (today's AI allowance ran out)", failed: "Couldn't be checked",
};

/** Why a search result can't be a company's own site, or null when it might be. Judged on host and title, never the model. */
export function junkReason(r: SearchResult, exclusions: string[] = []): RejectReason | null {
  const url = canonicalUrl(r.url);
  if (!url) return "not_a_url";
  const host = hostOf(url)!;
  const domain = registrableDomain(host);
  if (!domain) return "not_a_url";
  if (/\.(pdf|docx?|pptx?|xlsx?|zip|csv)(\?|$)/i.test(new URL(url).pathname)) return "file";
  if (isBlockedSite(domain)) return "blocked_site";
  if (!looksLikeCompanyHost(host, domain) || /\.(gov|edu|mil|int)(\.[a-z]{2})?$/.test(domain)) return "non_business_host";
  const title = String(r.title ?? "").trim();
  if (JUNK_TITLE.test(title) || JUNK_PATH.test(new URL(url).pathname)) return "listing_page";
  const hay = ` ${normText(`${title} ${r.snippet ?? ""} ${domain}`)} `;
  if (exclusions.some((x) => normText(x) && hay.includes(` ${normText(x)} `))) return "excluded_word";
  return null;
}

/* ── one candidate per company ──────────────────────────────────────────── */

export interface Provenance { provider: string; query: string; url: string; title: string; snippet?: string; at: string }
export interface Candidate { domain: string; name: string; website: string; sources: Provenance[]; rank: number }
export interface Rejected { url: string; reason: RejectReason }
export interface SearchHit extends SearchResult { provider: string; query: string; at: string }

/**
 * Turns the hits from every query into one candidate per registrable domain, keeping every source as provenance.
 * The name comes from the home-page result when there is one (a deep page's title is usually about the page).
 */
export function collectCandidates(hits: SearchHit[], icp: Pick<Icp, "exclusions">): { candidates: Candidate[]; rejected: Rejected[] } {
  const by = new Map<string, Candidate>();
  const rejected: Rejected[] = [];
  for (const h of hits) {
    const why = junkReason(h, icp.exclusions);
    if (why) { rejected.push({ url: String(h.url).slice(0, 300), reason: why }); continue; }
    const url = canonicalUrl(h.url)!;
    const domain = domainOf(url)!;
    const src: Provenance = { provider: h.provider, query: h.query, url, title: String(h.title ?? "").slice(0, 200), snippet: h.snippet?.slice(0, 300), at: h.at };
    const isHome = new URL(url).pathname === "/" || new URL(url).pathname === "";
    const prev = by.get(domain);
    if (!prev) {
      by.set(domain, { domain, name: cleanName(h.title, domain), website: `https://${domain}`, sources: [src], rank: 0 });
    } else {
      if (!prev.sources.some((s) => s.url === url && s.query === h.query)) prev.sources.push(src);
      else rejected.push({ url: url.slice(0, 300), reason: "duplicate" });
      if (isHome) prev.name = cleanName(h.title, domain);
    }
  }
  return { candidates: Array.from(by.values()), rejected };
}

/**
 * A cheap first ordering from words alone (no network, no model): how much of the ICP the result's own title and
 * snippet mention, plus a little for being found by more than one query. Only the top of this list is fetched.
 */
/** A search result must say at least this much about the ICP (industry words, market, place) to be worth fetching at all. */
export const MIN_RELEVANCE = 2;
export function relevance(c: Candidate, icp: Icp): number {
  const text = ` ${normText(c.sources.map((s) => `${s.title} ${s.snippet ?? ""}`).join(" "))} `;
  const has = (phrase: string) => { const n = normText(phrase); return !!n && text.includes(` ${n} `); };
  const anyWord = (phrase: string) => normText(phrase).split(" ").filter((w) => w.length >= 4).some((w) => text.includes(` ${w}`));
  let s = 0;
  if (has(icp.industry)) s += 4; else if (anyWord(icp.industry)) s += 2;
  for (const k of icp.keywords) if (has(k)) s += 2;
  for (const m of icp.targetMarket) if (has(m)) s += 3;
  for (const c2 of icp.countries) if (has(countryLabel(c2)) || has(c2)) s += 1;
  for (const l of icp.locations) if (has(l)) s += 1;
  return s;
}

/** The order to fetch in: relevance first, then a little for being found by several queries and for a home-page result. Never decides WHETHER to fetch (that is relevance alone). */
export function preRank(c: Candidate, icp: Icp): number {
  let s = relevance(c, icp);
  s += Math.min(3, c.sources.length - 1);
  if (c.sources.some((x) => { try { return new URL(x.url).pathname === "/"; } catch { return false; } })) s += 1;
  return s;
}

/* ── is the website the company's own? ──────────────────────────────────── */

const PARKED = /\b(this domain (is|may be) for sale|buy this domain|domain (is )?parked|parked free|courtesy of godaddy|sedo domain parking|hugedomains|domain name is for sale|coming soon)\b/i;

export interface SiteCheck { ok: boolean; reason?: RejectReason; identity?: "title" | "text" | "domain" }

/**
 * After the home page was fetched (through the SSRF-safe reader): is it a real business site belonging to this
 * candidate? Enough text, not parked, and its name or domain appears on it.
 */
export function checkSite(c: Pick<Candidate, "name" | "domain">, page: { title: string; text: string }): SiteCheck {
  const text = `${page.title}\n${page.text}`;
  if (PARKED.test(text.slice(0, 4000))) return { ok: false, reason: "parked" };
  if (page.text.replace(/\s+/g, " ").trim().length < 200) return { ok: false, reason: "thin_site" };
  const fold = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); // "Sōvyn" is "sovyn": a brand's accent is not a different brand
  const t = ` ${normText(fold(page.title))} `, body = ` ${normText(fold(page.text.slice(0, 20000)))} `;
  const name = normText(fold(c.name)), label = fold(c.domain.split(".")[0].toLowerCase());
  // The brand a page shows is often the domain without its corporate tail (callboxinc.com -> "Callbox"). Only the legal
  // and "group"-style tails count, and the rest must still be 4+ letters; thin and parked pages were rejected above.
  const brand = label.replace(/(inc|llc|ltd|corp|co|hq|group|usa)$/, "");
  if (name.length >= 2 && t.includes(` ${name} `)) return { ok: true, identity: "title" };
  if (name.length >= 3 && body.includes(` ${name} `)) return { ok: true, identity: "text" };
  const tight = t.replace(/ /g, ""), bodyTight = body.replace(/ /g, "");
  if (label.length >= 4 && (tight.includes(label) || bodyTight.includes(label))) return { ok: true, identity: "domain" };
  if (brand !== label && brand.length >= 4 && (tight.includes(brand) || bodyTight.includes(brand))) return { ok: true, identity: "domain" };
  return { ok: false, reason: "no_identity" };
}

/* ── signals and their freshness ────────────────────────────────────────── */

export const SIGNAL_TYPES = ["HIRING", "NEW_SERVICE", "EXPANSION", "NEW_LOCATION", "NEW_LEADERSHIP", "FUNDING", "NEW_CASE_STUDY", "TECH_CHANGE", "CONTENT_ACTIVITY", "GROWTH_SIGNAL", "PARTNERSHIP", "OTHER"] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];
export const SIGNAL_LABEL: Record<SignalType, string> = {
  HIRING: "Hiring", NEW_SERVICE: "New service", EXPANSION: "Expansion", NEW_LOCATION: "New location", NEW_LEADERSHIP: "New leadership",
  FUNDING: "Funding", NEW_CASE_STUDY: "New case study", TECH_CHANGE: "Technology change", CONTENT_ACTIVITY: "Publishing activity",
  GROWTH_SIGNAL: "Growth", PARTNERSHIP: "Partnership", OTHER: "Other",
};
export const isSignalType = (x: unknown): x is SignalType => typeof x === "string" && (SIGNAL_TYPES as readonly string[]).includes(x);

export type Freshness = "strong" | "medium" | "weak" | "stale" | "unknown";
export const FRESHNESS_LABEL: Record<Freshness, string> = { strong: "Last 30 days", medium: "Last 3 months", weak: "Last 12 months", stale: "Over a year old", unknown: "Undated" };

const DAY = 86_400_000;
/** How recent a signal is: ≤30 days strong, ≤90 medium, ≤365 weak, older stale; no date (or a date in the future) = unknown. */
export function freshness(observedAt: Date | string | null | undefined, now: Date): { band: Freshness; days: number | null } {
  if (!observedAt) return { band: "unknown", days: null };
  const t = new Date(observedAt).getTime();
  if (!Number.isFinite(t)) return { band: "unknown", days: null };
  const days = Math.floor((now.getTime() - t) / DAY);
  if (days < -2) return { band: "unknown", days: null }; // a future date is a plan, not something that happened
  const d = Math.max(0, days);
  return { band: d <= 30 ? "strong" : d <= 90 ? "medium" : d <= 365 ? "weak" : "stale", days: d };
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
/** A month's name or its usual short form, nothing else ("mayor" and "marching" are not months). */
const MON = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const mon = (s: string) => MONTHS[s.slice(0, 3)];

/** How exactly the page states a date. A year alone ("Top agencies in 2026") never dates an event to a day. */
export type DatePrecision = "day" | "month" | "year";
export interface EvidenceDate { at: Date; precision: DatePrecision }

/** Words that make the date after them an edit stamp ("Updated: March 17th, 2026"): the day a page changed, not the day something happened. */
const UPDATE_STAMP = /\b(?:updated|modified|revised|reviewed|edited)\b\s*(?:on|at)?\s*[:\-–—]?\s*$/;

/**
 * The date a piece of evidence states, read conservatively and with its precision: an exact date is a day; a month and
 * year is the 1st of that month (older, never fresher, than the truth); a year alone is a YEAR (kept as 1 January only so
 * it sorts; it never counts as a day); "3 days ago" counts from when the page was read. An update stamp is not a date of
 * anything. Returns null when nothing in the text is a date. Never infers one.
 */
export function evidenceDate(text: string, retrievedAt: Date): EvidenceDate | null {
  let t = String(text ?? "").toLowerCase().slice(0, 600);
  const utc = (y: number, m: number, d: number) => { const x = new Date(Date.UTC(y, m, d)); return x.getUTCMonth() === m && x.getUTCDate() === d ? x : null; };
  const patterns = [
    /\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/g,
    new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d\\d)\\b`, "g"),
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON},?\\s+(20\\d\\d)\\b`, "g"),
    new RegExp(`\\b${MON}\\s+(20\\d\\d)\\b`, "g"),
  ];
  // An update stamp's date is blanked out first, so neither it nor a part of it ("March 2026" inside it) is read as the date.
  for (const re of patterns) t = t.replace(re, (all, ...rest) => (UPDATE_STAMP.test(t.slice(Math.max(0, (rest[rest.length - 2] as number) - 30), rest[rest.length - 2] as number)) ? " ".repeat(all.length) : all));
  let m = t.match(/\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/);
  const day = (x: Date | null): EvidenceDate | null => (x ? { at: x, precision: "day" } : null);
  if (m) return day(utc(+m[1], +m[2] - 1, +m[3]));
  m = t.match(new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d\\d)\\b`));
  if (m) return day(utc(+m[3], mon(m[1]), +m[2]));
  m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON},?\\s+(20\\d\\d)\\b`));
  if (m) return day(utc(+m[3], mon(m[2]), +m[1]));
  m = t.match(new RegExp(`\\b${MON}\\s+(20\\d\\d)\\b`));
  if (m) { const x = utc(+m[2], mon(m[1]), 1); return x ? { at: x, precision: "month" } : null; }
  m = t.match(/\b(\d{1,3})\s+(day|week|month|year)s?\s+ago\b/);
  if (m && !UPDATE_STAMP.test(t.slice(Math.max(0, m.index! - 30), m.index!))) {
    const n = +m[1], unit = m[2] as "day" | "week" | "month" | "year";
    return { at: new Date(retrievedAt.getTime() - n * { day: 1, week: 7, month: 30, year: 365 }[unit] * DAY), precision: unit === "year" ? "year" : unit === "month" ? "month" : "day" };
  }
  // Only a posting date counts: "Subscribe today" or "Book a call today" says nothing about when anything happened.
  if (/\b(posted|published|announced)\s+yesterday\b/.test(t)) return { at: new Date(retrievedAt.getTime() - DAY), precision: "day" };
  if (/\b(posted|published|announced)\s+today\b|\bjust posted\b/.test(t)) return { at: new Date(retrievedAt.getTime()), precision: "day" };
  m = t.match(/\b(?:in|since|from|during|of)\s+(20\d\d)\b/);
  if (m) { const x = utc(+m[1], 0, 1); return x ? { at: x, precision: "year" } : null; }
  return null;
}
/** The date of evidenceDate (one rule). A year-only date comes back as 1 January: callers that judge recency must use evidenceDate's precision. */
export function parseEvidenceDate(text: string, retrievedAt: Date): Date | null {
  return evidenceDate(text, retrievedAt)?.at ?? null;
}

/* ── how strong a signal's timing is ─────────────────────────────────────── */

/** A concrete business event. A blog post (CONTENT_ACTIVITY) or an unclassified "OTHER" is context, never urgency on its own. */
export const EVENT_SIGNAL_TYPES: readonly SignalType[] = SIGNAL_TYPES.filter((t) => t !== "CONTENT_ACTIVITY" && t !== "OTHER");
export const isEventSignal = (type: string) => (EVENT_SIGNAL_TYPES as readonly string[]).includes(type);
/** A strong timing signal is a concrete event from this many days back or fewer. */
export const STRONG_TIMING_DAYS = 90;
/** A dated reason to get in touch (context) is at most this old. */
export const CONTEXT_DAYS = 365;

/**
 * A signal's date as the evidence states it: its precision, how old it is, and whether it is usable for timing at all.
 * A year-only date, a missing date or a future date is not usable (no recency is claimed from it). A signal stored before
 * precision was recorded has no `meta.datePrecision`: its date was a full date or a month (a year-only date is now never
 * stored), so it is read as a day.
 */
export function signalDating(f: Pick<FindingLike, "observedAt" | "meta">, now: Date): { usable: boolean; precision: DatePrecision | null; band: Freshness; days: number | null } {
  const p = f.meta?.datePrecision;
  const precision: DatePrecision | null = p === "day" || p === "month" || p === "year" ? p : f.observedAt ? "day" : null;
  if (precision === "year" || !f.observedAt) return { usable: false, precision, band: "unknown", days: null };
  const fr = freshness(f.observedAt, now);
  return { usable: fr.band !== "unknown", precision, band: fr.band, days: fr.days };
}

/** How a date reads to a person, at the precision the page gave: "14 Sep 2026", "Sep 2026", "2026 (year only)", "Undated". */
export function dateLabel(f: Pick<FindingLike, "observedAt" | "meta">): string {
  const p = f.meta?.datePrecision;
  if (p === "year") return typeof f.meta?.dateYear === "number" ? `${f.meta.dateYear} (year only)` : "Year only";
  if (!f.observedAt) return "Undated";
  const d = new Date(f.observedAt);
  if (!Number.isFinite(d.getTime())) return "Undated";
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return p === "month" ? `${m} ${d.getUTCFullYear()}` : `${d.getUTCDate()} ${m} ${d.getUTCFullYear()}`;
}

/**
 * The timing of a prospect, from its confirmed signals:
 *   strong   a concrete business event (hiring, expansion, a launch...) dated to the day or month, at most 90 days old
 *   context  a dated signal from the last 12 months that is not that: a blog post, or an older event. It may support a message; it is not urgency
 *   stale    only dated signals older than 12 months
 *   undated  only signals with no usable date (none stated, a year alone, an update stamp)
 *   none     no confirmed signal
 */
export type Timing = "strong" | "context" | "stale" | "undated" | "none";
export const TIMING_LABEL: Record<Timing, string> = {
  strong: "Strong timing signal", context: "Context only", stale: "Old evidence only", undated: "Undated evidence only", none: "No signal found",
};
export function timingOf(findings: FindingLike[], now: Date): { timing: Timing; best: FindingLike | null } {
  const sigs = findings.filter((f) => f.kind === "signal" && f.status === "confirmed").map((f) => ({ f, d: signalDating(f, now), event: isEventSignal(f.type) }));
  if (!sigs.length) return { timing: "none", best: null };
  const newest = (a: typeof sigs[number], b: typeof sigs[number]) => (a.d.days ?? 1e9) - (b.d.days ?? 1e9);
  const strong = sigs.filter((s) => s.event && s.d.usable && s.d.days! <= STRONG_TIMING_DAYS).sort(newest);
  if (strong.length) return { timing: "strong", best: strong[0].f };
  // Context: a concrete event before a blog post, then the newest.
  const context = sigs.filter((s) => s.d.usable && s.d.days! <= CONTEXT_DAYS).sort((a, b) => Number(b.event) - Number(a.event) || newest(a, b));
  if (context.length) return { timing: "context", best: context[0].f };
  const undated = sigs.filter((s) => !s.d.usable).sort((a, b) => Number(b.event) - Number(a.event));
  if (undated.length) return { timing: "undated", best: undated[0].f };
  return { timing: "stale", best: null };
}

/* ── findings, score and "ready" ────────────────────────────────────────── */

export type FindingKind = "fact" | "signal" | "decision_maker" | "opportunity";
export type FindingStatus = "confirmed" | "inferred" | "unknown" | "conflicting";
export interface FindingLike {
  id: number; kind: FindingKind | string; type: string; value: string; status: FindingStatus | string;
  sourceUrl?: string | null; observedAt?: Date | string | null; retrievedAt?: Date | string | null; meta?: Record<string, unknown> | null;
}

const SIGNAL_FIELD: Record<SignalType, string> = {
  HIRING: "hiring", FUNDING: "funding", NEW_SERVICE: "launch", NEW_CASE_STUDY: "recent_news", TECH_CHANGE: "recent_news", CONTENT_ACTIVITY: "recent_news",
  EXPANSION: "recent_news", NEW_LOCATION: "recent_news", NEW_LEADERSHIP: "recent_news", GROWTH_SIGNAL: "recent_news", PARTNERSHIP: "recent_news", OTHER: "recent_news",
};

/**
 * Prospect findings in the shape the lead score reads (shared/lead-score.ts), so a prospect and a lead are scored by
 * the same function. A stale signal does not score. A strong timing signal (a confirmed concrete event dated to the day
 * or month, ≤ 90 days) also counts as INFERRED timing; a blog post or a year-only date never does.
 */
export function findingsAsClaims(findings: FindingLike[], now: Date): ScoreClaim[] {
  const out: ScoreClaim[] = [];
  for (const f of findings) {
    const base = { id: f.id, value: f.value, status: f.status, evidenceUrl: f.sourceUrl ?? null, createdAt: f.retrievedAt ?? null };
    if (f.kind === "fact") out.push({ ...base, field: f.type });
    else if (f.kind === "decision_maker") {
      // Only a senior decision-maker counts as one; another employee is a named contact, which the score does not count.
      if (isDecisionMaker(f)) out.push({ ...base, field: "decision_maker" });
      // A person's business email that the contact PROVIDER itself verified is a way in; an unverified one is not.
      if (f.meta?.emailStatus === "verified" && typeof f.meta?.email === "string") out.push({ ...base, field: "business_email", status: "confirmed", value: f.meta.email });
    }
    else if (f.kind === "opportunity") out.push({ ...base, field: "opportunity", status: "inferred" });
    else if (f.kind === "signal" && isSignalType(f.type)) {
      const d = signalDating(f, now);
      if (d.band === "stale") continue;
      out.push({ ...base, field: SIGNAL_FIELD[f.type] });
      if (f.status === "confirmed" && isEventSignal(f.type) && d.usable && d.days! <= STRONG_TIMING_DAYS) {
        out.push({ ...base, field: "timing", status: "inferred", value: `${SIGNAL_LABEL[f.type]} ${d.days === 0 ? "today" : `${d.days} days ago`}: ${f.value}` });
      }
    }
  }
  return out;
}

/**
 * A person finding who is a verified SENIOR decision-maker: named with that role on the company's own site (confirmed),
 * or from a contact provider, with a senior title (isSeniorDecisionMaker). Other real employees stay visible as
 * employees and never count as decision-makers. Read from the stored title, so findings saved before this rule are judged the same way.
 */
export const personTitle = (f: Pick<FindingLike, "type" | "value" | "meta">): string => String(f.meta?.title ?? f.type ?? "");
export const isDecisionMaker = (f: Pick<FindingLike, "kind" | "type" | "value" | "meta">): boolean => f.kind === "decision_maker" && isSeniorDecisionMaker(personTitle(f));
/** A provider-verified business email on a person: an email route, whatever the person's seniority. */
export const hasVerifiedEmail = (f: Pick<FindingLike, "kind" | "meta">): boolean => f.kind === "decision_maker" && f.meta?.emailStatus === "verified" && typeof f.meta?.email === "string";

export interface ReadyInput {
  verified: boolean;
  fitVerdict: string | null;
  findings: FindingLike[];
  doNotContact?: boolean;
  now: Date;
}
/**
 * Where a prospect stands. Four separate things, never merged:
 *   not_a_fit              the evidence contradicts what you asked for (a weak or excluded fit)
 *   insufficient_evidence  there isn't enough evidence to say it fits (not verified, or the fit can't be judged)
 *   qualified              it fits on evidence, but something needed to reach out is missing (listed in `missing`)
 *   ready                  qualified, with a way in and a dated reason to get in touch from the last 12 months
 * and, alongside, its `timing` (timingOf): a "strong" timing signal is a concrete event from the last 90 days. That is
 * NOT a requirement for "ready" (most companies that fit have none); a blog post is context and never strong timing.
 */
export type ProspectClass = "ready" | "qualified" | "insufficient_evidence" | "not_a_fit";
export const PROSPECT_CLASS_LABEL: Record<ProspectClass, string> = { ready: "Ready", qualified: "Qualified", insufficient_evidence: "Insufficient evidence", not_a_fit: "Not a fit" };
export const MISSING_CONTACT = "a way to reach them (a senior decision-maker named on their site, a business email or a contact form)";
export const MISSING_REASON = "a dated reason to get in touch (a signal from the last 12 months, dated to the day or month)";
export interface Readiness { ready: boolean; missing: string[]; classification: ProspectClass; timing: Timing; strongTiming: boolean }

/**
 * "Outreach-ready" is a rule, not a model's opinion: a verified site, a fit that is strong or partial, at least one
 * confirmed reason to get in touch with a usable date (a signal from the last 12 months dated to the day or month, not
 * a year alone; or a stated need), and a way to reach a person there.
 */
export function readiness(i: ReadyInput): Readiness {
  const missing: string[] = [];
  if (!i.verified) missing.push("a verified website");
  const fitOk = i.fitVerdict === "strong" || i.fitVerdict === "partial";
  if (!fitOk) missing.push("a fit with who you want");
  const t = timingOf(i.findings, i.now);
  // An undated, year-only or stale signal still scores, but is not enough to call a prospect outreach-ready.
  const reason = t.timing === "strong" || t.timing === "context" || i.findings.some((f) => f.status === "confirmed" && f.kind === "fact" && ["pain_point", "need"].includes(f.type));
  if (!reason) missing.push(MISSING_REASON);
  // A way in: a senior decision-maker named on their site, or an email or contact form. Email and form routes do not
  // depend on anyone's seniority; a named employee who is not a decision-maker is not, on their own, a way in.
  const contact = i.findings.some((f) => (f.status === "confirmed" && (isDecisionMaker(f) || (f.kind === "fact" && ["business_email", "contact_form"].includes(f.type)))) || hasVerifiedEmail(f));
  if (!contact) missing.push(MISSING_CONTACT);
  if (i.doNotContact) missing.push("permission to contact (marked do-not-contact)");
  const ready = missing.length === 0;
  const classification: ProspectClass = i.fitVerdict === "weak" || i.fitVerdict === "excluded" ? "not_a_fit" : !i.verified || !fitOk ? "insufficient_evidence" : ready ? "ready" : "qualified";
  return { ready, missing, classification, timing: t.timing, strongTiming: t.timing === "strong" };
}

/* ── how much one run may spend ─────────────────────────────────────────── */

export interface RunBudget { queries: number; resultsPerQuery: number; verify: number; enrich: number; research: number; llmCalls: number }
/** Scales with the quantity asked for, with hard ceilings. Cheap steps get more room than expensive ones. */
export function runBudget(quantity: number): RunBudget {
  const q = Math.max(1, Math.min(50, Math.floor(quantity)));
  const verify = Math.min(120, 3 * q + 10);
  const enrich = Math.min(80, 2 * q + 10);
  const research = Math.min(60, Math.ceil(1.5 * q) + 5);
  return { queries: 8, resultsPerQuery: 20, verify, enrich, research, llmCalls: 2 + enrich + research };
}

/** The funnel a run reports (and the UI draws). */
export interface RunCounters {
  searched: number; results: number; discovered: number; rejected: number; rejectedBy: Partial<Record<RejectReason, number>>;
  /** signals: prospects with a dated reason to get in touch (last 12 months); strongTiming: of those, a concrete event from the last 90 days. */
  verified: number; enriched: number; icpMatch: number; researched: number; signals: number; strongTiming?: number; decisionMakers: number; ready: number; failed: number;
  llmCalls: number; providerCalls: number;
}
export const emptyCounters = (): RunCounters => ({
  searched: 0, results: 0, discovered: 0, rejected: 0, rejectedBy: {}, verified: 0, enriched: 0, icpMatch: 0, researched: 0, signals: 0, strongTiming: 0, decisionMakers: 0, ready: 0, failed: 0, llmCalls: 0, providerCalls: 0,
});

/* ── which of a company's own pages to read for research ────────────────── */

const RESEARCH_PATHS: [RegExp, number][] = [
  [/(careers?|jobs|hiring|join-?us|work-with-us|vacanc)/i, 0],
  [/(news|press|blog|updates|insights|announcements?|journal)/i, 1],
  [/(team|leadership|people|about|who-we-are|founders?|staff)/i, 2],
  [/(case-stud|clients|work|portfolio|results|success)/i, 3],
];
const TEAM_PAGE = /(team|leadership|people|meet|founders?|staff)/i;
const SKIP = /\.(pdf|jpe?g|png|gif|svg|webp|zip|mp4|css|js|xml)(\?|$)|\/(login|signin|signup|register|cart|checkout|privacy|terms|cookie|legal|wp-admin|feed|tag|category|author)(\/|$)|[?#]/i;

/**
 * Up to `max` same-site https pages most likely to hold why-now evidence and people: careers, news, team, case
 * studies (one per kind first), from the home page's links and the sitemap. Never another site, never an asset.
 */
export function pickResearchLinks(candidates: string[], home: URL, max = 4, skip: string[] = []): string[] {
  const site = home.hostname.replace(/^www\./, "");
  const seen = new Set(skip.map((u) => u.replace(/\/+$/, "")));
  const buckets: string[][] = RESEARCH_PATHS.map(() => []);
  for (const raw of candidates.slice(0, 600)) {
    let u: URL;
    try { u = new URL(raw, home); } catch { continue; }
    if (u.protocol !== "https:" || u.hostname.replace(/^www\./, "") !== site) continue;
    const href = `${u.origin}${u.pathname}`.replace(/\/+$/, "");
    if (seen.has(href) || u.pathname === "/" || SKIP.test(u.pathname)) continue;
    const depth = u.pathname.split("/").filter(Boolean).length;
    if (depth > 3) continue;
    const hit = RESEARCH_PATHS.find(([re]) => re.test(u.pathname));
    if (!hit) continue;
    seen.add(href);
    buckets[hit[1]].push(href);
  }
  for (const b of buckets) b.sort((a, c) => a.length - c.length); // the section page before its articles
  // People: a page that IS the team (/our-team, /about/meet-our-team, /leadership) names them; a generic /about page often
  // doesn't. With one, the about page is not read (measured: named leaders sat on a team page that was never read).
  const team = buckets[2].filter((u) => TEAM_PAGE.test(new URL(u).pathname));
  if (team.length) buckets[2] = team;
  const out: string[] = [];
  for (let round = 0; out.length < max && round < 3; round++) for (const b of buckets) if (b[round] && out.length < max) out.push(b[round]);
  return out;
}
