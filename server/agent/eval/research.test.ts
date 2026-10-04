/**
 * Researching a lead from its own website, end to end in the in-memory world: a fake web (real HTML extraction and
 * link picking), a scripted model, and the real services and stores. What each case pins down is something the
 * model or a website must not be able to change: what is believed, what is fetched, what is written.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../storage", async () => (await import("./world-mocks")).storageMock());
vi.mock("../../entitlements", async () => (await import("./world-mocks")).entitlementsMock());
vi.mock("../../emails", async () => (await import("./world-mocks")).emailsMock());
vi.mock("../../leads/profile-store", async () => (await import("./world-mocks")).profileStoreMock());
vi.mock("../../discovery/provider", async () => (await import("./world-mocks")).discoveryProviderMock());
vi.mock("../../discovery/usage", async () => (await import("./world-mocks")).discoveryUsageMock());
vi.mock("../../documents/style-store", async () => (await import("./world-mocks")).documentStyleStoreMock());
vi.mock("../../knowledge/store", async () => (await import("./world-mocks")).knowledgeStoreMock());
vi.mock("../../knowledge/net-guard", async (orig) => (await import("./world-mocks")).netGuardMock(orig as () => Promise<any>));
vi.mock("../../leads/store", async () => (await import("./world-mocks")).leadsStoreMock());
vi.mock("../../sales/research-store", async () => (await import("./world-mocks")).researchStoreMock());
vi.mock("../../llm/trace-store", async () => (await import("./world-mocks")).traceStoreMock());
vi.mock("../../routes", async () => (await import("./world-mocks")).routesMock());
vi.mock("../../copilot/provider", async (orig) => (await import("./world-mocks")).scriptedProviderMock(orig as () => Promise<any>));

import { fetchPublicPage } from "../../knowledge/net-guard";
import { getResearch, startResearch, type ResearchDeps } from "../../sales/research";
import { assessLead } from "../../services/sales";
import { useWorld } from "./world-mocks";
import { createWorld, seedLead, seedProfile, userRow, ORG1, ORG2, type World } from "./world";

const world = () => (globalThis as any).__world as World;
const user = (over: Record<string, any> = {}) => userRow(over) as any;
const OTHER = () => userRow({ id: "u2", organizationId: ORG2 }) as any;

const HOME = `<html><head><title>Casa Alma</title></head><body><nav><a href="/about">About us</a> <a href="/contact">Contact</a> <a href="/login">Login</a> <a href="https://facebook.com/casaalma">Facebook</a> <a href="/menu.pdf">Menu</a></nav>
<main><h1>Casa Alma</h1><p>Casa Alma runs boutique hotels in Lisbon. Book by phone or email only. We are a team of 12 people.</p></main></body></html>`;
const CONTACT = `<html><body><h1>Contact</h1><p>Write to hello@casaalma.pt or call +351 21 555 0123 for reservations.</p></body></html>`;
const ABOUT = `<html><body><h1>About</h1><p>In September 2026 we launched Casa Alma Porto, our second hotel.</p></body></html>`;

const page = (host: string, path: string, body: string, headers: Record<string, string> = { "content-type": "text/html" }, status = 200) => { world().knowledge.web[host + path] = { status, headers, body }; };
const dns = (host: string, ...a: string[]) => { world().knowledge.dns[host] = a; };
const stdSite = () => { dns("casaalma.pt", "93.184.216.34"); page("casaalma.pt", "/", HOME); page("casaalma.pt", "/contact", CONTACT); page("casaalma.pt", "/about", ABOUT); };
const lead = (over: Record<string, any> = {}) => seedLead(world(), { companyName: "Casa Alma", website: "https://casaalma.pt", domain: "casaalma.pt", industry: "Boutique hotels", location: "Lisbon, Portugal", ...over });
const f = (field: string, value: string, quote: string, p = 1) => ({ field, value, quote, page: p });
let sent: { role: string; content: string }[][] = [];
const say = (findings: unknown[], usage = { inputTokens: 2400, outputTokens: 300 }) => { world().llm = async (m) => { sent.push(m); return { content: JSON.stringify({ findings }), toolCalls: [], usage }; }; };

/** Starts a run and lets the test decide when the work happens. */
const start = async (id: number, u = user(), extra: Partial<ResearchDeps> = {}) => {
  const scheduled: (() => Promise<unknown>)[] = [];
  const r = await startResearch(u, id, {}, { schedule: (fn) => scheduled.push(fn), ...extra });
  return { r, run: async () => { for (const fn of scheduled) await fn(); }, scheduled };
};
const claims = (leadId: number) => world().leads.claims.filter((c) => c.leadId === leadId);
const view = async (id: number, u = user()) => ((await getResearch(u, id)) as any).research;

