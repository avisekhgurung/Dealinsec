/**
 * The lead pipeline through the agent: the real loop, policy, approvals, tools
 * and services against the in-memory world and lead store, with a scripted model.
 * What each case pins down is something the model must not be able to change:
 * what asks, what never creates twice, what cannot be invented, who can see what.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../storage", async () => (await import("./world-mocks")).storageMock());
vi.mock("../../entitlements", async () => (await import("./world-mocks")).entitlementsMock());
vi.mock("../../emails", async () => (await import("./world-mocks")).emailsMock());
vi.mock("../../leads/profile-store", async () => (await import("./world-mocks")).profileStoreMock());
vi.mock("../../leads/store", async () => (await import("./world-mocks")).leadsStoreMock());
vi.mock("../../routes", async () => (await import("./world-mocks")).routesMock());
vi.mock("../../copilot/provider", async (orig) => (await import("./world-mocks")).scriptedProviderMock(orig as () => Promise<any>));

import { executeApproval } from "../approvals";
import { runAgent } from "../loop";
import { MemoryAgentStore } from "../memory-store";
import { authorizeCall } from "../policy";
import { AGENT_TOOLS } from "../tools";
import { FakeProvider, call, collect, say, type Step } from "../testing";
import type { AutonomyLevel } from "../types";
import { convertToDeal } from "../../services/leads";
import { useWorld } from "./world-mocks";
import { createWorld, seedLead, seedProfile, userRow, ORG2, type World } from "./world";

const world = () => (globalThis as any).__world as World;
const OWNER = () => world().users.get("u1")!;
beforeEach(() => {
  useWorld(createWorld());
  vi.spyOn(console, "log").mockImplementation(() => {});
});

async function run(o: { user?: any; autonomy?: AutonomyLevel; text?: string; steps: Step[]; store?: MemoryAgentStore }) {
  const store = o.store ?? new MemoryAgentStore();
  const provider = new FakeProvider(o.steps);
  const ev = collect();
  const result = await runAgent(
    { provider, store, tools: AGENT_TOOLS, systemMessages: ["SYSTEM"], autonomy: o.autonomy ?? 0 },
    { sessionId: "s1", user: o.user ?? OWNER(), text: o.text ?? "do it", channel: "web" },
    ev.emit,
  );
  return { result, ev, store, provider };
}
const toolResult = (p: FakeProvider, i = 1) => p.calls[i].filter((m) => m.role === "tool").map((m) => m.content).join("\n");
const approve = (store: MemoryAgentStore, id: string, user: any = OWNER()) => executeApproval({ store, tools: AGENT_TOOLS }, user, id, collect().emit);
const firstApproval = (store: MemoryAgentStore) => [...store.approvals.keys()][0];
const ASKED = say("Waiting for your approval.");

describe("creating leads", () => {
  it("asks at level 0: nothing is written until the user approves, then the lead is the agent's and says so", async () => {
    const { result, store } = await run({ steps: [call("create_lead", { companyName: "Northwind", website: "https://www.northwind.com/about", industry: "Logistics" }), ASKED] });
    expect(result.status).toBe("waiting_for_user");
    expect(world().leads.leads).toHaveLength(0);
    await approve(store, firstApproval(store));
    expect(world().leads.leads).toHaveLength(1);
    expect(world().leads.leads[0]).toMatchObject({ companyName: "Northwind", domain: "northwind.com", source: "agent", status: "new", organizationId: "org-1" });
    expect(world().leads.events.map((e) => [e.kind, e.actor])).toEqual([["created", "agent"]]);
  });

  it("runs unasked at level 1 (a safe, internal change)", async () => {
    const { store } = await run({ autonomy: 1, steps: [call("create_lead", { companyName: "Northwind" }), say("Added.")] });
    expect(store.approvals.size).toBe(0);
    expect(world().leads.leads).toHaveLength(1);
  });

  it("a duplicate website is refused before anyone is asked", async () => {
    seedLead(world(), { companyName: "Northwind Ltd", domain: "northwind.com", website: "northwind.com" });
    const { store, provider } = await run({ steps: [call("create_lead", { companyName: "Northwind", website: "www.northwind.com" }), say("You already have it.")] });
    expect(store.approvals.size).toBe(0);
    expect(toolResult(provider)).toMatch(/already have a lead/);
    expect(world().leads.leads).toHaveLength(1);
  });

  it("a made-up or malformed contact email is refused, never stored", async () => {
    const { store, provider } = await run({ steps: [call("create_lead", { companyName: "Northwind", contactEmail: "ceo at northwind" }), say("Which email?")] });
    expect(store.approvals.size).toBe(0);
    expect(toolResult(provider)).toMatch(/invalid/i);
  });

  it("a batch asks once, skips duplicates and invalid rows, and adds the rest", async () => {
    seedLead(world(), { companyName: "Existing Co", domain: "existing.com", website: "existing.com" });
    const { store } = await run({
      steps: [call("create_leads", { leads: [
        { companyName: "Alpha", website: "alpha.com" },
        { companyName: "Existing Co", website: "existing.com" },
        { companyName: "Bravo" },
        { companyName: "Alpha again", website: "https://alpha.com" },
        { companyName: "Broken", contactEmail: "nope" },
      ] }), ASKED],
    });
    expect(store.approvals.size).toBe(1);
    const stored = [...store.approvals.values()][0].args.leads as { companyName: string }[];
    expect(stored.map((l) => l.companyName)).toEqual(["Alpha", "Bravo"]);
    await approve(store, firstApproval(store));
    expect(world().leads.leads.map((l) => l.companyName)).toEqual(["Existing Co", "Alpha", "Bravo"]);
  });

  it("a batch of nothing addable asks for nothing", async () => {
    seedLead(world(), { companyName: "Existing Co", domain: "existing.com", website: "existing.com" });
    const { store } = await run({ steps: [call("create_leads", { leads: [{ companyName: "Existing Co", website: "existing.com" }] }), say("Already there.")] });
    expect(store.approvals.size).toBe(0);
  });

  it("more than the batch limit is refused outright", async () => {
    const leads = Array.from({ length: 21 }, (_, i) => ({ companyName: `Co ${i}` }));
    const { store, provider } = await run({ steps: [call("create_leads", { leads }), say("Too many.")] });
    expect(store.approvals.size).toBe(0);
    expect(toolResult(provider)).toMatch(/invalid_arguments/);
  });
});

describe("evidence: nothing is 'confirmed' without a source", () => {
  it("confirmed without a URL and the page's words is refused before asking", async () => {
    const lead = seedLead(world());
    const { store, provider } = await run({ steps: [call("add_lead_claim", { leadId: lead.id, field: "headcount", value: "200", status: "confirmed" }), say("I need a source.")] });
    expect(store.approvals.size).toBe(0);
    expect(toolResult(provider)).toMatch(/URL|words from the page|source/i);
    expect(world().leads.claims).toHaveLength(0);
  });

  it("inferred needs no source; confirmed with one is stored with it", async () => {
    const lead = seedLead(world());
    const a = await run({ autonomy: 1, steps: [call("add_lead_claim", { leadId: lead.id, field: "headcount", value: "about 200", status: "inferred" }), say("ok")] });
    expect(a.store.approvals.size).toBe(0);
    await run({ autonomy: 1, steps: [call("add_lead_claim", { leadId: lead.id, field: "hiring", value: "hiring a designer", status: "confirmed", evidenceUrl: "https://northwind.com/careers", evidenceSnippet: "We are hiring a product designer" }), say("ok")] });
    expect(world().leads.claims.map((c) => [c.status, c.evidenceUrl, c.source])).toEqual([["inferred", null, "agent"], ["confirmed", "https://northwind.com/careers", "agent"]]);
  });
});

describe("stages", () => {
  it("a lead can never be moved to won: the tool does not offer it", async () => {
    const lead = seedLead(world(), { status: "proposal" });
    const { store, provider } = await run({ steps: [call("move_lead", { leadId: lead.id, to: "won" }), say("It needs converting.")] });
    expect(store.approvals.size).toBe(0);
    expect(toolResult(provider)).toMatch(/invalid_arguments/);
    expect(world().leads.leads[0].status).toBe("proposal");
  });

  it("a move the machine forbids is refused with the allowed ones; a valid move asks, then happens", async () => {
    const lead = seedLead(world(), { status: "new" });
    const bad = await run({ steps: [call("move_lead", { leadId: lead.id, to: "meeting" }), say("Can't.")] });
    expect(bad.store.approvals.size).toBe(0);
    expect(toolResult(bad.provider)).toMatch(/can't go straight to Meeting/);
    const good = await run({ steps: [call("move_lead", { leadId: lead.id, to: "qualified" }), ASKED] });
    expect(world().leads.leads[0].status).toBe("new");
    await approve(good.store, firstApproval(good.store));
    expect(world().leads.leads[0].status).toBe("qualified");
    expect(world().leads.events.at(-1)).toMatchObject({ kind: "status_changed", actor: "agent" });
  });

  it("an approval is single-use: approving twice moves the lead once", async () => {
    const lead = seedLead(world(), { status: "new" });
    const { store } = await run({ steps: [call("move_lead", { leadId: lead.id, to: "researching" }), ASKED] });
    const id = firstApproval(store);
    await approve(store, id);
    await approve(store, id);
    expect(world().leads.events.filter((e) => e.kind === "status_changed")).toHaveLength(1);
  });
});

describe("tickets", () => {
  it("create then complete a ticket; a closed lead takes none", async () => {
    const lead = seedLead(world(), { status: "qualified" });
    await run({ autonomy: 1, steps: [call("create_ticket", { leadId: lead.id, title: "Send intro email", kind: "intro", dueAt: "2026-10-09" }), say("ok")] });
    expect(world().leads.tickets).toMatchObject([{ title: "Send intro email", kind: "intro", status: "open", createdBy: "agent" }]);
    const id = world().leads.tickets[0].id;
    await run({ autonomy: 1, steps: [call("complete_ticket", { leadId: lead.id, ticketId: id }), say("ok")] });
    expect(world().leads.tickets[0].status).toBe("done");
    const lost = seedLead(world(), { status: "lost" });
    const { provider } = await run({ autonomy: 1, steps: [call("create_ticket", { leadId: lost.id, title: "Chase" }), say("closed")] });
    expect(toolResult(provider)).toMatch(/closed/);
  });

  it("a ticket from another organization's lead looks like it doesn't exist", async () => {
    const theirs = seedLead(world(), { companyName: "Foreign" }, ORG2);
    const { provider } = await run({ autonomy: 1, steps: [call("create_ticket", { leadId: theirs.id, title: "Spy" }), say("not found")] });
    expect(toolResult(provider)).toMatch(/isn't in your organization/);
    expect(world().leads.tickets).toHaveLength(0);
  });
});

describe("the ideal client and the fit check", () => {
  it("nothing set: the agent is told to ask, and a fit check says there is nothing to compare", async () => {
    const lead = seedLead(world(), { companyName: "Northwind", industry: "Logistics" });
    const a = await run({ steps: [call("get_ideal_client", {}), say("ok")] });
    expect(toolResult(a.provider)).toMatch(/hasn't set their ideal client/);
    const b = await run({ steps: [call("assess_lead_fit", { leadId: lead.id }), say("ok")] });
    expect(toolResult(b.provider)).toMatch(/No ideal client set/);
  });

  it("saving asks at level 0 and shows the change; nothing is stored until approved; other fields are kept", async () => {
    seedProfile(world(), { targetLocations: ["India"] });
    const { store } = await run({ steps: [call("update_ideal_client", { targetIndustries: ["Logistics", "Retail"], minDealMajor: 50000 }), ASKED] });
    expect(world().profiles.get("org-1")!.targetIndustries).toEqual([]);
    const preview = [...store.approvals.values()][0].preview as any;
    expect(preview.lines.map((l: any) => l.label)).toEqual(["Target industries", "Minimum deal"]);
    expect(preview.lines[1].value).toContain("₹50,000");
    await approve(store, firstApproval(store));
    expect(world().profiles.get("org-1")).toMatchObject({ targetIndustries: ["Logistics", "Retail"], targetLocations: ["India"], minDealMinor: 5_000_000, currency: "INR", updatedBy: "u1" });
  });

  it("an unchanged profile asks for nothing; junk is refused before anyone is asked", async () => {
    seedProfile(world(), { targetIndustries: ["Logistics"] });
    const same = await run({ steps: [call("update_ideal_client", { targetIndustries: ["Logistics"] }), say("already")] });
    expect(same.store.approvals.size).toBe(0);
    expect(toolResult(same.provider)).toMatch(/already how/);
    const junk = await run({ steps: [call("update_ideal_client", { minDealMajor: -5 }), say("no")] });
    expect(junk.store.approvals.size).toBe(0);
  });

  it("a fit check gives plain reasons from the profile, and unknown is not a mismatch", async () => {
    seedProfile(world(), { targetIndustries: ["logistics"], targetLocations: ["India"], minDealMinor: 5_000_000, currency: "INR", exclusions: ["gambling"] });
    const good = seedLead(world(), { companyName: "Northwind", industry: "Freight & Logistics", location: "Pune, India", estValueMinor: 6_000_000, currency: "INR" });
    const thin = seedLead(world(), { companyName: "Orchid", industry: "Logistics" });
    const bad = seedLead(world(), { companyName: "Lucky Spin", industry: "Online gambling", location: "India" });
    const g = await run({ steps: [call("assess_lead_fit", { leadId: good.id }), say("ok")] });
    expect(toolResult(g.provider)).toMatch(/Strong fit/);
    expect(toolResult(g.provider)).toMatch(/matches your target "logistics"/);
    expect(toolResult(g.provider)).toMatch(/Estimated ₹60,000 meets your minimum of ₹50,000/);
    const t = await run({ steps: [call("assess_lead_fit", { leadId: thin.id }), say("ok")] });
    expect(toolResult(t.provider)).toMatch(/Location \[unknown\]/);
    expect(toolResult(t.provider)).not.toMatch(/mismatch/);
    expect(toolResult(t.provider)).toMatch(/needs a location, an estimated value/);
    const b = await run({ steps: [call("assess_lead_fit", { leadId: bad.id }), say("ok")] });
    expect(toolResult(b.provider)).toMatch(/Excluded: .*gambling/);
  });

  it("another organization's profile and leads are invisible", async () => {
    seedProfile(world(), { targetIndustries: ["Secret industry"] }, ORG2);
    const theirs = seedLead(world(), { companyName: "Foreign" }, ORG2);
    const a = await run({ steps: [call("get_ideal_client", {}), say("ok")] });
    expect(toolResult(a.provider)).not.toMatch(/Secret industry/);
    const b = await run({ steps: [call("assess_lead_fit", { leadId: theirs.id }), say("ok")] });
    expect(toolResult(b.provider)).toMatch(/isn't in your organization/);
  });
});

describe("follow-ups: what is due", () => {
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const ticket = (leadId: number, title: string, dueAt: string | null, status = "open", org = "org-1") =>
    world().leads.tickets.push({ id: world().leads.tickets.length + 1, leadId, organizationId: org, title, kind: "other", status, dueAt: dueAt ? new Date(dueAt) : null, createdBy: "user", doneAt: null, createdAt: new Date() } as any);

  it("separates overdue, due today and coming up; leaves out done, undated, far-off, closed, archived and foreign", async () => {
    const live = seedLead(world(), { companyName: "Live Co", status: "contacted" });
    const won = seedLead(world(), { companyName: "Won Co", status: "won" });
    const arch = seedLead(world(), { companyName: "Archived Co", status: "new", archivedAt: new Date() });
    const theirs = seedLead(world(), { companyName: "Foreign Co", status: "new" }, ORG2);
    ticket(live.id, "Overdue thing", day(-3)); ticket(live.id, "Today thing", day(0)); ticket(live.id, "Soon thing", day(3));
    ticket(live.id, "Far thing", day(20)); ticket(live.id, "Undated thing", null); ticket(live.id, "Done thing", day(-1), "done");
    ticket(won.id, "Won leftover", day(-5)); ticket(arch.id, "Archived leftover", day(-5)); ticket(theirs.id, "Their thing", day(-5), "open", ORG2);
    const { provider } = await run({ steps: [call("get_lead_followups", {}), say("ok")] });
    const out = toolResult(provider);
    expect(out).toMatch(/Overdue \(1\):[\s\S]*Overdue thing/);
    expect(out).toMatch(/Due today \(1\):[\s\S]*Today thing/);
    expect(out).toMatch(/Coming up \(1\):[\s\S]*Soon thing/);
    for (const hidden of ["Far thing", "Undated", "Done thing", "Won leftover", "Archived leftover", "Their thing"]) expect(out, hidden).not.toContain(hidden);
  });

  it("says plainly when nothing is due, and the window can be widened", async () => {
    const live = seedLead(world(), { companyName: "Live Co", status: "contacted" });
    ticket(live.id, "Far thing", day(20));
    const a = await run({ steps: [call("get_lead_followups", {}), say("ok")] });
    expect(toolResult(a.provider)).toMatch(/Nothing is due/);
    const b = await run({ steps: [call("get_lead_followups", { days: 30 }), say("ok")] });
    expect(toolResult(b.provider)).toContain("Far thing");
  });
});

describe("closing: converting a lead to a deal", () => {
  const qualified = (over: Record<string, any> = {}) => seedLead(world(), { companyName: "Northwind", status: "qualified", estValueMinor: 5_000_000, currency: "INR", ...over });

  it("ALWAYS asks, even at level 1, and shows the deal; nothing exists until approved", async () => {
    const lead = qualified();
    const { result, store } = await run({ autonomy: 1, steps: [call("convert_lead_to_deal", { leadId: lead.id }), ASKED] });
    expect(result.status).toBe("waiting_for_user");
    expect(world().deals).toHaveLength(0);
    const preview = [...store.approvals.values()][0].preview as any;
    expect(preview.title).toMatch(/Northwind/);
    expect(preview.lines.map((l: any) => l.value).join(" ")).toMatch(/₹50,000/);
  });

  it("approval makes exactly one deal, links it, and marks the lead won", async () => {
    const lead = qualified();
    const { store } = await run({ steps: [call("convert_lead_to_deal", { leadId: lead.id }), ASKED] });
    await approve(store, firstApproval(store));
    expect(world().deals).toHaveLength(1);
    expect(world().deals[0]).toMatchObject({ brandName: "Northwind", dealAmountMinor: 5_000_000, status: "Pending" });
    expect(world().leads.leads[0]).toMatchObject({ status: "won", convertedDealId: world().deals[0].id, converting: false });
    expect(world().leads.events.at(-1)).toMatchObject({ kind: "converted", actor: "agent" });
  });

  it("converting again is refused: a lead never makes two deals", async () => {
    const lead = qualified();
    const first = await run({ steps: [call("convert_lead_to_deal", { leadId: lead.id }), ASKED] });
    await approve(first.store, firstApproval(first.store));
    const again = await run({ steps: [call("convert_lead_to_deal", { leadId: lead.id }), say("It already has a deal.")] });
    expect(again.store.approvals.size).toBe(0);
    expect(toolResult(again.provider)).toMatch(/already has a deal/);
    expect(world().deals).toHaveLength(1);
  });

  it("two conversions racing make one deal", async () => {
    const lead = qualified();
    const user = OWNER();
    const results = await Promise.all([convertToDeal(user, lead.id, {}), convertToDeal(user, lead.id, {}), convertToDeal(user, lead.id, {})]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(world().deals).toHaveLength(1);
    expect(world().leads.leads[0].convertedDealId).toBe(world().deals[0].id);
  });

  it("a stale approval can't create a second deal after the lead was converted another way", async () => {
    const lead = qualified();
    const { store } = await run({ steps: [call("convert_lead_to_deal", { leadId: lead.id }), ASKED] });
    expect((await convertToDeal(OWNER(), lead.id, {})).ok).toBe(true);
    await approve(store, firstApproval(store));
    expect(world().deals).toHaveLength(1);
  });

  it("no amount anywhere: refused before asking, and the deal amount is never made up", async () => {
    const lead = qualified({ estValueMinor: null, currency: null });
    const { store, provider } = await run({ steps: [call("convert_lead_to_deal", { leadId: lead.id }), say("What's the amount?")] });
    expect(store.approvals.size).toBe(0);
    expect(toolResult(provider)).toMatch(/amount/);
    expect(world().deals).toHaveLength(0);
  });

  it("an early-stage lead can't be converted; the refusal names the way forward", async () => {
    const lead = qualified({ status: "new" });
    const { store, provider } = await run({ steps: [call("convert_lead_to_deal", { leadId: lead.id }), say("Qualify it first.")] });
    expect(store.approvals.size).toBe(0);
    expect(toolResult(provider)).toMatch(/Qualified first/);
  });

  it("a failed deal creation releases the lead so it can be tried again", async () => {
    const lead = qualified({ companyName: "x".repeat(10) });
    const user = OWNER();
    const r = await convertToDeal(user, lead.id, { dealAmount: 0.001 });
    expect(r.ok).toBe(false);
    expect(world().leads.leads[0]).toMatchObject({ converting: false, convertedDealId: null, status: "qualified" });
    expect((await convertToDeal(user, lead.id, {})).ok).toBe(true);
  });
});

describe("isolation and roles", () => {
  it("another organization's lead can't be read, moved, updated, archived or converted", async () => {
    const theirs = seedLead(world(), { companyName: "Foreign", status: "qualified", estValueMinor: 100_000, currency: "INR" }, ORG2);
    const steps: [string, object][] = [
      ["get_lead", { leadId: theirs.id }], ["update_lead", { leadId: theirs.id, industry: "x" }], ["move_lead", { leadId: theirs.id, to: "contacted" }],
      ["add_lead_note", { leadId: theirs.id, text: "hi" }], ["archive_lead", { leadId: theirs.id }], ["convert_lead_to_deal", { leadId: theirs.id }],
    ];
    for (const [name, args] of steps) {
      const { store, provider } = await run({ steps: [call(name, args), say("not found")] });
      expect(toolResult(provider), name).toMatch(/isn't in your organization/);
      expect(store.approvals.size, name).toBe(0);
    }
    expect(world().leads.leads[0]).toMatchObject({ status: "qualified", archivedAt: null, convertedDealId: null });
    expect(world().deals).toHaveLength(0);
  });

  it("list_leads shows only this organization's leads", async () => {
    seedLead(world(), { companyName: "Mine" });
    seedLead(world(), { companyName: "Theirs" }, ORG2);
    const { provider } = await run({ steps: [call("list_leads", {}), say("ok")] });
    expect(toolResult(provider)).toMatch(/Mine/);
    expect(toolResult(provider)).not.toMatch(/Theirs/);
  });

  it("a closed lead shows no next step, even if an old ticket was left open", async () => {
    const won = seedLead(world(), { companyName: "Closed Co", status: "won" });
    const live = seedLead(world(), { companyName: "Live Co", status: "qualified" });
    for (const l of [won, live]) world().leads.tickets.push({ id: l.id, leadId: l.id, organizationId: "org-1", title: `Chase ${l.companyName}`, kind: "other", status: "open", dueAt: null, createdBy: "user", doneAt: null, createdAt: new Date() });
    const { provider } = await run({ steps: [call("list_leads", {}), say("ok")] });
    const out = toolResult(provider);
    expect(out).toMatch(/Live Co.*next: Chase Live Co/);
    expect(out).not.toMatch(/Chase Closed Co/);
  });

  it("a role with no permissions can use no lead tool", () => {
    const nobody = userRow({ orgRole: "CUSTOM", customPermissions: [] });
    const leadTools = AGENT_TOOLS.filter((t) => /lead|ticket|ideal_client/.test(t.name));
    expect(leadTools.length).toBe(16);
    for (const t of leadTools) expect(authorizeCall(t, nobody, {} as any), t.name).not.toBeNull();
  });

  it("money is a printed label, never a minor-unit number", async () => {
    const lead = seedLead(world(), { companyName: "Northwind", estValueMinor: 5_000_000, currency: "INR" });
    const { provider } = await run({ steps: [call("get_lead", { leadId: lead.id }), say("ok")] });
    expect(toolResult(provider)).toMatch(/₹50,000/);
    expect(toolResult(provider)).not.toMatch(/5000000|5,000,000/);
  });
});
