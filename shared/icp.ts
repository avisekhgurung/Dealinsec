/**
 * The ideal customer profile for ONE prospecting run, and how a company is judged against it. Pure: no model, no
 * network. A model may propose the structured ICP from the person's sentence (server/outbound/prompts.ts), but this
 * module decides what is valid, and a plain-rules fallback parses the same sentence when the model fails. The person
 * sees the result and confirms it before anything is spent.
 */
import { z } from "zod";
import { sanitizeQuery } from "./discovery";
import { assessFit, textMatches, verdictFrom, type FitResult, type FitSignal, type IdealClient } from "./fit";

export const MAX_QUANTITY = 50;
export const DEFAULT_QUANTITY = 20;

const text = (max: number) => z.string().trim().min(1).max(max);
const list = (n: number, max: number) => z.array(text(max)).max(n).transform((xs) => Array.from(new Set(xs.map((x) => x.replace(/\s+/g, " ").trim()))));

export const icpSchema = z.object({
  /** What kind of company, in the person's words ("digital marketing agency"). */
  industry: text(80),
  /** Other words such a company uses for itself ("performance marketing", "SEO agency"). */
  keywords: list(6, 60).default([]),
  /** ISO 3166-1 alpha-2 codes. */
  countries: z.array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/)).max(5).default([]).transform((xs) => Array.from(new Set(xs))),
  /** Regions or cities, free text ("California", "Bay Area"). */
  locations: list(5, 60).default([]),
  employeeMin: z.number().int().min(1).max(1_000_000).nullable().default(null),
  employeeMax: z.number().int().min(1).max(1_000_000).nullable().default(null),
  /** Who THEY serve ("SaaS companies"). */
  targetMarket: list(5, 60).default([]),
  /** Who to contact there, most relevant first. */
  roles: list(6, 60).default([]),
  exclusions: list(10, 60).default([]),
  quantity: z.number().int().min(1).max(MAX_QUANTITY).default(DEFAULT_QUANTITY),
}).refine((x) => x.employeeMin === null || x.employeeMax === null || x.employeeMin <= x.employeeMax, { message: "The smallest company size must not be bigger than the largest." });
export type Icp = z.infer<typeof icpSchema>;

/** Country names a person types, to ISO codes. Only these are recognised by the rules; the model may add others (validated as codes). */
export const COUNTRIES: Record<string, string> = {
  "us": "US", "usa": "US", "u.s.": "US", "u.s.a.": "US", "united states": "US", "america": "US", "american": "US",
  "uk": "GB", "u.k.": "GB", "united kingdom": "GB", "britain": "GB", "great britain": "GB", "england": "GB", "british": "GB",
  "india": "IN", "indian": "IN", "canada": "CA", "canadian": "CA", "australia": "AU", "australian": "AU", "germany": "DE", "german": "DE",
  "france": "FR", "french": "FR", "spain": "ES", "netherlands": "NL", "dutch": "NL", "ireland": "IE", "singapore": "SG", "uae": "AE",
  "united arab emirates": "AE", "new zealand": "NZ", "south africa": "ZA", "portugal": "PT", "italy": "IT", "sweden": "SE", "brazil": "BR", "mexico": "MX", "japan": "JP",
};
export const COUNTRY_NAME: Record<string, string> = {
  US: "United States", GB: "United Kingdom", IN: "India", CA: "Canada", AU: "Australia", DE: "Germany", FR: "France", ES: "Spain", NL: "Netherlands",
  IE: "Ireland", SG: "Singapore", AE: "United Arab Emirates", NZ: "New Zealand", ZA: "South Africa", PT: "Portugal", IT: "Italy", SE: "Sweden", BR: "Brazil", MX: "Mexico", JP: "Japan",
};
export const countryLabel = (code: string) => COUNTRY_NAME[code] ?? code;

const DEFAULT_ROLES = ["Founder", "CEO", "Owner", "Managing Director", "Head of Growth", "Head of Sales"];

/**
 * The plain-rules reading of a request such as "Find 30 US digital marketing agencies with 5-30 employees that serve
 * SaaS companies". It only takes what the words say; anything it can't read is left empty for the person to fill in.
 */