beforeEach(() => { useWorld(createWorld()); sent = []; vi.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { delete process.env.SALES_DAILY_RESEARCH_LIMIT; });

describe("a run, start to finish", () => {
  it("returns at once as running, then reads the site, keeps only verified findings and records the run", async () => {
    stdSite();
    say([f("business_email", "hello@casaalma.pt", "Write to hello@casaalma.pt or call +351 21 555 0123", 2), f("business_phone", "+351 21 555 0123", "call +351 21 555 0123", 2), f("team_size", "12 people", "We are a team of 12 people"), f("launch", "Opened Casa Alma Porto", "we launched Casa Alma Porto", 3), f("pain_point", "Bookings are manual", "Book by phone or email only"), f("buying_signal", "Expanding to a second hotel", "our second hotel", 3)]);
    const l = lead();
    const s = await start(l.id);
    expect(s.r.ok).toBe(true);
    expect((await view(l.id)).status).toBe("running");
    expect(claims(l.id)).toHaveLength(0); // nothing is written until the work runs
    await s.run();

    const v = await view(l.id);
    expect(v).toMatchObject({ status: "done", errorCode: null, claimCount: 6 });
    expect(v.pages.map((p: any) => [p.url, p.ok])).toEqual([["https://casaalma.pt/", true], ["https://casaalma.pt/contact", true], ["https://casaalma.pt/about", true]]);
    const by = Object.fromEntries(claims(l.id).map((c) => [c.field, c]));
    expect(by.business_email).toMatchObject({ status: "confirmed", source: "agent", evidenceUrl: "https://casaalma.pt/contact" });
    expect(by.pain_point.status).toBe("inferred");      // a judgment, however well quoted
    expect(by.buying_signal.status).toBe("inferred");
    expect(by.launch.status).toBe("confirmed");         // a stated fact
    expect(v.summary).toMatchObject({ kept: 6, confirmed: 4, inferred: 2, rejected: {} });
  });
  it("moves a NEW lead to researching through the validated stage change, notes it on the timeline, and never moves a later stage backwards", async () => {
    stdSite(); say([f("team_size", "12 people", "We are a team of 12 people")]);
    const l = lead(); const s = await start(l.id); await s.run();
    expect(world().leads.leads.find((x) => x.id === l.id)!.status).toBe("researching");
    expect(world().leads.events.some((e) => e.leadId === l.id && e.kind === "researched" && e.actor === "agent")).toBe(true);
    const q = lead({ companyName: "Qualified Co", domain: "q.pt", status: "qualified" });
    const s2 = await start(q.id); await s2.run();
    expect(world().leads.leads.find((x) => x.id === q.id)!.status).toBe("qualified");
  });
  it("the lead is then 'researched' and the score reflects the evidence", async () => {
    stdSite(); say([f("pain_point", "Bookings are manual", "Book by phone or email only"), f("business_email", "hello@casaalma.pt", "Write to hello@casaalma.pt or call +351 21 555 0123", 2)]);
    seedProfile(world(), { targetIndustries: ["hotels"], targetLocations: ["Portugal"] });
    const l = lead();
    const before = await assessLead(user(), l.id) as any; expect(before.researched).toBe(false);
    const s = await start(l.id); await s.run();
    const after = await assessLead(user(), l.id) as any;
    expect(after.researched).toBe(true);
    expect(after.score.components.find((c: any) => c.key === "need").points).toBe(12);
    expect(after.score.components.find((c: any) => c.key === "contact").points).toBe(6);
    expect(after.next.action).toBe("draft_outreach");
  });
  it("records a trace of the one model call (task, model, prompt version, tokens, cost) and never the text", async () => {
    stdSite(); say([f("team_size", "12 people", "We are a team of 12 people")]);
    const l = lead(); const s = await start(l.id); await s.run();
    const rows = world().llmCalls;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ task: "research", ok: true, promptVersion: "research-v1", tokensIn: 2400, tokensOut: 300, leadId: l.id, organizationId: ORG1 });
    expect(rows[0].costMicroUsd).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toMatch(/boutique hotels|hello@casaalma/i);
    expect(world().research[0]).toMatchObject({ status: "done", model: expect.any(String), promptVersion: "research-v1", createdBy: "user", createdByUser: "u1" });
  });
  it("re-running appends: the newest claim per field is what the score uses", async () => {
    stdSite(); const l = lead();
    say([f("pain_point", "Bookings are manual", "Book by phone or email only")]);
    let s = await start(l.id); await s.run();
    say([f("pain_point", "No online availability", "Casa Alma runs boutique hotels in Lisbon")]);
    s = await start(l.id); await s.run();
    expect(claims(l.id).filter((c) => c.field === "pain_point")).toHaveLength(2);
    expect(((await assessLead(user(), l.id)) as any).score.components.find((c: any) => c.key === "need").reason).toMatch(/No online availability/);
  });
});

