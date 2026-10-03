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

/** The web search: configured/unconfigured, canned results, and the usage counters, all from the world. */
export const discoveryProviderMock = async () => {
  const { DiscoveryError } = await import("../../discovery/types");
  return {
    discoveryConfigured: () => world().discovery.configured,
    discoveryProvider: {
      name: "fake",
      search: async (q: string) => {
        const d = world().discovery;
        d.queries.push(q);
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