export function parseIcpFallback(request: string): Icp | null {
  const raw = String(request ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (raw.length < 3) return null;
  let s = ` ${raw} `;
  const lower = s.toLowerCase();

  const qty = lower.match(/\b(?:find|get|show|give me|list)?\s*(\d{1,3})\s+(?!employees|people|staff|years?|days?)[a-z]/);
  const quantity = qty ? Math.min(MAX_QUANTITY, Math.max(1, Number(qty[1]))) : DEFAULT_QUANTITY;

  const size = lower.match(/(\d{1,6})\s*(?:-|–|—|to)\s*(\d{1,6})\s*(?:employees|people|staff|person|team members)/)
    ?? lower.match(/(?:under|fewer than|less than|up to)\s*(\d{1,6})\s*(?:employees|people|staff)/);
  let employeeMin: number | null = null, employeeMax: number | null = null;
  if (size && size.length === 3) { employeeMin = Number(size[1]); employeeMax = Number(size[2]); }
  else if (size) { employeeMax = Number(size[1]); }
  if (employeeMin !== null && employeeMax !== null && employeeMin > employeeMax) [employeeMin, employeeMax] = [employeeMax, employeeMin];

  const countries: string[] = [];
  for (const [name, code] of Object.entries(COUNTRIES).sort((a, b) => b[0].length - a[0].length)) {
    const re = new RegExp(`(^|[^a-z.])${name.replace(/\./g, "\\.")}(?=$|[^a-z])`, "i");
    if (re.test(s)) { countries.push(code); s = s.replace(re, "$1 "); }
  }

  const market = s.match(/\b(?:that serve|that work with|which serve|serving|working with|who serve|who work with|focused on|specialising in|specializing in|for)\s+([a-z0-9][a-z0-9 &/+.-]{1,60}?)(?:\s+(?:companies|businesses|clients|brands|startups|firms))?(?=$|[,.;]|\s+(?:in|with|that|and)\s)/i);
  const targetMarket = market ? [market[1].trim().replace(/\s+(companies|businesses|clients|brands|firms)$/i, "")].filter((x) => x.length >= 2) : [];

  // The industry: what is left of the head of the sentence, before "with", "that", "serving"...
  let head = s.replace(/^\s*(?:please\s+)?(?:find|get|show|give me|list|search for|look for)\s+(?:me\s+)?/i, " ")
    .replace(/^\s*\d{1,3}\s+/, " ")
    .split(/\s(?:with|that|which|who|serving|working|focused|specialising|specializing|for|in|based|having)\s/i)[0];
  head = head.replace(/\b(companies|businesses)\b/gi, " ").replace(/[^A-Za-z0-9\u00C0-\uFFFF &/+-]/g, " ").replace(/\s+/g, " ").trim();
  const industry = singular(head).slice(0, 80);
  if (industry.length < 3) return null;

  const parsed = icpSchema.safeParse({ industry, keywords: [], countries, locations: [], employeeMin, employeeMax, targetMarket, roles: DEFAULT_ROLES, exclusions: [], quantity });
  return parsed.success ? parsed.data : null;
}

/** "digital marketing agencies" -> "digital marketing agency". Only the last word, and only the plain English endings. */
export function singular(phrase: string): string {
  const words = phrase.split(" ");
  const last = words.pop() ?? "";
  const one = /ies$/i.test(last) ? last.replace(/ies$/i, "y") : /(ss|us)$/i.test(last) ? last : /(ches|shes|xes)$/i.test(last) ? last.replace(/es$/i, "") : /s$/i.test(last) ? last.replace(/s$/i, "") : last;
  return [...words, one].join(" ").trim();
}

/** Validates whatever the model proposed; anything invalid is dropped field by field, and missing fields come from the rules. */
export function mergeIcp(modelOutput: unknown, fallback: Icp | null): Icp | null {
  const m = (modelOutput && typeof modelOutput === "object" ? modelOutput : {}) as Record<string, unknown>;
  const base = icpSchema.innerType().shape;
  // A model field counts only when it is PRESENT and valid and says something: a missing or empty answer never overrides what the rules read.
  const pick = <K extends keyof Icp>(k: K, schema: z.ZodTypeAny): Icp[K] | undefined => {
    const raw = m[k as string];
    if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0)) return undefined;
    const r = schema.safeParse(raw);
    return r.success ? (r.data as Icp[K]) : undefined;
  };
  const industry = pick("industry", base.industry) ?? fallback?.industry;
  if (!industry) return null;
  const merged = {
    industry,
    keywords: pick("keywords", base.keywords) ?? fallback?.keywords ?? [],
    countries: pick("countries", base.countries) ?? fallback?.countries ?? [],
    locations: pick("locations", base.locations) ?? fallback?.locations ?? [],
    employeeMin: pick("employeeMin", base.employeeMin) ?? fallback?.employeeMin ?? null,
    employeeMax: pick("employeeMax", base.employeeMax) ?? fallback?.employeeMax ?? null,
    targetMarket: pick("targetMarket", base.targetMarket) ?? fallback?.targetMarket ?? [],
    roles: pick("roles", base.roles) ?? fallback?.roles ?? DEFAULT_ROLES,
    exclusions: pick("exclusions", base.exclusions) ?? fallback?.exclusions ?? [],
    // The NUMBER the person asked for is read by the rules when they found one; a model never raises it.
    quantity: Math.min(fallback?.quantity ?? MAX_QUANTITY, pick("quantity", base.quantity) ?? fallback?.quantity ?? DEFAULT_QUANTITY),
  };
  const r = icpSchema.safeParse(merged);
  if (r.success) return r.data;
  // An inconsistent size range: drop the range rather than the whole profile.
  const r2 = icpSchema.safeParse({ ...merged, employeeMin: null, employeeMax: null });
  return r2.success ? r2.data : null;
}

