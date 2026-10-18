/**
 * The three coworkers' tasks with fake services: what each one does, what it refuses, and that reports only say what
 * really happened (counts from results, sources from evidence, no invented contacts, no invented money).
 */
import { describe, expect, it } from "vitest";
import type { LeagueRunRow } from "@shared/schema";
import { niboTask, qualified, type NiboDeps } from "./tasks/nibo";
import { mikaTask, type MikaDeps } from "./tasks/mika";
import { summaryIsGrounded, zeeTask, type ZeeDeps } from "./tasks/zee";
import type { StepOutcome, TaskCtx } from "./tasks/types";

const NOW = new Date("2026-10-18T10:00:00Z");
function ctx(task: string, input: Record<string, unknown>, checkpoint: Record<string, unknown> = {}) {
  const events: { kind: string; message: string; data?: Record<string, unknown> }[] = [];
  let usage = 0;
  const c: TaskCtx = {
    run: { id: "lr_test", organizationId: "org-1", userId: "u1", bot: task.split(".")[0], task, input, status: "running", stage: "start", checkpoint } as unknown as LeagueRunRow,
    user: { id: "u1", organizationId: "org-1", orgRole: "OWNER" } as any, checkpoint, now: () => NOW,
    event: async (kind, message, data) => { events.push({ kind, message, data }); },
    addUsage: (i, o) => { usage += i + o; },
  };
  return { c, events, usage: () => usage };
}
const finish = (o: StepOutcome) => { if (o.kind !== "finish") throw new Error(`expected finish, got ${o.kind}`); return o; };

/* ── Nibo ───────────────────────────────────────────────────────────────── */

const card = (id: number, over: Record<string, any> = {}) => ({
  id, name: `Clinic ${id}`, domain: `clinic${id}.in`, website: `https://clinic${id}.in/`, rejectReason: null, classification: "qualified", classificationLabel: "Qualified", ready: false,
  score: { total: 50 + id }, leadId: null, contact: "none", whyNow: id % 2 ? { label: "Hiring", value: "Hiring a receptionist", url: `https://clinic${id}.in/careers` } : null, ...over,
});
function nibo(prospects: any[], over: Partial<NiboDeps> & { status?: string } = {}) {
  const added: number[] = [];
  const deps: NiboDeps = {
    parseIcp: async () => ({ ok: true, icp: { industry: "dentists" }, searches: ["dentists in Siliguri"], description: "dentists in Siliguri" }),
    startRun: async () => ({ ok: true, existing: false, run: { id: "pr_1" } as any }),
    getRun: async () => ({ ok: true, run: { id: "pr_1", status: over.status ?? "done", counters: { discovered: 12, verified: 8, icpMatch: 5, rejectedBy: { off_topic: 3, parked: 1 } }, errorCode: null } as any, prospects }),
    addToLeads: async (_u, id) => { added.push(id); return { ok: true, leadId: 1000 + id, existing: false }; },
    ...over,
  };
  return { task: niboTask(deps), added };
}

