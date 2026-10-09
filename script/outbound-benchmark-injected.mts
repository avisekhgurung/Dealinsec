/**
 * Stage-isolated benchmark: the verified truth companies are handed to the pipeline AS IF a search had returned them
 * (title = the company's name, snippet = a sentence from its own site, url = its website), bypassing only the search.
 * Everything after search is the real thing: real SSRF-safe fetches of the live websites, the real model, the real
 * rules, the real database. This measures verification precision, qualification quality, decision-maker coverage and
 * evidence accuracy separately from search recall (script/outbound-benchmark.mts). Local database only.
 *
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest PORT=3000 npm run dev   (only for the sign-up)
 *   DATABASE_URL=... npx tsx --env-file=.env script/outbound-benchmark-injected.mts
 * The server must be idle (nobody requesting the run) so its runner does not claim it: this script drives the steps itself.
 */
import pg from "pg";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCAL_TEST_DATABASE_URL, requireLocalDatabaseUrl } from "./local-db-guard.ts";

const DATABASE_URL = requireLocalDatabaseUrl("outbound-benchmark-injected.mts");
process.env.DATABASE_URL = DATABASE_URL;
const { domainOf, freshness } = await import("../shared/prospect.ts");
const { quoteInPage } = await import("../shared/research.ts");
const { pipelineDeps, stepRun } = await import("../server/outbound/pipeline.ts");
const svc = await import("../server/outbound/service.ts");
const { outboundStore } = await import("../server/outbound/store.ts");
const { pageReader } = await import("../server/outbound/providers.ts");
const { storage } = await import("../server/storage.ts");

const BASE = "http://localhost:3000";
const here = dirname(fileURLToPath(import.meta.url));
const STAMP = Date.now();
const REQUEST = process.env.BENCH_REQUEST ?? "Find 30 US digital marketing agencies with 5–30 employees that serve SaaS companies.";
const WHO = { email: `e2e-ob-bench-${STAMP}@dealinsec.invalid`, password: `Bench#${STAMP}`, firstName: "Bench", lastName: "Owner" };
type Cls = "positive" | "negative" | "ambiguous" | "unreachable";
interface TruthEntry { domain: string; name: string; website: string; class: Cls; quotes: { agency: { text: string } | null } }
const truth = JSON.parse(readFileSync(join(here, "bench", "truth.json"), "utf8")) as { counts: Record<Cls, number>; entries: TruthEntry[] };
const E = truth.entries; const T = new Map(E.map((e) => [e.domain, e]));
const of = (c: Cls) => E.filter((e) => e.class === c);
const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : null);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function signup() {
  let cookie = "";
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const sc of (res.headers as any).getSetCookie?.() ?? []) { const pair = String(sc).split(";")[0]; if (pair.startsWith("connect.sid=") || !cookie) cookie = pair; }
    const text = await res.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json };
  };
  const r = await call("POST", "/api/auth/signup", WHO);
  if (r.status !== 200 && r.status !== 201) throw new Error(`signup ${r.status}`);
  await call("PATCH", "/api/profile", { onboardingComplete: true, firstName: "Bench" });
  return (await call("GET", "/api/auth/user")).json as { id: string; organizationId: string };
}

