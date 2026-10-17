/**
 * Local business discovery end to end in the in-memory world: a fake Places provider, a fake web, a scripted model, and
 * the real services and pipeline. What it pins down:
 *   - listings are shown, never stored: no name, address, phone or website from a listing reaches a table, a lead or a
 *     model; only place IDs are kept (as provenance and as a lead's link)
 *   - one search = one credit, refunded when the source fails or a cap refuses it; the platform's daily cap and the
 *     workspace's spend ceiling are checked before the paid call
 *   - researching chosen websites goes through the normal pipeline (names and facts from the site itself)
 *   - "already in your workspace" and every write stay inside the caller's organization
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { DiscoveryError } from "../../discovery/types";
import type { LocalBusinessProvider, PlaceListing } from "../../discovery/google-places";
import { localSearch, researchLocalSites, saveLocalLead, type LocalDeps } from "../../outbound/local-search";
import { clearPageCache, pipelineDeps, stepRun, type PipelineDeps } from "../../outbound/pipeline";
import { getRun, listRuns } from "../../outbound/service";
import { outboundStore } from "../../outbound/store";
import { leadsStore } from "../../leads/store";
import { mapsUrlFor } from "@shared/local-discovery";
import { useWorld } from "./world-mocks";
import { createWorld, seedLead, userRow, ORG1, ORG2, type World } from "./world";

const world = () => (globalThis as any).__world as World;
const OWNER = () => userRow() as any;
const OTHER = () => userRow({ id: "u2", organizationId: ORG2 }) as any;
const READER = () => userRow({ id: "u3", orgRole: "CUSTOM", customPermissions: ["invoices.create"] }) as any;
const NOW = new Date("2026-10-18T09:00:00Z");

/* ── a fake Places source: listing details that appear nowhere else in the world ─ */

const PID = (n: number) => `ChIJplace${String(n).padStart(6, "0")}`;
const LISTINGS: PlaceListing[] = [
  { placeId: PID(1), name: "Smile Dental Clinic [listing]", address: "12 Listing Road, Siliguri 734001", category: "Dentist", website: "https://smiledental.in/", domain: "smiledental.in", phone: "0353 255 0101", mapsUrl: "https://maps.google.com/?cid=1", status: "OPERATIONAL" },
  { placeId: PID(2), name: "Hill Cart Dentistry [listing]", address: "88 Listing Hill Cart, Siliguri", category: "Dentist", website: null, domain: null, phone: "0353 255 0202", mapsUrl: "https://maps.google.com/?cid=2", status: "OPERATIONAL" },
  { placeId: PID(3), name: "Pearl Teeth Care [listing]", address: "3 Listing Lane, Siliguri", category: "Dental clinic", website: "https://pearlteeth.in/", domain: "pearlteeth.in", phone: null, mapsUrl: "https://maps.google.com/?cid=3", status: "CLOSED_TEMPORARILY" },
  { placeId: PID(4), name: "No Site Smiles [listing]", address: "4 Listing Market, Siliguri", category: "Dentist", website: null, domain: null, phone: "0353 255 0404", mapsUrl: "https://maps.google.com/?cid=4", status: null },
];
const LISTING_ONLY = LISTINGS.flatMap((l) => [l.name, l.address, l.phone].filter((x): x is string => !!x));
let placesCalls: { query: string; regionCode: string }[] = [];
const places = (behaviour: () => PlaceListing[] | Error = () => LISTINGS): LocalBusinessProvider => ({
  name: "google_places",
  async searchText(query, o) { placesCalls.push({ query, regionCode: o.regionCode }); const r = behaviour(); if (r instanceof Error) throw r; return r.map((x) => ({ ...x })); },
});

/* ── the fake web: the businesses' own websites ───────────────────────────── */

