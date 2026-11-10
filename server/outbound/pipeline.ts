/**
 * The prospecting pipeline: the steps a run goes through, each one idempotent and bounded, cheap before expensive.
 *
 *   search    several queries, through the search adapters; results -> one candidate per company (+ provenance)
 *   rank      words-only pre-rank; existing leads set aside; only the budget's top go on
 *   verify    the company's own home page, through the SSRF-safe reader: real, reachable, theirs
 *   enrich    one model call over home + about/services; only quoted facts kept; fit gate against the ICP
 *   research  careers / news / team / case studies; signals with dates, people with roles, pains, opportunities
 *   finalize  the deterministic score and "ready" rule for every prospect; the run's funnel and cost
 *
 * A step writes its results and its checkpoint (the run item's stage) in ONE transaction (store.saveStep), so a
 * crash redoes at most the slice in flight. The model only ever proposes; shared/prospect-intel.ts decides.
 */
import { randomUUID } from "node:crypto";
import { isSeeded, isOpportunitySourced, byResearchPriority, worthResearchingEarly, rankCandidates, collectCandidates, checkSite, emptyCounters, findingsAsClaims, readiness, runBudget, pickResearchLinks, junkReason, canonicalUrl, domainOf, SIGNAL_LABEL, timingOf, isDecisionMaker, type Provenance, type RejectReason, type RunCounters, type SearchHit, type FindingLike } from "@shared/prospect";
import { MAX_DIRECT_ASKS, MAX_OPPORTUNITY_PROSPECTS, directAskOf, relevantAsks, type DirectAsk } from "@shared/opportunity-sources";
import { contactFormFinding, normalizeEnrichment, normalizeResearch, type FactDraft } from "@shared/prospect-intel";
import { COUNTRIES, countryOfQuery, industryMatched, isSeniorDecisionMaker, prospectFit, type Icp, type ProspectProfile } from "@shared/icp";
import { classifyHiring, knownBigApplies } from "@shared/opportunity-signals";
import { scoreLead } from "@shared/lead-score";
import { pickLinks, sameSite, type ResearchPage, siteHost } from "@shared/research";
import type { ProspectFindingRow, ProspectRow, ProspectRunRow } from "@shared/schema";
import { ProviderError } from "../copilot/provider";
import { parseJsonObject } from "../agent/extraction";
import { DiscoveryError, type DiscoveryProvider, type OpportunitySource } from "../discovery/types";
import { opportunitySources, outboundSearchProviders } from "../discovery/provider";
import { localBusinessProvider, type LocalBusinessProvider } from "../discovery/google-places";
import { localQuery, mapsUrlFor } from "@shared/local-discovery";
import { leadsStore } from "../leads/store";
import { CapExceeded, CapUnavailable, GlobalCapExceeded, WorkspaceBudgetExceeded, remainingToday, tracedChat, type TraceCtx } from "../llm/traced";
import type { ChatMessage } from "../copilot/provider";
import { PROMPT_VERSIONS, SIGNALS_PAGE_CHARS, enrichSystemPrompt, enrichUserMessage, signalsSystemPrompt, signalsUserMessage } from "./prompts";
import { companyProvider, contactProvider, costMicroUsd, pageReader, readSitemap, researchPage, type CompanyEnrichmentProvider, type ContactEnrichmentProvider, type PageRead, type PageReader } from "./providers";
import { outboundStore, type ItemWithProspect, type NewFinding, type OutboundStore } from "./store";
import { dailyCompanyLimit, dailySearchLimit, globalSearchLimit, workspaceMonthlySpendMicroUsd, globalLocalSearchLimit } from "./limits";
import { OUTBOUND_WINDOW_DAYS, type RunMode } from "@shared/outbound-plans";
import { utcDayStart } from "@shared/llm-cost";
import { siteSignals } from "@shared/site-signals";
import { failureCode, retryCode } from "./diagnostics";
import { researchDiagnosticsDir, searchDiagnosticsDir, writeSearchDiagnostic } from "./search-diagnostics";
import { researchDateDiagnostics } from "@shared/research-diagnostics";
import { queryRecord, rankRecord } from "@shared/search-diagnostics";
import type { StepResult } from "../workflow/runner";

export const CACHE_DAYS = 14;
/**
 * What this run is for. A row written before list mode existed, or a test's run object that doesn't set it, is deep —
 * the only kind there used to be — so nothing that already works changes behaviour.
 */
export const runModeOf = (run: { mode?: string | null }): RunMode => (run.mode === "list" ? "list" : "deep");
/**
 * The most companies a run researches in depth: its requested number, which is what it holds of the workspace's
 * researched-prospects allowance (shared/outbound-plans.ts). Enrichment may look at more to find them; research doesn't.
 */
const researchCap = (quantity: number) => Math.min(runBudget(quantity).research, Math.max(1, quantity));
const DAY = 86_400_000;
const MAX_ATTEMPTS = 3;

export interface PipelineDeps {
  store: OutboundStore;
  chat: typeof tracedChat;
  reader: PageReader;
  sitemap: (site: string) => Promise<string[]>;
  searchProviders: () => Promise<DiscoveryProvider[]>;
  company: CompanyEnrichmentProvider | null;
  contact: ContactEnrichmentProvider | null;
  leadByDomain: (orgId: string, domain: string) => Promise<{ id: number } | null>;
  now: () => Date;
  concurrency: number;
  /** Model calls this task may still make today (the allowance is exact even when items run in parallel). */
  allowance: (task: "enrich" | "signals", orgId: string) => Promise<number>;
  /** Wakes the runner after a run starts (tests pass a no-op and drive the steps themselves). */
  kick?: () => void;
  /** False once this worker's lease was lost (a renewal found the run taken over): work stops at the next slice. */
  leaseHeld?: () => boolean;
  /** Explicit ICP points a "partial" company needs to be researched before every site is examined (default 3). */
  earlyResearchMinMatches?: number;
  /** Opt-in search diagnostics: the local directory to write them to (OUTBOUND_SEARCH_DIAGNOSTICS=1), or null (the default, off). */
  searchDiagnostics?: string | null;
  /** Opt-in research date diagnostics: the local directory to write them to (OUTBOUND_RESEARCH_DIAGNOSTICS=1), or null (off). */
  researchDiagnostics?: string | null;
  /** The community demand sources (OPPORTUNITY_SOURCES, Phase 3B). Empty (the default when unset) = no scan. */
  opportunitySources?: () => OpportunitySource[];
  /** The map listings source for the combined search. null (no key, or LOCAL_IN_RADAR=off) = web search alone. */
  localProvider?: () => LocalBusinessProvider | null;
}

/** This worker no longer holds the run (another claimed it, or it was cancelled): stop, write nothing more. */
export class LeaseLost extends Error { constructor(public runId: string) { super("lease lost"); } }
/** The claim number a fenced write must match: the claimed copy carries it; a plain row (tests) falls back to its attempts. */
const fenceOf = (r: ProspectRunRow & { fence?: number }) => r.fence ?? r.attempts;
const holds = (deps: PipelineDeps) => deps.leaseHeld ?? (() => true);
/** A fenced write to the run row; losing the fence stops the step. */
async function writeRun(deps: PipelineDeps, run: ProspectRunRow, set: Partial<ProspectRunRow>): Promise<void> {
  if (!(await deps.store.updateRun(run.id, fenceOf(run), set))) throw new LeaseLost(run.id);
}
export const pipelineDeps = (): PipelineDeps => ({
  store: outboundStore, chat: tracedChat, reader: pageReader(), sitemap: (s) => readSitemap(s), searchProviders: () => outboundSearchProviders(),
  company: companyProvider(), contact: contactProvider(), leadByDomain: (o, d) => leadsStore.findByDomain(o, d), now: () => new Date(), concurrency: 3,
  // One kill switch for the combined search: LOCAL_IN_RADAR=off falls back to the web-only search of before.
  localProvider: () => (String(process.env.LOCAL_IN_RADAR ?? "").trim().toLowerCase() === "off" ? null : localBusinessProvider()),
  allowance: (task, orgId) => remainingToday(task, orgId), searchDiagnostics: searchDiagnosticsDir(), researchDiagnostics: researchDiagnosticsDir(),
  opportunitySources: () => opportunitySources(),
});

