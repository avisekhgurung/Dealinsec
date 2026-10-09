/**
 * The module replacements that let the REAL agent loop, policy, tools and
 * services run against the in-memory world (./world.ts) with no database,
 * billing provider, mail server or network.
 *
 * vitest requires `vi.mock` calls to sit at the top of each test file, so the
 * files that need the world (cases.test.ts, live/agent.eval.ts) each declare
 *
 *   vi.mock("../../storage", async () => (await import("./world-mocks")).storageMock());
 *
 * and share these factories. They read the current world from
 * `globalThis.__world`, so a test only has to assign a fresh `createWorld()`
 * before each run. Test-only: never imported by server code.
 */
import type { World } from "./world";

const world = () => (globalThis as any).__world as World;

/** Install a world for the next run. */
export function useWorld(w: World): void {
  (globalThis as any).__world = w;
}

export const storageMock = () => ({
  storage: new Proxy({}, { get: (_t, p) => (...a: any[]) => world().storage[p as string](...a) }),
});

/** The lead store: the world's in-memory one, behind the same module name the services import. */
export const leadsStoreMock = () => ({
  leadsStore: new Proxy({}, { get: (_t, p) => (...a: any[]) => (world().leads as any)[p](...a) }),
  leadsTablesReady: async () => true,
});

/** The ideal-client store: the world's map, behind the module name the service imports. */
export const profileStoreMock = () => ({
  profileTableReady: async () => true,
  profileStore: {
    get: async (orgId: string) => { const r = world().profiles.get(orgId); return r ? { ...r } : null; },
    save: async (orgId: string, data: Record<string, any>, userId: string) => {
      if (world().readOnly) throw new Error("WRITE ATTEMPTED BY A READ-ONLY TOOL");
      const row = { organizationId: orgId, ...data, updatedBy: userId, updatedAt: new Date() };
      world().profiles.set(orgId, row);
      return { ...row };
    },
  },
});

/** The document-style store: the world's map, behind the module name the service imports. */
export const documentStyleStoreMock = () => ({
  documentStyleTableReady: async () => true,
  documentStyleStore: {
    get: async (orgId: string) => { const r = world().documentStyles.get(orgId); return r ? { ...r } : null; },
    save: async (orgId: string, data: Record<string, any>, userId: string) => {
      if (world().readOnly) throw new Error("WRITE ATTEMPTED BY A READ-ONLY TOOL");
      const row = { organizationId: orgId, ...data, updatedBy: userId, updatedAt: new Date() };
      world().documentStyles.set(orgId, row);
      return { ...row };
    },
  },
});