const filler = "We look after families across North Bengal with gentle, modern care and clear prices for every treatment. ".repeat(3);
const html = (title: string, body: string) => `<html><head><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;
function fakeWeb() {
  const site = (host: string, body: string) => { world().knowledge.dns[host] = ["93.184.216.34"]; world().knowledge.web[`${host}/`] = { status: 200, headers: { "content-type": "text/html" }, body }; };
  site("smiledental.in", html("Smile Dental Care | Home", `<p>Smile Dental Care is a dental clinic in Siliguri, West Bengal, India. ${filler}</p>`));
  site("pearlteeth.in", html("Pearl Teeth – Dentist", `<p>Pearl Teeth is a dental practice in Siliguri, India. ${filler}</p>`));
}
let modelMessages: string[] = [];
function model() {
  world().llm = async (m: { role: string; content: string }[]) => {
    modelMessages.push(m.map((x) => x.content).join("\n"));
    const s = m[0].content;
    const out = /about the company itself/.test(s)
      ? { facts: [{ field: "industry", value: "Dental clinic", quote: /Smile Dental/.test(m[1].content) ? "Smile Dental Care is a dental clinic" : "Pearl Teeth is a dental practice", page: 1 }, { field: "country", value: "India", quote: "Siliguri", page: 1 }] }
      : { findings: [], opportunities: [] };
    return { content: JSON.stringify(out), toolCalls: [], usage: { inputTokens: 500, outputTokens: 100 } };
  };
}

const deps = (over: Partial<LocalDeps> = {}): Partial<LocalDeps> => ({ provider: places(), tier: async () => "pro", now: () => NOW, kick: () => {}, ...over });
const pdeps = (): Partial<PipelineDeps> => ({ ...pipelineDeps(), searchProviders: async () => [], now: () => NOW, kick: () => {}, sitemap: async () => [], company: null, contact: null });
async function drive(runId: string, orgId = ORG1) {
  const full = { ...pipelineDeps(), ...pdeps() } as PipelineDeps;
  for (let i = 0; i < 100; i++) {
    const run = await outboundStore.getRun(orgId, runId);
    if (!run || run.status !== "running") return run;
    try { await stepRun(run, Date.now() + 60_000, full); } catch { /* retried, like the runner */ }
    for (const it of world().outbound.items) if (it.nextAttemptAt) it.nextAttemptAt = new Date(0);
  }
  throw new Error("run did not finish");
}
const search = (body: Record<string, unknown> = {}, d: Partial<LocalDeps> = deps(), u = OWNER()) => localSearch(u, { category: "dentists", city: "Siliguri", country: "IN", ...body }, d) as Promise<any>;
const stored = () => JSON.stringify({ outbound: world().outbound, leads: world().leads, llm: world().llmCalls });

beforeEach(() => { useWorld(createWorld()); fakeWeb(); model(); clearPageCache(); placesCalls = []; modelMessages = []; vi.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { for (const k of ["OUTBOUND_GLOBAL_DAILY_LOCAL_SEARCHES", "WORKSPACE_MONTHLY_SPEND_USD", "OUTBOUND_MONTHLY_PROSPECTS_PRO", "OUTBOUND_MAX_COMPANIES_PRO"]) delete process.env[k]; });

describe("a local search: listings shown, never stored", () => {
  it("returns the listings with their Google Maps attribution, and writes none of their details anywhere", async () => {
    const r = await search();
    expect(r.ok).toBe(true);
    expect(r.source).toEqual({ name: "google_places", attribution: "Google Maps" });
    expect(r.results.map((x: any) => x.name)).toEqual(LISTINGS.map((l) => l.name));
    expect(placesCalls).toEqual([{ query: "dentists in Siliguri", regionCode: "IN" }]);
    // Nothing from a listing is in any table, and no model saw it.
    for (const s of LISTING_ONLY) expect(stored()).not.toContain(s);
    expect(world().outbound.prospects).toHaveLength(0);
    expect(world().outbound.findings).toHaveLength(0);
    expect(modelMessages).toHaveLength(0);
    // The search itself is recorded (it used a credit): the query the person typed, and the paid call's cost.
    expect(world().outbound.runs).toHaveLength(1);
    expect(world().outbound.runs[0]).toMatchObject({ status: "done", counters: { searched: 1, results: 4, mode: "local" } });
    expect(world().outbound.providerCalls).toMatchObject([{ provider: "google_places", operation: "local_search", ok: true, costMicroUsd: 35_000 }]);
  });

  it("the website filter: listings that give no website, or only those that do", async () => {
    expect((await search({ website: "without" })).results.map((x: any) => x.placeId)).toEqual([PID(2), PID(4)]);
    expect((await search({ website: "with" })).results.map((x: any) => x.placeId)).toEqual([PID(1), PID(3)]);
    expect((await search({ max: 1 })).results).toHaveLength(1);
  });

  it("isn't listed among the searches to open (it has no prospects of its own), but counts as a search", async () => {
    await search();
    expect(((await listRuns(OWNER(), pdeps())) as any).runs).toHaveLength(0);
    expect(world().outbound.runs[0].counters.searched).toBe(1);
  });

  it("refuses an invalid search, a reader, and a server without a source, before any paid call", async () => {
    expect(await search({ city: "" })).toMatchObject({ ok: false, status: 400 });
    expect(await search({}, deps(), READER())).toMatchObject({ ok: false, status: 403 });
    expect(await search({}, deps({ provider: null }))).toMatchObject({ ok: false, status: 503, code: "LOCAL_NOT_SETUP" });
    expect(placesCalls).toHaveLength(0);
    expect(world().outbound.runs).toHaveLength(0);
  });
});

describe("credits and caps", () => {
  it("one credit per search; the free plan's three are used up by three searches", async () => {
    const free = deps({ tier: async () => "free" });
    for (let i = 0; i < 3; i++) expect((await search({}, free)).ok).toBe(true);
    expect(await search({}, free)).toMatchObject({ ok: false, status: 402, code: "NO_CREDITS" });
    expect(placesCalls).toHaveLength(3);
  });

  it("a source failure is not charged: the credit comes back and the person is told nothing was used", async () => {
    const free = deps({ tier: async () => "free", provider: places(() => new DiscoveryError("unavailable", "down")) });
    for (let i = 0; i < 4; i++) expect(await search({}, free)).toMatchObject({ ok: false, code: "local_unavailable" });
    expect(world().outbound.runs.every((r) => r.counters.searched === 0)).toBe(true);
    expect((await search({}, deps({ tier: async () => "free" }))).ok).toBe(true); // the credits are all still there
    // A refused key isn't billed; any other failure keeps its cost (it may have been billed).
    await search({}, deps({ provider: places(() => new DiscoveryError("auth", "bad key")) }));
    expect(world().outbound.providerCalls.filter((c) => c.errorCode === "auth").map((c) => c.costMicroUsd)).toEqual([0]);
  });

  it("the platform's daily cap for local searches stops the paid call and refunds the credit", async () => {
    process.env.OUTBOUND_GLOBAL_DAILY_LOCAL_SEARCHES = "1";
    expect((await search()).ok).toBe(true);
    expect(await search({}, deps(), OTHER())).toMatchObject({ ok: false, status: 429, code: "local_busy" }); // across workspaces
    expect(placesCalls).toHaveLength(1);
    expect(world().outbound.runs.find((r) => r.organizationId === ORG2)!.counters.searched).toBe(0);
  });

  it("the workspace's 30-day spend ceiling is checked before the paid call", async () => {
    process.env.WORKSPACE_MONTHLY_SPEND_USD = "0.01"; // less than one search
    expect(await search()).toMatchObject({ ok: false, status: 429, code: "workspace_budget" });
    expect(placesCalls).toHaveLength(0);
    expect(world().outbound.runs[0].counters.searched).toBe(0);
  });
});

describe("already in the workspace", () => {
  it("marks listings already researched (by place ID or website) or saved as leads, only from the caller's own workspace", async () => {
    world().outbound.prospects.push({ id: 900, organizationId: ORG1, domain: "pearlteeth.in", name: "Pearl Teeth", website: "https://pearlteeth.in/", status: "enriched", sources: [], leadId: null });
    const lead = seedLead(world(), { companyName: "Smile Dental", website: "https://smiledental.in", domain: "smiledental.in" });
    expect((await saveLocalLead(OWNER(), { placeId: PID(4), companyName: "No Site Smiles" }, deps())).ok).toBe(true);
    const mine = (await search()).results;
    expect(mine.find((x: any) => x.placeId === PID(1)).existing).toEqual({ leadId: lead.id });
    expect(mine.find((x: any) => x.placeId === PID(3)).existing).toEqual({ prospectId: 900 });
    expect(mine.find((x: any) => x.placeId === PID(4)).existing).toMatchObject({ leadId: expect.any(Number) });
    expect(mine.find((x: any) => x.placeId === PID(2)).existing).toBeNull();
    // Another workspace sees none of it.
    expect((await search({}, deps(), OTHER())).results.every((x: any) => x.existing === null)).toBe(true);
  });
});

describe("researching the websites the person picked", () => {
  it("seeds only the place ID and the domain, then researches each site through the normal pipeline, with no web search", async () => {
    const r: any = await researchLocalSites(OWNER(), { category: "dentists", city: "Siliguri", country: "IN", places: [
      { placeId: PID(1), website: "https://smiledental.in/" }, { placeId: PID(3), website: "https://www.pearlteeth.in/contact" },
      { placeId: PID(1), website: "https://smiledental.in/about" }, // the same site twice: researched once
    ] }, deps());
    expect(r).toMatchObject({ ok: true, queued: 2, skipped: 0 });
    // What's kept before any research: the domain, and the place ID as provenance. No listing name, address or phone.
    const seeded = world().outbound.prospects.find((p) => p.domain === "smiledental.in")!;
    expect(seeded.sources).toEqual([{ provider: "google_places", query: "", url: mapsUrlFor(PID(1)), title: "", at: NOW.toISOString(), placeId: PID(1) }]);
    const run = await drive(r.runId);
    expect(run!.status).toBe("done");
    expect(run!.counters).toMatchObject({ searched: 0, verified: 2 }); // no web search was made, no search credit used
    expect(world().outbound.providerCalls.filter((c) => c.operation === "search")).toHaveLength(0);
    // The name now comes from the website's own title, never from the listing.
    expect(world().outbound.prospects.find((p) => p.domain === "smiledental.in")!.name).toBe("Smile Dental Care");
    expect(world().outbound.prospects.find((p) => p.domain === "pearlteeth.in")!.name).toBe("Pearl Teeth");
    const view: any = await getRun(OWNER(), r.runId, pdeps());
    expect(view.prospects.map((p: any) => p.domain).sort()).toEqual(["pearlteeth.in", "smiledental.in"]);
    for (const s of LISTING_ONLY) { expect(stored()).not.toContain(s); expect(modelMessages.join("\n")).not.toContain(s); }
  });

  it("uses the researched-prospects allowance: trimmed to what's left, refused at zero", async () => {
    process.env.OUTBOUND_MONTHLY_PROSPECTS_PRO = "1";
    const body = { category: "dentists", city: "Siliguri", country: "IN", places: [{ placeId: PID(1), website: "https://smiledental.in/" }, { placeId: PID(3), website: "https://pearlteeth.in/" }] };
    expect(await researchLocalSites(OWNER(), body, deps())).toMatchObject({ ok: true, queued: 1, skipped: 1 });
    expect(await researchLocalSites(OWNER(), body, deps())).toMatchObject({ ok: false, status: 429, code: "monthly_limit" });
  });

  it("refuses a listing without a usable website and a made-up place ID", async () => {
    expect(await researchLocalSites(OWNER(), { category: "dentists", city: "Siliguri", country: "IN", places: [{ placeId: PID(2), website: "javascript:alert(1)" }] }, deps())).toMatchObject({ ok: false, status: 400 });
    expect(await researchLocalSites(OWNER(), { category: "dentists", city: "Siliguri", country: "IN", places: [{ placeId: "x", website: "https://a.in/" }] }, deps())).toMatchObject({ ok: false, status: 400 });
    expect(world().outbound.runs).toHaveLength(0);
  });
});

describe("saving a listing as a lead", () => {
  it("keeps the name the person typed and a link to the listing, nothing else from it; saving twice finds the same lead", async () => {
    const r: any = await saveLocalLead(OWNER(), { placeId: PID(2), companyName: "Hill Cart Dental", location: "Siliguri" }, deps());
    expect(r).toMatchObject({ ok: true, existing: false });
    const detail = await leadsStore.detail(ORG1, r.leadId);
    expect(detail!.lead).toMatchObject({ companyName: "Hill Cart Dental", location: "Siliguri", website: null, source: "outbound" });
    expect(detail!.claims).toEqual([expect.objectContaining({ field: "listing", status: "unknown", evidenceUrl: mapsUrlFor(PID(2)) })]);
    expect(await saveLocalLead(OWNER(), { placeId: PID(2), companyName: "Hill Cart Dental" }, deps())).toMatchObject({ ok: true, leadId: r.leadId, existing: true });
    for (const s of LISTING_ONLY) expect(stored()).not.toContain(s);
    // Another workspace saving the same listing gets its own lead.
    const other: any = await saveLocalLead(OTHER(), { placeId: PID(2), companyName: "Hill Cart" }, deps());
    expect(other).toMatchObject({ ok: true, existing: false });
    expect(other.leadId).not.toBe(r.leadId);
  });

  it("needs a typed name and a real place ID, and leads access", async () => {
    expect(await saveLocalLead(OWNER(), { placeId: PID(2), companyName: "" }, deps())).toMatchObject({ ok: false, status: 400 });
    expect(await saveLocalLead(OWNER(), { placeId: "../../x", companyName: "Abc" }, deps())).toMatchObject({ ok: false, status: 400 });
    expect(await saveLocalLead(READER(), { placeId: PID(2), companyName: "Abc" }, deps())).toMatchObject({ ok: false, status: 403 });
  });
});
