/**
 * The engine's outside data, behind small interfaces so that domain code never names a vendor:
 *   PageReader                 a company's own pages (built in: the SSRF-safe fetcher; optional: Firecrawl)
 *   CompanyEnrichmentProvider  structured firmographics (optional: Apollo)
 *   ContactEnrichmentProvider  named people with business emails and the PROVIDER's verification status (optional: Hunter)
 * Search providers are server/discovery/* (LangSearch, Brave, Tavily, Serper). Every adapter takes its key and a fetch
 * implementation, so tests run against fakes. Whatever comes back is untrusted data: it is validated and fenced later.
 */
import { createHash } from "node:crypto";
import { sameSite, siteHost, type PageLink, type ResearchPage } from "@shared/research";
import { robotsAllows, robotsRules, type RobotsRule } from "@shared/robots";
import { extractContactBlock, extractHtml, extractLinks, extractPeople, hasContactForm } from "../knowledge/extract";
import { QUOTED_BLOCK, STAFF_BLOCK } from "@shared/staff";
import { composePageText, datedItemsBlock, pageDatesLine, type PageDates, type PageParts } from "@shared/page-dates";
import { pageDatesFromHtml } from "./page-dates";
import { fetchPublicPage, realPageIO, validatePublicUrl } from "../knowledge/net-guard";
import { callJson, str } from "../discovery/http";
import { DiscoveryError } from "../discovery/types";

export const PROSPECT_USER_AGENT = "DealInSec/1.0 (reads public company websites for B2B prospect research; https://dealinsec.com)";
const PAGE_BYTES = 1_500_000;
export const PAGE_TEXT_CHARS = 8000;
/** The most of a page's readable text kept for composing (shared/page-dates.ts composePageText cuts it to each use's budget). */
const PAGE_BODY_KEEP = 20_000;

export type PageRead =
  | {
    ok: true; url: string; title: string; text: string; links: PageLink[]; hash: string; hasForm?: boolean;
    /** The page in parts (built-in reader): its dates line, its readable text and its labelled blocks, for composing
     * the text a model sees within that model's budget. `text` is the same composed at PAGE_TEXT_CHARS. */
    parts?: PageParts; dates?: PageDates; truncated?: boolean;
    /** Set when a paid reader was used for this read (the caller records its cost). */
    via?: "firecrawl";
    /** What the raw HTML shows (built-in reader only): a mobile viewport tag, and the latest year in a copyright notice. */
    site?: SiteMarkup;
  }
  | { ok: false; code: "blocked" | "unreachable" | "bad_response" | "too_big" | "unsupported" | "not_html" | "unreadable" | "provider" | "robots"; via?: "firecrawl" };

export interface PageReader {
  readonly name: string;
  /** Reads one public page. Never follows the page's own instructions; returns text and same-page links only. */
  read(url: string): Promise<PageRead>;
}

const hashOf = (t: string) => createHash("sha256").update(t).digest("hex");

/** A page whose address says it is about the people: where a people block is worth adding. */
const TEAM_PATH = /(team|leadership|people|about|who-we-are|founders?|staff|meet)/i;

/** The built-in reader: net-guard (https only, DNS pinned, private addresses refused, redirects re-checked, size and time caps). */
export const builtinReader: PageReader = {
  name: "builtin",
  async read(url) {
    const r = await fetchPublicPage(url, realPageIO, PAGE_BYTES, { userAgent: PROSPECT_USER_AGENT });
    if (!r.ok) return { ok: false, code: r.code };
    if (r.contentType !== "html") return { ok: false, code: "not_html" };
    return readHtml(r.bytes, r.url, new Date());
  },
};