/** The knowledge store, in memory, behind the module name the service imports. Search counts matching words; the real ranking is Postgres (checked in the smoke test, not here). */
export const knowledgeStoreMock = () => {
  const w = () => world();
  const guardWrite = () => { if (w().readOnly) throw new Error("WRITE ATTEMPTED BY A READ-ONLY TOOL"); };
  const words = (t: string) => t.toLowerCase().split(/[^a-z0-9\u00c0-\uffff]+/).filter(Boolean).map((x) => x.replace(/(ies|es|s)$/, ""));
  let n = 0;
  return {
    knowledgeTablesReady: async () => true,
    knowledgeStore: {
      list: async (orgId: string) => w().knowledge.sources.filter((r) => r.organizationId === orgId).map((r) => ({ ...r })),
      get: async (orgId: string, id: string) => { const r = w().knowledge.sources.find((x) => x.organizationId === orgId && x.id === id); return r ? { ...r } : null; },
      usage: async (orgId: string) => ({ sources: w().knowledge.sources.filter((r) => r.organizationId === orgId).length, chunks: w().knowledge.chunks.filter((c) => c.organizationId === orgId).length }),
      findByHash: async (orgId: string, sha: string) => { const r = w().knowledge.sources.find((x) => x.organizationId === orgId && x.sha256 === sha); return r ? { ...r } : null; },
      create: async (orgId: string, input: Record<string, any>, chunks: string[], file?: { mime: string; bytes: Buffer }) => {
        guardWrite();
        if (w().knowledge.sources.some((x) => x.organizationId === orgId && x.sha256 === input.sha256)) throw Object.assign(new Error("duplicate"), { code: "23505" });
        const row = { id: `ks-${++n}`, organizationId: orgId, sourceUrl: null, fileName: null, mime: null, sizeBytes: null, description: null, createdAt: new Date(), ...input, chunkCount: chunks.length };
        w().knowledge.sources.push(row);
        chunks.forEach((content, position) => w().knowledge.chunks.push({ sourceId: row.id, organizationId: orgId, position, content }));
        if (file) w().knowledge.files.set(row.id, { organizationId: orgId, ...file });
        return { ...row };
      },
      remove: async (orgId: string, id: string) => {
        guardWrite();
        const i = w().knowledge.sources.findIndex((x) => x.organizationId === orgId && x.id === id);
        if (i < 0) return false;
        w().knowledge.sources.splice(i, 1);
        w().knowledge.chunks = w().knowledge.chunks.filter((c) => c.sourceId !== id);
        w().knowledge.files.delete(id);
        return true;
      },
      file: async (orgId: string, id: string) => { const f = w().knowledge.files.get(id); return f && f.organizationId === orgId ? { mime: f.mime, bytes: f.bytes } : null; },
      search: async (orgId: string, terms: string[], limit: number) => {
        const want = terms.flatMap(words);
        return w().knowledge.chunks.filter((c) => c.organizationId === orgId)
          .map((c) => { const have = new Set(words(c.content)); return { c, rank: want.filter((t) => have.has(t)).length }; })
          .filter((x) => x.rank > 0).sort((a, b) => b.rank - a.rank).slice(0, limit)
          .map(({ c, rank }) => { const s = w().knowledge.sources.find((x) => x.id === c.sourceId)!; return { sourceId: c.sourceId, title: s.title, kind: s.kind, sourceUrl: s.sourceUrl, position: c.position, content: c.content, rank }; });
      },
    },
  };
};

/** The network guard with the real rules and a fake web: pages and DNS answers come from the world. */
export const netGuardMock = async (orig: () => Promise<any>) => {
  const actual = await orig();
  const realPageIO = {
    lookup: async (host: string) => { const a = world().knowledge.dns[host]; if (!a) throw new Error("ENOTFOUND"); return a; },
    get: async (url: URL) => {
      const page = world().knowledge.web[url.hostname + url.pathname];
      if (!page) throw new Error("ECONNREFUSED");
      return { status: page.status, headers: page.headers, read: async () => new TextEncoder().encode(page.body) };
    },
  };
  return { ...actual, realPageIO, fetchPublicPage: (raw: string, io = realPageIO, max?: number, opts?: unknown) => actual.fetchPublicPage(raw, io, max, opts) };
};

/** The sales agent's research store, in memory. One running run per lead id (as the database's partial unique index guarantees). */
export const researchStoreMock = () => {
  class RunBusy extends Error { constructor() { super("research is already running for this lead"); } }
  let seq = 0;
  const w = () => world();
  return {
    RunBusy,
    salesTablesReady: async () => w().salesReady,
    researchStore: {
      startRun: async (o: { orgId: string; leadId: number; by: string; userId: string; now: Date; staleMs: number }) => {
        if (w().readOnly) throw new Error("WRITE ATTEMPTED BY A READ-ONLY TOOL");
        for (const r of w().research) if (r.organizationId === o.orgId && r.leadId === o.leadId && r.status === "running" && r.startedAt < new Date(o.now.getTime() - o.staleMs)) { r.status = "failed"; r.errorCode = "stale"; r.finishedAt = o.now; }
        if (w().research.some((r) => r.leadId === o.leadId && r.status === "running")) throw new RunBusy();
        const row = { id: ++seq, leadId: o.leadId, organizationId: o.orgId, status: "running", startedAt: o.now, finishedAt: null, pages: [], claimIds: [], summary: null, errorCode: null, model: null, promptVersion: null, createdBy: o.by, createdByUser: o.userId };
        w().research.push(row);
        return { ...row };
      },
      finish: async (orgId: string, id: number, r: Record<string, any>) => {
        const row = w().research.find((x) => x.id === id && x.organizationId === orgId && x.status === "running");
        if (row) Object.assign(row, { status: r.status, finishedAt: r.finishedAt, pages: r.pages, claimIds: r.claimIds, summary: r.summary ?? null, errorCode: r.errorCode ?? null, model: r.model ?? null, promptVersion: r.promptVersion ?? null });
      },
      latest: async (orgId: string, leadId: number) => {
        const rows = w().research.filter((x) => x.organizationId === orgId && x.leadId === leadId).sort((a, b) => b.startedAt - a.startedAt || b.id - a.id);
        return rows[0] ? { ...rows[0] } : null;
      },
    },
  };
};

