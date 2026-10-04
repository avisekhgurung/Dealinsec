/**
 * Researching a lead from its own website. A deterministic pipeline, not an autonomous agent: code fetches the
 * pages (the home page, then up to two same-site pages worth reading), ONE model call reads them and proposes
 * findings, and code decides what is believed (shared/research.ts: a finding needs an exact quote that is really
 * on the page; judgments are never better than "inferred"). What survives is saved as lead claims with their
 * evidence, so everything shows up on the lead's Facts tab and in its score.
 *
 * Starting a run returns at once ("running"); the work continues in this process and the page polls. There is no
 * job queue in V1: a run left "running" for over 3 minutes (the instance slept or was restarted) reads as failed
 * and may be retried. Nothing is sent to anyone; the only outside requests are to the lead's own website.
 */
import { siteHost, normalizeFindings, sameSite, summarize, pickLinks, type ResearchPage } from "@shared/research";
import { ProviderError } from "../copilot/provider";
import { agentLog } from "../agent/log";
import { parseJsonObject } from "../agent/extraction";
import { leadsStore } from "../leads/store";
import { extractHtml, extractLinks } from "../knowledge/extract";
import { fetchPublicPage, validatePublicUrl, type PageResult } from "../knowledge/net-guard";
import { CapExceeded, CapUnavailable, assertWithinCap, tracedChat } from "../llm/traced";
import { addClaim, fail, getLead, moveLead, writeGate, type Result, type Who } from "../services/leads";
import { modelFor, dailyLimit } from "@shared/llm-cost";
import { PAGE_TEXT_CHARS, RESEARCH_PROMPT_VERSION, researchSystemPrompt, researchUserMessage } from "./research-prompt";
import { RunBusy, researchStore, type PageNote, type ResearchStore, type RunResult } from "./research-store";

/** A run left "running" this long is dead (the instance slept or restarted). */
export const STALE_MS = 3 * 60_000;
/** The whole run's own budget; a run past it is recorded as failed and writes nothing more. */
export const RUN_BUDGET_MS = 100_000;
const MAX_EXTRA_PAGES = 2;
/** Output budget for the research call: generous, because a reasoning model counts its thinking against it. */
const RESEARCH_MAX_TOKENS = 4000;

export interface ResearchDeps {
  store: ResearchStore;
  fetchPage: (url: string) => Promise<PageResult>;
  chat: typeof tracedChat;
  now: () => Date;
  /** Runs the work after the request has been answered. */
  schedule: (fn: () => Promise<unknown>) => void;
}
const defaults = (): ResearchDeps => ({
  store: researchStore, fetchPage: (u) => fetchPublicPage(u), chat: tracedChat, now: () => new Date(),
  schedule: (fn) => { setImmediate(() => { void fn(); }); },
});

export interface ResearchView {
  id: number; status: "running" | "done" | "failed"; startedAt: string; finishedAt: string | null;
  errorCode: string | null; summary: unknown; pages: PageNote[]; claimCount: number;
}
const view = (r: NonNullable<Awaited<ReturnType<ResearchStore["latest"]>>>, now: Date): ResearchView => {
  const stale = r.status === "running" && now.getTime() - new Date(r.startedAt).getTime() > STALE_MS;
  return {
    id: r.id, status: stale ? "failed" : (r.status as ResearchView["status"]), startedAt: new Date(r.startedAt).toISOString(),
    finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : null, errorCode: stale ? "stale" : r.errorCode ?? null,
    summary: r.summary ?? null, pages: (r.pages as PageNote[]) ?? [], claimCount: ((r.claimIds as number[]) ?? []).length,
  };
};

export async function getResearch(user: Who, leadId: number, d: Partial<ResearchDeps> = {}): Promise<Result<{ research: ResearchView | null }>> {
  const deps = { ...defaults(), ...d };
  const got = await getLead(user, leadId);
  if (!got.ok) return got;
  const row = await deps.store.latest(user.organizationId!, leadId);
  return { ok: true, research: row ? view(row, deps.now()) : null };
}