/** The ICP plus the workspace's saved exclusions (the person's standing "never these"). */
export function withSavedExclusions(icp: Icp, saved: { exclusions?: string[] } | null | undefined): Icp {
  const ex = Array.from(new Set([...icp.exclusions, ...(saved?.exclusions ?? [])])).slice(0, 10);
  return { ...icp, exclusions: ex };
}

/** A short readable line: "digital marketing agency · US · 5–30 people · serves SaaS". */
export function describeIcp(i: Icp): string {
  const size = i.employeeMin && i.employeeMax ? `${i.employeeMin}–${i.employeeMax} people` : i.employeeMax ? `up to ${i.employeeMax} people` : i.employeeMin ? `${i.employeeMin}+ people` : "";
  return [i.industry, i.countries.map(countryLabel).join(", "), i.locations.join(", "), size, i.targetMarket.length ? `serves ${i.targetMarket.join(", ")}` : ""].filter(Boolean).join(" · ");
}

/* ── search strategies ─────────────────────────────────────────────────── */

export const MAX_QUERIES = 8;

/**
 * Several phrasings, not one giant search: the ways such a company describes itself, with the place and the market.
 * Deterministic templates first; `extra` (model-proposed phrasings) only fill the remaining slots and pass the same
 * checks. Every query passes sanitizeQuery (no emails, phone numbers or links ever go to a search engine).
 */
export function searchStrategies(i: Icp, extra: string[] = [], max = MAX_QUERIES): string[] {
  const place = i.locations[0] ?? (i.countries[0] ? countryLabel(i.countries[0]) : "");
  const market = i.targetMarket[0] ?? "";
  const kinds = [i.industry, ...i.keywords].slice(0, 4);
  const small = i.employeeMax !== null && i.employeeMax <= 50;
  const t: string[] = [];
  for (const k of kinds.slice(0, 2)) {
    if (market) t.push(`${k} for ${market} ${place}`);
    t.push(`${k} ${place}`);
  }
  if (market) t.push(`${i.industry} ${market} clients case study`);
  if (small) t.push(`boutique ${i.industry} ${place}`);
  for (const k of kinds.slice(2)) t.push(`${k} ${market} ${place}`);
  const out: string[] = [];
  const seen = new Set<string>();
  const take = (q: string) => {
    const c = sanitizeQuery(q.replace(/\s+/g, " "));
    if (!c.ok || seen.has(c.query.toLowerCase()) || out.length >= max) return false;
    seen.add(c.query.toLowerCase()); out.push(c.query); return true;
  };
  // Model phrasings get up to 3 reserved slots (they find wordings the templates don't); templates take the rest.
  const okExtra = extra.filter((q) => sanitizeQuery(q).ok).slice(0, 3);
  for (const q of t) { if (out.length >= max - okExtra.length) break; take(q); }
  for (const q of okExtra) take(q);
  for (const q of t) take(q);
  return out;
}

