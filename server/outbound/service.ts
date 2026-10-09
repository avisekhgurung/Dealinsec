/**
 * AI Outbound: the functions the REST routes and the agent's tools call. Permissions follow the lead pipeline
 * (read = whoever may read deals; anything that spends or writes = whoever may create deals). A run, a prospect or a
 * finding in another workspace answers "not found", like one that does not exist.
 *
 * Nothing here contacts a company. Reading a company's public website, asking a search engine and (when connected)
 * asking a data provider are the only outside calls. A prospect becomes a lead only through addToLeads.
 */
import { createHash } from "node:crypto";
import { sanitizeQuery } from "@shared/discovery";
import { describeIcp, icpSchema, mergeIcp, parseIcpFallback, searchStrategies, withSavedExclusions, type Icp } from "@shared/icp";
import { normalizeAngle } from "@shared/prospect-intel";
import { FRESHNESS_LABEL, REJECT_LABEL, SIGNAL_LABEL, freshness, isSignalType, runBudget, type RejectReason } from "@shared/prospect";
import { roleRank } from "@shared/icp";
import type { ProspectFindingRow, ProspectRow, ProspectRunRow } from "@shared/schema";
import { parseJsonObject } from "../agent/extraction";
import { agentLog } from "../agent/log";
import { DiscoveryError } from "../discovery/types";
import { CapExceeded, CapUnavailable, tracedChat } from "../llm/traced";
import { dailyLimit } from "@shared/llm-cost";
import { profileStore } from "../leads/profile-store";
import { addClaim, addNote, createLead, fail, readGate, writeGate, type Result, type Who } from "../services/leads";
import { PROMPT_VERSIONS, angleSystemPrompt, angleUserMessage, icpSystemPrompt, icpUserMessage } from "./prompts";
import { pipelineDeps, newRunId, researchOne, enrichOne, scoreProspect, type PipelineDeps, type QueryPlan, type RunCountersExt } from "./pipeline";
import { prospectsTablesReady, RunActive } from "./store";
import { dailyContactLimit, dailyRunLimit } from "./limits";
import { outboundRunner } from "./runner";

const DAY = 86_400_000;
const NOT_SETUP = () => fail(503, "PROSPECTS_NOT_SETUP", "AI Outbound isn't set up on this server yet.");
async function ready(): Promise<boolean> { try { return await prospectsTablesReady(); } catch { return false; } }
const capFail = (e: unknown, task: Parameters<typeof dailyLimit>[0]) =>
  e instanceof CapExceeded ? fail(429, "daily_limit", `You've used today's AI allowance for this (${dailyLimit(task)} a day). Try again tomorrow.`)
    : e instanceof CapUnavailable ? NOT_SETUP() : null;

async function savedProfile(orgId: string) { try { return await profileStore.get(orgId); } catch { return null; } }

/* ── 1. the ICP ─────────────────────────────────────────────────────────── */

export interface ParsedIcp { icp: Icp; searches: string[]; description: string; source: "model" | "rules" }

export async function parseIcp(user: Who, request: unknown, d: Partial<PipelineDeps> = {}): Promise<Result<ParsedIcp>> {
  const deps = { ...pipelineDeps(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await ready())) return NOT_SETUP();
  const text = typeof request === "string" ? request.replace(/\s+/g, " ").trim() : "";
  if (text.length < 3 || text.length > 500) return fail(400, "invalid", "Describe who you want to reach in a sentence (for example: US SEO agencies with 5–30 employees that serve SaaS companies).");
  const orgId = user.organizationId!;
  const saved = await savedProfile(orgId);
  const fallback = parseIcpFallback(text);
  let modelOut: Record<string, unknown> | null = null;
  try {
    // A reasoning model counts its thinking against the budget, so it is generous, and an empty or unreadable reply gets one more try.
    for (let attempt = 0; attempt < 2 && !modelOut; attempt++) {
      const reply = await deps.chat({ task: "icp", orgId, userId: user.id, promptVersion: PROMPT_VERSIONS.icp },
        [{ role: "system", content: icpSystemPrompt() }, { role: "user", content: icpUserMessage(text, saved?.about ?? null) }], { maxTokens: 4000 });
      modelOut = parseJsonObject(reply.content) as Record<string, unknown> | null;
    }
  } catch (e) {
    const f = capFail(e, "icp");
    if (f && !fallback) return f;
    agentLog("error", { errorType: (e as Error)?.name ?? "Error", where: "outbound_icp" });
  }
  const merged = mergeIcp(modelOut, fallback);
  if (!merged) return fail(422, "unclear", "I couldn't tell what kind of company you want. Name the kind of business, for example \"digital marketing agencies\".");
  const icp = withSavedExclusions(merged, saved);
  const extra = Array.isArray(modelOut?.searches) ? (modelOut!.searches as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 4) : [];
  return { ok: true, icp, searches: searchStrategies(icp, extra), description: describeIcp(icp), source: modelOut ? "model" : "rules" };
}