/** Checks everything that can be checked now, claims the lead's single running slot, and schedules the work. */
export async function startResearch(user: Who, leadId: number, opts: { by?: "user" | "agent" } = {}, d: Partial<ResearchDeps> = {}): Promise<Result<{ researchId: number }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  const got = await getLead(user, leadId);
  if (!got.ok) return got;
  const lead = got.detail.lead;
  if (lead.archivedAt || lead.status === "won" || lead.status === "lost") return fail(409, "closed", "This lead is closed, so there is nothing to research.");
  if (!lead.website) return fail(422, "no_website", "Add the company's website to this lead first. Research reads the company's own website.");
  const site = validatePublicUrl(lead.website);
  if (!site.ok) return fail(422, "bad_website", `That website can't be researched: ${site.message}`);

  try { await assertWithinCap("research", user.organizationId!); }
  catch (e) {
    if (e instanceof CapExceeded) return fail(429, "daily_limit", `You've used today's ${dailyLimit("research")} research runs. Try again tomorrow.`);
    if (e instanceof CapUnavailable) return fail(503, "SALES_NOT_SETUP", "The sales agent isn't set up on this server yet.");
    throw e;
  }

  let run;
  try { run = await deps.store.startRun({ orgId: user.organizationId!, leadId, by: opts.by ?? "user", userId: user.id, now: deps.now(), staleMs: STALE_MS }); }
  catch (e) {
    if (e instanceof RunBusy) return fail(409, "running", "Research is already running for this lead.");
    throw e;
  }
  deps.schedule(() => runResearch(user, run.id, leadId, deps));
  return { ok: true, researchId: run.id };
}

const errorCode = (e: unknown): string =>
  e instanceof CapExceeded ? "daily_limit" : e instanceof CapUnavailable ? "cap_unavailable" : e instanceof ProviderError ? e.code : "internal";

