/**
 * Benchmark of AI Outbound against the verified truth set (script/bench/truth.json, built by script/bench/normalize.mts
 * from the frozen evidence in script/bench/raw/). Local database and local dev server only; real search, real websites,
 * real model. It measures; it asserts nothing about which companies the web returns.
 *
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest PORT=3000 npm run dev
 *   npx tsx --env-file=.env script/outbound-benchmark.mts                (everything)
 *   BENCH_PHASE=search ...                                                (search diagnostics only: no model calls, no run)
 *   BENCH_REQUEST="..." BENCH_KEEP=1 ...
 * Writes script/bench/results/<stamp>.json (every number below comes from it).
 *
 * The data (script/bench/raw, truth.json, overrides.json, results/) names third-party companies and, in the results, people:
 * the repository is public, so those paths are listed in .git/info/exclude and are never committed. Rebuild them from your own
 * verification files with script/bench/normalize.mts.
 */
import pg from "pg";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCAL_TEST_DATABASE_URL, requireLocalDatabaseUrl } from "./local-db-guard.ts";
import { collectCandidates, domainOf, MIN_RELEVANCE, preRank, relevance, runBudget, type SearchHit } from "../shared/prospect.ts";
import type { Icp } from "../shared/icp.ts";
import { quoteInPage } from "../shared/research.ts";
import { outboundSearchProviders } from "../server/discovery/provider.ts";
import { fetchPublicPage } from "../server/knowledge/net-guard.ts";
import { extractLinks } from "../server/knowledge/extract.ts";
import { pageReader } from "../server/outbound/providers.ts";

const DATABASE_URL = requireLocalDatabaseUrl("outbound-benchmark.mts");
const BASE = "http://localhost:3000";
const here = dirname(fileURLToPath(import.meta.url));
const STAMP = Date.now();
const REQUEST = process.env.BENCH_REQUEST ?? "Find 30 US digital marketing agencies with 5–30 employees that serve SaaS companies.";
const PHASE = process.env.BENCH_PHASE ?? "all";
const PW = `Bench#${STAMP}`;
const WHO = { email: `e2e-ob-bench-${STAMP}@dealinsec.invalid`, password: PW, firstName: "Bench", lastName: "Owner" };

type Cls = "positive" | "negative" | "ambiguous" | "unreachable";
interface TruthEntry { domain: string; name: string; class: Cls; why: string; employees: { stated: string | null; min: number | null; max: number | null; inBand5to30: boolean | null } }
const truth = JSON.parse(readFileSync(join(here, "bench", "truth.json"), "utf8")) as { counts: Record<Cls, number>; sources: unknown[]; entries: TruthEntry[] };
const T = new Map(truth.entries.map((e) => [e.domain, e]));
const of = (c: Cls) => truth.entries.filter((e) => e.class === c);
const POS = of("positive"), AMB = of("ambiguous"), NEG = of("negative");
const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : null);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function jar() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    for (const sc of (res.headers as any).getSetCookie?.() ?? []) { const pair = String(sc).split(";")[0]; if (pair.startsWith("connect.sid=") || !cookie) cookie = pair; }
    const text = await res.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text: text.slice(0, 300) };
  };
}
async function requireServerOnLocalDatabase() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const id = randomUUID(), email = `e2e-canary-${STAMP}@dealinsec.invalid`, password = `Canary#${STAMP}`;
  let outcome = "server unreachable";
  try {
    await pool.query(`INSERT INTO users (id,email,email_canonical,password) VALUES ($1,$2,$2,$3)`, [id, email, await bcrypt.hash(password, 10)]);
    try { const res = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }), redirect: "manual" }); outcome = `login answered ${res.status}`; if (res.status === 200) return; } catch { /* unreachable */ }
  } finally { await pool.query(`DELETE FROM users WHERE id=$1`, [id]).catch(() => {}); await pool.end(); }
  console.error(`REFUSING: the server at ${BASE} is not using the local test database (${outcome}).`); process.exit(1);
}