/** Outreach messages, in memory, with the database's rules: one unsent (draft or approved) message per lead, and a status change that applies only if the row is still in the status the caller saw. */
export const messageStoreMock = () => {
  class DraftExists extends Error { constructor() { super("this lead already has an unsent message"); } }
  let seq = 0;
  const w = () => world();
  const mine = (orgId: string, id: number) => w().messages.find((m) => m.organizationId === orgId && m.id === id);
  return {
    DraftExists,
    messagesTablesReady: async () => w().messagesReady,
    messageStore: {
      create: async (m: Record<string, any>) => {
        if (w().readOnly) throw new Error("WRITE ATTEMPTED BY A READ-ONLY TOOL");
        if (w().messages.some((x) => x.organizationId === m.orgId && x.leadId === m.leadId && x.direction === "out" && (x.status === "draft" || x.status === "approved"))) throw new DraftExists();
        const row = { id: ++seq, leadId: m.leadId, organizationId: m.orgId, direction: "out", channel: "manual", subject: m.subject, body: m.body, bodyHash: m.bodyHash, toAddress: m.toAddress, toSource: m.toSource, status: "draft", researchId: m.researchId, claimIds: m.claimIds, promptVersion: m.promptVersion, edited: false, createdBy: m.by, createdByUser: m.userId, approvedBy: null, approvedAt: null, sentAt: null, createdAt: m.now, updatedAt: m.now };
        w().messages.push(row);
        return { ...row };
      },
      get: async (orgId: string, id: number) => { const r = mine(orgId, id); return r ? { ...r } : null; },
      listForLead: async (orgId: string, leadId: number) => w().messages.filter((m) => m.organizationId === orgId && m.leadId === leadId).sort((a, b) => b.createdAt - a.createdAt || b.id - a.id).map((m) => ({ ...m })),
      unsent: async (orgId: string, leadId: number) => { const r = w().messages.find((m) => m.organizationId === orgId && m.leadId === leadId && m.direction === "out" && (m.status === "draft" || m.status === "approved")); return r ? { ...r } : null; },
      transition: async (o: { orgId: string; id: number; from: string; to: string; hash?: string; now: Date; set?: Record<string, any> }) => {
        if (w().readOnly) throw new Error("WRITE ATTEMPTED BY A READ-ONLY TOOL");
        const r = mine(o.orgId, o.id);
        if (!r || r.status !== o.from || (o.hash && r.bodyHash !== o.hash)) return null;
        Object.assign(r, o.set ?? {}, { status: o.to, updatedAt: o.now });
        return { ...r };
      },
    },
  };
};