/** Deterministic facts from a page's own markup, never a judgement: shared/site-signals.ts decides what is worth saying. */
export interface SiteMarkup { viewport: boolean; copyrightYear: number | null; copyrightText?: string | null }
export function siteMarkup(html: string, now: Date): SiteMarkup {
  const viewport = /<meta\b[^>]*\bname\s*=\s*["']?viewport\b/i.test(html);
  let copyrightYear: number | null = null, copyrightText: string | null = null;
  const thisYear = now.getUTCFullYear();
  const re = /(?:©|&copy;|&#169;|\bcopyright\b)\s*(?:\(c\)\s*)?(?:(?:19|20)\d{2}\s*(?:-|–|—|&ndash;|to)\s*)?((?:19|20)\d{2})\b/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const y = Number(m[1]);
    if (y >= 1995 && y <= thisYear + 1 && (copyrightYear === null || y > copyrightYear)) { copyrightYear = y; copyrightText = m[0].replace(/&copy;|&#169;/gi, "©").replace(/&ndash;/gi, "–").replace(/\s+/g, " ").trim().slice(0, 60); }
  }
  return { viewport, copyrightYear, copyrightText };
}

/** One fetched HTML page as the built-in reader returns it (no network here: fixtures run through exactly this). */
export async function readHtml(bytes: Uint8Array, url: URL, now: Date): Promise<PageRead> {
  const r = { bytes, url };
  const ex = await extractHtml(r.bytes);
  if (!ex.ok) return { ok: false, code: "unreadable" };
  // The article reader drops footers (a company's address and contact details live there) and card grids (where a team
  // page lists its people). Each is added back as a separate, labelled block; people only on a team or about page.
  const block = await extractContactBlock(r.bytes);
  // Quoted people (testimonials, reviews, case studies) get their own block: shared/staff.ts reads them as clients, not staff.
  const people = TEAM_PATH.test(r.url.pathname) ? await extractPeople(r.bytes) : { staff: [], quoted: [] };
  // The page's own dates, read from the whole document first: the article reader drops bylines, <time> elements and
  // structured data, and a text limit can cut a date off. They go in a first line and a dated-entries block (shared/page-dates.ts).
  const dates = await pageDatesFromHtml(r.bytes, r.url.toString(), now);
  const tail = [people.staff.length ? `${STAFF_BLOCK}\n${people.staff.join("\n")}` : "", people.quoted.length ? `${QUOTED_BLOCK}\n${people.quoted.join("\n")}` : "", block ? `[Footer and contact details]\n${block}` : "", datedItemsBlock(dates.items)];
  const parts: PageParts = { head: pageDatesLine(dates), body: ex.text.slice(0, PAGE_BODY_KEEP), tail };
  const composed = composePageText(parts, PAGE_TEXT_CHARS);
  const site = siteMarkup(new TextDecoder("utf-8", { fatal: false }).decode(r.bytes.subarray(0, PAGE_BYTES)), now);
  return { ok: true, url: r.url.toString(), title: ex.title ?? "", text: composed.text, links: await extractLinks(r.bytes), hash: hashOf(composed.text), hasForm: hasContactForm(r.bytes), parts, dates, truncated: composed.truncated || ex.truncated, site };
}

/** A page as a model is given it, within `budget` characters: the text it reads is exactly the text its quotes are checked against. */
export function researchPage(x: Extract<PageRead, { ok: true }>, index: number, budget: number): ResearchPage {
  if (!x.parts) return { index, url: x.url, text: x.text.slice(0, budget), truncated: x.text.length > budget };
  const c = composePageText(x.parts, budget);
  return { index, url: x.url, text: c.text, body: c.body, published: x.dates?.published ?? null, dateOrder: x.dates?.order ?? null, entries: x.dates?.list ? x.dates.items : [], dateRegions: x.dates?.regions ?? [], truncated: c.truncated || !!x.truncated };
}

/** A sitemap's page addresses on the same site (built-in reader only; XML is allowed for this call and no other). */
export async function readSitemap(site: string, max = 200): Promise<string[]> {
  const r = await fetchPublicPage(`https://${site}/sitemap.xml`, realPageIO, PAGE_BYTES, { allowXml: true, userAgent: PROSPECT_USER_AGENT });
  if (!r.ok || r.contentType !== "xml") return [];
  const xml = new TextDecoder().decode(r.bytes).slice(0, 600_000);
  const out: string[] = [];
  for (const m of Array.from(xml.matchAll(/<loc>\s*([^<\s]{1,500})\s*<\/loc>/gi))) {
    try { const u = new URL(m[1]); if (u.protocol === "https:" && sameSite(u.hostname, site)) out.push(u.toString()); } catch { /* skip */ }
    if (out.length >= max) break;
  }
  return out;
}

/** Firecrawl (POST /v1/scrape). Only addresses net-guard would accept are sent; its markdown is used as plain text. */
export class FirecrawlReader implements PageReader {
  readonly name = "firecrawl";
  constructor(private readonly apiKey: string, private readonly endpoint = "https://api.firecrawl.dev/v1/scrape", private readonly fetchImpl: typeof fetch = fetch) {}
  async read(url: string): Promise<PageRead> {
    const v = validatePublicUrl(url);
    if (!v.ok) return { ok: false, code: "blocked" };
    let body: unknown;
    try {
      body = await callJson(this.fetchImpl, this.endpoint, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ url: v.url.toString(), formats: ["markdown", "links"], onlyMainContent: false, timeout: 15000 }),
      }, { timeoutMs: 25_000, what: "The page reader" });
    } catch (e) {
      if (e instanceof DiscoveryError && (e.code === "auth" || e.code === "rate_limited")) throw e;
      return { ok: false, code: "provider" };
    }
    const d = (body as { data?: Record<string, unknown> })?.data;
    const md = typeof d?.markdown === "string" ? d.markdown : "";
    if (md.trim().length < 20) return { ok: false, code: "unreadable" };
    const meta = (d?.metadata ?? {}) as Record<string, unknown>;
    const finalUrl = str(meta.sourceURL, 500) ?? v.url.toString();
    // Markdown links and images become plain text; the link list is taken from the provider's own list.
    const text = md.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#>*_`|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, PAGE_TEXT_CHARS);
    const links = Array.isArray(d?.links) ? (d!.links as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 200).map((href) => ({ href: href.slice(0, 500), text: "" })) : [];
    return { ok: true, url: finalUrl, title: str(meta.title, 120) ?? "", text, links, hash: hashOf(text) };
  }
}

