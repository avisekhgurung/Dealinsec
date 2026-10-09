/**
 * Prospects: what a search result must go through before it is treated as a company worth contacting. Pure: no
 * network, no database, no model. Server code feeds it search results, page facts and findings; this module decides.
 *
 *   result -> canonical URL + registrable domain -> junk filter -> one candidate per company (provenance kept)
 *          -> pre-rank (words only) -> [verified site] -> [findings] -> score + ready
 */
import { JUNK_PATH, JUNK_TITLE, cleanName, hostOf, isBlockedSite, looksLikeCompanyHost, registrableDomain, type SearchResult } from "./discovery";
import { normText } from "./fit";
import { countryLabel, type Icp } from "./icp";
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
  const t = ` ${normText(page.title)} `, body = ` ${normText(page.text.slice(0, 20000))} `;
  const name = normText(c.name), label = c.domain.split(".")[0].toLowerCase();
  if (name.length >= 2 && t.includes(` ${name} `)) return { ok: true, identity: "title" };
  if (name.length >= 3 && body.includes(` ${name} `)) return { ok: true, identity: "text" };
  if (label.length >= 4 && (t.replace(/ /g, "").includes(label) || body.replace(/ /g, "").includes(label))) return { ok: true, identity: "domain" };
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
export const FRESHNESS_LABEL: Record<Freshness, string> = { strong: "This month", medium: "Last 3 months", weak: "This year", stale: "Over a year old", unknown: "Undated" };

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

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/**
 * The date a piece of evidence states, read conservatively: an exact date when there is one; a month-year is the 1st
 * of that month; a year alone is 1 January (older, never fresher, than the truth); "3 days ago" counts from when the
 * page was read. Returns null when nothing in the text is a date.
 */
export function parseEvidenceDate(text: string, retrievedAt: Date): Date | null {
  const t = String(text ?? "").toLowerCase().slice(0, 600);
  const utc = (y: number, m: number, d: number) => { const x = new Date(Date.UTC(y, m, d)); return x.getUTCMonth() === m && x.getUTCDate() === d ? x : null; };
  let m = t.match(/\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/);
  if (m) return utc(+m[1], +m[2] - 1, +m[3]);
  m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d\d)\b/);
  if (m) return utc(+m[3], MONTHS[m[1]], +m[2]);
  m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?,?\s+(20\d\d)\b/);
  if (m) return utc(+m[3], MONTHS[m[2]], +m[1]);
  m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(20\d\d)\b/);
  if (m) return utc(+m[2], MONTHS[m[1]], 1);
  m = t.match(/\b(\d{1,3})\s+(day|week|month|year)s?\s+ago\b/);
  if (m) { const n = +m[1]; const unit = { day: 1, week: 7, month: 30, year: 365 }[m[2] as "day"]; return new Date(retrievedAt.getTime() - n * unit * DAY); }
  if (/\b(yesterday)\b/.test(t)) return new Date(retrievedAt.getTime() - DAY);
  if (/\b(today|just posted|posted today)\b/.test(t)) return new Date(retrievedAt.getTime());
  m = t.match(/\b(?:in|since|from|during|of)\s+(20\d\d)\b/);
  if (m) return utc(+m[1], 0, 1);
  return null;
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
 * the same function. A stale signal does not score. A fresh (≤ 90 days) confirmed signal also counts as INFERRED timing.
 */
export function findingsAsClaims(findings: FindingLike[], now: Date): ScoreClaim[] {
  const out: ScoreClaim[] = [];
  for (const f of findings) {
    const base = { id: f.id, value: f.value, status: f.status, evidenceUrl: f.sourceUrl ?? null, createdAt: f.retrievedAt ?? null };
    if (f.kind === "fact") out.push({ ...base, field: f.type });
    else if (f.kind === "decision_maker") {
      out.push({ ...base, field: "decision_maker" });
      // A person's business email that the contact PROVIDER itself verified is a way in; an unverified one is not.
      if (f.meta?.emailStatus === "verified" && typeof f.meta?.email === "string") out.push({ ...base, field: "business_email", status: "confirmed", value: f.meta.email });
    }
    else if (f.kind === "opportunity") out.push({ ...base, field: "opportunity", status: "inferred" });
    else if (f.kind === "signal" && isSignalType(f.type)) {
      const fr = freshness(f.observedAt, now);
      if (fr.band === "stale") continue;
      out.push({ ...base, field: SIGNAL_FIELD[f.type] });
      if (f.status === "confirmed" && (fr.band === "strong" || fr.band === "medium")) {
        out.push({ ...base, field: "timing", status: "inferred", value: `${SIGNAL_LABEL[f.type]} ${fr.days === 0 ? "today" : `${fr.days} days ago`}: ${f.value}` });
      }
    }
  }
  return out;
}

export interface ReadyInput {
  verified: boolean;
  fitVerdict: string | null;
  findings: FindingLike[];
  doNotContact?: boolean;
  now: Date;
}
/**
 * "Outreach-ready" is a rule, not a model's opinion: a verified site, a fit that is not weak or excluded, at least one
 * confirmed reason to reach out now (a non-stale signal or a stated need), and a way to reach a person there.
 */
export function readiness(i: ReadyInput): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!i.verified) missing.push("a verified website");
  if (!i.fitVerdict || i.fitVerdict === "weak" || i.fitVerdict === "excluded" || i.fitVerdict === "no_profile") missing.push("a fit with who you want");
  // A reason to reach out NOW needs a date: an undated signal still scores, but is not enough to call a prospect outreach-ready.
  const dated = (f: FindingLike) => { const b = freshness(f.observedAt, i.now).band; return b === "strong" || b === "medium" || b === "weak"; };
  const reason = i.findings.some((f) => f.status === "confirmed" && ((f.kind === "signal" && dated(f)) || (f.kind === "fact" && ["pain_point", "need"].includes(f.type))));
  if (!reason) missing.push("a dated reason to reach out now (a recent signal)");
  const contact = i.findings.some((f) => (f.status === "confirmed" && (f.kind === "decision_maker" || (f.kind === "fact" && ["business_email", "contact_form"].includes(f.type))))
    || (f.kind === "decision_maker" && f.meta?.emailStatus === "verified"));
  if (!contact) missing.push("a person or a business address to contact");
  if (i.doNotContact) missing.push("permission to contact (marked do-not-contact)");
  return { ready: missing.length === 0, missing };
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
  verified: number; enriched: number; icpMatch: number; researched: number; signals: number; decisionMakers: number; ready: number; failed: number;
  llmCalls: number; providerCalls: number;
}
export const emptyCounters = (): RunCounters => ({
  searched: 0, results: 0, discovered: 0, rejected: 0, rejectedBy: {}, verified: 0, enriched: 0, icpMatch: 0, researched: 0, signals: 0, decisionMakers: 0, ready: 0, failed: 0, llmCalls: 0, providerCalls: 0,
});

/* ── which of a company's own pages to read for research ────────────────── */

const RESEARCH_PATHS: [RegExp, number][] = [
  [/(careers?|jobs|hiring|join-?us|work-with-us|vacanc)/i, 0],
  [/(news|press|blog|updates|insights|announcements?|journal)/i, 1],
  [/(team|leadership|people|about|who-we-are|founders?)/i, 2],
  [/(case-stud|clients|work|portfolio|results|success)/i, 3],
];
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
  const out: string[] = [];
  for (let round = 0; out.length < max && round < 3; round++) for (const b of buckets) if (b[round] && out.length < max) out.push(b[round]);
  return out;
}
