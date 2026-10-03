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
  // Seen in real search results for "logistics company Pune": news, directories, classifieds, slide decks, lookup tools.
  "slideserve.com", "slideshare.net", "scribd.com", "whois.com", "beforeitsnews.com", "smergers.com", "indianyellowpages.com", "surfindia.com",
  "loglink.com", "nexnews.org", "viesearch.com", "mapsofindia.com", "tuffclassified.com", "paperindex.com", "gktoday.in", "kashmirsearch.com",
  "indianexpress.com", "livemint.com", "hindustantimes.com", "ndtv.com", "timesofindia.com", "thehindu.com", "economictimes.com", "gridinsoft.com",
  "academia.edu", "researchgate.net", "archive.org", "blogspot.com", "wordpress.com", "wixsite.com", "weebly.com", "tumblr.com",
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

/** A host that is government, education or a known aggregator word, rather than a business. */
const JUNK_HOST = /(^|[.-])(news|times|herald|gazette|yellowpages|directory|classifieds?|listings?|wiki|forum|blogs?|jobs|careers)([.-]|$)/;
const NON_BUSINESS_LABELS = new Set(["gov", "edu", "ac", "mil", "nic"]);
/** A path that says "this is an article / listing / search page", not a company's own page. */
const JUNK_PATH = /\/(news|blogs?|articles?|posts?|category|categories|tags?|search|results|directory|listings?|wiki|forum|questions?|profiles?|biz|business(es)?|companies|jobs|press|events|handle|collections?|question)(\/|\.|$)|\/search\.\w+$|\.(pdf|docx?|pptx?|xlsx?)$/i;
/** A title that reads like an article, a list or a lookup result rather than a company name. */
const JUNK_TITLE = /^(top|best|\d+)\s|\bhow to\b|\bwhat is\b|\blist of\b|\bdirectory\b|\byellow pages\b|\bsearch results\b|\bfor sale\b|\bsought\b|\binvestment opportunit|\breviews?\b|\bguide\b|\bways\b|\btips\b|\bwikipedia\b|\bwhois\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b[^|]{0,12}\b(19|20)\d\d\b|^\d{1,2}(st|nd|rd|th)\b/i;
const GENERIC_TITLES = new Set(["description", "products", "home", "index", "untitled", "browser", "blogs collection", "page not found"]);

/**
 * Does this result look like a company's OWN page? A guess from the URL and title
 * alone: it can say no with confidence, never yes. (A directory listing about a
 * company is the main false positive, which is why the card says these are
 * guesses and why researching the actual site is a separate, later step.)
 */
export function looksLikeCompanyHost(hostname: string, domain: string): boolean {
  const labels = domain.split(".");
  if (labels.slice(0, -1).some((l) => NON_BUSINESS_LABELS.has(l))) return false;
  return !JUNK_HOST.test(hostname);
}

export function looksLikeCompanyPage(url: string, title: string, domain: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (!looksLikeCompanyHost(u.hostname, domain)) return false;
  if (JUNK_PATH.test(u.pathname)) return false;
  const t = String(title ?? "").trim();
  if (JUNK_TITLE.test(t) || GENERIC_TITLES.has(t.toLowerCase())) return false;
  // A company page is the home page or one level in; deeper than that is almost always a listing or an article.
  if (u.pathname.split("/").filter(Boolean).length > 2) return false;
  return true;
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

/**
 * A business a search turned up.
 *   site    : the result IS the business's own website (we link its home page).
 *   listing : the result is a page ABOUT the business on someone else's site (a
 *             directory profile, a social page); its website is not known yet.
 */
export type CandidateKind = "site" | "listing";
export interface Candidate {
  name: string;
  kind: CandidateKind;
  /** The business's own domain; null for a listing. */
  domain: string | null;
  /** The business's own home page; null for a listing. */
  website: string | null;
  /** The result page it came from, so a person can see where the name was found. */
  sourceUrl: string;
  /** The host of that page, for display. */
  sourceHost: string;
}

/** One candidate per company site, in the order the engine ranked them. */
export function toCandidates(results: SearchResult[], opts: { limit?: number } = {}): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const r of results) {
    const host = hostOf(r.url);
    const domain = host && registrableDomain(host);
    if (!domain || seen.has(domain) || isBlockedSite(domain) || !looksLikeCompanyPage(r.url, r.title, domain)) continue;
    seen.add(domain);
    out.push({ name: cleanName(r.title, domain), kind: "site", domain, website: `https://${domain}`, sourceUrl: r.url, sourceHost: host ?? domain });
    if (out.length >= (opts.limit ?? MAX_CANDIDATES)) break;
  }
  return out;
}