/** Failures a paid reader may get past (a site that refuses plain fetches or renders with script); never "blocked" (net-guard's own refusal of a private or unsafe address). */
const FALLBACK_CODES = new Set(["unreachable", "bad_response", "unreadable"]);
export const MAX_PAID_READS_PER_DOMAIN = 3;
const PAID_WINDOW_MS = 24 * 3_600_000;

/**
 * The free reader first; the paid one (Firecrawl) only when the free one couldn't read the page, and at most
 * MAX_PAID_READS_PER_DOMAIN times per site in 24 hours (per process). A read that used the paid reader, whether it
 * worked or not, says so (`via`), so its cost is recorded against the workspace and run that asked for it.
 */
export class FallbackReader implements PageReader {
  readonly name = "builtin+firecrawl";
  private paid = new Map<string, { n: number; since: number }>();
  constructor(private readonly primary: PageReader, private readonly fallback: PageReader, private readonly now: () => number = Date.now) {}
  async read(url: string): Promise<PageRead> {
    const first = await this.primary.read(url);
    if (first.ok || !FALLBACK_CODES.has(first.code)) return first;
    let host = "";
    try { host = siteHost(new URL(url).hostname); } catch { return first; }
    const t = this.now(), used = this.paid.get(host);
    const window = used && t - used.since < PAID_WINDOW_MS ? used : { n: 0, since: t };
    if (window.n >= MAX_PAID_READS_PER_DOMAIN) return first;
    this.paid.set(host, { n: window.n + 1, since: window.since });
    if (this.paid.size > 2000) this.paid.delete(this.paid.keys().next().value as string);
    const second = await this.fallback.read(url).catch((): PageRead => ({ ok: false, code: "provider" }));
    return second.ok ? { ...second, via: "firecrawl" } : { ...first, via: "firecrawl" };
  }
}

