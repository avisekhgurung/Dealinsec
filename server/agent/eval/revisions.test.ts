/**
 * Revising quotations and agreements through the agent: the real loop, policy,
 * approvals, tools and services against the in-memory world, with a scripted
 * model. What each case pins down is something the model must not be able to
 * change: what asks, what is locked once signed, who may revise what.
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
vi.mock("../../sales/research-store", async () => (await import("./world-mocks")).researchStoreMock());
vi.mock("../../sales/message-store", async () => (await import("./world-mocks")).messageStoreMock());
vi.mock("../../llm/trace-store", async () => (await import("./world-mocks")).traceStoreMock());
vi.mock("../../routes", async () => (await import("./world-mocks")).routesMock());
vi.mock("../../copilot/provider", async (orig) => (await import("./world-mocks")).scriptedProviderMock(orig as () => Promise<any>));

import { executeApproval } from "../approvals";
import { runAgent } from "../loop";
import { MemoryAgentStore } from "../memory-store";
import { authorizeCall } from "../policy";
import { AGENT_TOOLS } from "../tools";
import { FakeProvider, call, collect, say, type Step } from "../testing";
import type { AutonomyLevel } from "../types";
import { useWorld } from "./world-mocks";
import { createWorld, seedContract, seedDeal, seedQuote, userRow, ORG2, type World } from "./world";

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
const TERMS = "50% advance\nTwo rounds of revisions\nHosting is excluded";

const pending = (over: Record<string, any> = {}) => seedDeal(world(), { status: "Pending", brandName: "Acme", dealTitle: "Website", dealAmountMinor: 5_000_000, customTerms: TERMS, ...over });

describe("revise_quotation", () => {
  it("asks at level 0; nothing changes until approved; then the deal is edited and the quotation regenerated as a new draft", async () => {
    const deal = pending(); seedQuote(world(), deal.id, { status: "draft", version: 1 });
    const { store } = await run({ steps: [call("revise_quotation", { dealId: deal.id, dealTitle: "Website redesign", endDate: "2027-01-31" }), ASKED] });
    expect(world().deals[0].dealTitle).toBe("Website");
    const preview = [...store.approvals.values()][0].preview as any;
    expect(preview.lines.map((l: any) => l.label)).toEqual(["Project", "End"]);
    expect(preview.effects.join(" ")).toMatch(/new draft \(v2\)/);
    await approve(store, firstApproval(store));
    expect(world().deals[0]).toMatchObject({ dealTitle: "Website redesign", endDate: "2027-01-31" });
    const quotes = world().quotes.filter((q) => q.dealId === deal.id);
    expect(quotes.map((q) => [q.version, q.status])).toEqual([[1, "revised"], [2, "draft"]]);
    expect(world().activity.some((a: any) => /Quotation revised/.test(JSON.stringify(a)))).toBe(true);
  });

  it("a price change ALWAYS asks, even at level 1; other changes run unasked at level 1", async () => {
    const deal = pending(); seedQuote(world(), deal.id, { status: "draft" });
    const a = await run({ autonomy: 1, steps: [call("revise_quotation", { dealId: deal.id, dealAmount: 60000 }), ASKED] });
    expect(a.store.approvals.size).toBe(1);
    expect(world().deals[0].dealAmountMinor).toBe(5_000_000);
    expect(([...a.store.approvals.values()][0].preview as any).lines[0].value).toBe("₹50,000 → ₹60,000");
    const b = await run({ autonomy: 1, steps: [call("revise_quotation", { dealId: deal.id, addTerms: "Payment within 7 days" }), say("Done.")] });
    expect(b.store.approvals.size).toBe(0);
    expect(world().deals[0].customTerms).toBe(`${TERMS}\nPayment within 7 days`);
  });

  it("works only on a PENDING deal", async () => {
    const deal = pending({ status: "Active" });
    const { store, provider } = await run({ steps: [call("revise_quotation", { dealId: deal.id, dealTitle: "New" }), say("Can't.")] });
    expect(store.approvals.size).toBe(0);
    expect(toolResult(provider)).toMatch(/already active/);
  });

  it("removes a term only by its exact wording; a vague or unknown one is refused with the reason", async () => {
    const deal = pending();
    const ok = await run({ steps: [call("revise_quotation", { dealId: deal.id, removeTerms: "two rounds of revisions" }), ASKED] });
    await approve(ok.store, firstApproval(ok.store));
    expect(world().deals[0].customTerms).toBe("50% advance\nHosting is excluded");
    const bad = await run({ steps: [call("revise_quotation", { dealId: deal.id, removeTerms: "hosting" }), say("Not found.")] });
    expect(bad.store.approvals.size).toBe(0);
    expect(toolResult(bad.provider)).toMatch(/couldn't find "hosting"/);
    expect(world().deals[0].customTerms).toBe("50% advance\nHosting is excluded");
  });

  it("replaces the whole list of deliverables, shaped like a new deal's, and shows it", async () => {
    const deal = pending();
    const { store } = await run({ steps: [call("revise_quotation", { dealId: deal.id, deliverables: [{ contentType: "Home page" }, { contentType: "Inner page", quantity: 4 }] }), ASKED] });
    expect(([...store.approvals.values()][0].preview as any).lines[0].value).toBe("2 items: 1 × Home page, 4 × Inner page");
    await approve(store, firstApproval(store));
    expect(world().deals[0].deliverables.map((d: any) => [d.contentType, d.quantity, d.frequency])).toEqual([["Home page", 1, "One-time"], ["Inner page", 4, "One-time"]]);
  });

  it("refuses contradictions, nothing-to-change, bad dates and a foreign deal, before anyone is asked", async () => {
    const deal = pending();
    const theirs = seedDeal(world(), { organizationId: ORG2, userId: "u2", status: "Pending" });
    for (const [args, re] of [
      [{ dealId: deal.id, replaceTerms: "A", addTerms: "B" }, /not both/],
      [{ dealId: deal.id, dealTitle: "Website" }, /nothing to change/],
      [{ dealId: deal.id, startDate: "2026-12-10", endDate: "2026-12-01" }, /can't be before/],
      [{ dealId: deal.id }, /Say what to change/],
      [{ dealId: theirs.id, dealTitle: "x" }, /isn't in your organization/],
    ] as [Record<string, unknown>, RegExp][]) {
      const { store, provider } = await run({ steps: [call("revise_quotation", args), say("no")] });
      expect(store.approvals.size, JSON.stringify(args)).toBe(0);
      expect(toolResult(provider), JSON.stringify(args)).toMatch(re);
    }
  });

  it("warns that a link already shared still shows the old quotation", async () => {
    const deal = pending(); seedQuote(world(), deal.id, { status: "draft", shareToken: "tok", shareRevokedAt: null });
    const { store } = await run({ steps: [call("revise_quotation", { dealId: deal.id, dealTitle: "New" }), ASKED] });
    expect(([...store.approvals.values()][0].preview as any).effects.join(" ")).toMatch(/link you already shared still shows the old quotation/);
  });
});

describe("revise_agreement", () => {
  const withAgreement = (over: Record<string, any> = {}) => {
    const deal = pending({ status: "Active" }); seedQuote(world(), deal.id, { status: "draft" });
    return { deal, contract: seedContract(world(), deal.id, { signerUserId: "u1", signerName: "Asha Rao", ...over }) };
  };

  it("ALWAYS asks (even at level 1), reads the changes back, and changes nothing until confirmed", async () => {
    const { deal, contract } = withAgreement();
    const { store } = await run({ autonomy: 1, steps: [call("revise_agreement", { dealId: deal.id, endDate: "2027-02-28", addTerms: "Payment within 7 days" }), ASKED] });
    expect(store.approvals.size).toBe(1);
    expect(world().contracts[0].endDate).toBe(contract.endDate);
    const preview = [...store.approvals.values()][0].preview as any;
    expect(preview.lines.map((l: any) => l.label)).toEqual(["End", "Add to terms"]);
    expect(preview.effects.join(" ")).toMatch(/re-dated to now/);
  });

  it("on approval: the agreement and the deal move together, the signature is re-dated, the stale quotation is marked revised", async () => {
    const { deal } = withAgreement({ signedByInfluencerDate: "2026-01-01T00:00:00.000Z" });
    const { store } = await run({ steps: [call("revise_agreement", { dealId: deal.id, contractName: "Website agreement v2", contractValue: 65000, addTerms: "Source files included" }), ASKED] });
    await approve(store, firstApproval(store));
    expect(world().contracts[0]).toMatchObject({ contractName: "Website agreement v2", contractValueMinor: 6_500_000, signedByBrand: false });
    expect(world().contracts[0].signedByInfluencerDate).not.toBe("2026-01-01T00:00:00.000Z");
    expect(world().deals[0]).toMatchObject({ dealAmountMinor: 6_500_000, status: "Active" });
    expect(world().deals[0].customTerms).toBe(`${TERMS}\nSource files included`);
    expect(world().quotes[0].status).toBe("revised");
    expect(world().activity.some((a: any) => /Agreement revised/.test(JSON.stringify(a)))).toBe(true);
  });

  it("revokes a signing link that was already sent, and says so before and after", async () => {
    const { deal } = withAgreement({ clientShareToken: "tok", clientShareRevokedAt: null });
    const { store } = await run({ steps: [call("revise_agreement", { dealId: deal.id, exclusive: false }), ASKED] });
    expect(([...store.approvals.values()][0].preview as any).effects.join(" ")).toMatch(/signing link you already sent stops working/);
    const out: any[] = [];
    await executeApproval({ store, tools: AGENT_TOOLS }, OWNER(), firstApproval(store), (e) => out.push(e));
    expect(world().contracts[0].clientShareRevokedAt).toBeTruthy();
    expect(out.find((e) => e.type === "agent.message").data.text).toMatch(/no longer works/);
  });

  it("a client-signed agreement is LOCKED, however it was signed", async () => {
    for (const over of [{ signedByBrand: true }, { clientSignedAt: new Date() }]) {
      world().contracts.length = 0; world().deals.length = 0;
      const { deal } = withAgreement(over);
      const { store, provider } = await run({ steps: [call("revise_agreement", { dealId: deal.id, exclusive: false }), say("It is locked.")] });
      expect(store.approvals.size, JSON.stringify(over)).toBe(0);
      expect(toolResult(provider)).toMatch(/is locked/);
      expect(world().contracts[0].exclusive).toBe(true);
    }
  });

  it("only the person whose signature is on it may revise it", async () => {
    const { deal } = withAgreement({ signerUserId: "u7", signerName: "Ravi Menon" });
    const { store, provider } = await run({ steps: [call("revise_agreement", { dealId: deal.id, exclusive: false }), say("No.")] });
    expect(store.approvals.size).toBe(0);
    expect(toolResult(provider)).toMatch(/Only Ravi Menon, whose signature is on this agreement/);
  });

  it("a stale approval cannot slip past a client signature that arrived in the meantime", async () => {
    const { deal } = withAgreement();
    const { store } = await run({ steps: [call("revise_agreement", { dealId: deal.id, exclusive: false }), ASKED] });
    world().contracts[0].clientSignedAt = new Date(); // the client signs while the approval waits
    const out = await approve(store, firstApproval(store));
    expect(out.ok).toBe(false);
    expect(world().contracts[0].exclusive).toBe(true);
  });

  it("a fee can't be changed if the workspace's currency changed since the agreement was issued", async () => {
    const { deal } = withAgreement({ currency: "USD" });
    const { store, provider } = await run({ steps: [call("revise_agreement", { dealId: deal.id, contractValue: 5000 }), say("No.")] });
    expect(store.approvals.size).toBe(0);
    expect(toolResult(provider)).toMatch(/issued in USD/);
  });

  it("no agreement, foreign agreement, nothing to change", async () => {
    const bare = pending({ status: "Active" });
    const a = await run({ steps: [call("revise_agreement", { dealId: bare.id, exclusive: false }), say("none")] });
    expect(toolResult(a.provider)).toMatch(/no agreement for that deal/);
    const theirs = seedDeal(world(), { organizationId: ORG2, userId: "u2", status: "Active" });
    seedContract(world(), theirs.id, { organizationId: ORG2, userId: "u2" });
    const b = await run({ steps: [call("revise_agreement", { dealId: theirs.id, exclusive: false }), say("none")] });
    expect(toolResult(b.provider)).toMatch(/isn't in your organization/);
    const { deal } = withAgreement();
    const c = await run({ steps: [call("revise_agreement", { dealId: deal.id, exclusive: true }), say("none")] });
    expect(toolResult(c.provider)).toMatch(/nothing to change/);
  });

  it("a role without deal editing can use neither tool", () => {
    const nobody = userRow({ orgRole: "CUSTOM", customPermissions: [] });
    for (const n of ["revise_quotation", "revise_agreement"]) expect(authorizeCall(AGENT_TOOLS.find((t) => t.name === n)!, nobody, {} as any), n).not.toBeNull();
  });
});

describe("the document style tools", () => {
  const ask = async (args: Record<string, unknown>, autonomy: 0 | 1 = 0) => run({ autonomy, steps: [call("update_document_style", args), ASKED] });

  it("reads the current look and the choices; with nothing set it says it is the default", async () => {
    const { provider } = await run({ steps: [call("get_document_style", {}), say("ok")] });
    const out = toolResult(provider);
    expect(out).toMatch(/Accent colour: Emerald \(the default\)/);
    expect(out).toMatch(/Footer note: none/);
    expect(out).toMatch(/not on agreements/);
  });
  it("asks at level 0, changes nothing until approved, then saves a style normalised from the choices", async () => {
    const { store } = await ask({ accent: "blue", font: "serif", footerNote: "Payment within 7 days  " });
    expect(world().documentStyles.size).toBe(0);
    const preview = [...store.approvals.values()][0].preview as any;
    expect(preview.lines.map((l: any) => l.label)).toEqual(["Accent colour", "Typeface", "Footer note"]);
    await approve(store, firstApproval(store));
    expect(world().documentStyles.get("org-1")).toMatchObject({ accent: "blue", font: "serif", footerNote: "Payment within 7 days", updatedBy: "u1" });
  });
  it("runs unasked at level 1 (appearance only), and a partial change keeps the rest", async () => {
    world().documentStyles.set("org-1", { organizationId: "org-1", accent: "teal", font: "serif", footerNote: "Thanks", updatedBy: "u1" });
    const { store } = await ask({ accent: "rose" }, 1);
    expect(store.approvals.size).toBe(0);
    expect(world().documentStyles.get("org-1")).toMatchObject({ accent: "rose", font: "serif", footerNote: "Thanks" });
  });
  it("refuses an unknown colour, the same style again, and a role that may not change settings", async () => {
    const bad = await ask({ accent: "hotpink" });
    expect(bad.store.approvals.size).toBe(0);
    world().documentStyles.set("org-1", { organizationId: "org-1", accent: "blue", font: "sans", footerNote: null, updatedBy: "u1" });
    const same = await run({ steps: [call("update_document_style", { accent: "blue" }), say("same")] });
    expect(same.store.approvals.size).toBe(0);
    expect(toolResult(same.provider)).toMatch(/already how your documents look/);
    const nobody = userRow({ orgRole: "CUSTOM", customPermissions: [] });
    expect(authorizeCall(AGENT_TOOLS.find((t) => t.name === "update_document_style")!, nobody, {} as any)).not.toBeNull();
  });
  it("a footer note cannot carry markup", async () => {
    const { store } = await ask({ footerNote: "<b>Pay now</b>" });
    await approve(store, firstApproval(store));
    expect(world().documentStyles.get("org-1")!.footerNote).not.toMatch(/[<>]/);
  });
  it("another organization's style is never read", async () => {
    world().documentStyles.set("org-2", { organizationId: "org-2", accent: "purple", font: "serif", footerNote: "Secret", updatedBy: "u2" });
    const { provider } = await run({ steps: [call("get_document_style", {}), say("ok")] });
    expect(toolResult(provider)).not.toMatch(/Secret|Purple/);
  });
});