/** AI Outbound's store, in memory, with the database's guarantees: one active run per organization and ICP, one prospect per organization and domain, one item per run and prospect, an atomic lease claim, and saveStep all-or-nothing. */
export const outboundStoreMock = () => {
  class RunActive extends Error { constructor(public runId: string) { super("a run with this ICP is already in progress"); } }
  let pseq = 0, iseq = 0, fseq = 0;
  const o = () => world().outbound;
  const ro = () => { if (world().readOnly) throw new Error("WRITE ATTEMPTED BY A READ-ONLY TOOL"); };
  const copy = <T extends object | null | undefined>(x: T): T => (x ? JSON.parse(JSON.stringify(x), (k, v) => (typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && /(At|Until|at)$/.test(k) ? new Date(v) : v)) : x);
  const withP = (items: any[], orgId?: string) => items.map((i) => ({ ...copy(i), prospect: copy(o().prospects.find((p) => p.id === i.prospectId && (!orgId || p.organizationId === orgId))) })).filter((x) => x.prospect);
  const order = (a: any, b: any) => b.rank - a.rank || a.id - b.id;
  return {
    RunActive,
    prospectsTablesReady: async () => o().ready && world().salesReady,
    outboundStore: {
      async createRun(r: any) {
        ro();
        const active = o().runs.find((x) => x.organizationId === r.orgId && x.idemKey === r.idemKey && x.status === "running");
        if (active) throw new RunActive(active.id);
        const row = { id: r.id, organizationId: r.orgId, createdByUser: r.userId, createdBy: r.by, request: r.request, icp: r.icp, quantity: r.quantity, status: "running", stage: "search", counters: {}, queries: r.queries, costMicroUsd: 0, errorCode: null, idemKey: r.idemKey, leaseUntil: null, attempts: 0, createdAt: r.now, updatedAt: r.now, finishedAt: null };
        o().runs.push(row);
        return copy(row);
      },
      async getRun(orgId: string, id: string) { return copy(o().runs.find((x) => x.organizationId === orgId && x.id === id) ?? null); },
      async listRuns(orgId: string, limit: number) { return o().runs.filter((x) => x.organizationId === orgId).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).map(copy); },
      async countRunsSince(orgId: string, since: Date) { return o().runs.filter((x) => x.organizationId === orgId && x.createdAt >= since).length; },
      async claimRun(now: Date, leaseMs: number) {
        const r = o().runs.filter((x) => x.status === "running" && (!x.leaseUntil || x.leaseUntil < now)).sort((a, b) => a.updatedAt - b.updatedAt)[0];
        if (!r) return null;
        r.leaseUntil = new Date(now.getTime() + leaseMs); r.attempts += 1; r.updatedAt = now;
        return { ...copy(r), fence: r.attempts };
      },
      // Fenced like the real store: the claim number must still match and the run must still be running.
      async updateRun(id: string, fence: number, set: any) { ro(); const r = o().runs.find((x) => x.id === id && x.attempts === fence && x.status === "running"); if (!r) return false; Object.assign(r, copy(set)); return true; },
      async setLease(id: string, fence: number, until: Date | null) { const r = o().runs.find((x) => x.id === id && x.attempts === fence && x.status === "running"); if (!r) return false; r.leaseUntil = until; return true; },
      async finishRun(orgId: string, id: string, fence: number, s: any) {
        ro();
        const r = o().runs.find((x) => x.organizationId === orgId && x.id === id && x.attempts === fence && x.status === "running");
        if (!r) return false;
        Object.assign(r, { stage: "done", status: s.status, counters: copy(s.counters), costMicroUsd: s.costMicroUsd, errorCode: s.errorCode, finishedAt: s.now, updatedAt: s.now, leaseUntil: null });
        return true;
      },
      async nextLeaseExpiry(now: Date) { const t = o().runs.filter((x) => x.status === "running" && x.leaseUntil && x.leaseUntil > now).map((x) => x.leaseUntil.getTime()); return t.length ? new Date(Math.min(...t)) : null; },
      async setRunStatus(orgId: string, id: string, from: string, to: string, now: Date, errorCode: string | null = null) {
        const r = o().runs.find((x) => x.organizationId === orgId && x.id === id && x.status === from);
        if (!r) return false;
        Object.assign(r, { status: to, updatedAt: now, finishedAt: to === "running" ? null : now, errorCode, leaseUntil: null });
        return true;
      },
      async upsertProspect(orgId: string, p: any, now: Date) {
        ro();
        const cur = o().prospects.find((x) => x.organizationId === orgId && x.domain === p.domain);
        if (cur) { cur.sources = [...cur.sources, ...p.sources].slice(0, 20); cur.updatedAt = now; return copy(cur); }
        const row = { id: ++pseq, organizationId: orgId, domain: p.domain, name: p.name.slice(0, 120), website: p.website, status: "candidate", rejectReason: null, sources: p.sources, profile: {}, fit: null, score: null, angle: null, ready: false, contentHash: null, verifiedAt: null, researchedAt: null, leadId: null, createdAt: now, updatedAt: now };
        o().prospects.push(row);
        return copy(row);
      },
      async getProspect(orgId: string, id: number) { return copy(o().prospects.find((x) => x.organizationId === orgId && x.id === id) ?? null); },
      async updateProspect(orgId: string, id: number, set: any) { ro(); const p = o().prospects.find((x) => x.organizationId === orgId && x.id === id); if (!p) return null; Object.assign(p, copy(set)); return copy(p); },
      async linkLead(orgId: string, id: number, leadId: number) { const p = o().prospects.find((x) => x.organizationId === orgId && x.id === id && !x.leadId); if (!p) return false; p.leadId = leadId; return true; },
      async prospectMatching(orgId: string, m: { domain: string | null; name: string }) { return copy(o().prospects.find((x) => x.organizationId === orgId && (m.domain ? x.domain === m.domain : x.name.toLowerCase() === m.name.toLowerCase())) ?? null); },
      async prospectsLike(orgId: string, text: string, limit: number) { const t = text.toLowerCase(); return o().prospects.filter((x) => x.organizationId === orgId && (x.name.toLowerCase().includes(t) || x.domain.includes(t))).sort((a, b) => b.id - a.id).slice(0, limit).map(copy); },
      async prospectByLead(orgId: string, leadId: number) { return copy(o().prospects.find((x) => x.organizationId === orgId && x.leadId === leadId) ?? null); },
      async addRunItem(i: any) {
        ro();
        if (o().items.some((x) => x.runId === i.runId && x.prospectId === i.prospectId)) return;
        o().items.push({ id: ++iseq, runId: i.runId, organizationId: i.orgId, prospectId: i.prospectId, rank: 0, stage: i.stage, attempts: 0, errorCode: null, nextAttemptAt: null, updatedAt: i.now });
      },
      async itemsAt(runId: string, stage: string, limit: number, now: Date) { return withP(o().items.filter((x) => x.runId === runId && x.stage === stage && (!x.nextAttemptAt || x.nextAttemptAt <= now)).sort(order).slice(0, limit)); },
      async runItems(orgId: string, runId: string) { return withP(o().items.filter((x) => x.organizationId === orgId && x.runId === runId).sort(order), orgId); },
      async setItem(id: number, set: any) { ro(); const i = o().items.find((x) => x.id === id); if (i) Object.assign(i, copy(set)); },
      async findings(orgId: string, prospectId: number) { return o().findings.filter((f) => f.organizationId === orgId && f.prospectId === prospectId).sort((a, b) => a.id - b.id).map(copy); },
      async findingsFor(orgId: string, ids: number[]) { return o().findings.filter((f) => f.organizationId === orgId && ids.includes(f.prospectId)).sort((a, b) => a.id - b.id).map(copy); },
      async saveStep(s: any) {
        ro();
        if (world().outboundFailNextSave) { world().outboundFailNextSave = false; throw new Error("simulated crash inside the transaction"); }
        o().findings = o().findings.filter((f) => !(f.organizationId === s.orgId && f.prospectId === s.prospectId && f.batch === s.batch));
        const saved: any[] = [];
        for (const f of s.findings) {
          const supportingIds = (f.supports ?? []).map((x: any) => x.findingId ?? saved[x.local ?? -1]?.id).filter((x: any) => typeof x === "number");
          const row = { id: ++fseq, organizationId: s.orgId, prospectId: s.prospectId, kind: f.kind, type: f.type.slice(0, 40), value: f.value.slice(0, 400), status: f.status, sourceUrl: f.sourceUrl ?? null, sourceType: f.sourceType, quote: f.quote ?? null, contentHash: f.contentHash ?? null, observedAt: f.observedAt ?? null, confidence: f.confidence ?? "medium", supportingIds, meta: f.meta ?? {}, batch: s.batch, retrievedAt: s.now };
          o().findings.push(row); saved.push(row);
        }
        if (s.prospect) { const p = o().prospects.find((x) => x.organizationId === s.orgId && x.id === s.prospectId); if (p) Object.assign(p, copy(s.prospect), { updatedAt: s.now }); }
        if (s.itemId && s.item) { const i = o().items.find((x) => x.id === s.itemId && x.organizationId === s.orgId); if (i) Object.assign(i, copy(s.item), { updatedAt: s.now }); }
        return saved.map(copy);
      },
      async recordProviderCall(r: any) { o().providerCalls.push({ organizationId: r.orgId, runId: r.runId, provider: r.provider, operation: r.operation, ok: r.ok, errorCode: r.errorCode, latencyMs: r.latencyMs, costMicroUsd: r.costMicroUsd, createdAt: r.now }); },
      async countProviderCalls(q: { orgId?: string; operation: string; since: Date }) { return o().providerCalls.filter((c) => (!q.orgId || c.organizationId === q.orgId) && c.operation === q.operation && c.createdAt >= q.since).length; },
      async runCostMicroUsd(runId: string) { return world().llmCalls.filter((c) => c.runId === runId).reduce((n, c) => n + (c.costMicroUsd ?? 0), 0) + o().providerCalls.filter((c) => c.runId === runId).reduce((n, c) => n + c.costMicroUsd, 0); },
    },
  };
};