/* ── small helpers ──────────────────────────────────────────────────────── */

export interface QueryPlan { q: string; provider: string; done: boolean; ok?: boolean; results?: number; error?: string }
export interface RunCountersExt extends RunCounters {
  searchRejectedBy?: Partial<Record<RejectReason, number>>; costMicroUsd?: number; stoppedBy?: string | null;
  /** The Phase 3B demand scan's outcome, once per run (idempotence marker; an error never fails the run). */
  opportunityScan?: { done: boolean; posts?: number; asks?: number; error?: string };
  /** Posts with no company site: shown read-only on the run ("open the post and reply yourself"). Bounded. */
  directAsks?: DirectAsk[];
  /** The map scan's outcome, once per run (idempotence marker; an error never fails the run). */
  localScan?: { done: boolean; listings?: number; seeded?: number; noWebsite?: number; error?: string };
}

const pageCache = new Map<string, { at: number; page: PageRead }>();
/** Who a page read is for: a paid read (`via`) is recorded against them as a provider call, with its estimated cost. */
interface ReadFor { orgId: string; runId: string | null }
async function readPage(deps: PipelineDeps, url: string, readFor?: ReadFor): Promise<PageRead> {
  const hit = pageCache.get(url);
  if (hit && deps.now().getTime() - hit.at < 30 * 60_000) return hit.page;
  const t0 = Date.now();
  const page = await deps.reader.read(url);
  if (page.via && readFor) {
    await deps.store.recordProviderCall({ ...readFor, provider: page.via, operation: "page", ok: page.ok, errorCode: page.ok ? null : page.code, latencyMs: Date.now() - t0, costMicroUsd: costMicroUsd(page.via), now: deps.now() }).catch(() => {});
  }
  // A failure is never remembered: it is retried after its back-off, and a cached failure would make every retry a no-op.
  if (page.ok) {
    if (pageCache.size > 300) pageCache.delete(pageCache.keys().next().value as string);
    pageCache.set(url, { at: deps.now().getTime(), page });
  }
  return page;
}
/** Test hook: the cache is per process. */
export const clearPageCache = () => pageCache.clear();

async function inSlices<T>(items: T[], n: number, deadline: number, now: () => number, held: () => boolean, runId: string, fn: (x: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += n) {
    if (!held()) throw new LeaseLost(runId);
    if (now() >= deadline) return;
    // Every call in the slice is waited for, even when one stops the run (a budget refusal): the others are already paid for,
    // and what they save must land before the run is finished, never after (measured: 2 researched companies went uncounted).
    const settled = await Promise.allSettled(items.slice(i, i + n).map(fn));
    const failed = settled.find((x): x is PromiseRejectedResult => x.status === "rejected");
    if (failed) throw failed.reason;
  }
}

const fresh = (d: Date | string | null | undefined, now: Date, days = CACHE_DAYS) => !!d && now.getTime() - new Date(d).getTime() < days * DAY;

/**
 * Output budgets. A reasoning model spends part of its output on thinking before it writes the JSON; at 3,000 tokens
 * DeepSeek Flash used all of it and returned NOTHING on real company pages (measured: 2 empty replies in a row on 2 of
 * 3 sites; at 6,000 all succeeded, using up to 5,650). The ceiling is generous because only what is used is paid for.
 */
export const MAX_TOKENS = { enrich: 8000, signals: 8000 } as const;

/** Calls a model, with one retry for an empty or unreadable reply. Returns the parsed object or null. */
async function askJson(deps: PipelineDeps, ctx: TraceCtx, messages: ChatMessage[], maxTokens: number): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await deps.chat(ctx, messages, { maxTokens });
    const raw = parseJsonObject(reply.content);
    if (raw !== null) return raw;
  }
  return null;
}

/** A search whose platform-wide reservation is completed with what really happened (a failure keeps its cost: it may be billed, and it is not retried). */
export async function settledSearch<T>(deps: Pick<PipelineDeps, "store">, id: number, provider: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const settle = (ok: boolean, errorCode: string | null) => deps.store.settleProviderCall(id, { ok, errorCode, latencyMs: Date.now() - t0, costMicroUsd: ok || errorCode !== "auth" ? costMicroUsd(provider) : 0 }).catch(() => {});
  try { const r = await fn(); await settle(true, null); return r; }
  catch (e) { await settle(false, e instanceof DiscoveryError ? e.code : "error"); throw e; }
}

async function trackProvider<T>(deps: PipelineDeps, o: { orgId: string; runId: string | null; provider: string; operation: string }, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    const r = await fn();
    await deps.store.recordProviderCall({ ...o, ok: true, errorCode: null, latencyMs: Date.now() - t0, costMicroUsd: costMicroUsd(o.provider), now: deps.now() }).catch(() => {});
    return r;
  } catch (e) {
    const code = e instanceof DiscoveryError ? e.code : "error";
    await deps.store.recordProviderCall({ ...o, ok: false, errorCode: code, latencyMs: Date.now() - t0, costMicroUsd: code === "auth" ? 0 : costMicroUsd(o.provider), now: deps.now() }).catch(() => {});
    throw e;
  }
}

/** The step an item was in when it failed, from the stage it had reached: found -> verify, verified -> enrich, enriched -> research. */
export const STEP_OF_STAGE: Record<string, string> = { found: "verify", verified: "enrich", enriched: "research" };
/**
 * A transient problem: the item is retried later (with back-off), up to MAX_ATTEMPTS, then marked failed. A failed item
 * keeps WHERE and WHY in its error code ("research:invalid_response", "research:page:unreachable"), never a message (it may hold page text).
 */
async function retryLater(deps: PipelineDeps, item: ItemWithProspect, code: string): Promise<void> {
  const attempts = item.attempts + 1;
  // Codes are shaped to fit their 30-character column (B1: a longer one made the write fail and the run retry forever).
  if (attempts >= MAX_ATTEMPTS) await deps.store.setItem(item.id, { stage: "failed", attempts, errorCode: failureCode(STEP_OF_STAGE[item.stage] ?? item.stage, code), updatedAt: deps.now() });
  else await deps.store.setItem(item.id, { attempts, errorCode: retryCode(code), nextAttemptAt: new Date(deps.now().getTime() + 15_000 * 2 ** attempts), updatedAt: deps.now() });
}
const rejectItem = (deps: PipelineDeps, item: ItemWithProspect, reason: RejectReason) => deps.store.setItem(item.id, { stage: "rejected", errorCode: reason, updatedAt: deps.now() });

/** An unexpected error's type only ("error:TypeError"), never its message. */
const errorType = (e: unknown) => `error:${String((e as Error)?.name ?? "Error").replace(/[^A-Za-z0-9_]/g, "").slice(0, 40) || "Error"}`;

class StopRun extends Error { constructor(public code: string) { super(code); } }
/** The allowance left today; a count that can't be made stops the run (fail closed), it is never retried forever. */
async function allowanceOrStop(deps: PipelineDeps, task: "enrich" | "signals", orgId: string): Promise<number> {
  try { return await deps.allowance(task, orgId); }
  catch (e) { if (e instanceof CapUnavailable) throw new StopRun("cap_unavailable"); throw e; }
}
const classify = (e: unknown): "stop" | "retry" => (e instanceof CapExceeded ? "stop" : "retry");

/* ── the step dispatcher ─────────────────────────────────────────────────── */

export async function stepRun(run: ProspectRunRow, deadline: number, deps: PipelineDeps = pipelineDeps()): Promise<StepResult> {
  const icp = run.icp as Icp;
  try {
    switch (run.stage) {
      case "search": return await searchStep(run, icp, deadline, deps);
      case "verify": return await verifyStep(run, deadline, deps);
      case "enrich": return await enrichStep(run, icp, deadline, deps);
      case "research": return await researchStep(run, icp, deadline, deps);
      case "finalize": return await finalize(run, icp, deps, null);
      // Stage "done" with the run still running: a crash fell between the two writes of an older finish. Finish it again
      // (idempotent), with the outcome it already had.
      default: return await finalize(run, icp, deps, (run.counters as RunCountersExt)?.stoppedBy ?? null);
    }
  } catch (e) {
    if (e instanceof StopRun) return finalize(run, icp, deps, e.code);
    if (e instanceof CapExceeded) return finalize(run, icp, deps, e instanceof GlobalCapExceeded ? "global_limit" : e instanceof WorkspaceBudgetExceeded ? "workspace_budget" : "daily_limit");
    throw e;
  }
}