/* ── 2. runs ─────────────────────────────────────────────────────────────── */

export interface RunView {
  id: string; status: string; stage: string; request: string; icp: Icp; description: string; quantity: number;
  counters: RunCountersExt; costUsd: number; errorCode: string | null; createdAt: string; finishedAt: string | null;
  queries: { q: string; provider: string; done: boolean; ok?: boolean; results?: number }[];
}
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
export const runView = (r: ProspectRunRow): RunView => ({
  id: r.id, status: r.status, stage: r.stage, request: r.request, icp: r.icp as Icp, description: describeIcp(r.icp as Icp), quantity: r.quantity,
  counters: (r.counters ?? {}) as RunCountersExt, costUsd: Math.round(r.costMicroUsd / 100) / 10_000, errorCode: r.errorCode, createdAt: iso(r.createdAt)!, finishedAt: iso(r.finishedAt),
  queries: ((r.queries as QueryPlan[]) ?? []).map((q) => ({ q: q.q, provider: q.provider, done: q.done, ok: q.ok, results: q.results })),
});

const stable = (v: unknown): string => (Array.isArray(v) ? `[${v.map(stable).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v as object).sort().map((k) => `${k}:${stable((v as any)[k])}`).join(",")}}` : JSON.stringify(v));

export async function startRun(user: Who, raw: { request?: unknown; icp?: unknown; searches?: unknown }, opts: { by?: "user" | "agent" } = {}, d: Partial<PipelineDeps> = {}): Promise<Result<{ run: RunView; existing: boolean }>> {
  const deps = { ...pipelineDeps(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await ready())) return NOT_SETUP();
  const parsed = icpSchema.safeParse(raw.icp);
  if (!parsed.success) return fail(400, "invalid", parsed.error.issues[0]?.message ?? "That profile isn't valid.");
  const orgId = user.organizationId!;
  const icp = withSavedExclusions(parsed.data, await savedProfile(orgId));
  const providers = await deps.searchProviders();
  if (!providers.length) return fail(503, "DISCOVERY_NOT_SETUP", "Web search isn't connected on this server yet, so I can't look for companies.");
  const now = deps.now();
  if ((await deps.store.countRunsSince(orgId, new Date(now.getTime() - DAY))) >= dailyRunLimit()) return fail(429, "daily_limit", `You've started today's ${dailyRunLimit()} prospect searches. Try again tomorrow.`);
  // The searches the person saw (and may have edited) are the plan, each re-checked; none given = the default strategies.
  const given = Array.isArray(raw.searches) ? (raw.searches as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 12) : [];
  const max = runBudget(icp.quantity).queries;
  const checked = Array.from(new Set(given.map((q) => sanitizeQuery(q)).filter((c): c is { ok: true; query: string } => c.ok).map((c) => c.query)));
  const plan = checked.length ? checked.slice(0, max) : searchStrategies(icp, [], max);
  const queries: QueryPlan[] = plan.map((q, i) => ({ q, provider: providers[i % providers.length].name, done: false }));
  if (!queries.length) return fail(422, "unclear", "I couldn't build a search from that profile. Add the kind of business you want.");
  const request = typeof raw.request === "string" && raw.request.trim() ? raw.request.trim().slice(0, 500) : describeIcp(icp);
  const idemKey = createHash("sha256").update(`${orgId}|${stable(icp)}`).digest("hex");
  try {
    const run = await deps.store.createRun({ id: newRunId(), orgId, userId: user.id, by: opts.by ?? "user", request, icp, quantity: icp.quantity, idemKey, queries, now });
    (deps.kick ?? (() => outboundRunner.kick()))();
    return { ok: true, run: runView(run), existing: false };
  } catch (e) {
    if (e instanceof RunActive) {
      const run = e.runId ? await deps.store.getRun(orgId, e.runId) : null;
      if (run) { (deps.kick ?? (() => outboundRunner.kick()))(); return { ok: true, run: runView(run), existing: true }; }
    }
    throw e;
  }
}

