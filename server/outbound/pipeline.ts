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
import { collectCandidates, checkSite, emptyCounters, findingsAsClaims, preRank, relevance, MIN_RELEVANCE, readiness, runBudget, pickResearchLinks, SIGNAL_LABEL, freshness, type RejectReason, type RunCounters, type SearchHit, type FindingLike } from "@shared/prospect";
import { normalizeEnrichment, normalizeResearch, type FactDraft } from "@shared/prospect-intel";
import { industryMatched, prospectFit, type Icp, type ProspectProfile } from "@shared/icp";
import { scoreLead } from "@shared/lead-score";
import { pickLinks, sameSite, type ResearchPage } from "@shared/research";
import type { ProspectFindingRow, ProspectRow, ProspectRunRow } from "@shared/schema";
import { ProviderError } from "../copilot/provider";
import { parseJsonObject } from "../agent/extraction";
import { DiscoveryError, type DiscoveryProvider } from "../discovery/types";
import { outboundSearchProviders } from "../discovery/provider";
import { leadsStore } from "../leads/store";
import { CapExceeded, CapUnavailable, remainingToday, tracedChat, type TraceCtx } from "../llm/traced";
import type { ChatMessage } from "../copilot/provider";
import { PROMPT_VERSIONS, enrichSystemPrompt, enrichUserMessage, signalsSystemPrompt, signalsUserMessage } from "./prompts";
import { companyProvider, contactProvider, costMicroUsd, pageReader, readSitemap, type CompanyEnrichmentProvider, type ContactEnrichmentProvider, type PageRead, type PageReader } from "./providers";
import { outboundStore, type ItemWithProspect, type NewFinding, type OutboundStore } from "./store";
import { dailyCompanyLimit, dailySearchLimit } from "./limits";
import type { StepResult } from "../workflow/runner";

export const CACHE_DAYS = 14;
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
  allowance: (task, orgId) => remainingToday(task, orgId),
});

/* ── small helpers ──────────────────────────────────────────────────────── */

export interface QueryPlan { q: string; provider: string; done: boolean; ok?: boolean; results?: number; error?: string }
export interface RunCountersExt extends RunCounters { searchRejectedBy?: Partial<Record<RejectReason, number>>; costMicroUsd?: number; stoppedBy?: string | null }

const pageCache = new Map<string, { at: number; page: PageRead }>();
async function readPage(deps: PipelineDeps, url: string): Promise<PageRead> {
  const hit = pageCache.get(url);
  if (hit && deps.now().getTime() - hit.at < 30 * 60_000) return hit.page;
  const page = await deps.reader.read(url);
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
    await Promise.all(items.slice(i, i + n).map(fn));
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

/** A transient problem: the item is retried later (with back-off), up to MAX_ATTEMPTS, then marked failed. */
async function retryLater(deps: PipelineDeps, item: ItemWithProspect, code: string): Promise<void> {
  const attempts = item.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) await deps.store.setItem(item.id, { stage: "failed", attempts, errorCode: code, updatedAt: deps.now() });
  else await deps.store.setItem(item.id, { attempts, errorCode: code, nextAttemptAt: new Date(deps.now().getTime() + 15_000 * 2 ** attempts), updatedAt: deps.now() });
}
const rejectItem = (deps: PipelineDeps, item: ItemWithProspect, reason: RejectReason) => deps.store.setItem(item.id, { stage: "rejected", errorCode: reason, updatedAt: deps.now() });

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
    if (e instanceof CapExceeded) return finalize(run, icp, deps, "daily_limit");
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
  if (next) {
    const providers = await deps.searchProviders();
    const provider = providers.find((p) => p.name === next.provider) ?? providers[0];
    const used = await deps.store.countProviderCalls({ orgId: run.organizationId, operation: "search", since: new Date(deps.now().getTime() - DAY) });
    if (!provider) { next.done = true; next.ok = false; next.error = "not_configured"; }
    else if (used >= dailySearchLimit()) { for (const q of plan) if (!q.done) { q.done = true; q.ok = false; q.error = "daily_limit"; } counters.stoppedBy = "daily_limit"; }
    else {
      const budget = runBudget(run.quantity);
      try {
        const results = await trackProvider(deps, { orgId: run.organizationId, runId: run.id, provider: provider.name, operation: "search" }, () =>
          provider.search(next.q, { count: budget.resultsPerQuery, country: provider.supportsCountry ? icp.countries[0] : undefined }));
        const at = deps.now().toISOString();
        const hits: SearchHit[] = results.map((r) => ({ ...r, provider: provider.name, query: next.q, at }));
        const { candidates, rejected } = collectCandidates(hits, icp);
        for (const c of candidates) {
          const p = await deps.store.upsertProspect(run.organizationId, c, deps.now());
          await deps.store.addRunItem({ runId: run.id, orgId: run.organizationId, prospectId: p.id, stage: "found", now: deps.now() });
        }
        counters.searched += 1; counters.results += results.length;
        counters.searchRejectedBy = { ...(counters.searchRejectedBy ?? {}) };
        for (const r of rejected) counters.searchRejectedBy[r.reason] = (counters.searchRejectedBy[r.reason] ?? 0) + 1;
        next.done = true; next.ok = true; next.results = results.length;
      } catch (e) {
        // Billed searches are not retried; a failed query is recorded and the run carries on with the others.
        next.done = true; next.ok = false; next.error = e instanceof DiscoveryError ? e.code : "error";
      }
    }
    await writeRun(deps, run, { queries: plan, counters, updatedAt: deps.now() });
    run.queries = plan; run.counters = counters;
    if (plan.some((q) => !q.done)) return "more";
  }
  return rankStep(run, icp, deps);
}

