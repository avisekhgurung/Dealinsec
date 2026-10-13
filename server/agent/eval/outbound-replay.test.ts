/**
 * Replays one saved AI Outbound run through the real pipeline, offline: the verified companies with their saved search
 * rank, what the model said about each site (saved findings), the run's average tokens per call and the real model
 * budget reservation (tracedChat + the atomic reserve). No search, no model, no network. Skipped unless pointed at a
 * run in the LOCAL test database (the saved evidence names real companies, so it never lives in the repository):
 *
 *   REPLAY_RUN=<run id> REPLAY_RESULTS=script/bench/results/<stamp>.json npx vitest run server/agent/eval/outbound-replay.test.ts
 *
 * It measures allocation (what gets examined and researched before the budget runs out, and what that costs), not
 * readiness: a company that was never researched live has no saved research to replay.
 */
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("../../storage", async () => (await import("./world-mocks")).storageMock());
vi.mock("../../entitlements", async () => (await import("./world-mocks")).entitlementsMock());
vi.mock("../../emails", async () => (await import("./world-mocks")).emailsMock());
vi.mock("../../leads/profile-store", async () => (await import("./world-mocks")).profileStoreMock());
vi.mock("../../discovery/provider", async () => (await import("./world-mocks")).discoveryProviderMock());
vi.mock("../../discovery/usage", async () => (await import("./world-mocks")).discoveryUsageMock());
vi.mock("../../documents/style-store", async () => (await import("./world-mocks")).documentStyleStoreMock());
vi.mock("../../knowledge/store", async () => (await import("./world-mocks")).knowledgeStoreMock());
vi.mock("../../knowledge/net-guard", async (orig) => (await import("./world-mocks")).netGuardMock(orig as () => Promise<any>));
vi.mock("../../leads/store", async () => (await import("./world-mocks")).leadsStoreMock());
vi.mock("../../sales/research-store", async () => (await import("./world-mocks")).researchStoreMock());
vi.mock("../../sales/message-store", async () => (await import("./world-mocks")).messageStoreMock());
vi.mock("../../outbound/store", async () => (await import("./world-mocks")).outboundStoreMock());
vi.mock("../../llm/trace-store", async () => (await import("./world-mocks")).traceStoreMock());
vi.mock("../../routes", async () => (await import("./world-mocks")).routesMock());
vi.mock("../../copilot/provider", async (orig) => (await import("./world-mocks")).scriptedProviderMock(orig as () => Promise<any>));

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import pg from "pg";
import { clearPageCache, pipelineDeps, stepRun, type PipelineDeps } from "../../outbound/pipeline";
import { outboundStore } from "../../outbound/store";
import { useWorld } from "./world-mocks";
import { createWorld, ORG1, type World } from "./world";

const RUN = process.env.REPLAY_RUN, RESULTS = process.env.REPLAY_RESULTS;
const world = () => (globalThis as any).__world as World;
const LOCAL = "postgresql://dealtest@localhost:5544/dealinsec_pdftest";
const filler = (n: number) => "We plan campaigns, write content and report on results every month for every client we work with. ".repeat(n);

interface Saved {
  icp: any; quantity: number; icpCostMicroUsd: number;
  avg: Record<"enrich" | "signals", { in: number; out: number }>;
  companies: { domain: string; name: string; rank: number; label: string; enrich: any[]; research: any[] | null }[];
}

async function load(): Promise<Saved> {
  const db = new pg.Client({ connectionString: LOCAL });
  try { await db.connect(); } catch {
    throw new Error(`the local test database (${LOCAL}) is not running. Start it with:\n  LC_ALL=en_US.UTF-8 pg_ctl -D .pgdata-test -o "-p 5544" -l .pgdata-test/server.log -w start`);
  }
  try {
    const run = (await db.query(`SELECT organization_id, icp, quantity FROM prospect_runs WHERE id=$1`, [RUN])).rows[0];
    const calls = (await db.query(`SELECT task, avg(tokens_in)::float tin, avg(tokens_out)::float tout, sum(cost_micro_usd)::int cost FROM llm_calls WHERE organization_id=$1 GROUP BY task`, [run.organization_id])).rows;
    const avg: any = {}; let icpCost = 0;
    for (const c of calls) { if (c.task === "icp") icpCost = c.cost; else avg[c.task] = { in: Math.round(c.tin), out: Math.round(c.tout) }; }
    // The companies that passed verification: everything that reached the examination step (researched, closed by the stop, or set aside after it).
    const items = (await db.query(`SELECT i.id, i.rank, p.id pid, p.domain, p.name FROM prospect_run_items i JOIN prospects p ON p.id=i.prospect_id
      WHERE i.run_id=$1 AND (i.stage='done' OR i.error_code IN ('poor_fit','unclear','not_a_company')) ORDER BY i.rank DESC, i.id`, [RUN])).rows;
    const labels = new Map<string, string>((JSON.parse(readFileSync(RESULTS!, "utf8")).engine.cards as any[]).map((c) => [c.domain, c.label]));
    const companies = [];
    for (const it of items) {
      const f = (await db.query(`SELECT kind, type, value, quote, status, source_type, batch, meta FROM prospect_findings WHERE prospect_id=$1 ORDER BY id`, [it.pid])).rows;
      const enrich = f.filter((x) => x.batch === "enrich" && x.quote);
      const research = f.filter((x) => x.batch === "research" && x.quote && x.kind !== "opportunity");
      companies.push({ domain: it.domain, name: it.name, rank: it.rank, label: labels.get(it.domain) ?? "not_in_truth", enrich, research: research.length ? research : null });
    }
    return { icp: run.icp, quantity: run.quantity, icpCostMicroUsd: icpCost, avg, companies };
  } finally { await db.end(); }
}