async function setStage(deps: PipelineDeps, run: ProspectRunRow, stage: string): Promise<void> {
  run.stage = stage;
  await writeRun(deps, run, { stage, updatedAt: deps.now() });
}

/**
 * Everything left is waiting for a retry back-off: report when the first one is due instead of polling. At least 10 s
 * (every re-claim counts against the run) and at most 60 s (a restart or a changed run is noticed within a minute).
 */
async function waitFor(run: ProspectRunRow, stage: string, deps: PipelineDeps): Promise<StepResult> {
  const now = deps.now().getTime();
  const due = (await deps.store.runItems(run.organizationId, run.id)).filter((i) => i.stage === stage && i.nextAttemptAt).map((i) => new Date(i.nextAttemptAt!).getTime()).filter((t) => t > now);
  if (!due.length) return "more";
  return { wait: new Date(Math.min(Math.max(Math.min(...due), now + 10_000), now + 60_000)) };
}

/* ── search ─────────────────────────────────────────────────────────────── */

async function searchStep(run: ProspectRunRow, icp: Icp, deadline: number, deps: PipelineDeps): Promise<StepResult> {
  if (!holds(deps)()) throw new LeaseLost(run.id);
  const plan = run.queries as QueryPlan[];
  const next = plan.find((q) => !q.done);
  const counters: RunCountersExt = { ...emptyCounters(), ...(run.counters as RunCountersExt) };
  // The demand scan (Phase 3B) runs once, before the web queries. Free, no model; a failure is recorded and the
  // ordinary search carries on exactly as before. With no source configured (the default) nothing here runs at all —
  // not even the marker's write — so a deployment without OPPORTUNITY_SOURCES behaves exactly as it did before 3B.
  const scanSources = counters.opportunityScan?.done || !icp.services?.length ? [] : (deps.opportunitySources ?? (() => []))();
  if (scanSources.length) {
    await opportunityScan(run, icp, counters, deps, scanSources);
    await writeRun(deps, run, { counters, updatedAt: deps.now() });
    run.counters = counters;
  }
  if (next) {
    const providers = await deps.searchProviders();
    const provider = providers.find((p) => p.name === next.provider) ?? providers[0];
    const used = await deps.store.countProviderCalls({ orgId: run.organizationId, operation: "search", since: new Date(deps.now().getTime() - DAY) });
    // The platform-wide budget is reserved (atomically, for every workspace together) only after the workspace's own
    // limit passed; a reservation that can't be made because the searches can't be counted stops the run (fail closed).
    let reservation: number | null | "workspace" = null;
    if (provider && used < dailySearchLimit(run.organizationId)) {
      const workspace = { since: new Date(deps.now().getTime() - OUTBOUND_WINDOW_DAYS * DAY), maxMicroUsd: workspaceMonthlySpendMicroUsd(process.env, run.organizationId) };
      try { reservation = await deps.store.reserveSearch({ orgId: run.organizationId, runId: run.id, provider: provider.name, costMicroUsd: costMicroUsd(provider.name), limit: globalSearchLimit(), since: utcDayStart(deps.now()), now: deps.now(), workspace }); }
      catch { throw new StopRun("cap_unavailable"); }
    }
    if (!provider) { next.done = true; next.ok = false; next.error = "not_configured"; }
    else if (reservation === "workspace") { for (const q of plan) if (!q.done) { q.done = true; q.ok = false; q.error = "workspace_budget"; } counters.stoppedBy = "workspace_budget"; }
    else if (used >= dailySearchLimit(run.organizationId)) { for (const q of plan) if (!q.done) { q.done = true; q.ok = false; q.error = "daily_limit"; } counters.stoppedBy = "daily_limit"; }
    else if (reservation === null) { for (const q of plan) if (!q.done) { q.done = true; q.ok = false; q.error = "global_limit"; } counters.stoppedBy = "global_limit"; }
    else {
      const budget = runBudget(run.quantity);
      try {
        const results = await settledSearch(deps, reservation, provider.name, () =>
          provider.search(next.q, { count: budget.resultsPerQuery, country: provider.supportsCountry ? countryOfQuery(next.q, icp) : undefined }));
        const at = deps.now().toISOString();
        const hits: SearchHit[] = results.map((r) => ({ ...r, provider: provider.name, query: next.q, at }));
        const { candidates, rejected, decisions } = collectCandidates(hits, icp);
        if (deps.searchDiagnostics) await writeSearchDiagnostic(deps.searchDiagnostics, run.id, queryRecord(plan.indexOf(next), next.q, provider.name, results, decisions));
        for (const c of candidates) {
          const p = await deps.store.upsertProspect(run.organizationId, c, deps.now());
          await deps.store.addRunItem({ runId: run.id, orgId: run.organizationId, prospectId: p.id, stage: "found", now: deps.now() });
        }
        counters.searched += 1; counters.results += results.length;
        counters.searchRejectedBy = { ...(counters.searchRejectedBy ?? {}) };
        for (const r of rejected) counters.searchRejectedBy[r.reason] = (counters.searchRejectedBy[r.reason] ?? 0) + 1;
        next.done = true; next.ok = true; next.results = results.length;
      } catch (e) {
        // Billed searches are not retried; a failed query is recorded and the run carries on with the others. A failure that
        // is not the provider's own answer keeps its type (never its message, which could hold page text) so it is visible.
        next.done = true; next.ok = false; next.error = e instanceof DiscoveryError ? e.code : `error:${String((e as Error)?.name ?? "unknown").slice(0, 20)}`;
        if (deps.searchDiagnostics) await writeSearchDiagnostic(deps.searchDiagnostics, run.id, queryRecord(plan.indexOf(next), next.q, provider.name, [], [], next.error));
        console.log(JSON.stringify({ kind: "outbound_search_failed", provider: provider.name, errorType: e instanceof DiscoveryError ? e.code : (e as Error)?.name ?? "unknown" }));
      }
    }
    await writeRun(deps, run, { queries: plan, counters, updatedAt: deps.now() });
    run.queries = plan; run.counters = counters;
    if (plan.some((q) => !q.done)) return "more";
  }
  // The map half of the combined search, spent only as a FALLBACK (the rule Firecrawl already follows). Every web
  // query is done by the time we get here, so we know whether they filled the request. Google's Places Text Search is
  // the most expensive single call this engine makes — $35 per 1,000 beyond the first 1,000 a month, and that free
  // thousand is shared by every workspace with the manual local search — so it is spent only when the web half came
  // up short of the companies the person asked for. That is exactly when local businesses the web doesn't rank are
  // the missing recall; on a search the web already filled, it never runs and costs nothing.
  // Once per run: the marker survives a checkpoint (computeCounters keeps it), so a resumed run never scans twice.
  if (!counters.localScan?.done && plan.every((q) => q.done)) {
    const found = (await deps.store.runItems(run.organizationId, run.id)).filter((i) => i.stage === "found").length;
    if (found < run.quantity) {
      await localScan(run, icp, counters, deps);
      await writeRun(deps, run, { counters, updatedAt: deps.now() });
      run.counters = counters;
    }
  }
  return rankStep(run, icp, deps);
}

/**
 * The map half of the combined search.
 *
 * Google's terms do not allow a listing's content to be stored or sent to a model, so nothing of the listing is kept
 * except the one thing that is not its content: the website it points at, plus the place ID as provenance. The
 * company's NAME is its domain until the pipeline reads the site itself — exactly what researchLocalSites does for a
 * listing the person picks by hand (server/outbound/local-search.ts). Everything after this point is the ordinary
 * pipeline reading the company's own website, so every fact still comes from the company, never from the listing.
 *
 * A listing with no website is not seeded: there is nothing to research. Those remain the manual flow, where the
 * person names the business themselves.
 */