async function main() {
  const db = new pg.Client({ connectionString: DATABASE_URL }); await db.connect();
  const me = await signup();
  try {
    const user = (await storage.getUser(me.id)) as any;
    // The search results a good engine would plausibly give: each company once, spread over the planned queries.
    // Two real companies the end-to-end run's own search surfaced and the engine set aside; probed here to see how the fixed rules treat them.
    const EXTRA = [
      { domain: "kunocreative.com", name: "Revenue-Driven Marketing Agency | Kuno Creative", website: "https://kunocreative.com", class: "extra" as const, quotes: { agency: null } },
      { domain: "callboxinc.com", name: "Callbox - Leading B2B Lead Generation Agency", website: "https://callboxinc.com", class: "extra" as const, quotes: { agency: null } },
    ];
    const SET = [...E, ...EXTRA] as (TruthEntry | (typeof EXTRA)[number])[];
    const fixture = (queries: number) => ({
      name: "fixture", label: "Benchmark fixture", paid: false, supportsCountry: false,
      async search(q: string) { const i = fixtureQueries.indexOf(q); return SET.filter((_, k) => k % queries === i).map((e) => ({ title: e.name, url: e.website, snippet: e.quotes.agency?.text?.slice(0, 300) })); },
    });
    const fixtureQueries: string[] = [];
    const parsed = await svc.parseIcp(user, REQUEST);
    if (!parsed.ok) throw new Error(`parseIcp: ${parsed.code}`);
    const icp = { ...parsed.icp, quantity: 50 }; // the largest run, so the budgets (not the size of the set) never decide what gets read
    fixtureQueries.push(...parsed.searches.slice(0, 8));
    const deps = { ...pipelineDeps(), searchProviders: async () => [fixture(fixtureQueries.length) as any], kick: () => {} };
    const started = await svc.startRun(user, { request: REQUEST, icp, searches: fixtureQueries }, {}, deps);
    if (!started.ok) throw new Error(`startRun: ${started.code} ${started.message}`);
    const runId = started.run.id; const t0 = Date.now();
    console.log(`injected run ${runId}: ${E.length} truth companies (+${EXTRA.length} extra probes) over ${fixtureQueries.length} queries (quantity ${icp.quantity})`);
    for (let i = 0; i < 2000; i++) {
      const run = await outboundStore.getRun(me.organizationId, runId);
      if (!run || run.status !== "running") break;
      const state = await stepRun(run, Date.now() + 25_000, deps);
      if (typeof state === "object") await sleep(Math.min(60_000, Math.max(1000, state.wait.getTime() - Date.now())));
      if (i % 15 === 0) console.log(`   ... ${Math.round((Date.now() - t0) / 1000)}s ${run.stage}`);
    }
    const final = await svc.getRun(user, runId);
    if (!final.ok) throw new Error(`getRun ${final.code}`);
    const view = final.run, cards: any[] = final.prospects, counters = view.counters;
    console.log(`finished ${view.status}/${view.stage} in ${Math.round((Date.now() - t0) / 1000)}s, cost $${view.costUsd}, funnel ${JSON.stringify(counters)}`);
    const card = new Map<string, any>(cards.map((c) => [c.domain, c]));
    const SET_ASIDE = ["poor_fit", "unclear", "not_a_company"];
    const reached = (c: any, l: string) => {
      if (!c) return false; const rr = c.rejectReason as string | null;
      if (l === "found") return true;
      if (l === "verified") return !rr || SET_ASIDE.includes(rr) || ["enriched", "done"].includes(c.stage);
      if (l === "enriched") return !!c.fit || SET_ASIDE.includes(rr ?? "");
      if (l === "icpMatch") return !rr && !!c.fit && ["strong", "partial"].includes(c.fit.verdict);
      if (l === "researched") return !!c.researched;
      return !!c.ready;
    };
    const levels = ["found", "verified", "enriched", "icpMatch", "researched", "ready"];
    const cum = (list: TruthEntry[]) => Object.fromEntries(levels.map((l) => [l, list.filter((e) => reached(card.get(e.domain), l)).length]));
    const where = (e: TruthEntry) => { const c = card.get(e.domain); if (!c) return "not_found"; if (c.rejectReason) return `rejected:${c.rejectReason}`; if (c.ready) return "ready"; if (c.researched) return `researched:not_ready(${(c.score?.readyMissing ?? []).join("+") || "rule"})`; return `fit:${c.fit?.verdict ?? c.status}`; };
    const per = E.map((e) => ({ domain: e.domain, class: e.class, outcome: where(e), score: card.get(e.domain)?.score?.total ?? null, person: card.get(e.domain)?.decisionMaker?.value ?? null, whyNow: card.get(e.domain)?.whyNow ? `${card.get(e.domain).whyNow.label} · ${card.get(e.domain).whyNow.freshness}` : null }));

    // evidence: every confirmed quote re-found on the live page by the engine's own reader
    const fnd = (await db.query(`SELECT f.kind, f.status, f.type, f.quote, f.source_url, f.observed_at, p.domain FROM prospect_findings f JOIN prospects p ON p.id=f.prospect_id WHERE f.organization_id=$1`, [me.organizationId])).rows;
    const confirmed = fnd.filter((x) => x.status === "confirmed" && x.quote && x.source_url);
    const reader = pageReader(); const text = new Map<string, string | null>();
    for (const url of Array.from(new Set(confirmed.map((x) => x.source_url as string)))) { try { const p = await reader.read(url); text.set(url, p.ok ? p.text : null); } catch { text.set(url, null); } await sleep(120); }
    const readable = confirmed.filter((x) => text.get(x.source_url) != null);
    const bad = readable.filter((x) => !quoteInPage(x.quote, text.get(x.source_url)!));
    const judgments = fnd.filter((x) => x.kind === "opportunity" || x.type === "pain_point");
    const researched = cards.filter((c) => c.researched);
    const personOf = (d: string) => fnd.some((x) => x.domain === d && x.kind === "decision_maker");
    const sigDated = (d: string) => fnd.some((x) => x.domain === d && x.kind === "signal" && x.status === "confirmed" && x.observed_at && freshness(x.observed_at, new Date()).band !== "stale");
    const POS = of("positive"), AMB = of("ambiguous"), NEG = of("negative");
    const calls = (await db.query(`SELECT task, model, count(*)::int n, coalesce(sum(cost_micro_usd),0)::int micro FROM llm_calls WHERE organization_id=$1 GROUP BY 1,2`, [me.organizationId])).rows;
    const out = {
      stamp: new Date(STAMP).toISOString(), mode: "injected (search bypassed; everything after it real)", request: REQUEST, quantity: icp.quantity, truthCounts: truth.counts, status: view.status, errorCode: view.errorCode,
      seconds: Math.round((Date.now() - t0) / 1000), costUsd: view.costUsd, counters, calls,
      reachedPositive: cum(POS), reachedAmbiguous: cum(AMB), reachedNegative: cum(NEG),
      recallPositivePct: Object.fromEntries(levels.map((l) => [l, pct(cum(POS)[l], POS.length)])),
      lenientRecallPct: Object.fromEntries(levels.map((l) => [l, pct(cum([...POS, ...AMB])[l], POS.length + AMB.length)])),
      negativesQualifiedOrReady: NEG.filter((e) => reached(card.get(e.domain), "icpMatch")).map((e) => e.domain),
      negativesRejectedAtVerifyOrEnrich: NEG.filter((e) => !reached(card.get(e.domain), "icpMatch")).length,
      precisionAtReady: (() => { const r = cards.filter((c) => c.ready); const lab = (c: any) => T.get(c.domain)?.class ?? "not_in_truth"; return { n: r.length, positive: r.filter((c) => lab(c) === "positive").length, ambiguous: r.filter((c) => lab(c) === "ambiguous").length, negative: r.filter((c) => lab(c) === "negative").length, strictPct: pct(r.filter((c) => lab(c) === "positive").length, r.length), lenientPct: pct(r.filter((c) => ["positive", "ambiguous"].includes(lab(c))).length, r.length) }; })(),
      qualifiedByClass: { positive: cum(POS).icpMatch, ambiguous: cum(AMB).icpMatch, negative: cum(NEG).icpMatch },
      decisionMakers: { researched: researched.length, withPerson: researched.filter((c) => personOf(c.domain)).length, pct: pct(researched.filter((c) => personOf(c.domain)).length, researched.length), positivesResearched: POS.filter((e) => card.get(e.domain)?.researched).length, positivesWithPerson: POS.filter((e) => card.get(e.domain)?.researched && personOf(e.domain)).length, readyWithPerson: cards.filter((c) => c.ready && c.decisionMaker).length, ready: cards.filter((c) => c.ready).length },
      datedSignals: { researched: researched.length, withDatedFreshSignal: researched.filter((c) => sigDated(c.domain)).length },
      evidence: { confirmed: confirmed.length, readableNow: readable.length, found: readable.length - bad.length, notFound: bad.length, accuracyPct: pct(readable.length - bad.length, readable.length), judgmentsNeverConfirmed: judgments.every((x) => x.status !== "confirmed"), judgments: judgments.length, notFoundSamples: bad.slice(0, 8).map((x) => ({ domain: x.domain, url: x.source_url, quote: String(x.quote).slice(0, 110) })) },
      perTruth: per.map((p) => ({ ...p, fit: card.get(p.domain)?.fit ? { verdict: card.get(p.domain).fit.verdict, signals: card.get(p.domain).fit.signals.map((x: any) => `${x.key}:${x.status}`).join(" ") } : null, profile: card.get(p.domain)?.profile ?? null, factTypes: fnd.filter((x) => x.domain === p.domain && x.kind === "fact").map((x) => x.type), signalTypes: fnd.filter((x) => x.domain === p.domain && x.kind === "signal").map((x) => `${x.type}${x.observed_at ? "@dated" : "@undated"}`) })),
      extraProbes: EXTRA.map((e) => ({ domain: e.domain, outcome: where(e as any), fit: card.get(e.domain)?.fit ?? null, profile: card.get(e.domain)?.profile ?? null, score: card.get(e.domain)?.score?.total ?? null })),
      readyCards: cards.filter((c) => c.ready).map((c) => ({ domain: c.domain, name: c.name, label: T.get(c.domain)?.class ?? "not_in_truth", score: c.score?.total, whyNow: c.whyNow ? `${c.whyNow.label} ${c.whyNow.freshness}: ${String(c.whyNow.value).slice(0, 90)}` : null, person: c.decisionMaker?.value ?? null })),
    };
    writeFileSync(join(here, "bench", "results", `${STAMP}-injected.json`), JSON.stringify(out, null, 1));
    console.log(JSON.stringify({ recallPositivePct: out.recallPositivePct, lenientRecallPct: out.lenientRecallPct, reachedPositive: out.reachedPositive, reachedAmbiguous: out.reachedAmbiguous, reachedNegative: out.reachedNegative, negativesQualifiedOrReady: out.negativesQualifiedOrReady, precisionAtReady: out.precisionAtReady, decisionMakers: out.decisionMakers, datedSignals: out.datedSignals, evidence: { ...out.evidence, notFoundSamples: undefined }, costUsd: out.costUsd }, null, 1));
    console.log(`written script/bench/results/${STAMP}-injected.json`);
  } finally {
    if (!process.env.BENCH_KEEP) {
      for (const t of ["prospect_findings", "prospect_run_items", "prospects", "prospect_runs", "provider_calls", "lead_messages", "lead_research", "lead_claims", "lead_tickets", "lead_events", "leads", "client_profiles", "llm_calls", "activity_logs", "invoice_counters", "invitations", "org_roles"]) await db.query(`DELETE FROM ${t} WHERE organization_id=$1`, [me.organizationId]).catch(() => {});
      await db.query(`DELETE FROM activity_logs WHERE user_id=$1`, [me.id]).catch(() => {}); await db.query(`DELETE FROM agent_sessions WHERE user_id=$1`, [me.id]).catch(() => {});
      await db.query(`DELETE FROM users WHERE id=$1`, [me.id]).catch(() => {}); await db.query(`DELETE FROM organizations WHERE id=$1`, [me.organizationId]).catch(() => {});
      console.log("cleaned up the benchmark user and its rows");
    }
    await db.end();
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
