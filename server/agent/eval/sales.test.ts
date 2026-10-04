/**
 * The sales agent's judgement (score and next best action) through the real service against the
 * in-memory world. What each case pins down is something that must not drift: unknown never scores,
 * do-not-contact always wins, another workspace's lead is not reachable, and timing uses the
 * organization's day.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("../../routes", async () => (await import("./world-mocks")).routesMock());
vi.mock("../../copilot/provider", async (orig) => (await import("./world-mocks")).scriptedProviderMock(orig as () => Promise<any>));

import { addClaim, closeTicket, createTicket } from "../../services/leads";
import { assessLead, hasResearch, lastContactedAt } from "../../services/sales";
import { useWorld } from "./world-mocks";
import { createWorld, seedLead, seedProfile, userRow, ORG1, ORG2, type World } from "./world";

const world = () => (globalThis as any).__world as World;
const user = (over: Record<string, any> = {}) => userRow(over) as any;
const OTHER = () => userRow({ id: "u2", organizationId: ORG2 }) as any;
const DAY = 86_400_000;
const NOW = new Date("2026-10-10T12:00:00Z");
const assess = async (id: number, u = user(), pendingDrafts = 0) => { const r = await assessLead(u, id, { now: () => NOW, pendingDrafts }); if (!r.ok) throw new Error(`${r.code}: ${r.message}`); return r; };
const lead = (over: Record<string, any> = {}) => seedLead(world(), { companyName: "Casa Alma", industry: "Boutique hotels", location: "Lisbon, Portugal", ...over });
const agentClaim = (leadId: number, field: string, status: string, value = `${field} value`) =>
  addClaim(user(), leadId, { field, value, status, ...(status === "confirmed" ? { evidenceUrl: "https://casaalma.pt/about", evidenceSnippet: `${value} (as written on the page)` } : {}) }, { actor: "agent" });
const comp = (a: Awaited<ReturnType<typeof assess>>, k: string) => a.score.components.find((c) => c.key === k)!;

beforeEach(() => { useWorld(createWorld()); vi.spyOn(console, "log").mockImplementation(() => {}); });

describe("the score from a real lead", () => {
  it("a bare lead scores only what is recorded: nothing researched, no profile, no contact", async () => {
    const l = lead();
    const a = await assess(l.id);
    expect(a.score.total).toBe(0);
    expect(a.score.confidence).toBe("low");
    expect(a.researched).toBe(false);
    expect(a.score.missing.join(" ")).toMatch(/ideal client/i);
  });
  it("uses the real fit verdict once an ideal client is set", async () => {
    seedProfile(world(), { targetIndustries: ["hotels"], targetLocations: ["Portugal"] });
    const a = await assess(lead().id);
    expect(a.fit?.verdict).toBe("strong");
    expect(comp(a, "fit").points).toBe(20);
  });
  it("confirmed claims score in full, inferred in half, and 'unknown' claims score nothing", async () => {
    const l = lead({ contactEmail: "hello@casaalma.pt" });
    await agentClaim(l.id, "pain_point", "confirmed", "Outdated booking page");
    await agentClaim(l.id, "buying_signal", "inferred", "Recently opened a second hotel");
    await agentClaim(l.id, "timing", "unknown", "");
    const a = await assess(l.id);
    expect(comp(a, "need").points).toBe(25);
    expect(comp(a, "signal").points).toBe(10);
    expect(comp(a, "timing").points).toBeNull();
    expect(comp(a, "contact").points).toBe(6);
    expect(a.score.total).toBe(41);
    expect(comp(a, "need").evidenceClaimIds).toHaveLength(1);
    expect(a.researched).toBe(true); // an agent claim with evidence exists
  });
  it("a note or a claim with a field that is not in the rubric moves nothing", async () => {
    const l = lead();
    await addClaim(user(), l.id, { field: "favourite_colour", value: "green", status: "inferred" }, { actor: "user" });
    expect((await assess(l.id)).score.total).toBe(0);
  });
  it("do-not-contact scores contactability 0 and blocks the next action", async () => {
    const l = lead({ doNotContact: true, contactEmail: "hello@casaalma.pt" });
    const a = await assess(l.id);
    expect(comp(a, "contact").points).toBe(0);
    expect(a.next).toMatchObject({ action: "none", blockedBy: "do_not_contact" });
  });
});

describe("the next action from a real lead", () => {
  it("an unresearched new lead is researched first; a researched, reachable one gets a draft", async () => {
    const l = lead({ contactEmail: "hello@casaalma.pt" });
    expect((await assess(l.id)).next.action).toBe("research");
    await agentClaim(l.id, "pain_point", "confirmed");
    expect((await assess(l.id)).next.action).toBe("draft_outreach");
  });
  it("a researched lead with no email needs a contact first", async () => {
    const l = lead(); await agentClaim(l.id, "pain_point", "confirmed");
    expect((await assess(l.id)).next.action).toBe("find_contact");
  });
  it("a draft waiting for approval comes first", async () => {
    const l = lead({ contactEmail: "a@b.co" }); await agentClaim(l.id, "need", "confirmed");
    expect((await assess(l.id, user(), 1)).next.action).toBe("review_draft");
  });
  it("contacted: wait for 2 days, follow up from 3, counted from the stage-change on the timeline", async () => {
    const l = lead({ status: "contacted", contactEmail: "a@b.co" });
    const at = (daysAgo: number) => { world().leads.events.length = 0; world().leads.events.push({ id: 1, leadId: l.id, organizationId: ORG1, kind: "status_changed", data: { from: "qualified", to: "contacted" }, actor: "user", actorUserId: "u1", createdAt: new Date(NOW.getTime() - daysAgo * DAY) } as any); };
    at(2); expect((await assess(l.id)).next.action).toBe("wait");
    at(3); const a = await assess(l.id); expect(a.next.action).toBe("follow_up"); expect(a.next.reason).toMatch(/3 days ago/);
  });
  it("an overdue step you set triggers a follow-up even right after contact (the organization's day, not the server's)", async () => {
    const l = lead({ status: "contacted", contactEmail: "a@b.co", statusChangedAt: new Date(NOW.getTime() - DAY) });
    await createTicket(user(), l.id, { title: "Call them", kind: "follow_up", dueAt: "2026-10-09" }, { actor: "user" });
    expect((await assess(l.id)).next.action).toBe("follow_up");
  });
  it("a step you have already done or cancelled no longer triggers a follow-up", async () => {
    const l = lead({ status: "contacted", contactEmail: "a@b.co", statusChangedAt: new Date(NOW.getTime() - DAY) });
    const t = await createTicket(user(), l.id, { title: "Call them", kind: "follow_up", dueAt: "2026-10-09" }, { actor: "user" });
    expect((await assess(l.id)).next.action).toBe("follow_up");
    if (!t.ok) throw new Error("ticket"); 
    await closeTicket(user(), l.id, t.ticket.id, "done", { actor: "user" });
    expect((await assess(l.id)).next.action).toBe("wait");
  });
  it("an excluded lead is reconsidered", async () => {
    seedProfile(world(), { exclusions: ["hotels"] });
    expect((await assess(lead().id)).next.action).toBe("reconsider");
  });
});

describe("who may ask", () => {
  it("another workspace's lead is not found, in both directions", async () => {
    const mine = lead();
    const theirs = seedLead(world(), { companyName: "Their Co" }, ORG2);
    const r1 = await assessLead(OTHER(), mine.id, { now: () => NOW }); expect(r1.ok).toBe(false);
    const r2 = await assessLead(user(), theirs.id, { now: () => NOW }); expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe("not_found");
    expect((await assessLead(user(), 99999)).ok).toBe(false);
  });
  it("a member who cannot read deals cannot read a lead's assessment", async () => {
    const l = lead();
    const nobody = { ...user(), orgRole: "CUSTOM", customPermissions: [] };
    const r = await assessLead(nobody, l.id, { now: () => NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("forbidden");
  });
});

describe("the helpers", () => {
  it("hasResearch needs an agent-written claim WITH evidence: a person's claim or an agent guess does not count", () => {
    expect(hasResearch([{ source: "agent", evidenceUrl: "https://x.test" }])).toBe(true);
    expect(hasResearch([{ source: "agent", evidenceUrl: null }])).toBe(false);
    expect(hasResearch([{ source: "user", evidenceUrl: "https://x.test" }])).toBe(false);
    expect(hasResearch([])).toBe(false);
  });
  it("lastContactedAt takes the latest move to contacted, falls back to the stage timestamp only when contacted, and ignores other events", () => {
    const ev = (to: string, d: string) => ({ kind: "status_changed", data: { to }, createdAt: new Date(d) });
    expect(lastContactedAt([ev("contacted", "2026-10-01"), ev("contacted", "2026-10-05"), ev("replied", "2026-10-09")], "replied")?.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(lastContactedAt([], "contacted", "2026-10-02")?.toISOString().slice(0, 10)).toBe("2026-10-02");
    expect(lastContactedAt([], "qualified", "2026-10-02")).toBeNull();
    expect(lastContactedAt([{ kind: "note", data: { to: "contacted" }, createdAt: new Date("2026-10-03") }], "qualified")).toBeNull();
  });
});