/** The model-call trace, in memory: what the daily allowances count. */
export const traceStoreMock = () => ({
  llmTraceReady: async () => world().salesReady,
  traceStore: {
    record: async (row: Record<string, any>) => { world().llmCalls.push({ ...row, createdAt: new Date() }); },
    count: async (o: { orgId: string; task: string; since: Date }) => world().llmCalls.filter((c) => c.organizationId === o.orgId && c.task === o.task && c.ok && c.createdAt >= o.since).length,
    spendMicroUsd: async (o: { orgId: string; since: Date }) => world().llmCalls.filter((c) => c.organizationId === o.orgId && c.createdAt >= o.since).reduce((n, c) => n + c.costMicroUsd, 0),
  },
});

/** The web search: configured/unconfigured, canned results, and the usage counters, all from the world. */
export const discoveryProviderMock = async () => {
  const { DiscoveryError } = await import("../../discovery/types");
  const provider = {
      name: "fake",
      get label() { return world().discovery.provider.label; },
      get paid() { return world().discovery.provider.paid; },
      get supportsCountry() { return world().discovery.provider.supportsCountry; },
      search: async (q: string, o?: { country?: string }) => {
        const d = world().discovery;
        d.queries.push(q);
        d.countries.push(o?.country);
        if (d.error) throw new DiscoveryError(d.error as any, "The search service had a problem.");
        return d.results;
      },
  };
  return {
    discoveryConfigured: () => world().discovery.configured,
    discoveryProvider: provider,
    outboundSearchProviders: async () => (world().discovery.configured ? [provider] : []),
  };
};
export const discoveryUsageMock = () => ({
  searchCount: async (o: { orgId?: string }) => (o.orgId ? world().discovery.usedDay : world().discovery.usedMonth),
});