describe("only the company's own site is read, and only pages worth reading", () => {
  it("fetches the home page and the contact and about pages; never the login page, a PDF or another site", async () => {
    stdSite(); say([]);
    const fetched: string[] = [];
    const l = lead(); const s = await start(l.id, user(), { fetchPage: async (u) => { fetched.push(u); return fetchPublicPage(u); } });
    await s.run();
    expect(fetched).toEqual(["https://casaalma.pt/", "https://casaalma.pt/contact", "https://casaalma.pt/about"]);
  });
  it("a site that redirects somewhere else is not the lead's site: nothing from it reaches the model", async () => {
    dns("casaalma.pt", "93.184.216.34"); dns("elsewhere.example", "93.184.216.35");
    page("casaalma.pt", "/", "", { location: "https://elsewhere.example/" }, 302);
    page("elsewhere.example", "/", "<html><body><p>Totally different company, and a long enough paragraph to read.</p></body></html>");
    say([f("description", "Different company", "Totally different company")]);
    const l = lead(); const s = await start(l.id); await s.run();
    const v = await view(l.id);
    expect(v).toMatchObject({ status: "failed", errorCode: "no_pages" });
    expect(v.pages[0].note).toBe("offsite_redirect");
    expect(sent).toHaveLength(0); expect(claims(l.id)).toHaveLength(0);
  });
  it("a site that is not a web page, or cannot be reached, fails cleanly without calling the model", async () => {
    dns("casaalma.pt", "93.184.216.34"); page("casaalma.pt", "/", "{}", { "content-type": "application/json" });
    say([]);
    const l = lead(); const s = await start(l.id); await s.run();
    expect(await view(l.id)).toMatchObject({ status: "failed", errorCode: "no_pages" });
    const l2 = lead({ companyName: "Gone Co", website: "https://gone.example", domain: "gone.example" });
    const s2 = await start(l2.id); await s2.run();
    expect(await view(l2.id)).toMatchObject({ status: "failed", errorCode: "no_pages" });
    expect(sent).toHaveLength(0);
  });
  it("plain text and PDF pages are fetchable but are not read as web pages: they never reach the model", async () => {
    for (const type of ["text/plain", "application/pdf"]) {
      useWorld(createWorld()); sent = [];
      dns("casaalma.pt", "93.184.216.34"); page("casaalma.pt", "/", "Casa Alma runs boutique hotels in Lisbon. A long enough plain text body to read.", { "content-type": type });
      say([f("description", "Boutique hotels", "boutique hotels in Lisbon")]);
      const l = lead(); const s = await start(l.id); await s.run();
      const v = await view(l.id);
      expect(v, type).toMatchObject({ status: "failed", errorCode: "no_pages" });
      expect(v.pages[0].note, type).toBe("not_html");
      expect(sent, type).toHaveLength(0);
    }
  });
  it("a site whose address resolves to a private network is refused by the network guard, not read", async () => {
    dns("casaalma.pt", "10.0.0.5"); page("casaalma.pt", "/", HOME); say([]);
    const l = lead(); const s = await start(l.id); await s.run();
    expect((await view(l.id)).status).toBe("failed");
    expect(sent).toHaveLength(0);
  });
});