/* ── judging a company against the ICP ─────────────────────────────────── */

/** A headcount from words a page uses: "a team of 12", "12 people", "11-50 employees", "over 40 staff". */
export function parseHeadcount(textValue: string | null | undefined): { min: number; max: number } | null {
  const t = String(textValue ?? "").toLowerCase().replace(/,/g, "");
  const range = t.match(/(\d{1,6})\s*(?:-|–|—|to)\s*(\d{1,6})/);
  if (range) { const a = Number(range[1]), b = Number(range[2]); return a <= b ? { min: a, max: b } : { min: b, max: a }; }
  const over = t.match(/(?:over|more than|\+|above)\s*(\d{1,6})|(\d{1,6})\s*\+/);
  if (over) { const n = Number(over[1] ?? over[2]); return { min: n + 1, max: Number.MAX_SAFE_INTEGER }; }
  const under = t.match(/(?:under|fewer than|less than|up to)\s*(\d{1,6})/);
  if (under) return { min: 1, max: Number(under[1]) };
  const one = t.match(/(\d{1,6})/);
  if (one) { const n = Number(one[1]); return n > 0 ? { min: n, max: n } : null; }
  return null;
}

export interface ProspectProfile {
  name: string;
  /** The company's registrable domain: its country-code ending (.uk, .de) is evidence of where it is, when the page doesn't say. */
  domain?: string | null;
  industry?: string | null;
  description?: string | null;
  services?: string | null;
  location?: string | null;
  country?: string | null;
  employees?: string | null;
  targetCustomers?: string | null;
}

/** Country-code endings that really mean a country. Generic ones (.io, .co, .ai, .me, .tv) say nothing and are not here. */
const CCTLD: Record<string, string> = { uk: "GB", us: "US", in: "IN", ca: "CA", au: "AU", de: "DE", fr: "FR", es: "ES", nl: "NL", ie: "IE", sg: "SG", nz: "NZ", za: "ZA", pt: "PT", it: "IT", se: "SE", br: "BR", mx: "MX", jp: "JP", ae: "AE" };
export const countryFromDomain = (domain: string | null | undefined): string | null => {
  const tld = String(domain ?? "").toLowerCase().split(".").pop() ?? "";
  return CCTLD[tld] ?? null;
};

/**
 * How well a company matches the run's ICP: the lead fit check (industry, place, exclusions) plus company size and
 * target market, combined by the SAME verdict rule (verdictFrom). Unknown is never a mismatch.
 */