export async function localScan(run: Pick<ProspectRunRow, "id" | "organizationId">, icp: Icp, counters: RunCountersExt, deps: PipelineDeps, from?: LocalBusinessProvider | null): Promise<void> {
  const scan: NonNullable<RunCountersExt["localScan"]> = { done: true };
  counters.localScan = scan;
  const provider = from !== undefined ? from : (deps.localProvider ?? (() => null))();
  const city = icp.locations?.[0]?.trim(), regionCode = icp.countries?.[0]?.trim();
  // No source, nowhere to look it up, or no country to look it up in: the web search alone, as before.
  if (!provider || !city || !regionCode || !icp.industry?.trim()) { scan.done = true; return; }
  const now = deps.now(), orgId = run.organizationId;
  try {
    const reservation = await deps.store.reserveSearch({
      orgId, runId: run.id, provider: provider.name, costMicroUsd: costMicroUsd(provider.name),
      limit: globalLocalSearchLimit(), since: utcDayStart(now), now,
      workspace: { since: new Date(now.getTime() - OUTBOUND_WINDOW_DAYS * DAY), maxMicroUsd: workspaceMonthlySpendMicroUsd(process.env, orgId) },
    });
    // Out of the platform's daily map budget, or the workspace's ceiling: skip the map half, keep the web search.
    if (reservation === null || reservation === "workspace") { scan.error = reservation === null ? "global_limit" : "workspace_budget"; return; }
    const listings = await settledSearch(deps, reservation, provider.name, () =>
      provider.searchText(localQuery({ category: icp.industry, city }), { regionCode, pageSize: 20 }));
    scan.listings = listings.length;
    let seeded = 0, noWebsite = 0;
    const seen = new Set<string>();
    for (const l of listings) {
      if (!l.website) { noWebsite += 1; continue; }
      let domain = "";
      try { const u = new URL(l.website); if (u.protocol === "http:" || u.protocol === "https:") domain = siteHost(u.hostname); } catch { domain = ""; }
      if (!domain || !domain.includes(".") || seen.has(domain)) continue;
      seen.add(domain);
      // name = the domain, never the listing's name; url = the place link, never its address or phone.
      const p = await deps.store.upsertProspect(orgId, {
        domain, name: domain, website: `https://${domain}/`,
        sources: [{ provider: "google_places", query: "", url: mapsUrlFor(l.placeId), title: "", at: now.toISOString(), placeId: l.placeId }],
      }, now);
      await deps.store.addRunItem({ runId: run.id, orgId, prospectId: p.id, stage: "found", now });
      seeded += 1;
    }
    scan.seeded = seeded; scan.noWebsite = noWebsite;
  } catch (e) {
    // Never the message, which could carry listing text: only the type, so the failure is visible and nothing leaks.
    scan.error = e instanceof DiscoveryError ? e.code : `error:${String((e as Error)?.name ?? "unknown").slice(0, 20)}`;
    console.log(JSON.stringify({ kind: "outbound_local_scan_failed", errorType: scan.error }));
  }
}

/**
 * The Phase 3B demand scan: posts from community sources (people asking for the person's services), matched to the
 * ICP by plain rules. A post that links a company site seeds that site into the ordinary pipeline — carrying the
 * post as a confirmed, dated outside-help HIRING signal (batch "opportunity"; saveStep's replace-by-batch makes a
 * re-run exact, never a duplicate) — and the rest are kept as read-only direct asks on the run. Runs only when the
 * ICP has services AND a source is configured (OPPORTUNITY_SOURCES); otherwise it marks itself done and changes
 * nothing. A source failure is recorded in the marker and never stops the run.
 */
export async function opportunityScan(run: Pick<ProspectRunRow, "id" | "organizationId">, icp: Icp, counters: RunCountersExt, deps: PipelineDeps, from?: OpportunitySource[]): Promise<void> {
  const scan: NonNullable<RunCountersExt["opportunityScan"]> = { done: true };
  counters.opportunityScan = scan;
  const sources = from ?? (deps.opportunitySources ?? (() => []))();
  if (!sources.length || !(icp.services?.length)) return;
  const orgId = run.organizationId, now = deps.now();
  for (const src of sources.slice(0, 2)) {
    try {
      const posts = await trackProvider(deps, { orgId, runId: run.id, provider: src.name, operation: "opportunity" }, () => src.scan());
      const asks: DirectAsk[] = [];
      let seeded = 0;
      for (const post of relevantAsks(posts, icp)) {
        const url = post.companyUrl ? canonicalUrl(post.companyUrl) : null;
        const domain = url ? domainOf(url) : null;
        const why = url && domain ? junkReason({ url, title: "", snippet: post.text.slice(0, 300) }, icp.exclusions) : null;
        if (url && domain && !why && seeded < MAX_OPPORTUNITY_PROSPECTS) {
          // The post's own link seeds its company; the home page gives the name (verifyOne), as a listing's site does.
          const prov: Provenance = { provider: src.name, query: post.threadTitle.slice(0, 120), url, title: post.title.slice(0, 200), snippet: post.text.slice(0, 300), at: now.toISOString() };
          const p = await deps.store.upsertProspect(orgId, { domain, name: domain, website: `https://${domain}`, sources: [prov] }, now);
          await deps.store.addRunItem({ runId: run.id, orgId, prospectId: p.id, stage: "found", now });
          // The ask itself is the evidence: the post's words, its own date, a link to it. 3A's scoring reads
          // hiringKind "outside_help" as the real buying signal it is.
          await deps.store.saveStep({ orgId, prospectId: p.id, batch: "opportunity", now, findings: [{
            kind: "signal", type: "HIRING", value: post.title.slice(0, 400) || post.text.slice(0, 400), status: "confirmed",
            sourceUrl: post.url, sourceType: "post", quote: post.text.slice(0, 500), observedAt: post.postedAt ? new Date(post.postedAt) : null,
            confidence: "high", meta: { hiringKind: "outside_help", datePrecision: post.postedAt ? "day" : null, dateSource: "api", label: SIGNAL_LABEL.HIRING, source: src.name, thread: post.threadTitle.slice(0, 120) },
          }] });
          seeded++;
        } else if (asks.length < MAX_DIRECT_ASKS) asks.push(directAskOf(post));
      }
      scan.posts = (scan.posts ?? 0) + seeded;
      counters.directAsks = [...(counters.directAsks ?? []), ...asks].slice(0, MAX_DIRECT_ASKS);
      scan.asks = counters.directAsks.length;
    } catch (e) {
      scan.error = e instanceof DiscoveryError ? e.code : "error";
      console.log(JSON.stringify({ kind: "outbound_opportunity_scan_failed", source: src.name, errorType: scan.error }));
    }
  }
}

async function rankStep(run: ProspectRunRow, icp: Icp, deps: PipelineDeps): Promise<StepResult> {
  const plan = run.queries as QueryPlan[];
  const items = await deps.store.runItems(run.organizationId, run.id);
  if (!items.length) {
    const code = plan.length && plan.every((q) => !q.ok) ? (plan.some((q) => q.error === "global_limit") ? "global_limit" : plan.some((q) => q.error === "workspace_budget") ? "workspace_budget" : plan.some((q) => q.error === "daily_limit") ? "daily_limit" : "search_unavailable") : null;
    return finalize(run, icp, deps, code);
  }
  const budget = runBudget(run.quantity);
  const found = [];
  for (const i of items.filter((x) => x.stage === "found")) {
    const candidate = { domain: i.prospect.domain, name: i.prospect.name, website: i.prospect.website, sources: (i.prospect.sources as any[]) ?? [], rank: 0 };
    found.push({ i, order: i.id, candidate, isLead: !!i.prospect.leadId || !!(await deps.leadByDomain(run.organizationId, i.prospect.domain)) });
  }
  // A website the person chose from a local listing — or one a demand post explicitly linked — is checked whatever
  // its words say: it is there by a choice or a link, not because a web search matched it (rankCandidates' relevance
  // test is for search results).
  const seeded = found.filter((x) => (isSeeded(x.candidate.sources) || isOpportunitySourced(x.candidate.sources)) && !x.isLead);
  const ranked = [
    ...seeded.map((x) => ({ ...x, score: 1, rel: 1, outcome: "keep" as const })),
    ...rankCandidates(found.filter((x) => !seeded.includes(x)), icp, Math.max(0, budget.verify - seeded.length)),
  ];
  for (const r of ranked) {
    if (r.outcome === "keep") await deps.store.setItem(r.i.id, { rank: r.score, updatedAt: deps.now() });
    else await deps.store.setItem(r.i.id, { rank: r.score, stage: "rejected", errorCode: r.outcome, updatedAt: deps.now() });
  }
  if (deps.searchDiagnostics) await writeSearchDiagnostic(deps.searchDiagnostics, run.id, rankRecord(ranked.map((r) => ({ domain: r.candidate.domain, sources: r.candidate.sources, score: r.score, rel: r.rel, outcome: r.outcome })), plan));
  await setStage(deps, run, "verify");
  return "more";
}

