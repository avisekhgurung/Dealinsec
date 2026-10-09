/**
 * A small in-memory DealInSec for the evaluation suite: the same storage
 * methods the real tools call, backed by arrays. With it the REAL agent loop,
 * policy, tools and services run in a test with no database — only storage,
 * billing, email and the model are replaced.
 *
 * Test-only. Installed through vi.mock in the test files (see cases.test.ts),
 * which route `storage`, `entitlements`, `emails` and the model to the
 * `globalThis.__world` created here.
 */

import { FakeLeadsStore } from "./leads-fake";

export interface Row { [k: string]: any }

export interface World {
  orgs: Map<string, Row>;
  users: Map<string, Row>;
  deals: Row[]; quotes: Row[]; contracts: Row[]; invoices: Row[];
  activity: { action: string; entityType: string; entityId?: unknown; detail?: string }[];
  /** Every email the services tried to send. */
  emails: { to: string; subject: string }[];
  /** orgId → billing record (plan). Missing = Pro. */
  billing: Map<string, Row>;
  credits: { spent: number; regranted: number };
  /** Set per test: answers the tool-less extraction / chaser model calls. */
  llm: (messages: { role: string; content: string }[]) => Promise<{ content: string | null; toolCalls: []; usage?: { inputTokens: number; outputTokens: number } }>;
  /** Make every write throw (to prove a read tool never writes). */
  readOnly: boolean;
  storage: Record<string, (...a: any[]) => any>;
  /** The lead pipeline's store (same semantics as the database one). */
  leads: FakeLeadsStore;
  /** orgId -> the ideal-client row. */
  profiles: Map<string, Row>;
  /** orgId -> the document-style row. */
  documentStyles: Map<string, Row>;
  /** The sales agent: research runs, the model-call trace, and whether its tables exist. */
  research: Row[]; llmCalls: Row[]; salesReady: boolean;
  /** Outreach messages, and whether their table exists. */
  messages: Row[]; messagesReady: boolean;
  /** AI Outbound: runs, prospects, run items, findings, provider calls, and whether the tables exist. */
  outbound: { runs: Row[]; prospects: Row[]; items: Row[]; findings: Row[]; providerCalls: Row[]; ready: boolean };
  /** Test hook: the next outbound saveStep throws (a crash inside the transaction). */
  outboundFailNextSave?: boolean;
  /** Knowledge: sources, passages and picture bytes (all with their organization), and the pages the fake web serves. */
  knowledge: { sources: Row[]; chunks: Row[]; files: Map<string, Row>; web: Record<string, { status: number; headers: Record<string, string>; body: string }>; dns: Record<string, string[]> };
  /** The fake web search: what it returns, what it was asked, and the usage counters. */
  discovery: { configured: boolean; results: { title: string; url: string; snippet?: string }[]; queries: string[]; countries: (string | undefined)[]; error: string | null; usedDay: number; usedMonth: number; provider: { label: string; paid: boolean; supportsCountry: boolean } };
}

export const ORG1 = "org-1";
export const ORG2 = "org-2";

export function userRow(over: Row = {}): Row {
  return { id: "u1", organizationId: ORG1, orgRole: "OWNER", firstName: "Asha", lastName: "Rao", email: "asha@example.test", customPermissions: null, ...over };
}

/** Rows come back as copies, like rows from a database: a caller's snapshot doesn't change under it. */
const copy = <T extends object | undefined>(r: T): T => (r ? ({ ...r } as T) : r);