/**
 * Asks each site's robots.txt first (fetched once per site through the same safety-guarded fetcher, cached for a day):
 * a page our user-agent (or "*") is disallowed from is not read by any reader, free or paid ("robots"). A site without a
 * readable robots.txt is treated as allowing everything, the usual convention.
 */
export class RobotsReader implements PageReader {
  private cache = new Map<string, { rules: RobotsRule[]; at: number }>();
  constructor(private readonly inner: PageReader, private readonly fetchRobots: (origin: string) => Promise<string | null> = defaultRobotsFetch, private readonly now: () => number = Date.now) {}
  get name() { return this.inner.name; }
  async read(url: string): Promise<PageRead> {
    let u: URL;
    try { u = new URL(url); } catch { return this.inner.read(url); }
    const key = u.origin, t = this.now();
    let hit = this.cache.get(key);
    if (!hit || t - hit.at > ROBOTS_TTL_MS) {
      const text = await this.fetchRobots(u.origin).catch(() => null);
      hit = { rules: text ? robotsRules(text, "DealInSec") : [], at: t };
      if (this.cache.size > 2000) this.cache.delete(this.cache.keys().next().value as string);
      this.cache.set(key, hit);
    }
    if (!robotsAllows(hit.rules, `${u.pathname}${u.search}`)) return { ok: false, code: "robots" };
    return this.inner.read(url);
  }
}
const ROBOTS_TTL_MS = 24 * 3_600_000;
async function defaultRobotsFetch(origin: string): Promise<string | null> {
  const r = await fetchPublicPage(`${origin}/robots.txt`, realPageIO, 200_000, { userAgent: PROSPECT_USER_AGENT });
  return r.ok && (r.contentType === "text" || r.contentType === "html") ? new TextDecoder().decode(r.bytes) : null;
}

export function pageReader(env: NodeJS.ProcessEnv = process.env): PageReader {
  const inner = env.FIRECRAWL_API_KEY ? new FallbackReader(builtinReader, new FirecrawlReader(env.FIRECRAWL_API_KEY, env.FIRECRAWL_URL || undefined)) : builtinReader;
  return new RobotsReader(inner);
}

/* ── company enrichment ─────────────────────────────────────────────────── */

export interface CompanyData { name?: string; employees?: string; country?: string; location?: string; industry?: string; keywords?: string[]; sourceUrl?: string }
export interface CompanyEnrichmentProvider { readonly name: string; enrich(domain: string, signal?: AbortSignal): Promise<CompanyData | null> }

/** Apollo organization enrichment (GET /api/v1/organizations/enrich?domain=, X-Api-Key). Structured fields only. */
export class ApolloCompanyProvider implements CompanyEnrichmentProvider {
  readonly name = "apollo";
  constructor(private readonly apiKey: string, private readonly endpoint = "https://api.apollo.io/api/v1/organizations/enrich", private readonly fetchImpl: typeof fetch = fetch) {}
  async enrich(domain: string, signal?: AbortSignal): Promise<CompanyData | null> {
    const body = await callJson(this.fetchImpl, `${this.endpoint}?domain=${encodeURIComponent(domain)}`, { headers: { Accept: "application/json", "X-Api-Key": this.apiKey } }, { timeoutMs: 12_000, signal, what: "The company data service" });
    const o = (body as { organization?: Record<string, unknown> })?.organization;
    if (!o) return null;
    const n = typeof o.estimated_num_employees === "number" && o.estimated_num_employees > 0 ? Math.round(o.estimated_num_employees) : null;
    const cc = str(o.country, 60);
    return {
      name: str(o.name, 120), employees: n ? `${n} employees` : undefined, country: cc, location: [str(o.city, 60), str(o.state, 60)].filter(Boolean).join(", ") || undefined,
      industry: str(o.industry, 80), keywords: Array.isArray(o.keywords) ? (o.keywords as unknown[]).map((k) => str(k, 40)).filter((k): k is string => !!k).slice(0, 8) : undefined,
      sourceUrl: "https://www.apollo.io",
    };
  }
}