async function rankStep(run: ProspectRunRow, icp: Icp, deps: PipelineDeps): Promise<StepResult> {
  const plan = run.queries as QueryPlan[];
  const items = await deps.store.runItems(run.organizationId, run.id);
  if (!items.length) {
    const code = plan.length && plan.every((q) => !q.ok) ? (plan.some((q) => q.error === "daily_limit") ? "daily_limit" : "search_unavailable") : null;
    return finalize(run, icp, deps, code);
  }
  const budget = runBudget(run.quantity);
  const ranked = items.filter((i) => i.stage === "found").map((i) => { const c = { domain: i.prospect.domain, name: i.prospect.name, website: i.prospect.website, sources: (i.prospect.sources as any[]) ?? [], rank: 0 }; return { i, score: preRank(c, icp), rel: relevance(c, icp) }; })
    .sort((a, b) => b.score - a.score || a.i.id - b.i.id);
  let kept = 0;
  for (const { i, score, rel } of ranked) {
    const lead = i.prospect.leadId ? { id: i.prospect.leadId } : await deps.leadByDomain(run.organizationId, i.prospect.domain);
    if (lead) { await deps.store.setItem(i.id, { rank: score, stage: "rejected", errorCode: "already_lead", updatedAt: deps.now() }); continue; }
    if (rel < MIN_RELEVANCE) { await deps.store.setItem(i.id, { rank: score, stage: "rejected", errorCode: "off_topic", updatedAt: deps.now() }); continue; }
    if (kept >= budget.verify) { await deps.store.setItem(i.id, { rank: score, stage: "rejected", errorCode: "budget", updatedAt: deps.now() }); continue; }
    kept++;
    await deps.store.setItem(i.id, { rank: score, updatedAt: deps.now() });
  }
  await setStage(deps, run, "verify");
  return "more";
}

/* ── verify ─────────────────────────────────────────────────────────────── */