export function prospectFit(icp: Icp, p: ProspectProfile): FitResult {
  const ideal: IdealClient = {
    about: null, services: [], minDealMinor: null, currency: null,
    targetIndustries: [icp.industry, ...icp.keywords],
    targetLocations: [], // judged below: a country code is compared as a code, a city is never a mismatch for a country
    exclusions: icp.exclusions,
  };
  // WHAT KIND of company it is comes from the field that says so; only without one, from its own description.
  const industryText = p.industry?.trim() || [p.description, p.services].filter(Boolean).join(" · ") || null;
  const base = assessFit(ideal, { companyName: p.name, industry: industryText, location: null, fitSummary: [p.description, p.services, p.targetCustomers].filter(Boolean).join(" ") || null });
  if (base.verdict === "no_profile") return base;
  const signals: FitSignal[] = [...base.signals];

  if (icp.countries.length || icp.locations.length) {
    const want = [...icp.countries.map(countryLabel), ...icp.locations].join(", ");
    const stated = p.country?.trim().toUpperCase() || null;
    const fromDomain = stated ? null : countryFromDomain(p.domain);
    const country = stated ?? fromDomain;
    const placeText = [p.location, country ? countryLabel(country) : null].filter(Boolean).join(", ");
    const placeHit = icp.locations.find((l) => placeText && textMatches(l, placeText));
    if (country && icp.countries.length && !icp.countries.includes(country)) signals.push({ key: "location", label: "Location", status: "mismatch", detail: `It is in ${countryLabel(country)}${fromDomain ? ` (its web address ends .${p.domain!.split(".").pop()})` : ""}, not ${want}.` });
    else if ((country && icp.countries.includes(country) && !icp.locations.length) || placeHit) signals.push({ key: "location", label: "Location", status: "match", detail: `It is in ${placeText}, which matches ${want}.` });
    else if (placeText && icp.locations.length && country && icp.countries.includes(country)) signals.push({ key: "location", label: "Location", status: "unknown", detail: `It is in ${placeText}; not clear if that is ${icp.locations.join(", ")}.` });
    // A city or region alone is not compared with a country: unknown, never a mismatch.
    else signals.push({ key: "location", label: "Location", status: "unknown", detail: placeText ? `It says ${placeText}; the country isn't stated, so it isn't compared with ${want}.` : "Where it is based isn't known yet." });
  }

  if (icp.employeeMin !== null || icp.employeeMax !== null) {
    const hc = parseHeadcount(p.employees);
    const lo = icp.employeeMin ?? 1, hi = icp.employeeMax ?? Number.MAX_SAFE_INTEGER;
    const want = icp.employeeMin && icp.employeeMax ? `${lo}–${hi}` : icp.employeeMax ? `up to ${hi}` : `${lo}+`;
    if (!hc) signals.push({ key: "size", label: "Company size", status: "unknown", detail: `Its size isn't known yet (you want ${want} people).` });
    else if (hc.max >= lo && hc.min <= hi) signals.push({ key: "size", label: "Company size", status: "match", detail: `"${p.employees}" is within ${want} people.` });
    else signals.push({ key: "size", label: "Company size", status: "mismatch", detail: `"${p.employees}" is outside ${want} people.` });
  }
  if (icp.targetMarket.length) {
    const said = [p.targetCustomers, p.description, p.services].filter(Boolean).join(" ");
    const hit = said ? icp.targetMarket.find((m) => textMatches(m, said)) : undefined;
    if (!said) signals.push({ key: "market", label: "Who they serve", status: "unknown", detail: "Who they serve isn't known yet." });
    else if (hit) signals.push({ key: "market", label: "Who they serve", status: "match", detail: `They mention serving ${hit}.` });
    // Not saying it is not the same as not doing it: a company that doesn't mention your market is unknown, not a mismatch.
    else signals.push({ key: "market", label: "Who they serve", status: "unknown", detail: `Their site doesn't mention ${icp.targetMarket.join(" or ")}.` });
  }
  let { verdict, headline } = verdictFrom(signals, base.excludedBy);
  // The kind of company is the core of the ICP: a company that isn't the kind you asked for is a weak fit, whatever else matches.
  const ind = signals.find((x) => x.key === "industry");
  if (ind?.status === "mismatch" && verdict !== "excluded") { verdict = "weak"; headline = "It isn't the kind of company you asked for."; }
  const missing = signals.filter((s) => s.status === "unknown").map((s) => s.label.toLowerCase());
  return { verdict, headline, signals, excludedBy: base.excludedBy, missing };
}

/** True when the company is known to be the kind of business the ICP asks for. Anything less is not worth deeper research. */
export const industryMatched = (fit: Pick<FitResult, "signals"> | null | undefined): boolean => !!fit?.signals.some((x) => x.key === "industry" && x.status === "match");

/** Decision-maker relevance: earlier in the ICP's role list is more relevant; a title that matches none is still kept, ranked last. */
export function roleRank(icp: Pick<Icp, "roles">, title: string): number {
  const roles = icp.roles.length ? icp.roles : DEFAULT_ROLES;
  const i = roles.findIndex((r) => textMatches(r, title) || title.toLowerCase().includes(r.toLowerCase()));
  return i < 0 ? roles.length : i;
}
