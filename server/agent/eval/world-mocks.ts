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
  return { ...actual, realPageIO, fetchPublicPage: (raw: string, io = realPageIO, max?: number) => actual.fetchPublicPage(raw, io, max) };
};

/** The web search: configured/unconfigured, canned results, and the usage counters, all from the world. */
export const discoveryProviderMock = async () => {
  const { DiscoveryError } = await import("../../discovery/types");
  return {
    discoveryConfigured: () => world().discovery.configured,
    discoveryProvider: {
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
    },
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