/* ── verify ─────────────────────────────────────────────────────────────── */

async function verifyStep(run: ProspectRunRow, deadline: number, deps: PipelineDeps): Promise<StepResult> {
  const batch = await deps.store.itemsAt(run.id, "found", deps.concurrency * 2, deps.now());
  if (!batch.length) {
    if ((await deps.store.itemsAt(run.id, "found", 1, new Date(deps.now().getTime() + 365 * DAY))).length) return waitFor(run, "found", deps); // waiting on a retry
    // A list sweep ends here, by design: checking the company's own home page is the last step that costs no model
    // call. Everything past this point (enrich, research, score) is spent one company at a time, when the person
    // asks for it (service.researchProspect), not on all of them up front.
    await setStage(deps, run, runModeOf(run) === "list" ? "finalize" : "enrich");
    return "more";
  }
  await inSlices(batch, deps.concurrency, deadline, () => Date.now(), holds(deps), run.id, (item) => verifyOne(run, item, deps));
  return "more";
}

async function verifyOne(run: ProspectRunRow, item: ItemWithProspect, deps: PipelineDeps): Promise<void> {
  const p = item.prospect, now = deps.now();
  // Checked recently (by this or another run): reuse the verdict instead of fetching again.
  if (fresh(p.verifiedAt, now) && p.status !== "candidate") {
    if (p.status === "rejected") return void (await rejectItem(deps, item, (p.rejectReason as RejectReason) ?? "unreachable"));
    return void (await deps.store.setItem(item.id, { stage: "verified", updatedAt: now }));
  }
  let page: PageRead;
  try { page = await readPage(deps, `https://${p.domain}/`, { orgId: run.organizationId, runId: run.id }); }
  catch { return void (await retryLater(deps, item, "page_error")); }
  let reason: RejectReason | null = null;
  if (!page.ok) reason = page.code === "not_html" ? "not_html" : page.code === "robots" ? "robots_disallowed" : "unreachable";
  else if (!sameSite(new URL(page.url).hostname, p.domain) && !new URL(page.url).hostname.endsWith(`.${p.domain}`)) reason = "offsite_redirect";
  else {
    const c = checkSite({ name: p.name, domain: p.domain }, page);
    // A site a listing linked to is that business's own — and a site a demand post linked carries the post's words as
    // its stand-in name: a missing name match isn't a reason to set either aside. Parked and thin sites still are.
    if (!c.ok && !(c.reason === "no_identity" && (isSeeded(p.sources) || isOpportunitySourced(p.sources)))) reason = c.reason!;
  }
  if (reason === "unreachable" && item.attempts < 1) return void (await retryLater(deps, item, "unreachable"));
  if (reason) {
    await deps.store.updateProspect(run.organizationId, p.id, { status: "rejected", rejectReason: reason, verifiedAt: now, updatedAt: now });
    return void (await rejectItem(deps, item, reason));
  }
  // What the home page's own markup shows (a missing mobile viewport tag, an old copyright year): saved as observations
  // with their source and date, replacing the last check's. Never a judgement that they need a new website.
  const read = page as Extract<PageRead, { ok: true }>; // verified above: the page was read
  const signals = siteSignals(read.site, now);
  if (read.site) {
    await deps.store.saveStep({ orgId: run.organizationId, prospectId: p.id, batch: "site_check", now, findings: signals.map((x) => ({
      kind: "fact", type: "site_signal", value: x.value, status: "confirmed", sourceUrl: read.url, sourceType: "website", quote: x.quote ?? null,
      contentHash: read.hash, confidence: "high", meta: { signal: x.signal, ...(x.year ? { year: x.year } : {}) },
    })) });
  }
  // A prospect known only by its domain (chosen from a listing) takes its name from its own home page's title.
  const ownName = p.name === p.domain ? nameFromTitle(read.title) : null;
  await deps.store.updateProspect(run.organizationId, p.id, { status: p.status === "candidate" || p.status === "rejected" ? "verified" : p.status, rejectReason: null, verifiedAt: now, contentHash: (page as any).hash, updatedAt: now, ...(ownName ? { name: ownName } : {}) });
  await deps.store.setItem(item.id, { stage: "verified", updatedAt: now });
}

/** A business's name from its home page title: the part before " | ", " – " or " - " (the brand usually comes first). */
export function nameFromTitle(title: string): string | null {
  const first = String(title ?? "").split(/\s+[|–—-]\s+|\s*\|\s*/)[0].replace(/\s+/g, " ").trim();
  return first.length >= 2 && first.length <= 120 && !/^(home|homepage|welcome|index)$/i.test(first) ? first : null;
}

/* ── enrich + fit gate ──────────────────────────────────────────────────── */

const LABELS: Record<string, string> = { description: "What it does", services: "Services", industry: "Industry", location: "Location", country: "Country", team_size: "Team size", target_customers: "Who they serve", business_email: "Business email", business_phone: "Phone", contact_form: "Contact page" };

/** The structured profile from enrichment facts (website first, provider data only to fill gaps). */
export function profileFrom(name: string, facts: Pick<ProspectFindingRow, "type" | "value" | "sourceType" | "id">[]): Record<string, { value: string; source: string; findingId: number }> & { name?: never } {
  const out: Record<string, { value: string; source: string; findingId: number }> = {};
  for (const f of facts) {
    const cur = out[f.type];
    if (!cur || (cur.source !== "website" && f.sourceType === "website")) out[f.type] = { value: f.value, source: f.sourceType === "website" ? "website" : String(f.sourceType), findingId: f.id };
  }
  return out as any;
}
export const flatProfile = (name: string, profile: Record<string, { value: string } | undefined>, domain?: string): ProspectProfile => ({
  name, domain: domain ?? null, industry: profile.industry?.value ?? null, description: profile.description?.value ?? null, services: profile.services?.value ?? null,
  location: profile.location?.value ?? null, country: profile.country?.value ?? null, employees: profile.team_size?.value ?? null, targetCustomers: profile.target_customers?.value ?? null,
});

async function enrichStep(run: ProspectRunRow, icp: Icp, deadline: number, deps: PipelineDeps): Promise<StepResult> {
  const budget = runBudget(run.quantity);
  const all = await deps.store.runItems(run.organizationId, run.id);
  // Interleaving: a company its site shows to be a clear match is researched now, before the remaining sites are examined
  // (measured: examining all 16 sites first took $0.059 of a $0.10 budget, and any budget under $0.075 researched nothing).
  if (await researchEarly(run, icp, deadline, deps, all)) return "more";
  const done = all.filter((i) => ["enriched", "done"].includes(i.stage) || (i.stage === "rejected" && ["poor_fit", "unclear", "not_a_company"].includes(i.errorCode ?? ""))).length;
  // One slice per step (not two): after every few sites the step above can research what they turned up.
  const batch = await deps.store.itemsAt(run.id, "verified", deps.concurrency, deps.now());
  if (!batch.length) {
    if ((await deps.store.itemsAt(run.id, "verified", 1, new Date(deps.now().getTime() + 365 * DAY))).length) return waitFor(run, "verified", deps);
    await setStage(deps, run, "research");
    return "more";
  }
  const room = Math.max(0, budget.enrich - done);
  for (const item of batch.slice(room)) await rejectItem(deps, item, "budget");
  const todo = batch.slice(0, room);
  if (!todo.length) return "more";
  const left = await allowanceOrStop(deps, "enrich", run.organizationId);
  if (left <= 0) throw new StopRun("daily_limit");
  await inSlices(todo.slice(0, left), Math.min(deps.concurrency, left), deadline, () => Date.now(), holds(deps), run.id, (item) => enrichOne(run, icp, item, deps));
  return "more";
}