export function companyProvider(env: NodeJS.ProcessEnv = process.env): CompanyEnrichmentProvider | null {
  return env.APOLLO_API_KEY ? new ApolloCompanyProvider(env.APOLLO_API_KEY, env.APOLLO_URL || undefined) : null;
}

/* ── contact enrichment ─────────────────────────────────────────────────── */

/** The provider's own word on an address. Never upgraded by us: "verified" only when the provider says so. */
export type EmailStatus = "verified" | "accept_all" | "unknown" | "invalid";
export interface ContactData { name: string; title: string; email: string | null; emailStatus: EmailStatus; confidence: number; source: string }
export interface ContactEnrichmentProvider { readonly name: string; findPeople(domain: string, opts: { limit: number; signal?: AbortSignal }): Promise<ContactData[]> }

/** Hunter domain search (GET /v2/domain-search?domain=&type=personal). Named people with their business email and Hunter's verification status. */
export class HunterContactProvider implements ContactEnrichmentProvider {
  readonly name = "hunter";
  constructor(private readonly apiKey: string, private readonly endpoint = "https://api.hunter.io/v2/domain-search", private readonly fetchImpl: typeof fetch = fetch) {}
  async findPeople(domain: string, opts: { limit: number; signal?: AbortSignal }): Promise<ContactData[]> {
    const q = new URLSearchParams({ domain, type: "personal", limit: String(Math.min(10, Math.max(1, opts.limit))), api_key: this.apiKey });
    const body = await callJson(this.fetchImpl, `${this.endpoint}?${q}`, { headers: { Accept: "application/json" } }, { timeoutMs: 12_000, signal: opts.signal, what: "The contact data service" });
    const emails = (body as { data?: { emails?: unknown } })?.data?.emails;
    if (!Array.isArray(emails)) return [];
    const out: ContactData[] = [];
    for (const e of emails) {
      const x = e as Record<string, unknown>;
      const name = [str(x.first_name, 40), str(x.last_name, 40)].filter(Boolean).join(" ");
      const title = str(x.position, 100);
      const email = str(x.value, 254)?.toLowerCase() ?? null;
      if (!name || name.split(" ").length < 2 || !title) continue;
      // The address must be on the company's own domain; anything else is not this company's contact.
      if (email && !(email.split("@")[1] && (siteHost(email.split("@")[1]) === siteHost(domain) || email.split("@")[1].endsWith(`.${domain}`)))) continue;
      const v = (x.verification as { status?: unknown } | undefined)?.status;
      const emailStatus: EmailStatus = v === "valid" ? "verified" : v === "accept_all" ? "accept_all" : v === "invalid" ? "invalid" : "unknown";
      out.push({ name, title, email, emailStatus, confidence: typeof x.confidence === "number" ? Math.max(0, Math.min(100, Math.round(x.confidence))) : 0, source: "hunter" });
    }
    return out;
  }
}

export function contactProvider(env: NodeJS.ProcessEnv = process.env): ContactEnrichmentProvider | null {
  return env.HUNTER_API_KEY ? new HunterContactProvider(env.HUNTER_API_KEY, env.HUNTER_URL || undefined) : null;
}

/* ── estimated cost per call (an estimate, overridable: PROVIDER_COST_USD_<NAME>) ─────────────────────────── */

const DEFAULT_COST_USD: Record<string, number> = { langsearch: 0, brave: 0.005, tavily: 0.008, serper: 0.001, firecrawl: 0.002, builtin: 0, apollo: 0.02, hunter: 0.03, google_places: 0.035 };
export function costMicroUsd(provider: string, env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env[`PROVIDER_COST_USD_${provider.toUpperCase()}`]);
  const usd = Number.isFinite(v) && v >= 0 ? v : DEFAULT_COST_USD[provider] ?? 0;
  return Math.round(usd * 1_000_000);
}
