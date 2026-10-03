/**
 * Finding companies from a web search. Pure: no network, no database.
 *
 * Two jobs live here, both about not letting the wrong thing through:
 *   - what we are willing to SEND to a search engine (never a person's email or
 *     phone number, never pasted text): sanitizeQuery;
 *   - what we are willing to call a COMPANY from the results (a company's own
 *     site, once per company, with a name that is only ever a short label):
 *     toCandidates. Search results are pages, not companies, and are untrusted
 *     text from the open web.
 */

export interface SearchResult { title: string; url: string; snippet?: string }

export const MAX_QUERY_LENGTH = 150;
export const MAX_CANDIDATES = 10;

export type QueryCheck = { ok: true; query: string } | { ok: false; reason: string };

/** What may be sent to a search engine on the user's behalf. */
export function sanitizeQuery(raw: string): QueryCheck {
  // eslint-disable-next-line no-control-regex
  const q = String(raw ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (q.length < 3) return { ok: false, reason: "Say what kind of companies to look for (for example: small logistics companies in Pune)." };
  if (q.length > MAX_QUERY_LENGTH) return { ok: false, reason: `Keep the search under ${MAX_QUERY_LENGTH} characters.` };
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(q)) return { ok: false, reason: "A search shouldn't contain an email address. Describe the kind of company instead." };
  if (/\d[\d\s().-]{7,}\d/.test(q)) return { ok: false, reason: "A search shouldn't contain a phone number or long number. Describe the kind of company instead." };
  if (/https?:\/\//i.test(q)) return { ok: false, reason: "Describe the kind of company to look for rather than pasting a link." };
  return { ok: true, query: q };
}

/** Sites that are about companies rather than a company's own site. */
export const NOT_A_COMPANY_SITE = new Set([
  "linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com", "youtube.com", "tiktok.com", "pinterest.com", "threads.net",
  "wikipedia.org", "reddit.com", "quora.com", "medium.com", "substack.com", "github.com", "stackoverflow.com",
  "glassdoor.com", "indeed.com", "naukri.com", "monster.com", "ziprecruiter.com", "angel.co", "wellfound.com",
  "crunchbase.com", "zoominfo.com", "dnb.com", "owler.com", "apollo.io", "rocketreach.co", "lusha.com", "cbinsights.com", "pitchbook.com",
  "yelp.com", "justdial.com", "indiamart.com", "tradeindia.com", "yellowpages.com", "sulekha.com", "mapquest.com",
  "clutch.co", "goodfirms.co", "g2.com", "capterra.com", "trustpilot.com", "sortlist.com", "designrush.com", "upwork.com", "fiverr.com",
  "google.com", "bing.com", "amazon.com", "ebay.com", "alibaba.com", "forbes.com", "bloomberg.com", "reuters.com",
]);

// Second-level public suffixes where the registrable domain has three labels (co.uk, com.au ...).
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "ltd", "plc"]);
const COUNTRY_TLDS = new Set(["uk", "in", "au", "nz", "za", "br", "jp", "sg", "my", "ng", "ke", "pk", "bd", "lk", "ae", "hk", "tr", "mx", "ar", "kr", "tw", "id", "ph", "th", "vn"]);

export function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

/** The company's own domain: "blog.acme.co.uk" -> "acme.co.uk". A heuristic, good enough to group results. */
export function registrableDomain(host: string): string | null {
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(host)) return null;
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const [sld, tld] = [parts[parts.length - 2], parts[parts.length - 1]];
  const take = SECOND_LEVEL.has(sld) && COUNTRY_TLDS.has(tld) ? 3 : 2;
  return parts.slice(-take).join(".");
}

export const isBlockedSite = (domain: string) =>
  NOT_A_COMPANY_SITE.has(domain) || Array.from(NOT_A_COMPANY_SITE).some((d) => domain.endsWith(`.${d}`));

const GENERIC = /^(home|homepage|welcome|about( us)?|contact( us)?|official( site| website)?|index|services|our services|blog|news)$/i;

/** A short plain label from a page title. It is a GUESS from the open web and is shown as one. */
export function cleanName(title: string, domain: string): string {
  // eslint-disable-next-line no-control-regex
  const t = String(title ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  const segs = t.split(/\s+[|–—·•:-]\s+|\s*\|\s*/).map((s) => s.trim()).filter((s) => s.length >= 2 && !GENERIC.test(s));
  let name = segs.find((s) => s.length <= 50) ?? "";
  // Keep to ordinary name characters: whatever else a page title holds is not a company name.
  // (A removal list, not a whitelist, so names in any script survive.)
  name = name.replace(/[<>{}[\]\\`$%^*=~|/;:"@#!?_\u2000-\u2018\u201A-\u2BFF\uD800-\uDFFF\uFE00-\uFE0F]/g, "").replace(/\s+/g, " ").trim().slice(0, 50).trim();
  if (name.length < 2) {
    const label = domain.split(".")[0];
    name = label.charAt(0).toUpperCase() + label.slice(1);
  }
  return name;
}

export interface Candidate {
  name: string;
  domain: string;
  /** The company's home page, not the deep link the search returned. */
  website: string;
}

/** One candidate per company site, in the order the engine ranked them. */
export function toCandidates(results: SearchResult[], opts: { limit?: number } = {}): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const r of results) {
    const host = hostOf(r.url);
    const domain = host && registrableDomain(host);
    if (!domain || seen.has(domain) || isBlockedSite(domain)) continue;
    seen.add(domain);
    out.push({ name: cleanName(r.title, domain), domain, website: `https://${domain}` });
    if (out.length >= (opts.limit ?? MAX_CANDIDATES)) break;
  }
  return out;
}