/* ── 1. search diagnostics: what the search returns, and where each truth company is lost ─────────────────────── */
interface Raw { title: string; url: string; snippet?: string }
async function searchDiagnostics(icp: Icp, searches: string[]) {
  const providers = await outboundSearchProviders();
  if (!providers.length) throw new Error("no search provider configured");
  const prov = providers[0];
  const budget = runBudget(icp.quantity);
  const run = async (count: number) => {
    const per: { q: string; results: Raw[]; error?: string }[] = [];
    for (const q of searches) {
      try { per.push({ q, results: await prov.search(q, { count, country: prov.supportsCountry ? icp.countries[0] : undefined }) }); }
      catch (e) { per.push({ q, results: [], error: (e as Error).message }); }
      await sleep(400);
    }
    return per;
  };
  const at20 = await run(budget.resultsPerQuery); // exactly what a run does
  const at50 = await run(50);                    // what more results per query would add
  const domainsOf = (per: typeof at20) => { const m = new Map<string, Set<string>>(); for (const p of per) for (const r of p.results) { const d = domainOf(r.url); if (d) (m.get(d) ?? m.set(d, new Set()).get(d)!).add(p.q); } return m; };
  const d20 = domainsOf(at20), d50 = domainsOf(at50);

  // The engine's own rules, on the same results: junk filter, relevance bar, rank, budget.
  const hits: SearchHit[] = at20.flatMap((p) => p.results.map((r) => ({ ...r, provider: prov.name, query: p.q, at: new Date().toISOString() })));
  const { candidates, rejected } = collectCandidates(hits, icp);
  const rejectedBy = new Map<string, string[]>(); // domain -> reasons of hits of that domain
  for (const r of rejected) { const d = domainOf(r.url); if (d) (rejectedBy.get(d) ?? rejectedBy.set(d, []).get(d)!).push(r.reason); }
  const ranked = candidates.map((c) => ({ c, rel: relevance(c, icp), score: preRank(c, icp) })).sort((a, b) => b.score - a.score);
  const kept = ranked.filter((x) => x.rel >= MIN_RELEVANCE).slice(0, budget.verify);
  const keptSet = new Set(kept.map((x) => x.c.domain));
  const candSet = new Map(ranked.map((x, i) => [x.c.domain, { rel: x.rel, score: x.score, position: i + 1 }]));

  // Directory/list pages are thrown away by the junk filter. How many truth companies sit behind them?
  const listHits = rejected.filter((r) => r.reason === "listing_page" || r.reason === "blocked_site").map((r) => r.url);
  const listUrls = Array.from(new Set(listHits)).slice(0, 20);
  const viaLists = new Map<string, string[]>(); const candidateDomainsViaLists = new Set<string>(); let listsRead = 0;
  for (const u of listUrls) {
    try {
      const page = await fetchPublicPage(u);
      if (!page.ok || page.contentType !== "html") continue;
      listsRead++;
      for (const l of await extractLinks(page.bytes)) {
        let d: string | null = null; try { d = domainOf(new URL(l.href, page.url).toString()); } catch { /* bad href */ }
        if (!d || d === domainOf(u)) continue;
        candidateDomainsViaLists.add(d);
        if (T.has(d)) (viaLists.get(d) ?? viaLists.set(d, []).get(d)!).push(u);
      }
    } catch { /* unreachable list page */ }
    await sleep(300);
  }

  // For truth positives we still did not see: is the company in the index at all (found by name), or just not surfaced by our phrasing?
  const missing = POS.filter((p) => !d20.has(p.domain) && !d50.has(p.domain)).slice(0, 12);
  const byName = new Map<string, boolean>();
  for (const m of missing) {
    try { const rs = await prov.search(`"${m.name}" agency`, { count: 10 }); byName.set(m.domain, rs.some((r) => domainOf(r.url) === m.domain)); } catch { byName.set(m.domain, false); }
    await sleep(400);
  }

  const lossOf = (domain: string) => {
    if (!d20.has(domain)) return d50.has(domain) ? "coverage: only with more results per query" : byName.get(domain) === true ? "query: indexed (found by name) but not surfaced by our searches" : byName.has(domain) ? "coverage: not found even by name" : "coverage: not in the results (not probed by name)";
    if (!candSet.has(domain)) return `filter: ${Array.from(new Set(rejectedBy.get(domain) ?? ["rejected"])).join("/")}`;
    const c = candSet.get(domain)!;
    if (c.rel < MIN_RELEVANCE) return `filter: relevance ${c.rel} < ${MIN_RELEVANCE} (words only)`;
    return keptSet.has(domain) ? "kept" : "budget: ranked below the verify budget";
  };
  return {
    provider: prov.name, budget,
    queries: at20.map((p) => ({ q: p.q, results: p.results.length, error: p.error ?? null, distinctDomains: new Set(p.results.map((r) => domainOf(r.url)).filter(Boolean)).size, truthPositivesFound: POS.filter((t) => p.results.some((r) => domainOf(r.url) === t.domain)).map((t) => t.domain) })),
    totals: { results20: hits.length, distinctDomains20: d20.size, results50: at50.reduce((n, p) => n + p.results.length, 0), distinctDomains50: d50.size, candidatesAfterJunkFilter: candidates.length, rejectedByJunkFilter: rejected.length, keptForVerify: kept.length, rejectedReasons: rejected.reduce((m: Record<string, number>, r) => ((m[r.reason] = (m[r.reason] ?? 0) + 1), m), {}) },
    found20: (list: TruthEntry[]) => list.filter((e) => d20.has(e.domain)).length,
    perTruth: truth.entries.map((e) => ({ domain: e.domain, class: e.class, in20: d20.has(e.domain), in50: d50.has(e.domain), queries: Array.from(d20.get(e.domain) ?? d50.get(e.domain) ?? []), loss: lossOf(e.domain) })),
    lists: { urlsTried: listUrls.length, read: listsRead, distinctCompanyDomainsLinked: candidateDomainsViaLists.size, truthLinked: Array.from(viaLists.entries()).map(([d, from]) => ({ domain: d, class: T.get(d)!.class, onlyViaLists: !d20.has(d) && !d50.has(d), from: from.slice(0, 2) })) },
    rawResults: { at20, at50 },
  };
}