/**
 * Researches the clearest matches examined so far (worthResearchingEarly), best first (byResearchPriority), within the
 * run's research budget and today's allowance. False when there is nothing to do now, so the step examines more sites
 * instead: no clear match yet, a retry not yet due, no research room left, or no research allowance today (the sites
 * are still examined, as before; the research stage then stops the run as it always has).
 */
async function researchEarly(run: ProspectRunRow, icp: Icp, deadline: number, deps: PipelineDeps, all: ItemWithProspect[]): Promise<boolean> {
  const room = Math.max(0, researchCap(run.quantity) - all.filter((i) => i.stage === "done").length);
  if (room === 0) return false;
  const now = deps.now();
  const ready = all.filter((i) => i.stage === "enriched" && (!i.nextAttemptAt || new Date(i.nextAttemptAt) <= now) && worthResearchingEarly(i.prospect.fit as any, deps.earlyResearchMinMatches))
    .sort((a, b) => byResearchPriority({ rank: a.rank, fit: a.prospect.fit as any }, { rank: b.rank, fit: b.prospect.fit as any }));
  if (!ready.length) return false;
  const left = await allowanceOrStop(deps, "signals", run.organizationId);
  if (left <= 0) return false;
  await inSlices(ready.slice(0, Math.min(room, deps.concurrency, left)), deps.concurrency, deadline, () => Date.now(), holds(deps), run.id, async (item) => { await researchOne(run, icp, item, deps); });
  return true;
}

export async function enrichOne(run: Pick<ProspectRunRow, "id" | "organizationId" | "createdByUser">, icp: Icp, item: ItemWithProspect | null, deps: PipelineDeps, p0?: ProspectRow): Promise<void> {
  const p = item?.prospect ?? p0!, now = deps.now(), orgId = run.organizationId;
  try {
    const existing = await deps.store.findings(orgId, p.id);
    let facts = existing.filter((f) => f.batch === "enrich" || f.batch === "company");
    // A seeding demand post (Phase 3B, batch "opportunity") reaches the fit gate: its ask for outside help is the
    // known-big rule's override, so a bigger company that asked for exactly this work is not set aside here.
    const posts = existing.filter((f) => f.batch === "opportunity").map((f) => ({ kind: f.kind, type: f.type, value: f.value, status: f.status, meta: f.meta as Record<string, unknown> | null }));
    if (!(facts.some((f) => f.batch === "enrich" && fresh(f.retrievedAt, now)) || (fresh(p.researchedAt, now) && facts.length))) {
      const readFor = { orgId, runId: run.id };
      const home = await readPage(deps, `https://${p.domain}/`, readFor);
      if (!home.ok) { if (item) await retryLater(deps, item, `page_error:${home.code}`); return; }
      const extra = pickLinks(home.links, new URL(home.url), 2);
      const others = await Promise.all(extra.map((u) => readPage(deps, u, readFor)));
      const pages: ResearchPage[] = [home, ...others].filter((x): x is Extract<PageRead, { ok: true }> => x.ok && sameSite(new URL(x.url).hostname, p.domain)).map((x, i) => ({ index: i + 1, url: x.url, text: x.text }));
      const raw = await askJson(deps, { task: "enrich", orgId, userId: run.createdByUser, runId: run.id, promptVersion: PROMPT_VERSIONS.enrich },
        [{ role: "system", content: enrichSystemPrompt() }, { role: "user", content: enrichUserMessage(p.name, pages) }], MAX_TOKENS.enrich);
      // No answer at all is a failed call to retry, never "this company says nothing" (which sets it aside for good).
      if (raw === null) throw new ProviderError("invalid_response", "empty_output");
      const n = normalizeEnrichment(raw, pages, p.domain);
      const drafts: NewFinding[] = n.facts.map((f: FactDraft) => ({ kind: "fact", type: f.field, value: f.value, status: "confirmed", sourceUrl: f.url, sourceType: "website", quote: f.quote, contentHash: (home as any).hash, confidence: "high" }));
      // A contact form the MODEL reports is only a way in when the page reader saw a real form on that exact page of the site
      // (a "Contact Us" link or a contact-page address is not one; measured: a menu link was offered as a form). Otherwise it is
      // kept as a guess, with why. Email and person routes are judged on their own.
      const read = [home, ...others].filter((x): x is Extract<PageRead, { ok: true }> => x.ok && sameSite(new URL(x.url).hostname, p.domain));
      for (const d of drafts.filter((f) => f.type === "contact_form")) {
        const check = await confirmForm(deps, d.value, read, p.domain, { orgId, runId: run.id });
        if (check === "ok") d.meta = { formConfirmed: true };
        else { d.status = "inferred"; d.confidence = "low"; d.meta = { formConfirmed: false, formCheck: check }; }
      }
      // The model often skips a contact form. Code checks for one on the pages already read: a contact page of this site that
      // holds a real form, quoted from that page. (Measured: 7 of 37 not-ready companies lacked only a contact route.)
      if (!drafts.some((f) => f.type === "contact_form" && f.status === "confirmed")) {
        const form = read.map((x) => contactFormFinding(x, p.domain)).find((x) => x);
        if (form) {
          for (let i = drafts.length - 1; i >= 0; i--) if (drafts[i].type === "contact_form") drafts.splice(i, 1); // the confirmed one replaces the guess
          drafts.push({ kind: "fact", type: "contact_form", value: form.value, status: "confirmed", sourceUrl: form.url, sourceType: "website", quote: form.quote, contentHash: (home as any).hash, confidence: "high", meta: { detectedBy: "form", formConfirmed: true } });
        }
      }
      facts = await deps.store.saveStep({ orgId, prospectId: p.id, batch: "enrich", findings: drafts, now });
      // Firmographics from a data provider fill gaps. They are a third party's estimate: inferred, never "confirmed".
      if (deps.company) {
        try {
          // Its own daily allowance, counted from the database; a count that can't be made skips the provider (fail closed).
          if ((await deps.store.countProviderCalls({ orgId, operation: "company", since: new Date(now.getTime() - DAY) })) >= dailyCompanyLimit(orgId)) throw new Error("company_allowance");
          const c = await trackProvider(deps, { orgId, runId: run.id, provider: deps.company.name, operation: "company" }, () => deps.company!.enrich(p.domain));
          if (c) {
            const pf: NewFinding[] = [];
            const add = (type: string, value?: string) => { if (value) pf.push({ kind: "fact", type, value, status: "inferred", sourceUrl: c.sourceUrl ?? null, sourceType: "provider", quote: null, confidence: "medium", meta: { provider: deps.company!.name } }); };
            add("team_size", c.employees); add("industry", c.industry); add("location", c.location);
            // Apollo gives a full name ("United States"); a two-letter code is accepted too. Anything else is left out.
            const code = c.country && /^[A-Za-z]{2}$/.test(c.country) ? c.country.toUpperCase() : c.country ? COUNTRIES[c.country.trim().toLowerCase()] : undefined; add("country", code);
            facts = [...facts, ...(await deps.store.saveStep({ orgId, prospectId: p.id, batch: "company", findings: pf, now }))];
          }
        } catch { /* a provider problem never blocks the run; the call is recorded */ }
      }
    }
    const profile = profileFrom(p.name, facts);
    const fit = prospectFit(icp, flatProfile(p.name, profile, p.domain), { findings: posts });
    // Deeper work only for a business that is known to be the kind you asked for. Something else (a directory, a
    // publication, an institution) or not being able to tell what it does is set aside, with the reason.
    const nonBusiness = !!profile.business_type && profile.business_type.value !== "business" && profile.business_type.value !== "other";
    const why: RejectReason | null = nonBusiness ? "not_a_company" : fit.verdict === "excluded" || fit.verdict === "weak" ? "poor_fit" : !industryMatched(fit) ? "unclear" : null;
    await deps.store.updateProspect(orgId, p.id, { profile, fit, status: p.status === "ready" || p.status === "qualified" ? p.status : "enriched", updatedAt: now });
    if (item) await deps.store.setItem(item.id, why ? { stage: "rejected", errorCode: why, updatedAt: now } : { stage: "enriched", updatedAt: now });
  } catch (e) {
    if (classify(e) === "stop" || !item) throw e;
    await retryLater(deps, item, e instanceof ProviderError ? e.code : e instanceof CapUnavailable ? "cap_unavailable" : errorType(e));
  }
}

