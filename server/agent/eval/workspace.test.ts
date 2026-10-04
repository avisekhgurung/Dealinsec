/**
 * The workspace tools: complete_deal, update_invoice_details,
 * update_workspace_profile, update_my_details, through the real loop, policy,
 * approvals and services against the in-memory world with a scripted model.
 * What each case pins down is something the model must not be able to change:
 * what always asks, what is locked, which fields do not exist as inputs, and
 * that another workspace is never reachable.
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

import { applyCompleteDeal, applyInvoiceDetails, applyWorkspaceProfile } from "../../services/workspace";
import { executeApproval } from "../approvals";
import { runAgent } from "../loop";
import { MemoryAgentStore } from "../memory-store";
import { authorizeCall } from "../policy";
import { AGENT_TOOLS } from "../tools";
import { FakeProvider, call, collect, say, type Step } from "../testing";
import type { AutonomyLevel } from "../types";
import { useWorld } from "./world-mocks";
import { createWorld, seedDeal, seedInvoice, userRow, ORG2, type World } from "./world";

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

const active = (over: Record<string, any> = {}) => seedDeal(world(), { status: "Active", brandName: "Acme", dealTitle: "Website", ...over });

describe("complete_deal", () => {
  it("always asks, even at level 1; nothing changes until approved; then it is Completed and logged", async () => {
    for (const autonomy of [0, 1] as AutonomyLevel[]) {
      useWorld(createWorld());
      const deal = active(); seedInvoice(world(), deal.id);
      const { store } = await run({ autonomy, steps: [call("complete_deal", { dealId: deal.id }), ASKED] });
      expect(store.approvals.size, `level ${autonomy}`).toBe(1);
      expect(world().deals[0].status).toBe("Active");
      const preview = [...store.approvals.values()][0].preview as any;
      expect(preview.lines.map((l: any) => l.label)).toContain("Unpaid invoices");
      expect(preview.effects.join(" ")).toMatch(/no way to reopen/);
      await approve(store, firstApproval(store));
      expect(world().deals[0].status).toBe("Completed");
      expect(world().activity.some((a: any) => /completed/.test(JSON.stringify(a)))).toBe(true);
    }
  });
  it("only an active deal can be completed, and a completed one is said to be done already", async () => {
    const pendingDeal = seedDeal(world(), { status: "Pending" });
    const a = await run({ steps: [call("complete_deal", { dealId: pendingDeal.id }), say("no")] });
    expect(a.store.approvals.size).toBe(0);
    expect(toolResult(a.provider)).toMatch(/Only an active deal/);
    const done = seedDeal(world(), { status: "Completed" });
    const b = await run({ steps: [call("complete_deal", { dealId: done.id }), say("no")] });
    expect(toolResult(b.provider)).toMatch(/already completed/);
  });
  it("another workspace's deal is not found, and a role without deals.edit is refused", async () => {
    const other = seedDeal(world(), { status: "Active", organizationId: ORG2, userId: "u2" });
    const a = await run({ steps: [call("complete_deal", { dealId: other.id }), say("no")] });
    expect(a.store.approvals.size).toBe(0);
    expect(toolResult(a.provider)).toMatch(/isn't in your organization/);
    expect(authorizeCall(AGENT_TOOLS.find((t) => t.name === "complete_deal")!, userRow({ orgRole: "CUSTOM", customPermissions: [] }), {} as any)).not.toBeNull();
  });
  it("a stale approval cannot complete a deal that was completed meanwhile", async () => {
    const deal = active();
    const { store } = await run({ steps: [call("complete_deal", { dealId: deal.id }), ASKED] });
    world().deals[0].status = "Completed";
    const r = await approve(store, firstApproval(store));
    expect(JSON.stringify(r)).toMatch(/already completed|failed|refused/i);
    expect(world().activity.filter((a: any) => /completed/.test(JSON.stringify(a)))).toHaveLength(0);
  });
});

describe("update_invoice_details", () => {
  const inv = (over: Record<string, any> = {}) => { const d = active(); return seedInvoice(world(), d.id, { invoiceDate: "2026-10-01", dueDate: "2026-10-15", notes: null, ...over }); };
  it("asks at level 0 and runs at level 1; changes only the due date and note", async () => {
    const i = inv();
    const a = await run({ steps: [call("update_invoice_details", { invoiceId: i.id, dueDate: "2026-10-31" }), ASKED] });
    expect(world().invoices[0].dueDate).toBe("2026-10-15");
    expect((([...a.store.approvals.values()][0].preview as any).lines as any[]).map((l) => l.label)).toEqual(["Invoice", "Due date"]);
    await approve(a.store, firstApproval(a.store));
    expect(world().invoices[0]).toMatchObject({ dueDate: "2026-10-31", dealAmountMinor: 500_000, status: "Unpaid" });
    const b = await run({ autonomy: 1, steps: [call("update_invoice_details", { invoiceId: i.id, notes: "Thanks!" }), say("done")] });
    expect(b.store.approvals.size).toBe(0);
    expect(world().invoices[0].notes).toBe("Thanks!");
  });
  it("cannot touch the amount, the number or the status: those keys are not inputs", async () => {
    const i = inv();
    for (const bad of [{ dealAmountMinor: 1 }, { status: "Paid" }, { invoiceNumber: "X-1" }, { brandName: "Mallory" }]) {
      const r = await run({ autonomy: 1, steps: [call("update_invoice_details", { invoiceId: i.id, dueDate: "2026-11-01", ...bad }), say("no")] });
      expect(r.store.approvals.size).toBe(0);
    }
    expect(world().invoices[0]).toMatchObject({ dueDate: "2026-10-15", dealAmountMinor: 500_000, status: "Unpaid", brandName: "Acme" });
  });
  it("a paid invoice is locked, a date before the invoice date is refused, a foreign invoice is not found, Pro is required", async () => {
    const paid = inv({ status: "Paid" });
    expect(toolResult((await run({ autonomy: 1, steps: [call("update_invoice_details", { invoiceId: paid.id, notes: "x" }), say("no")] })).provider)).toMatch(/paid, and a paid invoice can't be edited/);
    const open = inv();
    expect(toolResult((await run({ autonomy: 1, steps: [call("update_invoice_details", { invoiceId: open.id, dueDate: "2026-09-30" }), say("no")] })).provider)).toMatch(/before the invoice date/);
    const foreign = seedInvoice(world(), active().id, { organizationId: ORG2, userId: "u2" });
    expect(toolResult((await run({ autonomy: 1, steps: [call("update_invoice_details", { invoiceId: foreign.id, notes: "x" }), say("no")] })).provider)).toMatch(/isn't in your organization/);
    world().billing.set("org-1", { id: "u1", plan: "free" });
    expect(toolResult((await run({ autonomy: 1, steps: [call("update_invoice_details", { invoiceId: open.id, notes: "x" }), say("no")] })).provider)).toMatch(/Pro feature/);
    expect(world().invoices.find((x) => x.id === open.id)!.notes).toBeNull();
  });
});

describe("update_workspace_profile", () => {
  it("a new name ALWAYS asks, even at level 1; industry alone runs at level 1", async () => {
    const a = await run({ autonomy: 1, steps: [call("update_workspace_profile", { name: "Una Studio" }), ASKED] });
    expect(a.store.approvals.size).toBe(1);
    expect(world().orgs.get("org-1")!.name).not.toBe("Una Studio");
    await approve(a.store, firstApproval(a.store));
    expect(world().orgs.get("org-1")!.name).toBe("Una Studio");
    const b = await run({ autonomy: 1, steps: [call("update_workspace_profile", { industry: "Design" }), say("done")] });
    expect(b.store.approvals.size).toBe(0);
    expect(world().orgs.get("org-1")!.industry).toBe("Design");
  });
  it("cannot change currency, country or plan; and never another workspace", async () => {
    for (const bad of [{ currency: "USD" }, { country: "US" }, { plan: "pro" }, { organizationId: ORG2 }]) {
      const r = await run({ autonomy: 1, steps: [call("update_workspace_profile", { industry: "x", ...bad }), say("no")] });
      expect(r.store.approvals.size).toBe(0);
    }
    expect(world().orgs.get("org-1")).toMatchObject({ currency: "INR", country: "IN" });
    expect(world().orgs.get(ORG2)!.name).toBe("Other Studio");
    expect(authorizeCall(AGENT_TOOLS.find((t) => t.name === "update_workspace_profile")!, userRow({ orgRole: "CUSTOM", customPermissions: [] }), {} as any)).not.toBeNull();
  });
});

describe("update_my_details", () => {
  it("a phone number runs at level 1; anything printed on documents (tax id, address, name) always asks", async () => {
    const a = await run({ autonomy: 1, steps: [call("update_my_details", { phone: "+91 98765 43210" }), say("done")] });
    expect(a.store.approvals.size).toBe(0);
    expect(world().users.get("u1")!.phone).toBe("+91 98765 43210");
    for (const edit of [{ gstNumber: "29ABCDE1234F1Z5" }, { billingAddress: "12 Tea Rd" }, { firstName: "Una" }]) {
      const r = await run({ autonomy: 1, steps: [call("update_my_details", edit), ASKED] });
      expect(r.store.approvals.size, JSON.stringify(edit)).toBe(1);
    }
  });
  it("bank details, signature, seal, email and password are not inputs and nothing is written", async () => {
    const before = JSON.stringify(world().users.get("u1"));
    for (const bad of [{ accountNumber: "123" }, { ifscCode: "HDFC0001" }, { digitalSignature: "data:" }, { companySeal: "data:" }, { email: "x@y.co" }, { password: "pw" }]) {
      const r = await run({ autonomy: 1, steps: [call("update_my_details", { phone: "123", ...bad }), say("no")] });
      expect(r.store.approvals.size).toBe(0);
    }
    expect(JSON.stringify(world().users.get("u1"))).toBe(before);
  });
  it("only ever the caller's own record", async () => {
    await run({ autonomy: 1, steps: [call("update_my_details", { phone: "555", userId: "u2" } as any), say("x")] });
    expect(world().users.get("u2")!.phone).not.toBe("555");
  });
});

describe("the service re-checks the role itself, not only the tool", () => {
  // The tool's authorize() stops these first; the service is the last line if anything ever calls it directly.
  const nobody = () => userRow({ orgRole: "CUSTOM", customPermissions: [] }) as any;
  it("refuses a member without the permission, writing nothing", async () => {
    const d = active(); const i = seedInvoice(world(), d.id, { invoiceDate: "2026-10-01" });
    expect((await applyCompleteDeal(nobody(), d.id)).ok).toBe(false);
    expect((await applyInvoiceDetails(nobody(), { invoiceId: i.id, notes: "x" })).ok).toBe(false);
    expect((await applyWorkspaceProfile(nobody(), { industry: "x" })).ok).toBe(false);
    expect(world().deals[0].status).toBe("Active");
    expect(world().invoices[0].notes).toBeUndefined();
    expect(world().orgs.get("org-1")!.industry).toBeUndefined();
  });
});