export async function listRuns(user: Who, d: Partial<PipelineDeps> = {}): Promise<Result<{ runs: RunView[] }>> {
  const deps = { ...pipelineDeps(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  if (!(await ready())) return NOT_SETUP();
  (deps.kick ?? (() => outboundRunner.kick()))();
  return { ok: true, runs: (await deps.store.listRuns(user.organizationId!, 20)).map(runView) };
}

export async function cancelRun(user: Who, id: string, d: Partial<PipelineDeps> = {}): Promise<Result<{ run: RunView }>> {
  const deps = { ...pipelineDeps(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await ready())) return NOT_SETUP();
  const run = await deps.store.getRun(user.organizationId!, id);
  if (!run) return fail(404, "not_found", "That search isn't in your workspace.");
  if (run.status !== "running") return { ok: true, run: runView(run) };
  await deps.store.setRunStatus(user.organizationId!, id, "running", "cancelled", deps.now(), "cancelled");
  return { ok: true, run: runView((await deps.store.getRun(user.organizationId!, id))!) };
}

/* ── 3. prospects: the card and the brief ───────────────────────────────── */

export interface Evidence { id: number; kind: string; type: string; label: string; value: string; status: string; source: string; url: string | null; quote: string | null; observedAt: string | null; freshness?: string; supports?: number[]; meta?: Record<string, unknown> }
export interface ProspectCard {
  id: number; runItemId?: number; name: string; domain: string; website: string; status: string; stage?: string; rejectReason: string | null; rejectLabel: string | null;
  score: { total: number; knownMax: number; unknownPoints: number; confidence: string; components: { key: string; label: string; max: number; points: number | null; reason: string }[]; missing: string[]; readyMissing?: string[] } | null;
  ready: boolean; fit: { verdict: string; headline: string; signals: { key: string; label: string; status: string; detail: string }[] } | null;
  profile: { industry: string | null; location: string | null; country: string | null; employees: string | null; serves: string | null };
  whyNow: Evidence | null; opportunity: Evidence | null; decisionMaker: Evidence | null; evidenceCount: number; leadId: number | null; researched: boolean;
}

const LABEL: Record<string, string> = { description: "What it does", services: "Services", industry: "Industry", location: "Location", country: "Country", team_size: "Team size", target_customers: "Who they serve", business_email: "Business email", business_phone: "Phone", contact_form: "Contact page", pain_point: "Possible pain point" };

function evidenceOf(f: ProspectFindingRow, now: Date): Evidence {
  const fr = f.kind === "signal" ? freshness(f.observedAt, now) : null;
  const label = f.kind === "signal" ? (isSignalType(f.type) ? SIGNAL_LABEL[f.type] : f.type) : f.kind === "decision_maker" ? "Decision maker" : f.kind === "opportunity" ? "Opportunity" : LABEL[f.type] ?? f.type;
  return {
    id: f.id, kind: f.kind, type: f.type, label, value: f.value, status: f.status, source: f.sourceType, url: f.sourceUrl, quote: f.quote, observedAt: iso(f.observedAt),
    freshness: fr ? FRESHNESS_LABEL[fr.band] : undefined, supports: (f.supportingIds as number[]) ?? [], meta: f.kind === "decision_maker" ? (f.meta as Record<string, unknown>) : undefined,
  };
}

/** The best why-now signal: confirmed, not stale, freshest first. */
function bestSignal(fs: ProspectFindingRow[], now: Date): ProspectFindingRow | null {
  const order = { strong: 0, medium: 1, weak: 2, unknown: 3, stale: 9 } as const;
  return fs.filter((f) => f.kind === "signal" && f.status === "confirmed" && freshness(f.observedAt, now).band !== "stale")
    .sort((a, b) => order[freshness(a.observedAt, now).band] - order[freshness(b.observedAt, now).band])[0] ?? null;
}
function bestPerson(fs: ProspectFindingRow[]): ProspectFindingRow | null {
  return fs.filter((f) => f.kind === "decision_maker").sort((a, b) => {
    const ra = Number((a.meta as any)?.rank ?? 99), rb = Number((b.meta as any)?.rank ?? 99);
    const va = (a.meta as any)?.emailStatus === "verified" ? 0 : 1, vb = (b.meta as any)?.emailStatus === "verified" ? 0 : 1;
    return ra - rb || va - vb || (a.status === "confirmed" ? -1 : 1);
  })[0] ?? null;
}

export function prospectCard(p: ProspectRow, fs: ProspectFindingRow[], now: Date, item?: { id: number; stage: string; errorCode: string | null }): ProspectCard {
  const prof = (p.profile ?? {}) as Record<string, { value: string } | undefined>;
  const reason = (item?.stage === "rejected" ? item.errorCode : p.status === "rejected" ? p.rejectReason : null) as RejectReason | null;
  const sig = bestSignal(fs, now), person = bestPerson(fs);
  const opp = fs.filter((f) => f.kind === "opportunity").sort((a, b) => (a.confidence === "medium" ? -1 : 1) - (b.confidence === "medium" ? -1 : 1))[0] ?? null;
  const fit = (p.fit as any) ?? null;
  return {
    id: p.id, runItemId: item?.id, name: p.name, domain: p.domain, website: p.website, status: p.status, stage: item?.stage, rejectReason: reason, rejectLabel: reason ? REJECT_LABEL[reason] ?? reason : null,
    score: (p.score as any) ?? null, ready: p.ready, fit: fit ? { verdict: fit.verdict, headline: fit.headline, signals: fit.signals ?? [] } : null,
    profile: { industry: prof.industry?.value ?? null, location: prof.location?.value ?? null, country: prof.country?.value ?? null, employees: prof.team_size?.value ?? null, serves: prof.target_customers?.value ?? null },
    whyNow: sig ? evidenceOf(sig, now) : null, opportunity: opp ? evidenceOf(opp, now) : null, decisionMaker: person ? evidenceOf(person, now) : null,
    evidenceCount: fs.filter((f) => f.kind !== "opportunity").length, leadId: p.leadId, researched: fs.some((f) => f.batch === "research"),
  };
}

export async function getRun(user: Who, id: string, d: Partial<PipelineDeps> = {}): Promise<Result<{ run: RunView; prospects: ProspectCard[] }>> {
  const deps = { ...pipelineDeps(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  if (!(await ready())) return NOT_SETUP();
  const orgId = user.organizationId!;
  const run = await deps.store.getRun(orgId, id);
  if (!run) return fail(404, "not_found", "That search isn't in your workspace.");
  if (run.status === "running") (deps.kick ?? (() => outboundRunner.kick()))();
  const items = await deps.store.runItems(orgId, id);
  const fs = await deps.store.findingsFor(orgId, items.map((i) => i.prospectId));
  const by = new Map<number, ProspectFindingRow[]>();
  for (const f of fs) { const a = by.get(f.prospectId) ?? []; a.push(f); by.set(f.prospectId, a); }
  const now = deps.now();
  const cards = items.map((i) => prospectCard(i.prospect, by.get(i.prospectId) ?? [], now, i))
    .sort((a, b) => Number(b.ready) - Number(a.ready) || Number(!!b.score) - Number(!!a.score) || (b.score?.total ?? -1) - (a.score?.total ?? -1) || Number(!a.rejectReason) - Number(!b.rejectReason));
  return { ok: true, run: runView(run), prospects: cards };
}

export interface StoredAngle { problem: string; opportunity: string; positioning: string; targetPerson: string | null; reason: string; evidenceIds: number[]; confidence: "low" | "medium"; promptVersion?: string; at?: string }
export interface ProspectBrief { prospect: ProspectCard; facts: Evidence[]; signals: Evidence[]; people: Evidence[]; inferences: Evidence[]; opportunities: Evidence[]; sources: { provider: string; query: string; url: string; title: string }[]; angle: StoredAngle | null; providers: { contact: boolean } }

export async function getProspect(user: Who, id: number, d: Partial<PipelineDeps> = {}): Promise<Result<{ brief: ProspectBrief }>> {
  const deps = { ...pipelineDeps(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  if (!(await ready())) return NOT_SETUP();
  const orgId = user.organizationId!;
  const p = await deps.store.getProspect(orgId, id);
  if (!p) return fail(404, "not_found", "That company isn't in your workspace.");
  const fs = await deps.store.findings(orgId, id);
  const now = deps.now();
  const ev = fs.map((f) => evidenceOf(f, now));
  return {
    ok: true,
    brief: {
      prospect: prospectCard(p, fs, now),
      facts: ev.filter((e) => e.kind === "fact" && e.status === "confirmed"),
      signals: ev.filter((e) => e.kind === "signal"),
      people: ev.filter((e) => e.kind === "decision_maker").sort((a, b) => Number((a.meta as any)?.rank ?? 99) - Number((b.meta as any)?.rank ?? 99)),
      inferences: ev.filter((e) => e.kind === "fact" && e.status !== "confirmed"),
      opportunities: ev.filter((e) => e.kind === "opportunity"),
      sources: (p.sources as ProspectBrief["sources"]) ?? [], angle: (p.angle as StoredAngle | null) ?? null, providers: { contact: !!deps.contact },
    },
  };
}

/* ── 4. on-demand intelligence ──────────────────────────────────────────── */

async function runFor(orgId: string, prospectId: number, runId: unknown, deps: PipelineDeps): Promise<ProspectRunRow | null> {
  if (typeof runId !== "string" || !runId) return null;
  const run = await deps.store.getRun(orgId, runId);
  if (!run) return null;
  const items = await deps.store.runItems(orgId, runId);
  return items.some((i) => i.prospectId === prospectId) ? run : null;
}

/** Research a prospect again, now, ignoring the cache (the person asked). Synchronous: one page set, one model call. */
export async function researchProspect(user: Who, id: number, runId: unknown, d: Partial<PipelineDeps> = {}): Promise<Result<{ brief: ProspectBrief }>> {
  const deps = { ...pipelineDeps(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await ready())) return NOT_SETUP();
  const orgId = user.organizationId!;
  const p = await deps.store.getProspect(orgId, id);
  if (!p) return fail(404, "not_found", "That company isn't in your workspace.");
  if (p.status === "rejected") return fail(409, "rejected", `This company was set aside: ${REJECT_LABEL[(p.rejectReason ?? "failed") as RejectReason] ?? "it couldn't be checked"}.`);
  const run = await runFor(orgId, id, runId, deps);
  if (!run) return fail(404, "not_found", "Open this company from one of your searches to research it.");
  const icp = run.icp as Icp;
  const ctxRun = { id: run.id, organizationId: orgId, createdByUser: user.id };
  try {
    if (!(p.profile && Object.keys(p.profile as object).length)) await enrichOne(ctxRun, icp, null, deps, p);
    const fresh = (await deps.store.getProspect(orgId, id))!;
    const saved = await savedProfile(orgId);
    const r = await researchOne(ctxRun, icp, null, deps, { force: true, prospect: fresh, offer: saved?.about ?? null });
    if (!r) return fail(502, "unreachable", "The company's website didn't load. Try again later.");
  } catch (e) {
    const f = capFail(e, "signals");
    if (f) return f;
    agentLog("error", { errorType: (e as Error)?.name ?? "Error", where: "outbound_research" });
    return fail(502, "model_unavailable", "The research didn't finish. Try again in a moment.");
  }
  return getProspect(user, id, d);
}

/** Named people at the company from the connected contact provider, with the provider's own verification status. */
export async function findContacts(user: Who, id: number, runId: unknown, d: Partial<PipelineDeps> = {}): Promise<Result<{ brief: ProspectBrief; found: number }>> {
  const deps = { ...pipelineDeps(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await ready())) return NOT_SETUP();
  if (!deps.contact) return fail(503, "CONTACTS_NOT_SETUP", "No contact data provider is connected. People named on the company's own website are shown after research.");
  const orgId = user.organizationId!;
  const p = await deps.store.getProspect(orgId, id);
  if (!p) return fail(404, "not_found", "That company isn't in your workspace.");
  const run = await runFor(orgId, id, runId, deps);
  const icp = (run?.icp as Icp | undefined) ?? { roles: [] as string[] } as unknown as Icp;
  const now = deps.now();
  if ((await deps.store.countProviderCalls({ orgId, operation: "contact", since: new Date(now.getTime() - DAY) })) >= dailyContactLimit()) return fail(429, "daily_limit", `You've used today's ${dailyContactLimit()} contact lookups. Try again tomorrow.`);
  let people;
  const t0 = Date.now();
  try {
    people = await deps.contact.findPeople(p.domain, { limit: 10 });
    await deps.store.recordProviderCall({ orgId, runId: run?.id ?? null, provider: deps.contact.name, operation: "contact", ok: true, errorCode: null, latencyMs: Date.now() - t0, costMicroUsd: 0, now });
  } catch (e) {
    await deps.store.recordProviderCall({ orgId, runId: run?.id ?? null, provider: deps.contact.name, operation: "contact", ok: false, errorCode: e instanceof DiscoveryError ? e.code : "error", latencyMs: Date.now() - t0, costMicroUsd: 0, now });
    return fail(502, "provider_unavailable", "The contact data service didn't answer. Try again later.");
  }
  // A provider's person is a third party's record: stored as INFERRED, with the provider's own email status, never upgraded.
  const findings = people.map((c) => ({
    kind: "decision_maker", type: c.title.slice(0, 40), value: `${c.name}, ${c.title}`.slice(0, 400), status: "inferred", sourceUrl: null, sourceType: "provider", quote: null, confidence: c.confidence >= 80 ? "medium" : "low",
    meta: { name: c.name, title: c.title, rank: roleRank(icp, c.title), email: c.email, emailStatus: c.emailStatus, providerConfidence: c.confidence, provider: c.source },
  }));
  await deps.store.saveStep({ orgId, prospectId: id, batch: "contact", findings, now });
  await scoreProspect(orgId, id, deps);
  const b = await getProspect(user, id, d);
  return b.ok ? { ok: true, brief: b.brief, found: findings.length } : b;
}

/** The outreach angle: from stored findings only (cited by id), checked by code before it is kept. */
export async function generateAngle(user: Who, id: number, d: Partial<PipelineDeps> = {}): Promise<Result<{ brief: ProspectBrief }>> {
  const deps = { ...pipelineDeps(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await ready())) return NOT_SETUP();
  const orgId = user.organizationId!;
  const p = await deps.store.getProspect(orgId, id);
  if (!p) return fail(404, "not_found", "That company isn't in your workspace.");
  const fs = (await deps.store.findings(orgId, id)).filter((f) => f.kind !== "decision_maker" && (f.kind !== "signal" || freshness(f.observedAt, deps.now()).band !== "stale"));
  if (!fs.some((f) => f.kind === "signal" || f.kind === "opportunity" || f.type === "pain_point")) return fail(422, "no_evidence", "There's nothing yet that says why to reach out now. Research the company first.");
  const people = (await deps.store.findings(orgId, id)).filter((f) => f.kind === "decision_maker").map((f) => String((f.meta as any)?.name ?? f.value.split(",")[0]));
  const saved = await savedProfile(orgId);
  const list = fs.map((f) => ({ id: f.id, label: f.kind === "signal" ? `Signal (${isSignalType(f.type) ? SIGNAL_LABEL[f.type] : f.type})` : f.kind === "opportunity" ? "Opportunity" : LABEL[f.type] ?? f.type, value: f.value, inferred: f.status !== "confirmed" }));
  let angle = null, why = "";
  try {
    for (let attempt = 0; attempt < 2 && !angle; attempt++) {
      const reply = await deps.chat({ task: "angle", orgId, userId: user.id, promptVersion: PROMPT_VERSIONS.angle },
        [{ role: "system", content: angleSystemPrompt() }, { role: "user", content: angleUserMessage(p.name, saved?.about ?? null, list, people) }], { maxTokens: 2000 });
      const r = normalizeAngle(parseJsonObject(reply.content), { allowedIds: list.map((x) => x.id), people, siteHost: p.domain });
      angle = r.angle; why = r.reason ?? "";
    }
  } catch (e) {
    const f = capFail(e, "angle");
    if (f) return f;
    return fail(502, "model_unavailable", "The angle couldn't be written. Try again in a moment.");
  }
  if (!angle) return fail(422, "angle_rejected", "The suggested angle didn't pass the checks, so it wasn't kept. Try again.", { why });
  await deps.store.updateProspect(orgId, id, { angle: { ...angle, promptVersion: PROMPT_VERSIONS.angle, at: deps.now().toISOString() }, updatedAt: deps.now() });
  return getProspect(user, id, d);
}

/* ── 5. into the CRM ─────────────────────────────────────────────────────── */

const CLAIM_FIELD: Record<string, string> = { HIRING: "hiring", FUNDING: "funding", NEW_SERVICE: "launch" };

/**
 * Adds a prospect to Leads through the normal lead service (its duplicate rules apply), then copies the evidence into
 * the lead's facts once. A named contact's email is set on the lead ONLY when the person chose that contact here.
 */
export async function addToLeads(user: Who, id: number, raw: { contactFindingId?: unknown } = {}, d: Partial<PipelineDeps> = {}): Promise<Result<{ leadId: number; existing: boolean }>> {
  const deps = { ...pipelineDeps(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await ready())) return NOT_SETUP();
  const orgId = user.organizationId!;
  const p = await deps.store.getProspect(orgId, id);
  if (!p) return fail(404, "not_found", "That company isn't in your workspace.");
  if (p.leadId) return { ok: true, leadId: p.leadId, existing: true };
  if (p.status === "rejected") return fail(409, "rejected", "This company was set aside, so it can't be added as a lead.");
  const fs = await deps.store.findings(orgId, id);
  const prof = (p.profile ?? {}) as Record<string, { value: string } | undefined>;
  const chosen = typeof raw.contactFindingId === "number" ? fs.find((f) => f.id === raw.contactFindingId && f.kind === "decision_maker") : undefined;
  if (raw.contactFindingId !== undefined && !chosen) return fail(400, "invalid", "That contact isn't one of this company's people.");
  const top = chosen ?? bestPerson(fs.filter((f) => f.status === "confirmed"));
  const meta = (top?.meta ?? {}) as Record<string, any>;
  const score = p.score as any;
  const fields = {
    companyName: p.name, website: p.website, industry: prof.industry?.value?.slice(0, 80), location: [prof.location?.value, prof.country?.value].filter(Boolean).join(", ").slice(0, 80) || undefined,
    sizeHint: prof.team_size?.value?.slice(0, 60), fitSummary: [(p.fit as any)?.headline, prof.target_customers?.value ? `Serves ${prof.target_customers.value}` : null].filter(Boolean).join(" ").slice(0, 1000) || undefined,
    contactName: meta.name?.slice(0, 100), contactRole: meta.title?.slice(0, 100),
    // Only the person's chosen contact, and only an address the provider itself verified.
    contactEmail: chosen && meta.email && meta.emailStatus === "verified" ? String(meta.email) : undefined,
    contactSource: top ? (top.sourceType === "website" ? `Named on ${top.sourceUrl ?? "their website"}`.slice(0, 200) : `${meta.provider ?? "provider"} (${meta.emailStatus ?? "unverified"})`) : undefined,
  };
  const created = await createLead(user, fields, { source: "outbound", actor: "user" });
  if (!created.ok) {
    if (created.code === "duplicate" && typeof created.existingId === "number") { await deps.store.linkLead(orgId, id, created.existingId); return { ok: true, leadId: created.existingId, existing: true }; }
    return created;
  }
  const leadId = created.lead.id;
  if (!(await deps.store.linkLead(orgId, id, leadId))) return { ok: true, leadId, existing: false };
  for (const f of fs) {
    if (f.kind === "opportunity" && !f.value) continue;
    const field = f.kind === "signal" ? CLAIM_FIELD[f.type] ?? "recent_news" : f.kind === "decision_maker" ? "decision_maker" : f.kind === "opportunity" ? "opportunity" : f.type;
    const value = f.kind === "signal" ? `${isSignalType(f.type) ? SIGNAL_LABEL[f.type] : f.type}: ${f.value}` : f.value;
    const confirmed = f.status === "confirmed" && !!f.sourceUrl && !!f.quote && f.quote.length >= 8;
    await addClaim(user, leadId, { field, value: value.slice(0, 400), status: confirmed ? "confirmed" : "inferred", ...(f.sourceUrl ? { evidenceUrl: f.sourceUrl } : {}), ...(f.quote && f.quote.length >= 8 ? { evidenceSnippet: f.quote.slice(0, 500) } : {}) }, { actor: "agent" });
  }
  await addNote(user, leadId, `Added from AI Outbound${score ? ` (score ${score.total}/100)` : ""}. Evidence copied to Facts.`, { actor: "user" });
  return { ok: true, leadId, existing: false };
}
