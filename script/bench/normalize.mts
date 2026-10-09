/**
 * Turns the three raw verification files (script/bench/raw/, read-only evidence, never edited) into the benchmark's
 * truth set: script/bench/truth.json. Deterministic: same inputs, same output.
 *
 * Target definition: a US-based digital marketing agency/consultancy that serves SaaS / B2B software companies,
 * established from the company's OWN site. Classes:
 *   positive     agency + an explicit SaaS/software/tech statement + a US location, all on its own site, nothing contradicting
 *   negative     the site CONTRADICTS the target: another country's base, not an agency, or a stated different focus
 *   ambiguous    the evidence is MISSING or mixed: no location on the site, no SaaS/software statement on the pages read,
 *                several offices with the headquarters unstated or another country first. Never counted as a miss or a hit.
 *   unreachable  the site could not be read at all. Excluded from every metric.
 * Absence of a statement is not a contradiction, so it is never "negative". Employee count is a number only where the
 * company's own text states one clearly; otherwise null (unknown).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHeadcount } from "../../shared/icp.ts";

const here = dirname(fileURLToPath(import.meta.url));
type Quote = { text: string; url: string } | null;
interface Raw { name: string; domain: string; website: string; agency_quote: Quote; saas_b2b_quote: Quote; location_quote: Quote; country: string; employees_stated: string | null; employees_url: string | null; verdict: "include" | "exclude" | "unreachable"; reason: string }

/** Company-by-company judgments live in script/bench/overrides.json, a LOCAL file (it names third-party companies; the repository is public). */
interface Overrides { negative: Record<string, string>; ambiguousInclude: Record<string, string>; notAnEntry: string[] }
const overridesPath = join(here, "overrides.json");
if (!existsSync(overridesPath)) throw new Error("script/bench/overrides.json is missing: it holds the per-company judgments (negative / ambiguous includes / duplicate rows) and is kept local, never committed.");
const OV = JSON.parse(readFileSync(overridesPath, "utf8")) as Overrides;
/** The site states a base outside the US, is not an agency, or states a different focus. Each is a positive statement by the site. */
const NEGATIVE = OV.negative;
/** Includes whose US headquarters or fit is not clear: another country's office listed first or alongside, or a weaker kind of agency. */
const AMBIGUOUS_INCLUDE = OV.ambiguousInclude;
const NOT_AN_ENTRY = new Set(OV.notAnEntry); // the same company listed twice is recorded once
const SAAS = /saas|software|\btech\b|technology|cloud|\bapp\b|b2b tech|startup/i;

const files = [1, 2, 3].map((i) => join(here, "raw", `bench-part${i}.json`));
const rawBytes = files.map((f) => readFileSync(f));
const entries: (Raw & { part: number })[] = rawBytes.flatMap((b, i) => (JSON.parse(b.toString()) as Raw[]).map((r) => ({ ...r, part: i + 1 })));

type Class = "positive" | "negative" | "ambiguous" | "unreachable";
function classify(e: Raw): { cls: Class; why: string } {
  if (e.verdict === "unreachable") return { cls: "unreachable", why: e.reason };
  if (NEGATIVE[e.domain]) return { cls: "negative", why: NEGATIVE[e.domain] };
  if (AMBIGUOUS_INCLUDE[e.domain]) return { cls: "ambiguous", why: AMBIGUOUS_INCLUDE[e.domain] };
  if (e.verdict === "exclude") return { cls: "ambiguous", why: `missing evidence: ${e.reason}`.slice(0, 220) };
  if (!e.agency_quote || !e.location_quote || e.country !== "US") return { cls: "ambiguous", why: "include without a complete set of quotes on its own site" };
  if (!e.saas_b2b_quote || !SAAS.test(e.saas_b2b_quote.text)) return { cls: "ambiguous", why: "serves B2B but SaaS/software/tech is not stated in its own words" };
  return { cls: "positive", why: "agency + SaaS/software/tech + US location, all on its own site" };
}
/** A number only where the site's own words give one clearly; conflicting or fuzzy statements stay unknown. */
function employees(e: Raw): { stated: string | null; min: number | null; max: number | null; inBand5to30: boolean | null } {
  const stated = e.employees_stated;
  if (!stated || e.domain === "elevatedemand.com" /* "four" vs "five" people on the same page */ || /worldwide|clients|experts|projects/i.test(stated)) return { stated, min: null, max: null, inBand5to30: null };
  const h = parseHeadcount(stated);
  if (!h) return { stated, min: null, max: null, inBand5to30: null };
  return { stated, min: h.min, max: h.max, inBand5to30: h.min >= 5 && h.max <= 30 };
}

const out = entries.filter((e) => !NOT_AN_ENTRY.has(e.name)).map((e) => {
  const { cls, why } = classify(e);
  return { domain: e.domain, name: e.name, website: e.website, class: cls, why, employees: employees(e), part: e.part, quotes: { agency: e.agency_quote, saas: e.saas_b2b_quote, location: e.location_quote }, rawVerdict: e.verdict, rawReason: e.reason };
});
const domains = out.map((o) => o.domain);
if (new Set(domains).size !== domains.length) throw new Error(`duplicate domains: ${domains.filter((d, i) => domains.indexOf(d) !== i).join(", ")}`);
const counts = Object.fromEntries(["positive", "negative", "ambiguous", "unreachable"].map((c) => [c, out.filter((o) => o.class === c).length]));
const truth = { definition: "US digital marketing agency/consultancy serving SaaS / B2B software companies, from the company's own site", sources: files.map((f, i) => ({ file: `raw/bench-part${i + 1}.json`, sha256: createHash("sha256").update(rawBytes[i]).digest("hex") })), counts, entries: out };
writeFileSync(join(here, "truth.json"), JSON.stringify(truth, null, 1) + "\n");
console.log(JSON.stringify({ counts, total: out.length, sources: truth.sources.map((s) => `${s.file} ${s.sha256.slice(0, 12)}`) }));
const band = out.filter((o) => o.class === "positive");
console.log(`positives with a stated, clear headcount: ${band.filter((o) => o.employees.min !== null).length}/${band.length}; of those in 5-30: ${band.filter((o) => o.employees.inBand5to30).length}`);