async function verifyStep(run: ProspectRunRow, deadline: number, deps: PipelineDeps): Promise<StepResult> {
  const batch = await deps.store.itemsAt(run.id, "found", deps.concurrency * 2, deps.now());
  if (!batch.length) {
    if ((await deps.store.itemsAt(run.id, "found", 1, new Date(deps.now().getTime() + 365 * DAY))).length) return waitFor(run, "found", deps); // waiting on a retry
    await setStage(deps, run, "enrich");
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
  try { page = await readPage(deps, `https://${p.domain}/`); }
  catch { return void (await retryLater(deps, item, "page_error")); }
  let reason: RejectReason | null = null;
  if (!page.ok) reason = page.code === "not_html" ? "not_html" : "unreachable";
  else if (!sameSite(new URL(page.url).hostname, p.domain) && !new URL(page.url).hostname.endsWith(`.${p.domain}`)) reason = "offsite_redirect";
  else { const c = checkSite({ name: p.name, domain: p.domain }, page); if (!c.ok) reason = c.reason!; }
  if (reason === "unreachable" && item.attempts < 1) return void (await retryLater(deps, item, "unreachable"));
  if (reason) {
    await deps.store.updateProspect(run.organizationId, p.id, { status: "rejected", rejectReason: reason, verifiedAt: now, updatedAt: now });
    return void (await rejectItem(deps, item, reason));
  }
  await deps.store.updateProspect(run.organizationId, p.id, { status: p.status === "candidate" || p.status === "rejected" ? "verified" : p.status, rejectReason: null, verifiedAt: now, contentHash: (page as any).hash, updatedAt: now });
  await deps.store.setItem(item.id, { stage: "verified", updatedAt: now });
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
  const done = all.filter((i) => ["enriched", "done"].includes(i.stage) || (i.stage === "rejected" && ["poor_fit", "unclear", "not_a_company"].includes(i.errorCode ?? ""))).length;
  const batch = await deps.store.itemsAt(run.id, "verified", deps.concurrency * 2, deps.now());
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

export async function enrichOne(run: Pick<ProspectRunRow, "id" | "organizationId" | "createdByUser">, icp: Icp, item: ItemWithProspect | null, deps: PipelineDeps, p0?: ProspectRow): Promise<void> {
  const p = item?.prospect ?? p0!, now = deps.now(), orgId = run.organizationId;
  try {
    let facts = (await deps.store.findings(orgId, p.id)).filter((f) => f.batch === "enrich" || f.batch === "company");
    if (!(facts.some((f) => f.batch === "enrich" && fresh(f.retrievedAt, now)) || (fresh(p.researchedAt, now) && facts.length))) {
      const home = await readPage(deps, `https://${p.domain}/`);
      if (!home.ok) { if (item) await retryLater(deps, item, "page_error"); return; }
      const extra = pickLinks(home.links, new URL(home.url), 2);
      const others = await Promise.all(extra.map((u) => readPage(deps, u)));
      const pages: ResearchPage[] = [home, ...others].filter((x): x is Extract<PageRead, { ok: true }> => x.ok && sameSite(new URL(x.url).hostname, p.domain)).map((x, i) => ({ index: i + 1, url: x.url, text: x.text }));
      const raw = await askJson(deps, { task: "enrich", orgId, userId: run.createdByUser, runId: run.id, promptVersion: PROMPT_VERSIONS.enrich },
        [{ role: "system", content: enrichSystemPrompt() }, { role: "user", content: enrichUserMessage(p.name, pages) }], MAX_TOKENS.enrich);
      // No answer at all is a failed call to retry, never "this company says nothing" (which sets it aside for good).
      if (raw === null) throw new ProviderError("invalid_response", "empty_output");
      const n = normalizeEnrichment(raw, pages, p.domain);
      const drafts: NewFinding[] = n.facts.map((f: FactDraft) => ({ kind: "fact", type: f.field, value: f.value, status: "confirmed", sourceUrl: f.url, sourceType: "website", quote: f.quote, contentHash: (home as any).hash, confidence: "high" }));
      facts = await deps.store.saveStep({ orgId, prospectId: p.id, batch: "enrich", findings: drafts, now });
      // Firmographics from a data provider fill gaps. They are a third party's estimate: inferred, never "confirmed".
      if (deps.company) {
        try {
          // Its own daily allowance, counted from the database; a count that can't be made skips the provider (fail closed).
          if ((await deps.store.countProviderCalls({ orgId, operation: "company", since: new Date(now.getTime() - DAY) })) >= dailyCompanyLimit()) throw new Error("company_allowance");
          const c = await trackProvider(deps, { orgId, runId: run.id, provider: deps.company.name, operation: "company" }, () => deps.company!.enrich(p.domain));
          if (c) {
            const pf: NewFinding[] = [];
            const add = (type: string, value?: string) => { if (value) pf.push({ kind: "fact", type, value, status: "inferred", sourceUrl: c.sourceUrl ?? null, sourceType: "provider", quote: null, confidence: "medium", meta: { provider: deps.company!.name } }); };
            add("team_size", c.employees); add("industry", c.industry); add("location", c.location);
            const code = c.country && /^[A-Za-z]{2}$/.test(c.country) ? c.country.toUpperCase() : undefined; add("country", code);
            facts = [...facts, ...(await deps.store.saveStep({ orgId, prospectId: p.id, batch: "company", findings: pf, now }))];
          }
        } catch { /* a provider problem never blocks the run; the call is recorded */ }
      }
    }
    const profile = profileFrom(p.name, facts);
    const fit = prospectFit(icp, flatProfile(p.name, profile, p.domain));
    // Deeper work only for a business that is known to be the kind you asked for. Something else (a directory, a
    // publication, an institution) or not being able to tell what it does is set aside, with the reason.
    const nonBusiness = !!profile.business_type && profile.business_type.value !== "business" && profile.business_type.value !== "other";
    const why: RejectReason | null = nonBusiness ? "not_a_company" : fit.verdict === "excluded" || fit.verdict === "weak" ? "poor_fit" : !industryMatched(fit) ? "unclear" : null;
    await deps.store.updateProspect(orgId, p.id, { profile, fit, status: p.status === "ready" || p.status === "qualified" ? p.status : "enriched", updatedAt: now });
    if (item) await deps.store.setItem(item.id, why ? { stage: "rejected", errorCode: why, updatedAt: now } : { stage: "enriched", updatedAt: now });
  } catch (e) {
    if (classify(e) === "stop" || !item) throw e;
    await retryLater(deps, item, e instanceof ProviderError ? e.code : e instanceof CapUnavailable ? "cap_unavailable" : "error");
  }
}

/* ── research: why now, who, what ───────────────────────────────────────── */

const FIT_ORDER: Record<string, number> = { strong: 0, partial: 1, unclear: 2 };

async function researchStep(run: ProspectRunRow, icp: Icp, deadline: number, deps: PipelineDeps): Promise<StepResult> {
  const budget = runBudget(run.quantity);
  const all = await deps.store.runItems(run.organizationId, run.id);
  const researched = all.filter((i) => i.stage === "done").length;
  const waiting = all.filter((i) => i.stage === "enriched");
  const dueNow = waiting.filter((i) => !i.nextAttemptAt || new Date(i.nextAttemptAt) <= deps.now())
    .sort((a, b) => (FIT_ORDER[(a.prospect.fit as any)?.verdict] ?? 3) - (FIT_ORDER[(b.prospect.fit as any)?.verdict] ?? 3) || b.rank - a.rank);
  if (!waiting.length) return finalize(run, icp, deps, null);
  if (!dueNow.length) return waitFor(run, "enriched", deps);
  const room = Math.max(0, budget.research - researched);
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
      await scoreProspect(orgId, p.id, deps);
      if (item) await deps.store.setItem(item.id, { stage: "done", updatedAt: now });
      return { kept: 0 };
    }
    const home = await readPage(deps, `https://${p.domain}/`);
    if (!home.ok) { if (item) await retryLater(deps, item, "page_error"); return null; }
    const homeUrl = new URL(home.url);
    let links = home.links.map((l) => l.href);
    let picked = pickResearchLinks(links, homeUrl, 4);
    if (picked.length < 3) { links = [...links, ...(await deps.sitemap(p.domain).catch(() => []))]; picked = pickResearchLinks(links, homeUrl, 4); }
    const reads = await Promise.all(picked.map((u) => readPage(deps, u)));
    const pages: ResearchPage[] = [home, ...reads].filter((x): x is Extract<PageRead, { ok: true }> => x.ok && sameSite(new URL(x.url).hostname, p.domain)).slice(0, 5).map((x, i) => ({ index: i + 1, url: x.url, text: x.text }));
    const known = (await deps.store.findings(orgId, p.id)).filter((f) => f.kind === "fact" && (f.batch === "enrich" || f.batch === "company"));
    const raw = await askJson(deps, { task: "signals", orgId, userId: run.createdByUser, runId: run.id, promptVersion: PROMPT_VERSIONS.signals },
      [{ role: "system", content: signalsSystemPrompt() }, { role: "user", content: signalsUserMessage(p.name, icp, opts.offer ?? null, known.map((k) => ({ id: k.id, label: LABELS[k.type] ?? k.type, value: k.value })), pages) }], MAX_TOKENS.signals);
    if (raw === null) throw new ProviderError("invalid_response", "empty_output");
    const r = normalizeResearch(raw, pages, p.domain, { retrievedAt: now, icp, knownFactIds: known.map((k) => k.id), companyName: p.name });

    const list: NewFinding[] = [];
    const localOf = new Map<number, number>();
    for (const s of r.signals) {
      localOf.set(s.index, list.length);
      list.push({ kind: "signal", type: s.type, value: s.value, status: "confirmed", sourceUrl: s.url, sourceType: "website", quote: s.quote, observedAt: s.observedAt, confidence: s.observedAt ? "high" : "medium", meta: { dateQuote: s.dateQuote, label: SIGNAL_LABEL[s.type] } });
    }
    for (const m of r.people) {
      localOf.set(m.index, list.length);
      list.push({ kind: "decision_maker", type: m.title.slice(0, 40), value: `${m.name}, ${m.title}`.slice(0, 400), status: "confirmed", sourceUrl: m.url, sourceType: "website", quote: m.quote, confidence: "high", meta: { name: m.name, title: m.title, rank: m.rank, email: null, emailStatus: null } });
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
    await scoreProspect(orgId, p.id, deps);
    return { kept: list.length };
  } catch (e) {
    if (classify(e) === "stop") throw e;
    if (item) { await retryLater(deps, item, e instanceof ProviderError ? e.code : "error"); return null; }
    throw e;
  }
}

/* ── score, ready, finalize ─────────────────────────────────────────────── */

/** The deterministic score and readiness for one prospect, from everything stored about it. */
export async function scoreProspect(orgId: string, prospectId: number, deps: Pick<PipelineDeps, "store" | "now">): Promise<ProspectRow | null> {
  const p = await deps.store.getProspect(orgId, prospectId);
  if (!p) return null;
  const now = deps.now();
  const findings = await deps.store.findings(orgId, prospectId);
  const asLike: FindingLike[] = findings.map((f) => ({ id: f.id, kind: f.kind, type: f.type, value: f.value, status: f.status, sourceUrl: f.sourceUrl, observedAt: f.observedAt, retrievedAt: f.retrievedAt, meta: f.meta as Record<string, unknown> }));
  const fit = (p.fit as any) ?? null;
  const score = scoreLead(fit, {}, findingsAsClaims(asLike, now));
  const ready = readiness({ verified: !!p.verifiedAt && p.status !== "rejected", fitVerdict: fit?.verdict ?? null, findings: asLike, now });
  const researched = findings.some((f) => f.batch === "research");
  return deps.store.updateProspect(orgId, prospectId, { score: { ...score, readyMissing: ready.missing }, ready: ready.ready, status: p.status === "rejected" ? "rejected" : ready.ready ? "ready" : researched ? "qualified" : p.status, updatedAt: now });
}

export async function computeCounters(run: ProspectRunRow, deps: PipelineDeps): Promise<RunCountersExt> {
  const prev = (run.counters ?? {}) as RunCountersExt;
  const items = await deps.store.runItems(run.organizationId, run.id);
  const fs = await deps.store.findingsFor(run.organizationId, items.map((i) => i.prospectId));
  const by = new Map<number, ProspectFindingRow[]>();
  for (const f of fs) { const a = by.get(f.prospectId) ?? []; a.push(f); by.set(f.prospectId, a); }
  const c: RunCountersExt = { ...emptyCounters(), searched: prev.searched ?? 0, results: prev.results ?? 0, searchRejectedBy: prev.searchRejectedBy ?? {}, stoppedBy: prev.stoppedBy ?? null };
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
    if (f.some((x) => x.kind === "signal" && x.status === "confirmed" && freshness(x.observedAt, deps.now()).band !== "stale")) c.signals++;
    if (f.some((x) => x.kind === "decision_maker")) c.decisionMakers++;
    if (i.prospect.ready && i.stage === "done") c.ready++;
  }
  c.costMicroUsd = await deps.store.runCostMicroUsd(run.id).catch(() => prev.costMicroUsd ?? 0);
  return c;
}

async function finalize(run: ProspectRunRow, icp: Icp, deps: PipelineDeps, stoppedBy: string | null): Promise<"done"> {
  // Everything that reached enrichment gets its score; items left waiting (budget or a stop) are closed as they are.
  const items = await deps.store.runItems(run.organizationId, run.id);
  for (const i of items) {
    if (i.stage === "enriched" || i.stage === "done") await scoreProspect(run.organizationId, i.prospectId, deps);
    if (i.stage === "enriched") await deps.store.setItem(i.id, { stage: "done", errorCode: stoppedBy ? stoppedBy : "not_researched", updatedAt: deps.now() });
    const why = stoppedBy === "daily_limit" ? "daily_limit" : stoppedBy ? "failed" : "budget";
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