export const entitlementsMock = () => ({
  getBillingUser: async (u: any) =>
    world().billing.get(u.organizationId) ?? { id: u.id, plan: "pro", planExpiresAt: new Date(Date.now() + 365 * 86_400_000) },
  logOrgActivity: (_u: any, action: string, entityType: string, entityId?: unknown, detail?: string) =>
    world().activity.push({ action, entityType, entityId, detail }),
});

export const emailsMock = () => ({
  appUrl: () => "https://app.test",
  sendEmail: async (a: any) => { world().emails.push({ to: a.to, subject: a.subject }); },
  contractSignedEmail: () => ({ subject: "Agreement created", html: "" }),
  paymentReceivedEmail: () => ({ subject: "Payment received", html: "" }),
});

export async function routesMock() {
  const { documentLocaleSettings } = await import("@shared/money");
  const issuedCurrency = (row: any) => (typeof row?.currency === "string" && row.currency ? row.currency : null);
  const documentLocaleFor = async (user: any, row?: any) =>
    documentLocaleSettings(world().orgs.get(user.organizationId), user, issuedCurrency(row) ? { currency: issuedCurrency(row) } : null);
  return {
    documentLocaleFor,
    issuedCurrency,
    issuingContext: async (user: any) => {
      const settings = await documentLocaleFor(user);
      return { owner: user, settings, issued: { issuerSnapshot: {}, currency: settings.currency } };
    },
    invoiceableRemainingMinor: async (contract: any, _user: any, excludeId?: number) =>
      Number(contract.contractValueMinor) - world().invoices
        .filter((i: any) => i.dealId === contract.dealId && i.contractId === contract.id && i.id !== excludeId)
        .reduce((s: number, i: any) => s + (i.dealAmountMinor || 0), 0),
  };
}

/** A scripted model: the provider's answers come from `world.llm`. */
export async function scriptedProviderMock(importOriginal: () => Promise<any>) {
  const real = await importOriginal();
  return {
    ...real,
    aiProvider: { name: "fake", model: "fake", isConfigured: () => true, chat: (m: any[]) => world().llm(m) },
  };
}
