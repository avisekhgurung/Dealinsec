/**
 * The engine's outside data, behind small interfaces so that domain code never names a vendor:
 *   PageReader                 a company's own pages (built in: the SSRF-safe fetcher; optional: Firecrawl)
 *   CompanyEnrichmentProvider  structured firmographics (optional: Apollo)
 *   ContactEnrichmentProvider  named people with business emails and the PROVIDER's verification status (optional: Hunter)
 * Search providers are server/discovery/* (LangSearch, Brave, Tavily, Serper). Every adapter takes its key and a fetch
 * implementation, so tests run against fakes. Whatever comes back is untrusted data: it is validated and fenced later.
 */
import { createHash } from "node:crypto";
import { sameSite, siteHost, type PageLink } from "@shared/research";
import { extractContactBlock, extractHtml, extractLinks } from "../knowledge/extract";
import { fetchPublicPage, realPageIO, validatePublicUrl } from "../knowledge/net-guard";
import { callJson, str } from "../discovery/http";
import { DiscoveryError } from "../discovery/types";

export const PROSPECT_USER_AGENT = "DealInSec/1.0 (reads public company websites for B2B prospect research; https://dealinsec.com)";
const PAGE_BYTES = 1_500_000;
export const PAGE_TEXT_CHARS = 8000;

export type PageRead =
  | { ok: true; url: string; title: string; text: string; links: PageLink[]; hash: string }
  | { ok: false; code: "blocked" | "unreachable" | "bad_response" | "too_big" | "unsupported" | "not_html" | "unreadable" | "provider" };

export interface PageReader {
  readonly name: string;
  /** Reads one public page. Never follows the page's own instructions; returns text and same-page links only. */
  read(url: string): Promise<PageRead>;
}

const hashOf = (t: string) => createHash("sha256").update(t).digest("hex");

/** The built-in reader: net-guard (https only, DNS pinned, private addresses refused, redirects re-checked, size and time caps). */
export const builtinReader: PageReader = {
  name: "builtin",
  async read(url) {
    const r = await fetchPublicPage(url, realPageIO, PAGE_BYTES, { userAgent: PROSPECT_USER_AGENT });
    if (!r.ok) return { ok: false, code: r.code };
    if (r.contentType !== "html") return { ok: false, code: "not_html" };
    const ex = await extractHtml(r.bytes);
    if (!ex.ok) return { ok: false, code: "unreadable" };
    // The article reader drops footers; a company's address and contact details live there. Added as a separate, labelled block.
    const block = await extractContactBlock(r.bytes);
    const text = block ? `${ex.text.slice(0, Math.max(2000, PAGE_TEXT_CHARS - block.length - 40))}\n\n[Footer and contact details]\n${block}` : ex.text.slice(0, PAGE_TEXT_CHARS);
    return { ok: true, url: r.url.toString(), title: ex.title ?? "", text, links: await extractLinks(r.bytes), hash: hashOf(text) };
  },
};

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

export function pageReader(env: NodeJS.ProcessEnv = process.env): PageReader {
  return env.FIRECRAWL_API_KEY ? new FirecrawlReader(env.FIRECRAWL_API_KEY, env.FIRECRAWL_URL || undefined) : builtinReader;
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

const DEFAULT_COST_USD: Record<string, number> = { langsearch: 0, brave: 0.005, tavily: 0.008, serper: 0.001, firecrawl: 0.002, builtin: 0, apollo: 0.02, hunter: 0.03 };
export function costMicroUsd(provider: string, env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env[`PROVIDER_COST_USD_${provider.toUpperCase()}`]);
  const usd = Number.isFinite(v) && v >= 0 ? v : DEFAULT_COST_USD[provider] ?? 0;
  return Math.round(usd * 1_000_000);
}