/* ── 2. the engine run ─────────────────────────────────────────────────────────────────────────────────────── */
async function engineRun(icp: any, searches: string[], req: ReturnType<typeof jar>) {
  let r = await req("POST", "/api/outbound/runs", { request: REQUEST, icp, searches });
  if (r.status !== 201) throw new Error(`start failed: ${r.status} ${r.text}`);
  const id = r.json.run.id as string; const t0 = Date.now();
  let view: any = null;
  for (let i = 0; i < 400; i++) {
    await sleep(3000); r = await req("GET", `/api/outbound/runs/${id}`); view = r.json;
    if (i % 10 === 0) console.log(`   ... ${Math.round((Date.now() - t0) / 1000)}s ${view?.run?.status}/${view?.run?.stage} ${JSON.stringify(view?.run?.counters && { d: view.run.counters.discovered, v: view.run.counters.verified, e: view.run.counters.enriched, r: view.run.counters.researched, ready: view.run.counters.ready })}`);
    if (view?.run && view.run.status !== "running") break;
  }
  return { id, view, seconds: Math.round((Date.now() - t0) / 1000) };
}

const STAGE_ORDER = ["rejected", "found", "verified", "enriched", "done"];
async function main() {
  await requireServerOnLocalDatabase();
  const req = jar();
  let r = await req("POST", "/api/auth/signup", WHO);
  if (r.status !== 200 && r.status !== 201) throw new Error(`signup ${r.status} ${r.text}`);
  await req("PATCH", "/api/profile", { onboardingComplete: true, firstName: "Bench" });
  const me = (await req("GET", "/api/auth/user")).json;
  const db = new pg.Client({ connectionString: DATABASE_URL }); await db.connect();
  try {
    console.log(`\nTruth set: ${truth.counts.positive} positive, ${truth.counts.ambiguous} ambiguous, ${truth.counts.negative} negative, ${truth.counts.unreachable} unreachable (unreachable excluded everywhere)\nRequest: ${REQUEST}`);
    r = await req("POST", "/api/outbound/icp", { request: REQUEST });
    if (r.status !== 200) throw new Error(`icp ${r.status} ${r.text}`);
    const { icp, searches } = r.json as { icp: Icp; searches: string[] };
    console.log(`ICP: ${JSON.stringify(icp)}\nSearches (${searches.length}):\n${searches.map((q) => "  - " + q).join("\n")}`);

    console.log("\n━━ search diagnostics (no model calls) ━━");
    const sd = await searchDiagnostics(icp, searches);
    const out: any = { stamp: new Date(STAMP).toISOString(), request: REQUEST, icp, searches, truthCounts: truth.counts, truthSources: truth.sources, search: { ...sd, found20: undefined } };
    const f = (list: TruthEntry[]) => sd.found20(list);
    out.search.recall = { positive20: `${f(POS)}/${POS.length}`, positive20pct: pct(f(POS), POS.length), lenient20pct: pct(f(POS) + f(AMB), POS.length + AMB.length), negativesReturned: f(NEG), positive50: `${sd.perTruth.filter((e) => e.class === "positive" && (e.in20 || e.in50)).length}/${POS.length}` };
    console.log(JSON.stringify({ totals: sd.totals, recall: out.search.recall, lists: { ...sd.lists, truthLinked: sd.lists.truthLinked.length } }, null, 1));
    delete out.search.rawResults; // kept in a sibling file
    writeFileSync(join(here, "bench", "results", `${STAMP}-search-raw.json`), JSON.stringify(sd.rawResults));

    if (PHASE === "search") { writeFileSync(join(here, "bench", "results", `${STAMP}.json`), JSON.stringify(out, null, 1)); return; }

    console.log("\n━━ engine run ━━");
    const run = await engineRun(icp, searches, req);
    const view = run.view; const counters = view.run.counters; const cards: any[] = view.prospects ?? [];
    console.log(`   finished ${view.run.status} in ${run.seconds}s, cost $${view.run.costUsd}, funnel ${JSON.stringify(counters)}`);
    const card = new Map<string, any>(cards.map((c) => [c.domain, c]));
    const stageOf = (c: any | undefined) => (!c ? "not_found" : c.rejectReason ? `rejected:${c.rejectReason}` : c.ready ? "ready" : c.researched ? "researched" : c.fit ? `enriched:${c.fit.verdict}` : c.status);
    const reached = (c: any | undefined, level: "found" | "verified" | "enriched" | "icpMatch" | "researched" | "ready") => {
      if (!c) return false;
      const rr = c.rejectReason as string | null;
      if (level === "found") return true;
      if (level === "verified") return !rr || ["poor_fit", "unclear", "not_a_company"].includes(rr) || c.stage === "done" || c.stage === "enriched";
      if (level === "enriched") return !!c.fit || ["poor_fit", "unclear", "not_a_company"].includes(rr ?? "");
      if (level === "icpMatch") return !rr && !!c.fit && ["strong", "partial"].includes(c.fit.verdict);
      if (level === "researched") return !!c.researched;
      return !!c.ready;
    };
    const per = truth.entries.map((e) => ({ domain: e.domain, class: e.class, discovered: card.has(e.domain), stage: stageOf(card.get(e.domain)), ready: !!card.get(e.domain)?.ready, score: card.get(e.domain)?.score?.total ?? null }));
    const levels = ["found", "verified", "enriched", "icpMatch", "researched", "ready"] as const;
    const cum = (list: TruthEntry[]) => Object.fromEntries(levels.map((l) => [l, list.filter((e) => reached(card.get(e.domain), l)).length]));
    out.engine = { runId: run.id, status: view.run.status, errorCode: view.run.errorCode, seconds: run.seconds, costUsd: view.run.costUsd, counters, perTruth: per, reachedPositive: cum(POS), reachedAmbiguous: cum(AMB), reachedNegative: cum(NEG) };

    out.engine.cards = cards.map((c) => ({ domain: c.domain, name: c.name, website: c.website, label: T.get(c.domain)?.class ?? "not_in_truth", outcome: stageOf(c), fit: c.fit?.verdict ?? null, industry: c.profile?.industry ?? null, location: c.profile?.location ?? null, country: c.profile?.country ?? null, employees: c.profile?.employees ?? null, serves: c.profile?.serves ?? null, score: c.score?.total ?? null, ready: !!c.ready, whyNow: c.whyNow ? `${c.whyNow.label} · ${c.whyNow.freshness}` : null, person: c.decisionMaker?.value ?? null }));
    // ready / qualified cards: what are they?
    const readyCards = cards.filter((c) => c.ready), qualCards = cards.filter((c) => reached(c, "icpMatch"));
    const label = (c: any) => (T.has(c.domain) ? T.get(c.domain)!.class : "not_in_truth");
    out.engine.ready = readyCards.map((c) => ({ domain: c.domain, name: c.name, label: label(c), score: c.score?.total ?? null, whyNow: c.whyNow ? `${c.whyNow.label} ${c.whyNow.freshness}` : null, person: c.decisionMaker?.value ?? null }));
    out.engine.qualified = qualCards.map((c) => ({ domain: c.domain, name: c.name, label: label(c), ready: !!c.ready, fit: c.fit?.verdict }));
    out.engine.notInTruth = { discovered: cards.filter((c) => !T.has(c.domain)).length, verified: cards.filter((c) => !T.has(c.domain) && reached(c, "verified")).length, qualified: qualCards.filter((c) => !T.has(c.domain)).length, ready: readyCards.filter((c) => !T.has(c.domain)).length };
    const pc = (list: any[]) => ({ n: list.length, positive: list.filter((c) => label(c) === "positive").length, ambiguous: list.filter((c) => label(c) === "ambiguous").length, negative: list.filter((c) => label(c) === "negative").length, notInTruth: list.filter((c) => label(c) === "not_in_truth").length });
    out.engine.precision = { ready: pc(readyCards), qualified: pc(qualCards) };

    // decision makers + evidence accuracy (every confirmed quote re-found on the live page, by the engine's own reader)
    const org = me.organizationId as string;
    const fnd = (await db.query(`SELECT f.id, f.kind, f.status, f.quote, f.source_url, f.source_type, p.domain FROM prospect_findings f JOIN prospects p ON p.id=f.prospect_id WHERE f.organization_id=$1`, [org])).rows;
    const researched = cards.filter((c) => c.researched);
    const withPerson = researched.filter((c) => fnd.some((x) => x.domain === c.domain && x.kind === "decision_maker"));
    out.engine.decisionMakers = { researched: researched.length, withPerson: withPerson.length, coveragePct: pct(withPerson.length, researched.length), readyWithPerson: readyCards.filter((c) => !!c.decisionMaker).length, ready: readyCards.length };
    const confirmed = fnd.filter((x) => x.status === "confirmed" && x.quote && x.source_url);
    const reader = pageReader(); const pageText = new Map<string, string | null>();
    for (const url of Array.from(new Set(confirmed.map((x) => x.source_url as string)))) { try { const p = await reader.read(url); pageText.set(url, p.ok ? p.text : null); } catch { pageText.set(url, null); } await sleep(150); }
    const checked = confirmed.filter((x) => pageText.get(x.source_url) != null);
    const bad = checked.filter((x) => !quoteInPage(x.quote, pageText.get(x.source_url)!));
    out.engine.evidence = { confirmedFindings: confirmed.length, pageReadable: checked.length, pageNotReadableNow: confirmed.length - checked.length, quoteFoundOnPage: checked.length - bad.length, quoteNotFound: bad.length, accuracyPct: pct(checked.length - bad.length, checked.length), notFound: bad.slice(0, 10).map((x) => ({ domain: x.domain, kind: x.kind, url: x.source_url, quote: String(x.quote).slice(0, 120) })), inferredOpportunitiesConfirmed: fnd.filter((x) => (x.kind === "opportunity") && x.status === "confirmed").length };
    const calls = (await db.query(`SELECT operation, provider, count(*)::int n, coalesce(sum(cost_micro_usd),0)::int cost FROM provider_calls WHERE organization_id=$1 GROUP BY 1,2`, [org])).rows;
    const llm = (await db.query(`SELECT task, model, count(*)::int n, coalesce(sum(cost_micro_usd),0)::int cost FROM llm_calls WHERE organization_id=$1 GROUP BY 1,2`, [org])).rows;
    out.engine.calls = { provider: calls, llm };

    // yields + recall + loss attribution
    const sdMap = new Map<string, any>(sd.perTruth.map((e) => [e.domain, e]));
    const recall = (list: TruthEntry[], l: (typeof levels)[number]) => pct(list.filter((e) => reached(card.get(e.domain), l)).length, list.length);
    out.metrics = {
      searchRecallStrictPct: pct(sd.perTruth.filter((e) => e.class === "positive" && e.in20).length, POS.length),
      searchRecallLenientPct: pct(sd.perTruth.filter((e) => (e.class === "positive" || e.class === "ambiguous") && e.in20).length, POS.length + AMB.length),
      pipelineRecallStrictPct: Object.fromEntries(levels.map((l) => [l, recall(POS, l)])),
      pipelineRecallLenientPct: Object.fromEntries(levels.map((l) => [l, recall([...POS, ...AMB], l)])),
      verificationYieldPct: pct(counters.verified, counters.discovered), qualificationYieldPct: pct(counters.icpMatch, counters.enriched), readyYieldPct: pct(counters.ready, counters.discovered),
      precisionAtReady: { strictPct: pct(out.engine.precision.ready.positive, readyCards.length), lenientPct: pct(out.engine.precision.ready.positive + out.engine.precision.ready.ambiguous, readyCards.length), notInTruthAwaitingLabel: out.engine.precision.ready.notInTruth },
      negativesQualifiedOrReady: NEG.filter((e) => reached(card.get(e.domain), "icpMatch")).map((e) => e.domain),
      costUsd: view.run.costUsd, costPerReadyUsd: counters.ready ? Math.round((view.run.costUsd / counters.ready) * 1000) / 1000 : null, costPerQualifiedUsd: counters.icpMatch ? Math.round((view.run.costUsd / counters.icpMatch) * 1000) / 1000 : null,
    };
    out.lossAttribution = POS.filter((e) => !reached(card.get(e.domain), "ready")).map((e) => {
      const c = card.get(e.domain); const s = sdMap.get(e.domain);
      let where: string;
      if (!c) where = s?.loss ?? "not discovered";
      else if (c.rejectReason) where = ["poor_fit", "unclear", "not_a_company"].includes(c.rejectReason) ? `qualification: set aside after reading (${c.rejectReason})` : `verification: ${c.rejectReason}`;
      else if (!reached(c, "icpMatch")) where = `qualification: fit ${c.fit?.verdict ?? "none"}`;
      else if (!c.researched) where = "research: not researched (budget or stop)";
      else where = `readiness: researched but not ready (${(c.score?.readyMissing ?? []).join(", ") || "rule"})`;
      return { domain: e.domain, where, stage: stageOf(c) };
    });
    const bucket = (w: string) => w.split(":")[0];
    out.lossSummary = out.lossAttribution.reduce((m: Record<string, number>, x: any) => ((m[bucket(x.where)] = (m[bucket(x.where)] ?? 0) + 1), m), {});
    console.log(JSON.stringify({ metrics: out.metrics, lossSummary: out.lossSummary, reachedPositive: out.engine.reachedPositive, ready: out.engine.ready, decisionMakers: out.engine.decisionMakers, evidence: { ...out.engine.evidence, notFound: undefined } }, null, 1));
    writeFileSync(join(here, "bench", "results", `${STAMP}.json`), JSON.stringify(out, null, 1));
    console.log(`\nwritten script/bench/results/${STAMP}.json`);
  } finally {
    if (!process.env.BENCH_KEEP) {
      const users = (await db.query(`SELECT id, organization_id FROM users WHERE email = $1`, [WHO.email])).rows;
      for (const u of users) {
        const o = u.organization_id; if (o) for (const t of ["prospect_findings", "prospect_run_items", "prospects", "prospect_runs", "provider_calls", "lead_messages", "lead_research", "lead_claims", "lead_tickets", "lead_events", "leads", "client_profiles", "llm_calls", "activity_logs", "invoice_counters", "invitations", "org_roles"]) await db.query(`DELETE FROM ${t} WHERE organization_id=$1`, [o]).catch(() => {});
        await db.query(`DELETE FROM activity_logs WHERE user_id=$1`, [u.id]).catch(() => {}); await db.query(`DELETE FROM agent_sessions WHERE user_id=$1`, [u.id]).catch(() => {});
        await db.query(`DELETE FROM users WHERE id=$1`, [u.id]).catch(() => {}); if (o) await db.query(`DELETE FROM organizations WHERE id=$1`, [o]).catch(() => {});
      }
      console.log("cleaned up the benchmark user and its rows");
    }
    await db.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