/** One spelling per page for comparing addresses: host without www, path without a trailing slash. */
const pageKey = (u: string) => { try { const x = new URL(u); return `${x.hostname.replace(/^www\./, "").toLowerCase()}${x.pathname.replace(/\/+$/, "") || "/"}`; } catch { return ""; } };
/**
 * Whether a page the model called a contact form really holds one: the page already read, or read now (one more fetch, no
 * model call); "unreadable" when it can't be read or leaves the site, "no_form" when the reader saw no contact form on it.
 */
export async function confirmForm(deps: Pick<PipelineDeps, "reader" | "now">, url: string, read: Extract<PageRead, { ok: true }>[], domain: string, readFor?: ReadFor): Promise<"ok" | "no_form" | "unreadable"> {
  const key = pageKey(url);
  if (!key) return "unreadable";
  let page = read.find((x) => pageKey(x.url) === key);
  if (!page) {
    const r = await readPage(deps as PipelineDeps, url, readFor).catch(() => null);
    if (!r || !r.ok || !sameSite(new URL(r.url).hostname, domain)) return "unreadable";
    page = r;
  }
  return page.hasForm === true ? "ok" : "no_form";
}

/* ── research: why now, who, what ───────────────────────────────────────── */

async function researchStep(run: ProspectRunRow, icp: Icp, deadline: number, deps: PipelineDeps): Promise<StepResult> {
  const budget = runBudget(run.quantity);
  const all = await deps.store.runItems(run.organizationId, run.id);
  const researched = all.filter((i) => i.stage === "done").length;
  const waiting = all.filter((i) => i.stage === "enriched");
  const dueNow = waiting.filter((i) => !i.nextAttemptAt || new Date(i.nextAttemptAt) <= deps.now())
    .sort((a, b) => byResearchPriority({ rank: a.rank, fit: a.prospect.fit as any }, { rank: b.rank, fit: b.prospect.fit as any }));
  if (!waiting.length) return finalize(run, icp, deps, null);
  if (!dueNow.length) return waitFor(run, "enriched", deps);
  const room = Math.max(0, researchCap(run.quantity) - researched);
  if (room === 0) return finalize(run, icp, deps, null); // the rest keep their enrichment; finalize scores them
  const left = await allowanceOrStop(deps, "signals", run.organizationId);
  if (left <= 0) throw new StopRun("daily_limit");
  const batch = dueNow.slice(0, Math.min(room, deps.concurrency, left));
  await inSlices(batch, deps.concurrency, deadline, () => Date.now(), holds(deps), run.id, async (item) => { await researchOne(run, icp, item, deps); });
  return "more";
}

export async function researchOne(run: Pick<ProspectRunRow, "id" | "organizationId" | "createdByUser">, icp: Icp, item: ItemWithProspect | null, deps: PipelineDeps, opts: { force?: boolean; prospect?: ProspectRow; offer?: string | null } = {}): Promise<{ kept: number } | null> {
  const p = item?.prospect ?? opts.prospect!, now = deps.now(), orgId = run.organizationId;
  try {
    if (!opts.force && fresh(p.researchedAt, now) && (await deps.store.findings(orgId, p.id)).some((f) => f.batch === "research")) {
      await scoreProspect(orgId, p.id, deps, icp);
      if (item) await deps.store.setItem(item.id, { stage: "done", updatedAt: now });
      return { kept: 0 };
    }
    const readFor = { orgId, runId: run.id };
    const home = await readPage(deps, `https://${p.domain}/`, readFor);
    if (!home.ok) { if (item) await retryLater(deps, item, `page_error:${home.code}`); return null; }
    const homeUrl = new URL(home.url);
    let links = home.links.map((l) => l.href);
    let picked = pickResearchLinks(links, homeUrl, 4);
    if (picked.length < 3) { links = [...links, ...(await deps.sitemap(p.domain).catch(() => []))]; picked = pickResearchLinks(links, homeUrl, 4); }
    const reads = await Promise.all(picked.map((u) => readPage(deps, u, readFor)));
    // Each page as the model will see it (SIGNALS_PAGE_CHARS): its dates line, as much of its text as fits, its labelled blocks.
    const pages: ResearchPage[] = [home, ...reads].filter((x): x is Extract<PageRead, { ok: true }> => x.ok && sameSite(new URL(x.url).hostname, p.domain)).slice(0, 5).map((x, i) => researchPage(x, i + 1, SIGNALS_PAGE_CHARS));
    const known = (await deps.store.findings(orgId, p.id)).filter((f) => f.kind === "fact" && (f.batch === "enrich" || f.batch === "company"));
    const raw = await askJson(deps, { task: "signals", orgId, userId: run.createdByUser, runId: run.id, promptVersion: PROMPT_VERSIONS.signals },
      [{ role: "system", content: signalsSystemPrompt() }, { role: "user", content: signalsUserMessage(p.name, icp, opts.offer ?? null, known.map((k) => ({ id: k.id, label: LABELS[k.type] ?? k.type, value: k.value })), pages) }], MAX_TOKENS.signals);
    if (raw === null) throw new ProviderError("invalid_response", "empty_output");
    const r = normalizeResearch(raw, pages, p.domain, { retrievedAt: now, icp, knownFactIds: known.map((k) => k.id), companyName: p.name });
    // Opt-in: why signals did or didn't end up dated. It reads the model's output, the pages and the result above and
    // changes none of them; a problem here never affects the research.
    if (deps.researchDiagnostics) {
      try { await writeSearchDiagnostic(deps.researchDiagnostics, run.id, { prospect: p.domain, ...researchDateDiagnostics(raw, pages, r, now) }); } catch { /* diagnostics only */ }
    }

    const list: NewFinding[] = [];
    const localOf = new Map<number, number>();
    // A date stated in or beside the claim is "high"; one inherited from the article's publication date is "medium" (the article dates the
    // statement, not necessarily the event it describes). Confidence is provenance only: readiness reads the date and its precision.
    for (const s of r.signals) {
      localOf.set(s.index, list.length);
      list.push({ kind: "signal", type: s.type, value: s.value, status: "confirmed", sourceUrl: s.url, sourceType: "website", quote: s.quote, observedAt: s.observedAt, confidence: s.observedAt && s.dateSource !== "page_published" ? "high" : "medium", meta: { dateQuote: s.dateQuote, datePrecision: s.datePrecision, dateYear: s.dateYear, dateSource: s.dateSource, dateIssue: s.dateIssue, pageTruncated: s.pageTruncated, pagePublishedSource: s.dateSource === "page_published" ? pages.find((pg) => pg.url === s.url)?.published?.source ?? null : null, label: SIGNAL_LABEL[s.type],
        // What a hiring notice means FOR A FREELANCER, read from the quoted wording once, at storage time (pure rules).
        ...(s.type === "HIRING" ? { hiringKind: classifyHiring(`${s.value} ${s.quote ?? ""}`) } : {}) } });
    }
    for (const m of r.people) {
      localOf.set(m.index, list.length);
      list.push({ kind: "decision_maker", type: m.title.slice(0, 40), value: `${m.name}, ${m.title}`.slice(0, 400), status: "confirmed", sourceUrl: m.url, sourceType: "website", quote: m.quote, confidence: "high", meta: { name: m.name, title: m.title, rank: m.rank, senior: isSeniorDecisionMaker(m.title), staffEvidence: m.staffEvidence, email: null, emailStatus: null } });
    }
    for (const x of r.pains) {
      localOf.set(x.index, list.length);
      list.push({ kind: "fact", type: "pain_point", value: x.value, status: "inferred", sourceUrl: x.url, sourceType: "website", quote: x.quote, confidence: "low" });
    }
    for (const o of r.opportunities) {
      list.push({ kind: "opportunity", type: "opportunity", value: o.text, status: "inferred", sourceUrl: null, sourceType: "derived", quote: null, confidence: o.confidence,
        supports: o.supports.map((s) => (s.findingId !== undefined ? { findingId: s.findingId } : { local: localOf.get(s.newIndex!) })) });
    }
    await deps.store.saveStep({ orgId, prospectId: p.id, batch: "research", findings: list, prospect: { researchedAt: now }, itemId: item?.id, item: item ? { stage: "done" } : undefined, now });
    await scoreProspect(orgId, p.id, deps, icp);
    return { kept: list.length };
  } catch (e) {
    if (classify(e) === "stop") throw e;
    if (item) { await retryLater(deps, item, e instanceof ProviderError ? e.code : errorType(e)); return null; }
    throw e;
  }
}