/** One replay at one model budget. Returns what was examined, researched and spent. */
async function replay(s: Saved, budgetUsd: number) {
  useWorld(createWorld()); clearPageCache();
  process.env.LLM_GLOBAL_DAILY_SPEND_USD = String(budgetUsd); process.env.LLM_OUTBOUND_DAILY_SPEND_USD = String(budgetUsd);
  // Today's spend before the run's own calls: the request was read by one call.
  world().llmCalls.push({ id: 1, organizationId: ORG1, task: "icp", model: "replay", ok: true, errorCode: null, costMicroUsd: s.icpCostMicroUsd, tokensIn: 0, tokensOut: 0, createdAt: new Date() });
  const byName = new Map(s.companies.map((c) => [c.name, c]));
  // A site per company: its saved quotes on the home page (dates beside their claims), padded to a real page's length so the
  // reservation estimate (characters / 3) is about what it was live.
  for (const c of s.companies) {
    world().knowledge.dns[c.domain] = ["93.184.216.34"];
    const quotes = [...c.enrich, ...(c.research ?? [])].map((f) => `<p>${f.meta?.dateQuote ? `${f.meta.dateQuote}. ` : ""}${String(f.quote).replace(/</g, " ")}.</p>`).join("");
    for (const x of (process.env.REPLAY_EXTRA_PAGES ?? "about").split(",").filter(Boolean)) world().knowledge.web[`${c.domain}/${x}`] = { status: 200, headers: { "content-type": "text/html" }, body: `<html><head><title>${c.name} ${x}</title></head><body><main><h1>${x}</h1><p>${filler(Number(process.env.REPLAY_FILLER ?? 90))}</p></main></body></html>` };
    world().knowledge.web[`${c.domain}/`] = { status: 200, headers: { "content-type": "text/html" }, body: `<html><head><title>${c.name}</title></head><body><main><h1>${c.name}</h1>${quotes}<p>${filler(Number(process.env.REPLAY_FILLER ?? 90))}</p>${(process.env.REPLAY_EXTRA_PAGES ?? "about").split(",").filter(Boolean).map((x) => `<a href="/${x}">${x}</a>`).join(" ")}</main></body></html>` };
  }
  const calls: { task: string; company: string }[] = [];
  world().llm = async (m: { role: string; content: string }[]) => {
    const sys = m[0].content, user = m[1].content;
    const task = /about the company itself/.test(sys) ? "enrich" : /for a salesperson/.test(sys) ? "signals" : "other";
    const name = (user.match(/Company: <untrusted[^>]*>\n([^\n]+)\n/)?.[1] ?? user.match(/Company: ([^\n]+)/)?.[1] ?? "").trim();
    const c = byName.get(name) ?? Array.from(byName.values()).find((x) => name.startsWith(x.name));
    calls.push({ task, company: c?.domain ?? name });
    const usage = task === "enrich" || task === "signals" ? { inputTokens: s.avg[task].in, outputTokens: s.avg[task].out } : { inputTokens: 0, outputTokens: 0 };
    const out = task === "enrich" ? { facts: (c?.enrich ?? []).map((f) => ({ field: f.type, value: f.value, quote: f.quote, page: 1 })) }
      : task === "signals" ? { findings: (c?.research ?? []).map((f) => f.kind === "signal" ? { kind: "signal", type: f.type, value: f.value, quote: f.quote, page: 1, date_quote: f.meta?.dateQuote ?? undefined }
          : f.kind === "decision_maker" ? { kind: "person", name: f.meta?.name, title: f.meta?.title, employer: c?.name, quote: f.quote, page: 1 }
          : { kind: "pain", value: f.value, quote: f.quote, page: 1 }), opportunities: [] }
      : {};
    return { content: JSON.stringify(out), toolCalls: [], usage };
  };
  // The run as it stood after verification: stage "enrich", every verified company waiting with its saved rank.
  const now = new Date();
  const run = await outboundStore.createRun({ id: "pr_replay", orgId: ORG1, userId: "u1", by: "user", request: "replay", icp: s.icp, quantity: s.quantity, queries: [], idemKey: "replay", now });
  world().outbound.runs[0].stage = "enrich";
  for (const c of s.companies) {
    const p = await outboundStore.upsertProspect(ORG1, { domain: c.domain, name: c.name, website: `https://${c.domain}`, sources: [] }, now);
    await outboundStore.updateProspect(ORG1, p.id, { status: "verified", verifiedAt: now });
    await outboundStore.addRunItem({ runId: run.id, orgId: ORG1, prospectId: p.id, stage: "verified", now });
    world().outbound.items[world().outbound.items.length - 1].rank = c.rank;
  }
  const deps = { ...pipelineDeps(), now: () => now, kick: () => {}, sitemap: async () => [], company: null, contact: null, concurrency: 3, ...(process.env.REPLAY_EARLY_MIN ? { earlyResearchMinMatches: Number(process.env.REPLAY_EARLY_MIN) } : {}), researchDiagnostics: process.env.REPLAY_RESEARCH_DIAGNOSTICS_DIR || null } as PipelineDeps;
  for (let i = 0; i < 300; i++) {
    const r = await outboundStore.getRun(ORG1, run.id);
    if (!r || r.status !== "running") break;
    try { await stepRun(r, Date.now() + 60_000, deps); } catch { /* a crash is retried, like the runner */ }
    for (const it of world().outbound.items) if (it.nextAttemptAt) it.nextAttemptAt = new Date(0);
  }
  const final = (await outboundStore.getRun(ORG1, run.id))!;
  // Research completed = the research step ran for the company (its time is set). Companies never researched live have no
  // saved research to replay, so "with evidence" can only count the ones that were.
  const researched = world().outbound.prospects.filter((p: any) => p.researchedAt).map((p: any) => p.domain);
  const withEvidence = world().outbound.prospects.filter((p: any) => world().outbound.findings.some((f: any) => f.prospectId === p.id && f.batch === "research")).length;
  const llm = world().llmCalls.filter((c: any) => c.task !== "icp");
  const spend = (t: string) => llm.filter((c: any) => c.task === t).reduce((n: number, c: any) => n + c.costMicroUsd, 0) / 1e6;
  const label = new Map(s.companies.map((c) => [c.domain, c.label]));
  const firstResearch = calls.findIndex((x) => x.task === "signals");
  return {
    budgetUsd, status: `${final.status}/${final.errorCode ?? "-"}`,
    examined: calls.filter((x) => x.task === "enrich").length, researchCalls: calls.filter((x) => x.task === "signals").length,
    examinedBeforeFirstResearch: firstResearch < 0 ? null : calls.slice(0, firstResearch).filter((x) => x.task === "enrich").length,
    spendUsd: { examine: +spend("enrich").toFixed(4), research: +spend("signals").toFixed(4), total: +(spend("enrich") + spend("signals") + s.icpCostMicroUsd / 1e6).toFixed(4) },
    researchCompleted: researched.length, researchedWithEvidence: withEvidence, runCounterResearched: (final.counters as any)?.researched ?? 0,
    knownTargetsResearched: `${researched.filter((d) => label.get(d) === "positive").length}/${s.companies.filter((c) => c.label === "positive").length}`,
    researchOrder: calls.filter((x) => x.task === "signals").map((x) => x.company),
    ready: world().outbound.prospects.filter((p: any) => p.ready).map((p: any) => p.domain).sort(),
    // A fingerprint of every saved finding (what research kept, with its dates): equal fingerprints, equal research.
    findingsSig: createHash("sha256").update(world().outbound.findings.map((f: any) => `${f.prospectId}|${f.batch}|${f.kind}|${f.type}|${f.status}|${f.quote}|${f.observedAt ? new Date(f.observedAt).toISOString() : ""}|${f.meta?.datePrecision ?? ""}`).sort().join("\n")).digest("hex").slice(0, 16),
    stuck: world().outbound.items.filter((i: any) => !["done", "rejected", "failed"].includes(i.stage)).length,
    openReservations: world().llmCalls.filter((c: any) => c.errorCode === "reserved").length,
  };
}

describe.skipIf(!RUN || !RESULTS)("replay a saved run (local only)", () => {
  afterAll(() => { delete process.env.LLM_GLOBAL_DAILY_SPEND_USD; delete process.env.LLM_OUTBOUND_DAILY_SPEND_USD; });
  it("allocation at several model budgets", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const s = await load();
    const out = [];
    for (const b of (process.env.REPLAY_BUDGETS ?? "0.05,0.075,0.10,0.15,1").split(",").map(Number)) out.push(await replay(s, b));
    process.stderr.write(`REPLAY ${JSON.stringify({ companies: s.companies.length, avgTokens: s.avg, results: out })}\n`);
    for (const r of out) { expect(r.stuck).toBe(0); expect(r.openReservations).toBe(0); expect(r.runCounterResearched).toBe(r.researchedWithEvidence); }
  }, 120_000);
});