describe("Nibo: find potential clients", () => {
  it("starts the AI Outbound search and parks until it's done (no worker held while waiting)", async () => {
    const { task } = nibo([], { status: "running" });
    const { c, events } = ctx("nibo.find_clients", { request: "dentists in Siliguri", saveLeads: true, maxLeads: 3 });
    const parsed = await task.step(c, "start");
    expect(parsed).toMatchObject({ kind: "continue", stage: "launch", checkpoint: { icp: { industry: "dentists" } } });
    const first = await task.step({ ...c, checkpoint: (parsed as any).checkpoint }, "launch");
    expect(first).toMatchObject({ kind: "wait", stage: "researching", checkpoint: { outboundRunId: "pr_1" } });
    expect(events.map((e) => e.kind)).toEqual(["understood", "research_started"]);
    expect(events[1].data?.href).toBe("/outbound?run=pr_1");
    const again = await task.step({ ...c, checkpoint: (first as any).checkpoint }, "researching");
    expect(again.kind).toBe("wait");
  });

  it("a retried launch sends the saved profile again (AI Outbound finds the same search), never a fresh parse", async () => {
    const sent: unknown[] = []; let parses = 0;
    const { task } = nibo([], { parseIcp: async () => { parses++; return { ok: true, icp: { industry: `dentists ${parses}` }, searches: ["q"], description: "d" }; }, startRun: async (_u, raw) => { sent.push(raw.icp); return { ok: true, existing: sent.length > 1, run: { id: "pr_1" } as any }; } });
    const { c } = ctx("nibo.find_clients", { request: "dentists in Siliguri" });
    const cp = ((await task.step(c, "start")) as any).checkpoint;
    await task.step({ ...c, checkpoint: { ...cp } }, "launch");
    await task.step({ ...c, checkpoint: { ...cp } }, "launch"); // the first launch's save was lost; the step runs again
    expect(parses).toBe(1);
    expect(sent).toEqual([{ industry: "dentists 1" }, { industry: "dentists 1" }]);
  });

  it("saves only qualified companies, ready first, up to the limit; skips ones already in Leads; never invents a contact", async () => {
    const ps = [card(1), card(2, { ready: true, classification: "ready", classificationLabel: "Ready" }), card(3, { leadId: 77 }), card(4, { classification: "insufficient_evidence" }), card(5, { rejectReason: "parked", classification: "not_a_fit" }), card(6), card(7)];
    const { task, added } = nibo(ps);
    const { c } = ctx("nibo.find_clients", { request: "dentists", saveLeads: true, maxLeads: 2 }, { outboundRunId: "pr_1" });
    const out = finish(await task.step(c, "saving"));
    expect(added).toEqual([2, 7]); // ready first, then the best-scored qualified; never insufficient evidence or not a fit
    expect(out.status).toBe("completed");
    expect(out.report.counts).toEqual([{ label: "Found", value: 12 }, { label: "Checked", value: 8 }, { label: "Qualified", value: 5 }, { label: "Saved to Leads", value: 2 }, { label: "Already in Leads", value: 1 }, { label: "Set aside", value: 4 }]);
    const saved = out.report.items.filter((i) => i.status === "done");
    expect(saved.map((i) => i.href)).toEqual(["/leads/1007", "/leads/1002"]);
    expect(saved.every((i) => i.detail?.includes("No contact found yet"))).toBe(true);
    expect(out.report.items.find((i) => i.title.startsWith("Clinic 7"))?.sources).toEqual(["https://clinic7.in/careers", "https://clinic7.in/"]); // evidence links come from the findings
    expect(out.report.items.find((i) => i.title.startsWith("Clinic 3"))).toMatchObject({ status: "skipped", href: "/leads/77" });
    expect(qualified(ps).map((p) => p.id)).not.toContain(4);
  });

  it("re-running the saving step after a crash saves nothing twice (the checkpoint and add-to-Leads both de-duplicate)", async () => {
    const { task, added } = nibo([card(1), card(3)]);
    const { c } = ctx("nibo.find_clients", { request: "dentists", saveLeads: true, maxLeads: 2 }, { outboundRunId: "pr_1", saved: { 1: 1001 } });
    await task.step(c, "saving");
    expect(added).toEqual([3]);
  });

  it("an allowance that runs out stops saving and makes it partial; a search that can't start fails with the reason", async () => {
    const { task } = nibo([card(1), card(3)], { addToLeads: async () => ({ ok: false, status: 402, code: "NO_CREDITS", message: "You've used the free plan's researched prospects." }) });
    const { c } = ctx("nibo.find_clients", { request: "dentists", saveLeads: true, maxLeads: 2 }, { outboundRunId: "pr_1" });
    const out = finish(await task.step(c, "saving"));
    expect(out.status).toBe("partial");
    expect(out.report.notes?.[0]).toMatch(/Stopped saving/);
    const failing = nibo([], { startRun: async () => ({ ok: false, status: 402, code: "NO_CREDITS", message: "You've used the free plan's searches." }) });
    const f = finish(await failing.task.step(ctx("nibo.find_clients", { request: "dentists in Siliguri" }, { icp: { industry: "dentists" }, searches: [] }).c, "launch"));
    expect(f).toMatchObject({ status: "failed", errorCode: "limit" });
    expect(f.report.headline).toMatch(/free plan's searches/);
  });

  it("with saving off, reports the qualified companies and saves none", async () => {
    const { task, added } = nibo([card(1), card(2)]);
    const out = finish(await task.step(ctx("nibo.find_clients", { request: "dentists", saveLeads: false, maxLeads: 3 }, { outboundRunId: "pr_1" }).c, "saving"));
    expect(added).toEqual([]);
    expect(out.report.headline).toBe("Found 2 qualified companies");
  });
});

/* ── Mika ───────────────────────────────────────────────────────────────── */

function mika(leads: any[], draft: MikaDeps["draftOutreach"]) {
  const drafted: number[] = [];
  const task = mikaTask({ listLeads: async () => ({ ok: true, rows: leads }), draftOutreach: async (u, id) => { drafted.push(id); return draft(u, id); } });
  return { task, drafted };
}
const lead = (id: number, over: Record<string, any> = {}) => ({ id, companyName: `Lead ${id}`, status: "researching", doNotContact: false, archivedAt: null, ...over });

describe("Mika: draft first messages", () => {
  it("drafts through the outreach service for eligible leads only, and sends nothing", async () => {
    const { task, drafted } = mika([lead(1), lead(2, { doNotContact: true }), lead(3, { status: "contacted" }), lead(4, { archivedAt: "2026-10-01" }), lead(5)], async (_u, id) => ({ ok: true, message: { id: 900 + id, to: `hi@lead${id}.in` } }));
    const out = finish(await task.step(ctx("mika.first_messages", { leadIds: [], max: 3 }).c, ""));
    expect(drafted).toEqual([1, 5]); // never do-not-contact, contacted or archived leads
    expect(out).toMatchObject({ status: "completed", report: { headline: "2 first messages ready for your approval", next: { href: "/outbound?view=outreach" } } });
    expect(out.report.items.every((i) => i.status === "needs_you")).toBe(true);
    expect(out.report.notes?.[0]).toMatch(/Nothing was sent/);
  });

  it("a refusal from the outreach service (suppressed, no facts, no address) is a skip with its reason", async () => {
    const { task } = mika([lead(1), lead(2)], async (_u, id) => (id === 1 ? { ok: false, status: 409, code: "suppressed", message: "This address is on your do-not-contact list" } : { ok: true, message: { id: 2, to: "a@b.in" } }));
    const out = finish(await task.step(ctx("mika.first_messages", { leadIds: [], max: 3 }).c, ""));
    expect(out.report.items.find((i) => i.title === "Lead 1")).toMatchObject({ status: "skipped", detail: "This address is on your do-not-contact list" });
    expect(out.report.counts).toEqual([{ label: "Drafted", value: 1 }, { label: "Skipped", value: 1 }]);
  });

  it("stops at the draft allowance and says so (partial); with no eligible leads, says that plainly", async () => {
    const { task, drafted } = mika([lead(1), lead(2), lead(3)], async (_u, id) => (id === 1 ? { ok: true, message: { id: 1, to: "a@b.in" } } : { ok: false, status: 429, code: "draft_allowance", message: "You've used the 10 AI drafts" }));
    const out = finish(await task.step(ctx("mika.first_messages", { leadIds: [], max: 3 }).c, ""));
    expect(drafted).toEqual([1, 2]);
    expect(out.status).toBe("partial");
    const none = finish(await mika([], async () => ({ ok: true, message: { id: 1, to: null } })).task.step(ctx("mika.first_messages", { leadIds: [], max: 3 }).c, ""));
    expect(none).toMatchObject({ status: "completed", report: { headline: "No leads are waiting for a first message" } });
  });
});

/* ── Zee ────────────────────────────────────────────────────────────────── */

const emptyRadar = { overdue: { totalMinor: 0, count: 0, invoices: [] }, dueThisWeek: { totalMinor: 0, count: 0, invoices: [] }, readyToInvoice: { totalMinor: 0, count: 0, contracts: [] }, collectibleMinor: 0 };
function zee(over: Partial<ZeeDeps> = {}) {
  return zeeTask({
    briefing: async () => ({ greetingName: "Asha", attentionCount: 0, radar: emptyRadar, nextActions: [], protection: {} as any, generatedAt: NOW.toISOString() }),
    followUps: async () => ({ ok: true, today: "2026-10-18", overdue: [], dueToday: [] }),
    waitingDrafts: async () => ({ ok: true, items: [] }),
    locale: async () => ({ currency: "INR", locale: "en-IN" }),
    ...over,
  });
}

describe("Zee: business briefing", () => {
  it("an empty day is reported as all clear, with nothing invented", async () => {
    const out = finish(await zee().step(ctx("zee.briefing", {}).c, ""));
    expect(out).toMatchObject({ status: "completed", report: { headline: "All clear today", items: [] } });
    expect(out.report.summary).toMatch(/^All clear/);
    expect(out.report.counts.every((c) => c.value === 0)).toBe(true);
  });

  it("lists what really needs the person, from the records, with links and the workspace's money", async () => {
    const t = zee({
      briefing: async () => ({ greetingName: "Asha", attentionCount: 2, generatedAt: "", protection: {} as any, nextActions: [{ dealId: 9, dealTitle: "Website", brandName: "Acme", action: "Send the quotation", route: "/deals/9", urgency: "red" }],
        radar: { ...emptyRadar, overdue: { totalMinor: 2500000, count: 1, invoices: [{ id: 5, brandName: "Acme", amountMinor: 2500000, daysOverdue: 3, invoiceNumber: "INV-2627-0005" }] } } }),
      followUps: async () => ({ ok: true, today: "2026-10-18", overdue: [{ id: 1, title: "Call back", due: "2026-10-16", leadId: 4, companyName: "Pearl" }], dueToday: [] }),
    });
    const out = finish(await t.step(ctx("zee.briefing", {}).c, ""));
    expect(out.report.headline).toBe("3 things need you today");
    expect(out.report.items[0]).toMatchObject({ title: "Overdue: INV-2627-0005 · Acme", detail: "₹25,000, 3 days past due", href: "/brand-invoices/5", status: "needs_you" });
    expect(out.report.items[1]).toMatchObject({ title: "Follow up: Pearl", href: "/leads/4" });
    expect(out.report.summary).toBe("1 overdue invoice (₹25,000) · 1 follow-up due");
  });

  it("a written summary that mentions a figure not in the records is dropped; a grounded one is kept", async () => {
    const withOverdue = { briefing: async () => ({ greetingName: "", attentionCount: 1, generatedAt: "", protection: {} as any, nextActions: [], radar: { ...emptyRadar, overdue: { totalMinor: 2500000, count: 1, invoices: [{ id: 5, brandName: "Acme", amountMinor: 2500000, daysOverdue: 3, invoiceNumber: "INV-2627-0005" }] } } }) };
    const bad = finish(await zee({ ...withOverdue, summarize: async () => ({ text: "Chase Acme's ₹40,000 today.", tokensIn: 10, tokensOut: 5 }) }).step(ctx("zee.briefing", {}).c, ""));
    expect(bad.report.summary).toBe("1 overdue invoice (₹25,000)");
    const good = finish(await zee({ ...withOverdue, summarize: async () => ({ text: "Start with Acme: INV-2627-0005 is 3 days past due.", tokensIn: 10, tokensOut: 5 }) }).step(ctx("zee.briefing", {}).c, ""));
    expect(good.report.summary).toBe("Start with Acme: INV-2627-0005 is 3 days past due.");
    expect(summaryIsGrounded("You have 2 invoices", "- Overdue: 1 invoice")).toBe(false);
  });

  it("a part it couldn't read makes the briefing partial and says which", async () => {
    const out = finish(await zee({ followUps: async () => ({ ok: false, status: 503, code: "x", message: "down" }) }).step(ctx("zee.briefing", {}).c, ""));
    expect(out.status).toBe("partial");
    expect(out.report.notes).toContain("Follow-ups couldn't be read this time.");
  });
});