/* ── verifying what a model says about a set of results ────────────────── */

// Letters in any script count (anything from U+00C0 up is treated as one); everything else is a separator.
const norm2 = (x: string) => x.toLowerCase().replace(/[^a-z0-9\u00c0-\uffff]+/g, " ").trim();
const LEGAL_WORDS = new Set(["the", "and", "of", "pvt", "ltd", "llp", "llc", "inc", "co", "company", "corp", "limited", "private", "services", "service", "solutions", "group", "official", "website", "home"]);

/** True when a business name literally appears in the text it was supposedly read from. */
export function nameAppearsIn(name: string, ...texts: (string | undefined)[]): boolean {
  const n = norm2(name);
  if (n.length < 2) return false;
  return texts.some((t) => !!t && ` ${norm2(t)} `.includes(` ${n} `));
}

/** Does the domain look like it belongs to a business of this name? ("Godfrey Dadich Partners" ~ godfreydadich.com) */
export function nameResemblesDomain(name: string, domain: string): boolean {
  const label = domain.split(".")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  const tokens = norm2(name).split(" ").filter((t) => t.length >= 3 && !LEGAL_WORDS.has(t));
  if (label.length < 4 || !tokens.length) return false;
  if (tokens.some((t) => t.length >= 4 && label.includes(t))) return true;
  const joined = tokens.join("");
  return joined.length >= 4 && (label.includes(joined) || joined.includes(label));
}

/** The whole name is the domain's name ("Stowe Family Law" = stowefamilylaw.co.uk): the URL is part of the result, so this is checkable. */
export function nameFromDomain(name: string, domain: string): boolean {
  const label = domain.split(".")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  const n = norm2(name).split(" ").filter((t) => !LEGAL_WORDS.has(t)).join("");
  return label.length >= 4 && n.length >= 4 && (n === label || n.startsWith(label) || label.startsWith(n));
}

/** A display name from model output: plain characters only, short. */
export function plainName(raw: unknown): string {
  return cleanName(String(raw ?? ""), "x.example").replace(/^X$/, "");
}

export interface PickedBusiness { index: unknown; name: unknown; kind: unknown }

/**
 * What the model SAID about the results, checked against the results themselves.
 * The model can only choose among the results it was given; it cannot add a
 * business, a website or a name that is not in the text. Anything that fails a
 * check is dropped, or (for a claimed own site) downgraded to a listing.
 */
export function verifyPicks(picks: unknown, results: SearchResult[], opts: { limit?: number } = {}): Candidate[] {
  const list = (picks as { businesses?: unknown })?.businesses;
  if (!Array.isArray(list)) return [];
  const byName = new Map<string, Candidate>();
  for (const raw of list.slice(0, 30)) {
    const p = raw as PickedBusiness;
    const i = typeof p?.index === "number" && Number.isInteger(p.index) ? p.index : -1;
    const r = results[i];
    if (!r) continue;
    const host = hostOf(r.url);
    const domain = host && registrableDomain(host);
    if (!host || !domain) continue;
    let name = plainName(p.name);
    // A web address is not a name: show the domain's own label ("stowefamilylaw.co.uk" -> "Stowefamilylaw").
    if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(name.replace(/\s+/g, ""))) name = cleanName("", name.replace(/^www\./i, "").replace(/\s+/g, ""));
    // A "name" that reads like an article, ranking or lookup title is not a business, whoever picked it.
    if (name.length < 2 || JUNK_TITLE.test(name) || GENERIC_TITLES.has(name.toLowerCase())) continue;
    const inText = nameAppearsIn(name, r.title, r.snippet);

    // An own site is judged on its HOST, not on how deep the page is (a company's service page is deep): the
    // domain must resemble the name, and the name may be read from the domain itself ("stowefamilylaw.co.uk").
    const ownOk = p.kind === "own_site" && !isBlockedSite(domain) && looksLikeCompanyHost(host, domain)
      && nameResemblesDomain(name, domain) && (inText || nameFromDomain(name, domain));
    let cand: Candidate;
    if (ownOk) {
      cand = { name, kind: "site", domain, website: `https://${domain}`, sourceUrl: r.url, sourceHost: host };
    } else {
      // A listing's name must be IN the result's own title or snippet: a model cannot invent a business.
      if (!inText) continue;
      cand = { name, kind: "listing", domain: null, website: null, sourceUrl: r.url, sourceHost: host };
    }
    const key = norm2(name);
    const prev = byName.get(key);
    if (!prev || (prev.kind === "listing" && cand.kind === "site")) byName.set(key, cand);
  }
  return Array.from(byName.values()).slice(0, opts.limit ?? MAX_CANDIDATES);
}