/** The work. Never throws: whatever happens, the run is finished (done or failed) and says why. Returns what it recorded. */
export async function runResearch(user: Who, runId: number, leadId: number, deps: ResearchDeps = defaults()): Promise<RunResult> {
  const orgId = user.organizationId!;
  const started = deps.now().getTime();
  const expired = () => deps.now().getTime() - started > RUN_BUDGET_MS;
  const pages: PageNote[] = [];
  let model: string | null = null;
  let result: RunResult;
  try {
    const got = await getLead(user, leadId);
    if (!got.ok) throw new Error("lead_missing");
    const lead = got.detail.lead;
    const site = validatePublicUrl(lead.website ?? "");
    if (!site.ok) throw new Error("bad_website");
    const host = siteHost(site.url.hostname);

    // 1. Read the company's own pages: home first, then up to two same-site pages worth reading.
    const readable: ResearchPage[] = [];
    const read = async (url: string): Promise<{ page?: ResearchPage; bytes?: Uint8Array; finalUrl?: URL }> => {
      const r = await deps.fetchPage(url);
      if (!r.ok) { pages.push({ url, ok: false, note: r.code }); return {}; }
      if (r.contentType !== "html") { pages.push({ url, ok: false, note: "not_html" }); return {}; }
      // A site that redirects elsewhere is not the lead's own site any more.
      if (!sameSite(r.url.hostname, host)) { pages.push({ url, ok: false, note: "offsite_redirect" }); return {}; }
      const ex = await extractHtml(r.bytes);
      if (!ex.ok) { pages.push({ url: r.url.toString(), ok: false, note: "unreadable" }); return { bytes: r.bytes, finalUrl: r.url }; }
      pages.push({ url: r.url.toString(), ok: true });
      return { page: { index: 0, url: r.url.toString(), text: ex.text.slice(0, PAGE_TEXT_CHARS) }, bytes: r.bytes, finalUrl: r.url };
    };
    const home = await read(`${site.url.origin}/`);
    if (home.page) readable.push(home.page);
    if (home.bytes && home.finalUrl && !expired()) {
      const wanted = pickLinks(await extractLinks(home.bytes), home.finalUrl, MAX_EXTRA_PAGES);
      const extra = await Promise.all(wanted.map((u) => read(u)));
      for (const e of extra) if (e.page) readable.push(e.page);
    }
    readable.forEach((p, i) => { p.index = i + 1; });
    if (!readable.length) { result = { status: "failed", finishedAt: deps.now(), pages, claimIds: [], errorCode: "no_pages" }; await deps.store.finish(orgId, runId, result); return result; }
    if (expired()) { result = { status: "failed", finishedAt: deps.now(), pages, claimIds: [], errorCode: "timeout" }; await deps.store.finish(orgId, runId, result); return result; }

    // 2. One model call reads them and proposes findings.
    model = modelFor("research");
    // A reasoning model (DeepSeek Flash) spends output tokens thinking before it answers, so the budget is generous, and an empty or
    // unreadable reply gets ONE more try before the run is recorded as failed. Both calls are traced and count towards the allowance.
    const messages = [{ role: "system" as const, content: researchSystemPrompt() }, { role: "user" as const, content: researchUserMessage(lead.companyName, readable) }];
    let raw: unknown = null, content: string | null = null;
    for (let attempt = 0; attempt < 2 && raw === null; attempt++) {
      if (attempt > 0 && expired()) break;
      const reply = await deps.chat({ task: "research", orgId, userId: user.id, leadId, promptVersion: RESEARCH_PROMPT_VERSION }, messages, { maxTokens: RESEARCH_MAX_TOKENS, model });
      content = reply.content;
      raw = parseJsonObject(reply.content);
    }
    if (expired()) { result = { status: "failed", finishedAt: deps.now(), pages, claimIds: [], errorCode: "timeout", model, promptVersion: RESEARCH_PROMPT_VERSION }; await deps.store.finish(orgId, runId, result); return result; }
    if (raw === null) {
      // An empty reply (a reasoning model that used its whole budget thinking) is a different problem from a malformed one.
      const code = (content ?? "").trim() ? "bad_output" : "empty_output";
      result = { status: "failed", finishedAt: deps.now(), pages, claimIds: [], errorCode: code, model, promptVersion: RESEARCH_PROMPT_VERSION };
      await deps.store.finish(orgId, runId, result); return result;
    }

    // 3. Code decides what is believed; what survives is saved as claims with their evidence.
    const normalized = normalizeFindings(raw, readable, host);
    const claimIds: number[] = [];
    for (const c of normalized.claims) {
      const saved = await addClaim(user, leadId, { field: c.field, value: c.value, status: c.status, evidenceUrl: c.evidenceUrl, evidenceSnippet: c.evidenceSnippet }, { actor: "agent" });
      if (saved.ok) claimIds.push(saved.claim.id);
    }
    const summary = summarize(normalized);
    await leadsStore.addEvent(orgId, leadId, { kind: "researched", data: { researchId: runId, claims: claimIds.length, pages: readable.length }, actor: "agent", actorUserId: user.id });
    if (lead.status === "new") await moveLead(user, leadId, "researching", { actor: "agent" }); // a validated stage change; a refusal changes nothing

    result = { status: "done", finishedAt: deps.now(), pages, claimIds, summary, model, promptVersion: RESEARCH_PROMPT_VERSION };
  } catch (e) {
    agentLog("error", { errorType: (e as Error)?.name ?? "Error", where: "sales_research", code: errorCode(e) }); // never the text
    result = { status: "failed", finishedAt: deps.now(), pages, claimIds: [], errorCode: errorCode(e), model, promptVersion: RESEARCH_PROMPT_VERSION };
  }
  try { await deps.store.finish(orgId, runId, result); } catch (e) { agentLog("error", { errorType: (e as Error)?.name ?? "Error", where: "sales_research_finish" }); }
  return result;
}