export function createWorld(): World {
  const w: World = {
    orgs: new Map([
      [ORG1, { id: ORG1, name: "Asha Studio", country: "IN", currency: "INR", locale: "en-IN", timezone: "Asia/Kolkata", audience: null }],
      [ORG2, { id: ORG2, name: "Other Studio", country: "IN", currency: "INR", locale: "en-IN", timezone: "Asia/Kolkata", audience: null }],
    ]),
    users: new Map([["u1", userRow()], ["u2", userRow({ id: "u2", organizationId: ORG2, firstName: "Other" })]]),
    deals: [], quotes: [], contracts: [], invoices: [],
    activity: [], emails: [], billing: new Map(),
    credits: { spent: 0, regranted: 0 },
    llm: async () => ({ content: null, toolCalls: [] }),
    readOnly: false,
    storage: {},
    leads: new FakeLeadsStore(() => w.readOnly),
    profiles: new Map(),
    documentStyles: new Map(),
    research: [], llmCalls: [], salesReady: true, messages: [], messagesReady: true,
    outbound: { runs: [], prospects: [], items: [], findings: [], providerCalls: [], ready: true },
    knowledge: { sources: [], chunks: [], files: new Map(), web: {}, dns: {} },
    discovery: { configured: true, results: [], queries: [], countries: [], error: null, usedDay: 0, usedMonth: 0, provider: { label: "Brave Search", paid: true, supportsCountry: true } },
  };
  let id = 100;
  const nextId = () => ++id;
  const guard = (fn: (...a: any[]) => any) => (...a: any[]) => {
    if (w.readOnly) throw new Error("WRITE ATTEMPTED BY A READ-ONLY TOOL");
    return fn(...a);
  };
  const visible = (r: Row, orgId: string, userId?: string) => (r.organizationId ? r.organizationId === orgId : r.userId === userId);

  w.storage = {
    getOrganization: async (id: string) => w.orgs.get(id),
    getUser: async (id: string) => w.users.get(id),
    updateUser: guard(async (id: string, u: Row) => { const r = w.users.get(id); if (!r) return undefined; Object.assign(r, u); return r; }),
    updateOrganization: guard(async (id: string, u: Row) => { const r = w.orgs.get(id); if (!r) return undefined; Object.assign(r, u); return r; }),
    countActiveMembers: async () => 1,
    getActivityLogs: async () => w.activity.slice(0, 10).map((a) => ({ userName: "Asha", ...a })),

    getDeal: async (id: number) => copy(w.deals.find((d) => d.id === id)),
    getDealsByOrg: async (orgId: string, userId?: string) => w.deals.filter((d) => visible(d, orgId, userId)).map(copy),
    createDeal: guard(async (d: Row) => { const row = { id: nextId(), status: "Pending", createdAt: new Date(), brandTerms: null, standardTermIds: [], ...d }; w.deals.push(row); return row; }),
    updateDeal: guard(async (id: number, u: Row) => { const d = w.deals.find((x) => x.id === id); if (!d) return undefined; Object.assign(d, u); return copy(d); }),
    spendDealCredit: guard(async () => { w.credits.spent++; return { ok: true }; }),
    regrantDealCredit: guard(async () => { w.credits.regranted++; }),
    ensureMonthlyCredits: guard(async () => {}),

    getQuoteByDealId: async (dealId: number) => copy([...w.quotes].reverse().find((q) => q.dealId === dealId)),
    getQuotesByOrg: async (orgId: string, userId?: string) => w.quotes.filter((q) => visible(q, orgId, userId)).map((q) => ({ ...q, deal: w.deals.find((d) => d.id === q.dealId) })),
    createQuote: guard(async (q: Row) => { const row = { id: nextId(), createdAt: new Date(), shareToken: null, shareRevokedAt: null, acceptedAt: null, sharedAt: null, ...q }; w.quotes.push(row); return row; }),
    updateQuote: guard(async (id: number, u: Row) => { const q = w.quotes.find((x) => x.id === id); if (!q) return undefined; Object.assign(q, u); return copy(q); }),

    getContract: async (id: number) => copy(w.contracts.find((c) => c.id === id)),
    getContractByDealId: async (dealId: number) => copy(w.contracts.find((c) => c.dealId === dealId)),
    getContractsByOrg: async (orgId: string, userId?: string) => w.contracts.filter((c) => visible(c, orgId, userId)),
    createContract: guard(async (c: Row) => { const row = { id: nextId(), status: "Active", signedByBrand: false, clientShareToken: null, clientShareRevokedAt: null, createdAt: new Date(), ...c }; w.contracts.push(row); return row; }),
    updateContract: guard(async (id: number, u: Row) => { const c = w.contracts.find((x) => x.id === id); if (!c) return undefined; Object.assign(c, u); return copy(c); }),

    getBrandInvoice: async (id: number) => copy(w.invoices.find((i) => i.id === id)),
    getBrandInvoicesByOrg: async (orgId: string, userId?: string) => w.invoices.filter((i) => visible(i, orgId, userId)).map(copy),
    getBrandInvoicesByDealIdForOrg: async (dealId: number, orgId: string, userId?: string) => w.invoices.filter((i) => i.dealId === dealId && visible(i, orgId, userId)).map(copy),
    createBrandInvoice: guard(async (i: Row) => { const row = { id: nextId(), createdAt: new Date(), paidAt: null, ...i }; w.invoices.push(row); return row; }),
    updateBrandInvoice: guard(async (id: number, u: Row) => { const i = w.invoices.find((x) => x.id === id); if (!i) return undefined; Object.assign(i, u); return copy(i); }),
    generateOrgInvoiceNumber: guard(async () => `INV-${String(w.invoices.length + 1).padStart(4, "0")}`),
  };
  return w;
}