/* ── score, ready, finalize ─────────────────────────────────────────────── */

/**
 * The deterministic score and readiness for one prospect, from everything stored about it. With the run's ICP, the fit
 * is also recomputed over the findings (the known-big rule reads funding and hiring signals research stored after the
 * enrich-time fit was judged); without one — a caller that has no run in hand — the stored fit stands as it was.
 */
export async function scoreProspect(orgId: string, prospectId: number, deps: Pick<PipelineDeps, "store" | "now">, icp?: Icp | null): Promise<ProspectRow | null> {
  const p = await deps.store.getProspect(orgId, prospectId);
  if (!p) return null;
  const now = deps.now();
  const findings = await deps.store.findings(orgId, prospectId);
  const asLike: FindingLike[] = findings.map((f) => ({ id: f.id, kind: f.kind, type: f.type, value: f.value, status: f.status, sourceUrl: f.sourceUrl, observedAt: f.observedAt, retrievedAt: f.retrievedAt, meta: f.meta as Record<string, unknown> }));
  let fit = (p.fit as any) ?? null;
  const profile = (p.profile ?? {}) as Record<string, { value: string } | undefined>;
  const refit = !!icp?.industry && !!fit && Object.keys(profile).length > 0;
  if (refit) fit = prospectFit(icp!, flatProfile(p.name, profile, p.domain), { findings: asLike });
  const score = scoreLead(fit, {}, findingsAsClaims(asLike, now, { smallTeam: !!icp && knownBigApplies(icp) }));
  const ready = readiness({ verified: !!p.verifiedAt && p.status !== "rejected", fitVerdict: fit?.verdict ?? null, findings: asLike, now });
  const researched = findings.some((f) => f.batch === "research");
  // "qualified" only when it fits on evidence; a researched company whose fit can't be judged keeps its earlier status.
  const status = p.status === "rejected" ? "rejected" : ready.ready ? "ready" : researched && ready.classification === "qualified" ? "qualified" : p.status === "ready" || p.status === "qualified" ? "enriched" : p.status;
  return deps.store.updateProspect(orgId, prospectId, { ...(refit ? { fit } : {}), score: { ...score, readyMissing: ready.missing, classification: ready.classification, timing: ready.timing }, ready: ready.ready, status, updatedAt: now });
}

export async function computeCounters(run: ProspectRunRow, deps: PipelineDeps): Promise<RunCountersExt> {
  const prev = (run.counters ?? {}) as RunCountersExt;
  const items = await deps.store.runItems(run.organizationId, run.id);
  const fs = await deps.store.findingsFor(run.organizationId, items.map((i) => i.prospectId));
  const by = new Map<number, ProspectFindingRow[]>();
  for (const f of fs) { const a = by.get(f.prospectId) ?? []; a.push(f); by.set(f.prospectId, a); }
  const c: RunCountersExt = { ...emptyCounters(), searched: prev.searched ?? 0, results: prev.results ?? 0, searchRejectedBy: prev.searchRejectedBy ?? {}, stoppedBy: prev.stoppedBy ?? null,
    // The demand and map scans' markers and the direct asks are facts of this run, written once at search time:
    // recomputing keeps them. Dropping a marker here would let a checkpoint mid-search make the run scan — and pay — twice.
    ...(prev.opportunityScan ? { opportunityScan: prev.opportunityScan } : {}), ...(prev.localScan ? { localScan: prev.localScan } : {}),
    ...(prev.directAsks?.length ? { directAsks: prev.directAsks } : {}) };
  // Rejected AFTER verification (a poor fit, or not enriched for budget or allowance) still counts as verified.
  const reached = (i: ItemWithProspect, stages: string[]) => stages.includes(i.stage) || (i.stage === "rejected" && i.prospect.status !== "rejected" && !!i.prospect.verifiedAt && ["poor_fit", "unclear", "not_a_company", "budget", "daily_limit"].includes(i.errorCode ?? "") && stages.includes("verified"));
  c.discovered = items.length;
  for (const i of items) {
    if (i.stage === "rejected") { c.rejected++; const r = (i.errorCode ?? "failed") as RejectReason; c.rejectedBy[r] = (c.rejectedBy[r] ?? 0) + 1; }
    if (i.stage === "failed") c.failed++;
    if (reached(i, ["verified", "enriched", "done"])) c.verified++;
    if (["enriched", "done"].includes(i.stage) || (i.stage === "rejected" && ["poor_fit", "unclear", "not_a_company"].includes(i.errorCode ?? ""))) c.enriched++;
    const v = (i.prospect.fit as any)?.verdict;
    if (["enriched", "done"].includes(i.stage) && (v === "strong" || v === "partial")) c.icpMatch++;
    const f = by.get(i.prospectId) ?? [];
    if (f.some((x) => x.batch === "research")) c.researched++;
    // A dated reason to get in touch (last 12 months, day or month precision); a strong timing signal is counted on its own.
    const t = timingOf(f as unknown as FindingLike[], deps.now()).timing;
    if (t === "strong" || t === "context") c.signals++;
    if (t === "strong") c.strongTiming = (c.strongTiming ?? 0) + 1;
    // A senior decision-maker, not just any named employee.
    if (f.some((x) => x.kind === "decision_maker" && isDecisionMaker(x as unknown as FindingLike))) c.decisionMakers++;
    if (i.prospect.ready && i.stage === "done") c.ready++;
  }
  c.costMicroUsd = await deps.store.runCostMicroUsd(run.id).catch(() => prev.costMicroUsd ?? 0);
  return c;
}

async function finalize(run: ProspectRunRow, icp: Icp, deps: PipelineDeps, stoppedBy: string | null): Promise<"done"> {
  // Everything that reached enrichment gets its score; items left waiting (budget or a stop) are closed as they are.
  const items = await deps.store.runItems(run.organizationId, run.id);
  const listMode = runModeOf(run) === "list";
  for (const i of items) {
    // A list sweep's verified company was never meant to be researched, so it is not a company that ran out of
    // budget: it is the result. It is closed with the same benign marker an enriched-but-unresearched company gets,
    // and left unscored, because a score with no profile and no fit would be a number standing for nothing.
    if (listMode && i.stage === "verified") { await deps.store.setItem(i.id, { stage: "done", errorCode: "not_researched", updatedAt: deps.now() }); continue; }
    if (i.stage === "enriched" || i.stage === "done") await scoreProspect(run.organizationId, i.prospectId, deps, icp);
    if (i.stage === "enriched") await deps.store.setItem(i.id, { stage: "done", errorCode: stoppedBy ? stoppedBy : "not_researched", updatedAt: deps.now() });
    const why = stoppedBy === "daily_limit" || stoppedBy === "global_limit" || stoppedBy === "workspace_budget" ? stoppedBy : stoppedBy ? "failed" : "budget";
    if (i.stage === "found" || i.stage === "verified") await deps.store.setItem(i.id, { stage: "rejected", errorCode: why, updatedAt: deps.now() });
  }
  const counters = await computeCounters({ ...run, counters: { ...(run.counters as object), stoppedBy: stoppedBy ?? (run.counters as RunCountersExt)?.stoppedBy ?? null } as any }, deps);
  // One statement: the stage and the status can't be left half-written by a crash between two of them.
  const failed = stoppedBy === "search_unavailable";
  if (!(await deps.store.finishRun(run.organizationId, run.id, fenceOf(run), { status: failed ? "failed" : "done", counters, costMicroUsd: counters.costMicroUsd ?? 0, errorCode: stoppedBy, now: deps.now() }))) throw new LeaseLost(run.id);
  run.stage = "done";
  return "done";
}

/** Checkpoints the funnel mid-run so the page shows progress. Cheap enough to call after every slice. */
export async function checkpoint(run: ProspectRunRow, deps: PipelineDeps): Promise<void> {
  const counters = await computeCounters(run, deps);
  await writeRun(deps, run, { counters, costMicroUsd: counters.costMicroUsd ?? 0, updatedAt: deps.now() });
}

/** A unique run id. */
export const newRunId = () => `pr_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
