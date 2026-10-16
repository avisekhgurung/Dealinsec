/**
 * The prospect workspace and its exports, through the real services in the in-memory world: organization scoping,
 * permissions, ids a request names, server-evaluated filters, the frozen "all matching" selection, limits, and rows
 * that say only what the stored evidence says.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../storage", async () => (await import("./world-mocks")).storageMock());
vi.mock("../../entitlements", async () => (await import("./world-mocks")).entitlementsMock());
vi.mock("../../emails", async () => (await import("./world-mocks")).emailsMock());
vi.mock("../../leads/profile-store", async () => (await import("./world-mocks")).profileStoreMock());
vi.mock("../../discovery/provider", async () => (await import("./world-mocks")).discoveryProviderMock());
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

import { inflateRawSync } from "node:zlib";
import { MISSING_CONTACT, MISSING_REASON } from "@shared/prospect";
import { LARGE_EXPORT_ROWS, MAX_WORKSPACE_PROSPECTS } from "@shared/prospect-workspace";
import { exportProspects, listWorkspace, workspaceRow } from "../../outbound/workspace";
import { useWorld } from "./world-mocks";
import { createWorld, userRow, ORG1, ORG2, type World } from "./world";

const world = () => (globalThis as any).__world as World;
const NOW = new Date("2026-10-13T12:00:00Z");
const d = { now: () => NOW };
const OWNER = () => userRow() as any;
const OTHER_ORG = () => userRow({ id: "u2", organizationId: ORG2 }) as any;
const ACCOUNTS = () => userRow({ id: "u3", orgRole: "ACCOUNTS" }) as any;
const INVOICES_ONLY = () => userRow({ id: "u4", orgRole: "CUSTOM", customPermissions: ["invoices.create"] }) as any;
const DEALS_READER = () => userRow({ id: "u5", orgRole: "CUSTOM", customPermissions: ["quotations.create"] }) as any;
const NO_ORG = () => userRow({ id: "u6", organizationId: null }) as any;

let pid = 0, fid = 0, iid = 0;
const FIT = { strong: { verdict: "strong", headline: "Fits your ICP", signals: [{ key: "industry", label: "Industry", status: "match", detail: 'Industry "Digital marketing" matches your target.' }, { key: "size", label: "Size", status: "unknown", detail: "No team size stated." }] } };
function prospect(over: Record<string, any> = {}, orgId = ORG1) {
  const p = {
    id: ++pid, organizationId: orgId, domain: `p${pid}.com`, name: `Prospect ${pid}`, website: `https://p${pid}.com`, status: "enriched", rejectReason: null,
    sources: [{ provider: "brave", query: "agencies", url: `https://p${pid}.com`, title: "x", at: "2026-10-01T00:00:00Z" }],
    profile: { industry: { value: "Digital marketing", source: "website" }, country: { value: "US", source: "website" }, location: { value: "Austin, Texas", source: "website" }, team_size: { value: "a team of 18", source: "website" } },
    fit: FIT.strong, score: { total: 60, knownMax: 80, unknownPoints: 20, confidence: "medium", components: [], missing: [] }, angle: null, ready: false, contentHash: null,
    verifiedAt: new Date("2026-10-01T00:00:00Z"), researchedAt: null, leadId: null, createdAt: new Date("2026-10-02T00:00:00Z"), updatedAt: new Date("2026-10-03T00:00:00Z"), ...over,
  };
  world().outbound.prospects.push(p);
  return p;
}
function finding(p: { id: number; organizationId: string }, over: Record<string, any>) {
  const f = { id: ++fid, organizationId: p.organizationId, prospectId: p.id, kind: "fact", type: "description", value: "x", status: "confirmed", sourceUrl: `https://p${p.id}.com/`, sourceType: "website", quote: "quoted words", contentHash: null, observedAt: null, confidence: "high", supportingIds: [], meta: {}, batch: "enrich", retrievedAt: new Date("2026-10-04T00:00:00Z"), ...over };
  world().outbound.findings.push(f);
  return f;
}
const signal = (p: any, observedAt: string, over: Record<string, any> = {}) => finding(p, { kind: "signal", type: "HIRING", value: "Hiring an SEO strategist", observedAt: new Date(observedAt), meta: { datePrecision: "day" }, batch: "research", ...over });
const person = (p: any, name: string, title: string, over: Record<string, any> = {}) => finding(p, { kind: "decision_maker", type: "person", value: `${name}, ${title}`, meta: { name, title, rank: 1, email: null, emailStatus: null }, ...over });
const item = (p: any, runId: string, updatedAt: string) => world().outbound.items.push({ id: ++iid, runId, organizationId: p.organizationId, prospectId: p.id, rank: 0, stage: "done", attempts: 0, errorCode: null, nextAttemptAt: null, updatedAt: new Date(updatedAt) });

const list = async (params: Record<string, unknown> = {}, user = OWNER()) => listWorkspace(user, params, d) as Promise<any>;
const exp = async (body: unknown, user = OWNER()) => exportProspects(user, body, d) as Promise<any>;
const csvRows = (b: Buffer) => b.toString("utf8").slice(1).trim().split("\r\n").map((l) => l.slice(1, -1).split('","'));

beforeEach(() => { useWorld(createWorld()); pid = 0; fid = 0; iid = 0; });

describe("the table", () => {
  it("shows only the organization's own prospects, newest evidence first", async () => {
    const a = prospect({ name: "Alpha" }); signal(a, "2026-09-01T00:00:00Z");
    const b = prospect({ name: "Bravo" }); signal(b, "2026-10-01T00:00:00Z");
    const c = prospect({ name: "Charlie" });
    prospect({ name: "Their prospect" }, ORG2);
    const r = await list();
    expect(r.ok).toBe(true);
    expect(r.rows.map((x: any) => x.name)).toEqual(["Bravo", "Alpha", "Charlie"]);
    expect(r.summary).toMatchObject({ all: 3, filtered: 3 });
    expect(JSON.stringify(r)).not.toContain("Their prospect");
    expect(r.asOf).toBe(NOW.toISOString());
    expect((await list({}, OTHER_ORG())).rows.map((x: any) => x.name)).toEqual(["Their prospect"]);
    void c;
  });

  it("filters, sorts and pages on the server", async () => {
    for (let i = 0; i < 30; i++) prospect({ name: `Co ${String(i).padStart(2, "0")}`, ready: i < 12, profile: { country: { value: i % 2 ? "GB" : "US" } } });
    const ready = await list({ readiness: "ready", sort: "name", dir: "asc", pageSize: "25" });
    expect(ready.summary).toMatchObject({ all: 30, filtered: 12, ready: 12 });
    expect(ready.rows.map((x: any) => x.name)).toEqual(Array.from({ length: 12 }, (_, i) => `Co ${String(i).padStart(2, "0")}`));
    const p2 = await list({ sort: "name", dir: "desc", page: "2", pageSize: "25" });
    expect(p2).toMatchObject({ page: 2, pageCount: 2 });
    expect(p2.rows.map((x: any) => x.name)).toEqual(["Co 04", "Co 03", "Co 02", "Co 01", "Co 00"]);
    expect((await list({ country: "GB" })).summary.filtered).toBe(15);
    expect((await list({ q: "co 2" })).summary.filtered).toBe(10);
    expect(ready.facets.countries).toEqual([{ value: "GB", count: 15 }, { value: "US", count: 15 }]);
  });

  it.each([
    [{ sort: "organizationId" }], [{ readiness: "approved" }], [{ pageSize: "5000" }], [{ organizationId: ORG2 }], [{ country: "'; drop table prospects;--" }],
  ])("refuses an invalid query %j (400)", async (params) => {
    expect(await list(params)).toMatchObject({ ok: false, status: 400, code: "invalid_query" });
  });

  it("follows the module permissions: no organization, or no read access to deals, is refused", async () => {
    prospect();
    expect(await list({}, NO_ORG())).toMatchObject({ ok: false, status: 403 });
    expect(await list({}, INVOICES_ONLY())).toMatchObject({ ok: false, status: 403 });
    expect((await list({}, ACCOUNTS())).ok).toBe(true); // built-in roles read every module
    expect((await list({}, DEALS_READER())).ok).toBe(true);
  });

  it("says when the feature isn't set up", async () => {
    world().outbound.ready = false;
    expect(await list()).toMatchObject({ ok: false, status: 503, code: "PROSPECTS_NOT_SETUP" });
  });

  it("lists a prospect found by several runs once, with the run that touched it last", async () => {
    const p = prospect();
    item(p, "run-old", "2026-10-01T00:00:00Z"); item(p, "run-new", "2026-10-05T00:00:00Z"); item(p, "run-mid", "2026-10-03T00:00:00Z");
    const r = await list();
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].latestRunId).toBe("run-new");
  });

  it("evaluates the newest prospects only above the cap, and says so", async () => {
    for (let i = 0; i < MAX_WORKSPACE_PROSPECTS + 3; i++) prospect();
    const r = await list({ sort: "created" });
    expect(r.truncated).toBe(true);
    expect(r.summary.all).toBe(MAX_WORKSPACE_PROSPECTS);
  }, 20_000);
});

describe("what a row says (from stored evidence only)", () => {
  it("a website decision maker, a company email and phone, dated evidence at its precision", () => {
    const p = prospect();
    const dm = person(p, "Ana Silva", "Founder and CEO");
    finding(p, { type: "business_email", value: "hello@p1.com" });
    finding(p, { type: "business_phone", value: "+1 512 555 0100" });
    signal(p, "2026-09-01T00:00:00Z", { meta: { datePrecision: "month" }, type: "NEW_SERVICE", value: "Launched a PPC practice", quote: "In September 2026 we launched" });
    signal(p, "2026-10-10T00:00:00Z", { status: "inferred", value: "maybe" }); // not confirmed: never the latest evidence
    const r = workspaceRow({ ...p, latestRunId: null } as any, world().outbound.findings as any, NOW);
    expect(r.contact).toMatchObject({ findingId: dm.id, name: "Ana Silva", title: "Founder and CEO", senior: true, email: null, source: "website" });
    expect(r).toMatchObject({ contactLevel: "decision_maker", emailStatus: "company_email", emailSource: "website", companyEmail: "hello@p1.com", phoneStatus: "company_phone", companyPhone: "+1 512 555 0100" });
    expect(r.latestEvidence).toMatchObject({ date: "2026-09", precision: "month", title: "New service", claim: "Launched a PPC practice", excerpt: "In September 2026 we launched", sourceType: "website", status: "confirmed" });
    expect(r).toMatchObject({ country: "US", location: "Austin, Texas", industry: "Digital marketing", companySize: "a team of 18", sizeBucket: "11-50", icpFit: "match" });
    expect(r.icpMatch).toEqual(['Industry "Digital marketing" matches your target.']);
    expect(r.icpUnmatched).toEqual(["No team size stated."]);
  });

  it("a provider contact keeps its own provenance; only the provider's 'verified' counts as verified", () => {
    const p = prospect();
    person(p, "Ben Okafor", "Head of Growth", { sourceType: "provider", status: "inferred", sourceUrl: null, quote: null, meta: { name: "Ben Okafor", title: "Head of Growth", rank: 2, email: "ben@p1.com", emailStatus: "accept_all", provider: "hunter" } });
    const r = workspaceRow({ ...p, latestRunId: null } as any, world().outbound.findings as any, NOW);
    expect(r.contact).toMatchObject({ email: "ben@p1.com", emailStatus: "accept_all", source: "provider", provider: "hunter" });
    expect(r.emailStatus).toBe("unverified");
    expect(r.emailSource).toBe("provider");
  });

  it("research readiness is the existing classification: a verified email alone doesn't make it ready", () => {
    const p = prospect();
    person(p, "Ben Okafor", "Account Manager", { sourceType: "provider", status: "inferred", meta: { name: "Ben Okafor", title: "Account Manager", email: "ben@p1.com", emailStatus: "verified", provider: "hunter" } });
    const r = workspaceRow({ ...p, latestRunId: null } as any, world().outbound.findings as any, NOW);
    expect(r.emailStatus).toBe("verified");
    expect(r.contactLevel).toBe("employee");
    expect(r.readiness).toBe("qualified");
    expect(r.readinessBlockers).toEqual([MISSING_REASON]);
  });

  it("old evidence reads as stale; a set-aside prospect says why", () => {
    const p = prospect();
    signal(p, "2024-03-01T00:00:00Z");
    expect(workspaceRow({ ...p, latestRunId: null } as any, world().outbound.findings as any, NOW)).toMatchObject({ readiness: "stale", latestEvidence: { date: "2024-03-01" } });
    const q = prospect({ status: "rejected", rejectReason: "parked_domain", fit: null });
    const r = workspaceRow({ ...q, latestRunId: null } as any, [], NOW);
    expect(r.readiness).toBe("rejected");
    expect(r.readinessBlockers[0]).toMatch(/^Set aside: /);
    expect(r.icpFit).toBe("unknown");
    const weak = workspaceRow({ ...prospect({ fit: { verdict: "weak", headline: "Mostly outside your ICP", signals: [] } }), latestRunId: null } as any, [], NOW);
    expect(weak).toMatchObject({ icpFit: "not_qualified", readiness: "not_a_fit", icpUnmatched: ["Mostly outside your ICP"] });
  });

  it("a stored 'ready' prospect is Ready; nothing is invented when data is missing", () => {
    const p = prospect({ ready: true, profile: {}, score: null });
    const r = workspaceRow({ ...p, latestRunId: null } as any, [], NOW);
    expect(r).toMatchObject({ readiness: "ready", readinessBlockers: [], country: null, location: null, industry: null, companySize: null, sizeBucket: "unknown", contact: null, emailStatus: "none", phoneStatus: "none", latestEvidence: null, scoreTotal: null });
  });

  it("missing contact is a blocker the row shows", () => {
    const p = prospect();
    signal(p, "2026-10-01T00:00:00Z");
    expect(workspaceRow({ ...p, latestRunId: null } as any, world().outbound.findings as any, NOW).readinessBlockers).toEqual([MISSING_CONTACT]);
  });
});

describe("exports", () => {
  it("exports exactly the selected rows of this organization, sorted, as CSV", async () => {
    const a = prospect({ name: "Alpha" }), b = prospect({ name: "Bravo" }); prospect({ name: "Charlie" });
    const r = await exp({ format: "csv", scope: { mode: "ids", ids: [b.id, a.id] }, sort: "name", dir: "asc" });
    expect(r).toMatchObject({ ok: true, count: 2, contentType: "text/csv; charset=utf-8", filename: "prospects-2026-10-13.csv" });
    const rows = csvRows(r.body);
    expect(rows.slice(1).map((x) => x[1])).toEqual(["Alpha", "Bravo"]);
  });

  it("refuses ids that aren't this organization's, without saying which", async () => {
    const mine = prospect(); const theirs = prospect({}, ORG2);
    const r = await exp({ format: "csv", scope: { mode: "ids", ids: [mine.id, theirs.id] } });
    expect(r).toMatchObject({ ok: false, status: 404, code: "not_found" });
    expect(JSON.stringify(r)).not.toContain(String(theirs.id));
    expect(await exp({ format: "csv", scope: { mode: "ids", ids: [theirs.id] } })).toMatchObject({ ok: false, status: 404 });
    expect(await exp({ format: "csv", scope: { mode: "ids", ids: [999999] } })).toMatchObject({ ok: false, status: 404 });
    expect(world().activity).toHaveLength(0);
  });

  it("an organization id in the request is refused, never used", async () => {
    const theirs = prospect({}, ORG2);
    expect(await exp({ format: "csv", organizationId: ORG2, scope: { mode: "ids", ids: [theirs.id] } })).toMatchObject({ ok: false, status: 400 });
  });

  it("needs the right to work with leads, not only to read them", async () => {
    const p = prospect();
    expect(await exp({ format: "csv", scope: { mode: "ids", ids: [p.id] } }, ACCOUNTS())).toMatchObject({ ok: false, status: 403 });
    expect(await exp({ format: "csv", scope: { mode: "ids", ids: [p.id] } }, DEALS_READER())).toMatchObject({ ok: false, status: 403 });
    expect(await exp({ format: "csv", scope: { mode: "ids", ids: [p.id] } }, NO_ORG())).toMatchObject({ ok: false, status: 403 });
  });

  it("all matching filters: evaluated on the server, frozen at the time it was chosen", async () => {
    prospect({ ready: true, name: "Old ready", createdAt: new Date("2026-10-01T00:00:00Z") });
    prospect({ ready: false, name: "Not ready", createdAt: new Date("2026-10-01T00:00:00Z") });
    const listed = await list({ readiness: "ready" });
    expect(listed.summary.filtered).toBe(1);
    // A prospect found after the selection was made matches the filters but must not be exported.
    prospect({ ready: true, name: "Found later", createdAt: new Date("2026-10-13T11:59:00Z") });
    const r = await exp({ format: "csv", scope: { mode: "filter", filters: { readiness: ["ready"] }, asOf: "2026-10-12T00:00:00.000Z", expectedCount: 1 } });
    expect(r.ok).toBe(true);
    expect(csvRows(r.body).slice(1).map((x) => x[1])).toEqual(["Old ready"]);
  });

  it("if the matching set changed since it was confirmed, the export is refused with the new count", async () => {
    const p = prospect({ ready: true });
    prospect({ ready: true });
    const r = await exp({ format: "csv", scope: { mode: "filter", filters: { readiness: ["ready"] }, asOf: NOW.toISOString(), expectedCount: 1 } });
    expect(r).toMatchObject({ ok: false, status: 409, code: "selection_changed", count: 2 });
    void p;
  });

  it("large exports need the confirmation; with it they go through", async () => {
    for (let i = 0; i < LARGE_EXPORT_ROWS; i++) prospect();
    const body = { format: "xlsx", scope: { mode: "filter", filters: {}, asOf: NOW.toISOString(), expectedCount: LARGE_EXPORT_ROWS } };
    expect(await exp(body)).toMatchObject({ ok: false, status: 409, code: "confirm_required", count: LARGE_EXPORT_ROWS });
    const r = await exp({ ...body, confirmed: true });
    expect(r).toMatchObject({ ok: true, count: LARGE_EXPORT_ROWS, filename: "prospects-2026-10-13.xlsx" });
    expect(r.body.subarray(0, 4).readUInt32LE(0)).toBe(0x04034b50);
  });

  it("one export at a time per person", async () => {
    const p = prospect();
    const body = { format: "csv", scope: { mode: "ids", ids: [p.id] } };
    const [a, b] = await Promise.all([exp(body), exp(body)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((x) => !x.ok)).toMatchObject({ status: 429, code: "export_in_progress" });
    expect((await exp(body)).ok).toBe(true); // released afterwards, also after a refusal
  });

  it("a future asOf is refused", async () => {
    prospect();
    expect(await exp({ format: "csv", scope: { mode: "filter", filters: {}, asOf: "2027-01-01T00:00:00.000Z", expectedCount: 1 } })).toMatchObject({ ok: false, status: 400 });
  });

  it("the audit line says who exported how many, never what", async () => {
    const p = prospect({ name: "Secret Co" });
    person(p, "Ana Silva", "Founder and CEO", { sourceType: "provider", meta: { name: "Ana Silva", title: "Founder and CEO", email: "ana@secret.co", emailStatus: "verified", provider: "hunter" } });
    const r = await exp({ format: "csv", scope: { mode: "ids", ids: [p.id] } });
    expect(r.ok).toBe(true);
    expect(r.body.toString("utf8")).toContain("ana@secret.co");
    expect(world().activity).toEqual([{ action: "exported", entityType: "prospects", entityId: null, detail: "1 prospect · CSV · selected" }]);
    expect(JSON.stringify(world().activity)).not.toMatch(/Secret|Ana|ana@/);
  });

  it("XLSX of the same rows holds the same values as text cells", async () => {
    const p = prospect({ name: "=cmd|' /C calc'!A0" });
    const r = await exp({ format: "xlsx", scope: { mode: "ids", ids: [p.id] } });
    const b: Buffer = r.body;
    // the sheet is the last entry: read it through the central directory
    const end = b.length - 22, cdOff = b.readUInt32LE(end + 16), n = b.readUInt16LE(end + 10);
    let off = cdOff, sheet = "";
    for (let k = 0; k < n; k++) {
      const comp = b.readUInt32LE(off + 20), nameLen = b.readUInt16LE(off + 28), local = b.readUInt32LE(off + 42), name = b.subarray(off + 46, off + 46 + nameLen).toString();
      if (name === "xl/worksheets/sheet1.xml") { const ln = b.readUInt16LE(local + 26); sheet = inflateRawSync(b.subarray(local + 30 + ln, local + 30 + ln + comp)).toString(); }
      off += 46 + nameLen;
    }
    expect(sheet).toContain(`t="inlineStr"><is><t xml:space="preserve">=cmd|' /C calc'!A0</t>`);
    expect(sheet).not.toMatch(/<f[ >]/);
  });
});