const today = () => new Date().toISOString().slice(0, 10);

export function seedDeal(w: World, over: Row = {}): Row {
  const row = {
    id: 1 + w.deals.length, userId: "u1", organizationId: ORG1, brandName: "Acme", dealTitle: "Logo design",
    dealType: "Design", dealAmountMinor: 1_500_000, startDate: today(), endDate: today(),
    deliverables: [{ id: "d", platform: "Design", contentType: "Logo", quantity: 1, frequency: "One-time", notes: "" }],
    deliverableMode: "all", standardTermIds: [], customTerms: "", brandTerms: null, status: "Pending", createdAt: new Date(),
    ...over,
  };
  w.deals.push(row);
  return row;
}
/** A lead in the given organization (default: the first), in any stage. */
export function seedLead(w: World, over: Record<string, any> = {}, orgId = ORG1) {
  return w.leads.seed(orgId, over);
}
/** An ideal-client profile for the given organization (default: the first). */
export function seedProfile(w: World, over: Record<string, any> = {}, orgId = ORG1) {
  const row = { organizationId: orgId, about: null, services: [], targetIndustries: [], targetLocations: [], exclusions: [], minDealMinor: null, currency: null, updatedBy: "u1", updatedAt: new Date(), ...over };
  w.profiles.set(orgId, row);
  return row;
}
export function seedQuote(w: World, dealId: number, over: Row = {}): Row {
  const row = { id: 500 + w.quotes.length, userId: "u1", organizationId: ORG1, dealId, status: "draft", version: 1, shareToken: null, shareRevokedAt: null, acceptedAt: null, sharedAt: null, ...over };
  w.quotes.push(row);
  return row;
}
export function seedContract(w: World, dealId: number, over: Row = {}): Row {
  const d = w.deals.find((x) => x.id === dealId)!;
  const row = {
    id: 700 + w.contracts.length, userId: "u1", organizationId: ORG1, dealId, contractName: `${d.brandName} - ${d.dealTitle}`, brandName: d.brandName,
    startDate: d.startDate, endDate: d.endDate, contractValueMinor: d.dealAmountMinor, status: "Active", signedByInfluencer: true, signedByBrand: false,
    exclusive: true, currency: "INR", clientShareToken: null, clientShareRevokedAt: null, ...over,
  };
  w.contracts.push(row);
  return row;
}
export function seedInvoice(w: World, dealId: number, over: Row = {}): Row {
  const d = w.deals.find((x) => x.id === dealId)!;
  const row = {
    id: 900 + w.invoices.length, userId: "u1", organizationId: ORG1, dealId, contractId: null, brandName: d.brandName, invoiceNumber: `INV-${String(901 + w.invoices.length).padStart(4, "0")}`,
    dealAmountMinor: 500_000, invoiceType: "full", status: "Unpaid", dueDate: today(), currency: "INR", paidAt: null, ...over,
  };
  w.invoices.push(row);
  return row;
}
