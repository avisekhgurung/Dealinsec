/**
 * Search diagnostics for Client Radar: where results are thrown away between the search provider and the sites the run
 * checks. Pure, and privacy-safe by construction: a record holds only a query's number, each result's rank, its
 * registrable domain, whether it was a home or an inner page, and what the filters decided. Never a title, a snippet, a
 * URL path or query string, the query's text (it is built from the user's request), an email, a phone number or a key.
 *
 * Opt-in (OUTBOUND_SEARCH_DIAGNOSTICS=1, server/outbound/search-diagnostics.ts); with it off nothing here runs.
 */
import { canonicalUrl, domainOf, type HitDecision, type RankOutcome } from "./prospect";
import { JUNK_PATH, JUNK_TITLE } from "./discovery";

/** rule: for a listing_page, which rule fired (the title reads like a list or article, or the address is a list/blog/directory path). */
export interface ResultTrace { rank: number; domain: string | null; page: "home" | "inner" | null; decision: HitDecision; rule?: "title" | "path" | "title+path" }
export interface QueryRecord { type: "query"; query: string; words: number; provider: string; ok: boolean; error: string | null; results: ResultTrace[] }
export interface CandidateTrace { domain: string; queries: string[]; bestRank: number | null; relevance: number; score: number; outcome: RankOutcome; checkOrder: number | null }
export interface RankRecord { type: "rank"; candidates: CandidateTrace[]; summary: Record<string, number> }

/** A domain is kept only when it is a plain public hostname of a business site; anything else is dropped (null). */
const HOSTNAME = /^(?=.{3,120}$)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+$/;
const NO_DOMAIN: ReadonlySet<HitDecision> = new Set<HitDecision>(["not_a_url", "non_business_host"]); // personal pages, free hosts, odd addresses
export function safeDomain(url: unknown, decision: HitDecision): string | null {
  if (NO_DOMAIN.has(decision)) return null;
  const d = domainOf(String(url ?? ""));
  return d && HOSTNAME.test(d) ? d : null;
}
const pageOf = (url: unknown): "home" | "inner" | null => {
  const c = canonicalUrl(String(url ?? ""));
  if (!c) return null;
  try { return new URL(c).pathname === "/" ? "home" : "inner"; } catch { return null; }
};
const listingRule = (r: { url: unknown; title?: unknown }): ResultTrace["rule"] => {
  const byTitle = JUNK_TITLE.test(String(r.title ?? "").trim());
  let byPath = false; try { byPath = JUNK_PATH.test(new URL(canonicalUrl(String(r.url ?? "")) ?? "").pathname); } catch { /* no path */ }
  return byTitle && byPath ? "title+path" : byTitle ? "title" : "path";
};
/** "q3": the query's place in the run's plan, never its text. */
export const queryId = (index: number) => `q${index + 1}`;
/** Only the leading code ("rate_limited", "error:TypeError"), never the words after it (a provider message can hold page text). */
const codeOnly = (e: string | null | undefined) => (e ? (String(e).match(/^[A-Za-z0-9_]+(?::[A-Za-z0-9_]+)?/)?.[0] ?? "error").slice(0, 30) : null);

/** One query: each result's rank, domain, page kind and decision (`decisions` from collectCandidates, one per result). */
export function queryRecord(index: number, q: string, provider: string, results: { url: unknown; title?: unknown }[], decisions: HitDecision[], error?: string | null): QueryRecord {
  return {
    type: "query", query: queryId(index), words: String(q ?? "").trim().split(/\s+/).filter(Boolean).length, provider: codeOnly(provider) ?? "unknown", ok: !error, error: codeOnly(error),
    results: results.map((r, i) => {
      const decision = decisions[i] ?? "not_a_url";
      const t: ResultTrace = { rank: i + 1, domain: safeDomain(r.url, decision), page: pageOf(r.url), decision };
      if (decision === "listing_page") t.rule = listingRule(r);
      return t;
    }),
  };
}

/**
 * The ranking step: every found candidate with the queries that found it (by number), its best result rank, its word
 * relevance and pre-rank score, what was decided, and its place in the check order. `plan` maps query text to its number.
 */
export function rankRecord(ranked: { domain: string; sources: { query?: string; url?: string }[]; score: number; rel: number; outcome: RankOutcome; bestRank?: number | null }[], plan: { q: string }[]): RankRecord {
  const idOf = new Map(plan.map((p, i) => [p.q, queryId(i)]));
  let order = 0;
  const candidates: CandidateTrace[] = ranked.map((r) => ({
    domain: HOSTNAME.test(r.domain) ? r.domain : "(dropped)",
    queries: Array.from(new Set(r.sources.map((s) => idOf.get(String(s.query ?? "")) ?? "q?"))).sort(),
    bestRank: r.bestRank ?? null, relevance: r.rel, score: r.score, outcome: r.outcome, checkOrder: r.outcome === "keep" ? ++order : null,
  }));
  const summary: Record<string, number> = { candidates: candidates.length };
  for (const c of candidates) summary[c.outcome] = (summary[c.outcome] ?? 0) + 1;
  return { type: "rank", candidates, summary };
}

/** Totals over a run's query records: results, decisions by kind, distinct domains returned, and per-query yield. */
export function summarizeQueries(records: QueryRecord[]): { queries: number; failed: number; results: number; distinctDomains: number; byDecision: Record<string, number>; perQuery: { query: string; results: number; candidates: number; rejected: number }[] } {
  const byDecision: Record<string, number> = {};
  const domains = new Set<string>();
  for (const r of records) for (const x of r.results) { byDecision[x.decision] = (byDecision[x.decision] ?? 0) + 1; if (x.domain) domains.add(x.domain); }
  return {
    queries: records.length, failed: records.filter((r) => !r.ok).length, results: records.reduce((n, r) => n + r.results.length, 0), distinctDomains: domains.size, byDecision,
    perQuery: records.map((r) => ({ query: r.query, results: r.results.length, candidates: r.results.filter((x) => x.decision === "candidate").length, rejected: r.results.filter((x) => x.decision !== "candidate" && x.decision !== "merged").length })),
  };
}
