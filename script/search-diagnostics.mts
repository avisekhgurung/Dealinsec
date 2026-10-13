/**
 * Search diagnostics from SAVED search results, offline: no provider call, no model, no network, no key read. Feeds a
 * benchmark's saved raw results (script/bench/results/<stamp>-search-raw.json, written by outbound-benchmark.mts) through
 * the run's own filters and ranking (collectCandidates, rankCandidates) and writes the privacy-safe trace
 * (shared/search-diagnostics.ts) to .diagnostics/outbound-search/, which git ignores.
 *
 *   npx tsx script/search-diagnostics.mts <stamp> [<stamp> …] [--quantity 3]
 *
 * With the local truth set (script/bench/truth.json, never committed) it also says where each known target was lost:
 * not returned by the search, rejected by a filter (which), off topic, over the check budget, or kept. The truth set and
 * the saved results name third-party companies, so the trace with those attributions stays in the ignored folder.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectCandidates, domainOf, rankCandidates, runBudget, type Candidate, type SearchHit } from "../shared/prospect.ts";
import { queryRecord, rankRecord, summarizeQueries, type QueryRecord } from "../shared/search-diagnostics.ts";
import { DEFAULT_SEARCH_DIAGNOSTICS_DIR } from "../server/outbound/search-diagnostics.ts";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const qIdx = args.indexOf("--quantity");
const quantityOverride = qIdx >= 0 ? Number(args[qIdx + 1]) : null;
const stamps = args.filter((a, i) => !a.startsWith("--") && (qIdx < 0 || i !== qIdx + 1));
if (!stamps.length) { console.error("usage: npx tsx script/search-diagnostics.mts <stamp> [<stamp> …] [--quantity N]"); process.exit(2); }

const truthFile = join(here, "bench", "truth.json");
const truth = existsSync(truthFile) ? (JSON.parse(readFileSync(truthFile, "utf8")).entries as { domain: string; class: string }[]) : null;
const outDir = join(here, "..", DEFAULT_SEARCH_DIAGNOSTICS_DIR);
mkdirSync(outDir, { recursive: true });

const report: any[] = [];
for (const stamp of stamps) {
  const raw = JSON.parse(readFileSync(join(here, "bench", "results", `${stamp}-search-raw.json`), "utf8")) as { at20: { q: string; results: { url: string; title: string; snippet?: string }[]; error?: string }[] };
  const run = JSON.parse(readFileSync(join(here, "bench", "results", `${stamp}.json`), "utf8"));
  const icp = { ...run.icp, quantity: quantityOverride ?? run.icp.quantity };
  const provider = String(run.search?.provider ?? "unknown");
  const budget = runBudget(icp.quantity);
  // Exactly what a run does: each query's results through collectCandidates; one candidate per domain across queries.
  const records: QueryRecord[] = [];
  const byDomain = new Map<string, Candidate>();
  const bestRank = new Map<string, number>();
  raw.at20.forEach((q, i) => {
    const hits: SearchHit[] = q.results.map((r) => ({ ...r, provider, query: q.q, at: run.stamp }));
    const { candidates, decisions } = collectCandidates(hits, icp);
    records.push(queryRecord(i, q.q, provider, hits, decisions, q.error ?? null));
    hits.forEach((h, k) => { const d = domainOf(String(h.url)); if (d && (decisions[k] === "candidate" || decisions[k] === "merged")) bestRank.set(d, Math.min(bestRank.get(d) ?? 99, k + 1)); });
    for (const c of candidates) { const prev = byDomain.get(c.domain); if (prev) prev.sources.push(...c.sources); else byDomain.set(c.domain, { ...c, sources: [...c.sources] }); }
  });
  const ranked = rankCandidates(Array.from(byDomain.values()).map((candidate, order) => ({ candidate, order, isLead: false })), icp, budget.verify);
  const rank = rankRecord(ranked.map((r) => ({ domain: r.candidate.domain, sources: r.candidate.sources, score: r.score, rel: r.rel, outcome: r.outcome, bestRank: bestRank.get(r.candidate.domain) ?? null })), raw.at20);
  const summary = summarizeQueries(records);

  // Where each known target was lost (only with the local truth set).
  let targets: any = null;
  if (truth) {
    const decisionsFor = (d: string) => records.flatMap((r) => r.results.filter((x) => x.domain === d).map((x) => x.decision));
    const where = (d: string) => {
      const ds = decisionsFor(d);
      if (!ds.length) return "not_returned";
      const c = rank.candidates.find((x) => x.domain === d);
      if (!c) return `rejected:${Array.from(new Set(ds)).sort().join("+")}`;
      return c.outcome === "keep" ? "kept_for_check" : c.outcome;
    };
    const pos = truth.filter((t) => t.class === "positive");
    const attribution = pos.map((t) => ({ domain: t.domain, where: where(t.domain) }));
    const tally = attribution.reduce((m: Record<string, number>, a) => ((m[a.where] = (m[a.where] ?? 0) + 1), m), {});
    targets = { positives: pos.length, returned: attribution.filter((a) => a.where !== "not_returned").length, keptForCheck: tally.kept_for_check ?? 0, where: tally, attribution };
  }
  const out = { stamp, provider, quantity: icp.quantity, verifyBudget: budget.verify, summary, rank: rank.summary, targets, records, candidates: rank.candidates };
  writeFileSync(join(outDir, `replay-${stamp}-q${icp.quantity}.json`), JSON.stringify(out, null, 1));
  report.push({ stamp, provider, quantity: icp.quantity, results: summary.results, distinctDomains: summary.distinctDomains, byDecision: summary.byDecision, rank: rank.summary, targets: targets && { positives: targets.positives, returned: targets.returned, keptForCheck: targets.keptForCheck, where: targets.where } });
}
console.log(JSON.stringify(report, null, 1));
console.log(`\nwritten to ${DEFAULT_SEARCH_DIAGNOSTICS_DIR}/ (ignored by git)`);