describe("whatever the model says is checked before it is believed", () => {
  it("a fabricated quote and a personal address save nothing; the run still counts as done (it WAS researched)", async () => {
    stdSite(); say([f("pain_point", "Website is very slow", "Our website takes ages to load"), f("business_email", "ceo@casaalma.pt", "Write to ceo@casaalma.pt", 2)]);
    const l = lead(); const s = await start(l.id); await s.run();
    const v = await view(l.id);
    expect(v.status).toBe("done"); expect(v.claimCount).toBe(0);
    expect(v.summary.rejected).toEqual({ quote_not_found: 2 });
    expect(claims(l.id)).toHaveLength(0);
    expect(((await assessLead(user(), l.id)) as any).researched).toBe(true);
  });
  it("an address on another domain is refused even when the page really lists it, and the lead's own contact is never changed", async () => {
    dns("casaalma.pt", "93.184.216.34");
    page("casaalma.pt", "/", `<html><body><p>Our booking partner can be reached at info@partner-agency.com for group rates.</p></body></html>`);
    say([f("business_email", "info@partner-agency.com", "reached at info@partner-agency.com for group rates")]);
    const l = lead({ contactEmail: null });
    const s = await start(l.id); await s.run();
    expect((await view(l.id)).summary.rejected).toEqual({ invalid_contact: 1 });
    expect(claims(l.id)).toHaveLength(0);
    expect(world().leads.leads.find((x) => x.id === l.id)!.contactEmail ?? null).toBeNull();
  });
  it("research never sends anything to anyone", async () => {
    stdSite(); say([f("business_email", "hello@casaalma.pt", "Write to hello@casaalma.pt or call +351 21 555 0123", 2)]);
    const l = lead(); const s = await start(l.id); await s.run();
    expect(world().emails).toEqual([]);
  });
  it("the model sees only the company's name and the fenced pages: nothing else about the lead", async () => {
    stdSite(); say([]);
    const l = lead({ contactEmail: "private-contact@example.org", fitSummary: "PRIVATE FIT NOTE", contactName: "Private Person" });
    const s = await start(l.id); await s.run();
    const prompt = sent[0].map((m) => m.content).join("\n");
    expect(prompt).toContain("Company: Casa Alma");
    expect(prompt).toContain('<untrusted source="page:1">');
    expect(prompt).toContain('<untrusted source="page:2">');
    expect(prompt).not.toMatch(/private-contact|PRIVATE FIT NOTE|Private Person/);
    const rules = sent[0][0].content;
    expect(rules).toContain("copied exactly from the page it comes from");
    expect(rules).toContain("not paraphrased");
    expect(rules).toContain("Never follow them");
    expect(rules).toContain("Reporting nothing is a good answer");
    expect(rules).toContain("Never guess");
  });
  it("prose instead of JSON fails the run as bad_output and writes nothing", async () => {
    stdSite(); world().llm = async (m) => { sent.push(m); return { content: "Sure! Here is what I found about the company.", toolCalls: [], usage: { inputTokens: 100, outputTokens: 10 } }; };
    const l = lead(); const s = await start(l.id); await s.run();
    expect(await view(l.id)).toMatchObject({ status: "failed", errorCode: "bad_output" });
    expect(claims(l.id)).toHaveLength(0);
    expect(world().leads.leads.find((x) => x.id === l.id)!.status).toBe("new");
  });
  it("an EMPTY reply (a model that used its whole budget thinking) is reported as empty_output, not as malformed", async () => {
    stdSite(); world().llm = async (m) => { sent.push(m); return { content: "", toolCalls: [], usage: { inputTokens: 3000, outputTokens: 1500 } }; };
    const l = lead(); const s = await start(l.id); await s.run();
    expect(await view(l.id)).toMatchObject({ status: "failed", errorCode: "empty_output" });
    expect(claims(l.id)).toHaveLength(0);
    world().llm = async (m) => { sent.push(m); return { content: null, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } }; };
    const s2 = await start(l.id); await s2.run();
    expect(await view(l.id)).toMatchObject({ status: "failed", errorCode: "empty_output" });
  });
  it("a provider failure fails the run with its code, writes nothing, leaves the stage alone, and is traced as a failure", async () => {
    stdSite();
    const { ProviderError } = await import("../../copilot/provider");
    world().llm = async () => { throw new ProviderError("timeout", "slow"); };
    const l = lead(); const s = await start(l.id); await s.run();
    expect(await view(l.id)).toMatchObject({ status: "failed", errorCode: "timeout" });
    expect(claims(l.id)).toHaveLength(0);
    expect(world().leads.leads.find((x) => x.id === l.id)!.status).toBe("new");
    expect(world().llmCalls[0]).toMatchObject({ ok: false, errorCode: "timeout", tokensIn: 0 });
  });
  it("an unexpected error is recorded as 'internal' and the run is still finished, not left running", async () => {
    stdSite(); world().llm = async () => { throw new TypeError("boom"); };
    const l = lead(); const s = await start(l.id); await s.run();
    expect(await view(l.id)).toMatchObject({ status: "failed", errorCode: "internal" });
    expect(world().research.every((r) => r.status !== "running")).toBe(true);
  });
  it("a model call that takes the run past its budget is timed out too, and its findings are not saved", async () => {
    stdSite();
    let t = Date.parse("2026-10-10T12:00:00Z");
    world().llm = async (m) => { sent.push(m); t += 200_000; return { content: JSON.stringify({ findings: [f("team_size", "12 people", "We are a team of 12 people")] }), toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } }; };
    const l = lead(); const s = await start(l.id, user(), { now: () => new Date(t) });
    await s.run();
    expect(await view(l.id)).toMatchObject({ status: "failed", errorCode: "timeout" });
    expect(claims(l.id)).toHaveLength(0);
    expect(sent).toHaveLength(1); // the model WAS called; what it returned was discarded
  });
  it("a run that outlives its time budget is recorded as timed out and saves nothing", async () => {
    stdSite(); say([f("team_size", "12 people", "We are a team of 12 people")]);
    let t = Date.parse("2026-10-10T12:00:00Z");
    const l = lead();
    const s = await start(l.id, user(), { now: () => new Date(t), fetchPage: async (u) => { const r = await fetchPublicPage(u); t += 200_000; return r; } });
    await s.run();
    expect(await view(l.id)).toMatchObject({ status: "failed", errorCode: "timeout" });
    expect(claims(l.id)).toHaveLength(0);
  });
});

describe("starting a run", () => {
  it("needs a website, a public one, and an open lead", async () => {
    const noSite = lead({ website: null, domain: null });
    const a = await startResearch(user(), noSite.id, {}, { schedule: () => {} });
    expect(a).toMatchObject({ ok: false, code: "no_website" });
    for (const w of ["http://casaalma.pt", "https://localhost/", "https://127.0.0.1/", "https://169.254.169.254/"]) {
      const l = lead({ companyName: `Co ${w}`, website: w, domain: w.replace(/\W/g, "") });
      const r = await startResearch(user(), l.id, {}, { schedule: () => {} });
      expect(r, w).toMatchObject({ ok: false, code: "bad_website" });
    }
    for (const status of ["won", "lost"]) {
      const l = lead({ companyName: `Closed ${status}`, domain: `c-${status}.pt`, status });
      expect(await startResearch(user(), l.id, {}, { schedule: () => {} }), status).toMatchObject({ ok: false, code: "closed" });
    }
    const archived = lead({ companyName: "Old", domain: "old.pt", archivedAt: new Date() });
    expect(await startResearch(user(), archived.id, {}, { schedule: () => {} })).toMatchObject({ ok: false, code: "closed" });
    expect(world().research).toHaveLength(0);
  });
  it("one run at a time per lead; a new one may start when it finishes; a run left running for over 3 minutes is stale and recovered", async () => {
    stdSite(); say([]);
    const l = lead();
    const first = await start(l.id);
    expect(first.r.ok).toBe(true);
    expect((await start(l.id)).r).toMatchObject({ ok: false, code: "running" });
    await first.run();
    expect((await start(l.id)).r.ok).toBe(true);
    world().research[0].startedAt = new Date(Date.now() - 10 * 60_000);          // the earlier, finished run
    world().research.at(-1)!.startedAt = new Date(Date.now() - 4 * 60_000);       // the running one, left behind
    expect((await view(l.id))).toMatchObject({ status: "failed", errorCode: "stale" });   // read as failed, not as running forever
    expect((await start(l.id)).r.ok).toBe(true);                                         // and a new one may start
  });
  it("two clicks at once start exactly one run", async () => {
    stdSite(); say([]); const l = lead();
    const results = await Promise.all([start(l.id), start(l.id), start(l.id)]);
    expect(results.filter((x) => x.r.ok)).toHaveLength(1);
    expect(world().research).toHaveLength(1);
  });
  it("stops at the workspace's daily allowance WITHOUT creating a run or calling the model; a failed run does not use it up", async () => {
    process.env.SALES_DAILY_RESEARCH_LIMIT = "2";
    stdSite(); say([f("team_size", "12 people", "We are a team of 12 people")]);
    const ids = [lead({ domain: "a.pt" }), lead({ companyName: "B", domain: "b.pt" }), lead({ companyName: "C", domain: "c.pt" })];
    for (const l of ids.slice(0, 2)) { const s = await start(l.id); expect(s.r.ok).toBe(true); await s.run(); }
    const callsBefore = sent.length, runsBefore = world().research.length;
    const third = await start(ids[2].id);
    expect(third.r).toMatchObject({ ok: false, code: "daily_limit" });
    expect(sent.length).toBe(callsBefore); expect(world().research.length).toBe(runsBefore);

    world().llmCalls.length = 0;
    const { ProviderError } = await import("../../copilot/provider");
    world().llm = async () => { throw new ProviderError("upstream", "down"); };
    for (const l of ids.slice(0, 2)) { const s = await start(l.id); await s.run(); }   // two failures
    world().llm = async (m) => { sent.push(m); return { content: JSON.stringify({ findings: [] }), toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } }; };
    expect((await start(ids[2].id)).r.ok).toBe(true);                                  // failures did not count
  });
  it("a different workspace's allowance is separate", async () => {
    process.env.SALES_DAILY_RESEARCH_LIMIT = "1";
    stdSite(); say([]);
    const a = lead(); const s = await start(a.id); await s.run();
    const mine2 = lead({ companyName: "Second", domain: "second.pt" });
    expect((await start(mine2.id)).r).toMatchObject({ ok: false, code: "daily_limit" });
    const theirs = seedLead(world(), { companyName: "Theirs", website: "https://casaalma.pt", domain: "theirs.pt" }, ORG2);
    expect((await start(theirs.id, OTHER())).r.ok).toBe(true);
  });
  it("another workspace's lead is not found, for starting and for reading; a member who may only edit deals can read but not start", async () => {
    stdSite(); say([]);
    const mine = lead();
    expect((await start(mine.id, OTHER())).r).toMatchObject({ ok: false, code: "not_found" });
    expect(await getResearch(OTHER(), mine.id)).toMatchObject({ ok: false, code: "not_found" });
    const reader = { ...user(), orgRole: "CUSTOM", customPermissions: ["deals.edit"] };
    expect((await start(mine.id, reader)).r).toMatchObject({ ok: false, code: "forbidden" });
    expect((await getResearch(reader, mine.id)).ok).toBe(true);
    const nobody = { ...user(), orgRole: "CUSTOM", customPermissions: [] };
    expect(await getResearch(nobody, mine.id)).toMatchObject({ ok: false, code: "forbidden" });
    expect(world().research).toHaveLength(0);
  });
  it("a do-not-contact lead can still be researched (reading a company is not contacting it)", async () => {
    stdSite(); say([f("team_size", "12 people", "We are a team of 12 people")]);
    const l = lead({ doNotContact: true }); const s = await start(l.id); await s.run();
    expect((await view(l.id)).status).toBe("done");
    expect(((await assessLead(user(), l.id)) as any).next).toMatchObject({ action: "none", blockedBy: "do_not_contact" });
  });
});
