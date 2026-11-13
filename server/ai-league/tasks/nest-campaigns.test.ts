/**
 * The Nest and saved profiles / campaigns, with fake services:
 *   Nibo   starts a search from a saved client profile by rules, never by re-reading words;
 *   Mika   gets a campaign's drafts written through the campaign's own job, and reports only what happened;
 *   Zee    reports campaigns and reply COUNTS in the briefing, and survives either being unavailable.
 * And the chat tools that start them: what the approval card shows, and what they refuse.
 */
import { describe, expect, it } from "vitest";
import { LEAGUE_LIMITS, TASK_INPUT } from "@shared/ai-league";
import type { LeagueRunRow } from "@shared/schema";
import { niboTask, type NiboDeps } from "./nibo";
import { campaignLink, defaultName, mikaCampaignTask, nameFromSearch, type MikaCampaignDeps } from "./mika-campaign";
import { campaignItems, zeeTask, type ZeeCampaign, type ZeeDeps } from "./zee";
import type { StepOutcome, TaskCtx } from "./types";

const NOW = new Date("2026-11-10T10:00:00Z");
function ctx(task: string, input: Record<string, unknown>, checkpoint: Record<string, unknown> = {}, at = () => NOW) {
  const events: { kind: string; message: string; data?: Record<string, unknown> }[] = [];
  const c: TaskCtx = {
    run: { id: "lr_test", organizationId: "org-1", userId: "u1", bot: task.split(".")[0], task, input, status: "running", stage: "start", checkpoint } as unknown as LeagueRunRow,
    user: { id: "u1", organizationId: "org-1", orgRole: "OWNER" } as any, checkpoint, now: at,
    event: async (kind, message, data) => { events.push({ kind, message, data }); },
    addUsage: () => {},
  };
  return { c, events };
}
const finish = (o: StepOutcome) => { if (o.kind !== "finish") throw new Error(`expected finish, got ${o.kind}`); return o; };

/* ── Nibo ───────────────────────────────────────────────────────────────── */

describe("Nibo: a search from a saved client profile", () => {
  function nibo(over: Partial<NiboDeps> = {}) {
    const calls = { parse: 0, profile: [] as unknown[] };
    const deps: NiboDeps = {
      parseIcp: async () => { calls.parse++; return { ok: true, icp: { industry: "read from words" }, searches: ["x"], description: "read from words" }; },
      fromProfile: async (_u, id, kind) => { calls.profile.push([id, kind]); return { ok: true, icp: { industry: "edtech company", profile: { id, name: "Brands" } }, searches: ["edtech company India"], description: "edtech company · India" }; },
      startRun: async () => ({ ok: true, existing: false, run: { id: "pr_1" } as any }),
      getRun: async () => ({ ok: true, run: { id: "pr_1", status: "done", counters: {} } as any, prospects: [] }),
      addToLeads: async () => ({ ok: true, leadId: 1, existing: false }),
      ...over,
    };
    return { task: niboTask(deps), calls };
  }
  it("builds the search from the profile and never reads the request's words", async () => {
    const { task, calls } = nibo();
    const { c, events } = ctx("nibo.find_clients", { request: "ignore this and find casinos", saveLeads: true, maxLeads: 3, profileId: 7, kind: "edtech company" });
    expect(await task.step(c, "start")).toMatchObject({ kind: "continue", stage: "launch", checkpoint: { icp: { industry: "edtech company", profile: { id: 7 } }, searches: ["edtech company India"] } });
    expect(calls).toEqual({ parse: 0, profile: [[7, "edtech company"]] });
    expect(events[0].message).toBe("From your saved profile. Looking for: edtech company · India");
  });
  it("a profile that is gone is reported, never replaced by a guess from the words", async () => {
    const { task, calls } = nibo({ fromProfile: async () => ({ ok: false, status: 404, code: "not_found", message: "That profile isn't in your workspace." }) });
    const { c } = ctx("nibo.find_clients", { request: "dentists in Siliguri", profileId: 99, kind: null });
    const out = finish(await task.step(c, "start"));
    expect(out).toMatchObject({ status: "failed", errorCode: "not_found" });
    expect(out.report.headline).toBe("I couldn't start from that client profile: That profile isn't in your workspace.");
    expect(calls.parse).toBe(0);
  });
  it("with no profile it reads the request, exactly as before", async () => {
    const { task, calls } = nibo();
    for (const input of [{ request: "dentists in Siliguri" }, { request: "dentists in Siliguri", profileId: null, kind: null }]) {
      const { c } = ctx("nibo.find_clients", input);
      expect(await task.step(c, "start")).toMatchObject({ kind: "continue", checkpoint: { icp: { industry: "read from words" } } });
    }
    expect(calls).toEqual({ parse: 2, profile: [] });
  });
  it("the task's input accepts a profile, and a search stored before profiles existed is still valid", () => {
    const old = TASK_INPUT["nibo.find_clients"].parse({ request: "dentists in Siliguri" });
    expect(old).toMatchObject({ profileId: null, kind: null, saveLeads: true, maxLeads: 3 });
    expect(TASK_INPUT["nibo.find_clients"].safeParse({ request: "D2C brands from my profile", profileId: 7, kind: "D2C brand" }).success).toBe(true);
    expect(TASK_INPUT["nibo.find_clients"].safeParse({ request: "D2C brands from my profile", profileId: -1 }).success).toBe(false);
    expect(TASK_INPUT["nibo.find_clients"].safeParse({ request: "D2C brands from my profile", profile: 7 }).success).toBe(false);
  });
});

/* ── Mika ───────────────────────────────────────────────────────────────── */

const counts = (over: Record<string, number> = {}) => ({ members: 0, queued: 0, skipped: 0, failed: 0, draft: 0, approved: 0, sending: 0, sent: 0, discarded: 0, ...over });
function mika(over: Partial<MikaCampaignDeps> = {}) {
  const calls = { audience: 0, create: [] as any[], prepare: [] as number[], get: 0 };
  const state = { campaign: { id: 5, name: "Diwali", status: "active", preparing: false, prepareStop: null as string | null, prepareStopLabel: null as string | null, counts: counts({ members: 3, queued: 3 }) }, members: [] as any[] };
  const deps: MikaCampaignDeps = {
    audience: async () => { calls.audience++; return { ok: true, leads: [{ id: 1, companyName: "A", blocked: null }, { id: 2, companyName: "B", blocked: "Marked do-not-contact" }, { id: 3, companyName: "C", blocked: null }, { id: 4, companyName: "D", blocked: 'Already in "Other"' }, { id: 5, companyName: "E", blocked: null }] }; },
    createCampaign: async (_u, raw) => { calls.create.push(raw); state.campaign = { ...state.campaign, name: raw.name, counts: counts({ members: raw.leadIds.length, queued: raw.leadIds.length }) }; return { ok: true, campaign: state.campaign, added: raw.leadIds.length, left: 0 }; },
    getCampaign: async () => { calls.get++; return { ok: true, campaign: state.campaign, members: state.members }; },
    startPreparing: async (_u, id) => { calls.prepare.push(id); state.campaign = { ...state.campaign, preparing: true }; return { ok: true, campaign: state.campaign, waiting: state.campaign.counts.queued }; },
    ...over,
  };
  return { task: mikaCampaignTask(deps), calls, state };
}
const member = (leadId: number, stage: string, note: string | null = null) => ({ leadId, companyName: `Lead ${leadId}`, stage, stageLabel: stage === "draft" ? "Draft to review" : stage === "skipped" ? "Skipped" : stage === "queued" ? "Waiting for a draft" : stage, note });

describe("Mika: campaign drafts", () => {
  it("makes a campaign from the newest open leads that are free, never a blocked one, and no more than asked", async () => {
    const { task, calls } = mika();
    const { c, events } = ctx("mika.campaign", { campaignId: null, name: "", leadIds: [], max: 2 });
    const out = await task.step(c, "start");
    expect(calls.create).toEqual([{ name: defaultName(NOW), leadIds: [1, 3] }]);
    expect(out).toMatchObject({ kind: "continue", stage: "prepare", checkpoint: { campaignId: 5, created: true } });
    expect(events[0]).toMatchObject({ kind: "campaign_created", data: { href: campaignLink(5) } });
    expect(defaultName(NOW)).toBe("Mika's campaign, 10 Nov");
  });
  it("uses the leads and the name the person gave, and doesn't look for others", async () => {
    const { task, calls } = mika();
    const { c } = ctx("mika.campaign", { campaignId: null, name: "D2C, November", leadIds: [9, 8], max: 10 });
    await task.step(c, "start");
    expect(calls.create).toEqual([{ name: "D2C, November", leadIds: [9, 8] }]);
    expect(calls.audience).toBe(0);
  });
  it("with no free lead it says so and creates nothing", async () => {
    const { task, calls } = mika({ audience: async () => ({ ok: true, leads: [{ id: 2, companyName: "B", blocked: "Marked do-not-contact" }] }) });
    const { c } = ctx("mika.campaign", { campaignId: null, name: "", leadIds: [], max: 10 });
    const out = finish(await task.step(c, "start"));
    expect(out).toMatchObject({ status: "completed", report: { headline: "No open leads are free for a campaign" } });
    expect(calls.create).toEqual([]);
  });
  it("works on an existing campaign without creating one; an archived or unknown one is refused", async () => {
    const { task, calls } = mika();
    const { c } = ctx("mika.campaign", { campaignId: 5, name: "", leadIds: [], max: 10 });
    expect(await task.step(c, "start")).toMatchObject({ kind: "continue", stage: "prepare", checkpoint: { campaignId: 5, created: false } });
    expect(calls.create).toEqual([]);
    const archived = mika(); archived.state.campaign.status = "archived";
    expect(finish(await archived.task.step(ctx("mika.campaign", { campaignId: 5 }).c, "start"))).toMatchObject({ status: "failed", errorCode: "archived" });
    const gone = mika({ getCampaign: async () => ({ ok: false, status: 404, code: "not_found", message: "That campaign isn't in your workspace." }) });
    expect(finish(await gone.task.step(ctx("mika.campaign", { campaignId: 77 }).c, "start"))).toMatchObject({ status: "failed", errorCode: "not_found" });
  });
  it("presses Prepare once, parks while the campaign's own job writes, and reports what the rows say", async () => {
    const { task, calls, state } = mika();
    const cp = { campaignId: 5, name: "Diwali", created: true };
    const a = ctx("mika.campaign", {}, cp);
    const started = await task.step(a.c, "prepare");
    expect(started).toMatchObject({ kind: "wait", stage: "following" });
    expect(calls.prepare).toEqual([5]);
    // Still writing: parked again, with progress said once per change.
    state.campaign = { ...state.campaign, counts: counts({ members: 3, queued: 2, draft: 1 }) };
    const b = ctx("mika.campaign", {}, (started as any).checkpoint);
    const again = await task.step(b.c, "following");
    expect(again).toMatchObject({ kind: "wait", stage: "following", checkpoint: { last: "1 ready · 0 set aside · 2 waiting" } });
    expect(b.events.map((e) => e.message)).toEqual(["Drafts: 1 ready · 0 set aside · 2 waiting"]);
    const same = ctx("mika.campaign", {}, (again as any).checkpoint);
    await task.step(same.c, "following");
    expect(same.events).toEqual([]);
    // Finished: two drafts, one skipped.
    state.campaign = { ...state.campaign, preparing: false, counts: counts({ members: 3, draft: 2, skipped: 1 }) };
    state.members = [member(1, "draft"), member(2, "skipped", "No verified facts to write from. Research it first"), member(3, "draft")];
    const done = await task.step(ctx("mika.campaign", {}, (again as any).checkpoint).c, "following");
    expect(done).toMatchObject({ kind: "continue", stage: "report", checkpoint: { stillGoing: false } });
    const out = finish(await task.step(ctx("mika.campaign", {}, (done as any).checkpoint).c, "report"));
    expect(out.status).toBe("completed");
    expect(out.report.headline).toBe('2 drafts ready for your approval in "Diwali"');
    expect(out.report.counts).toEqual([{ label: "Drafts to review", value: 2 }, { label: "Already approved", value: 0 }, { label: "Set aside", value: 1 }, { label: "Still waiting", value: 0 }]);
    expect(out.report.items.map((i) => [i.title, i.status, i.detail])).toEqual([["Lead 1", "needs_you", "Draft to review"], ["Lead 2", "skipped", "Skipped: No verified facts to write from. Research it first"], ["Lead 3", "needs_you", "Draft to review"]]);
    expect(out.report.next).toEqual({ label: "Review and approve in Campaigns", href: "/outbound?view=campaigns&campaign=5" });
    expect(out.report.notes?.[0]).toMatch(/^Nothing was approved or sent\./);
  });
  it("when the plan's drafts run out it reports what was written and why it stopped; with nothing written that is a failure", async () => {
    const some = mika();
    some.state.campaign = { ...some.state.campaign, preparing: false, prepareStop: "draft_allowance", prepareStopLabel: "Your plan's AI drafts for this 30-day period are used up", counts: counts({ members: 3, draft: 1, queued: 2 }) };
    some.state.members = [member(1, "draft"), member(2, "queued"), member(3, "queued")];
    const out = finish(await some.task.step(ctx("mika.campaign", {}, { campaignId: 5 }).c, "report"));
    expect(out).toMatchObject({ status: "partial", errorCode: null });
    expect(out.report.notes).toContain("Drafting stopped early: Your plan's AI drafts for this 30-day period are used up. Press Prepare drafts in the campaign to carry on when you can.");
    expect(out.report.counts[3]).toEqual({ label: "Still waiting", value: 2 });
    const none = mika();
    none.state.campaign = { ...none.state.campaign, preparing: false, prepareStop: "draft_allowance", prepareStopLabel: "used up", counts: counts({ members: 3, queued: 3 }) };
    expect(finish(await none.task.step(ctx("mika.campaign", {}, { campaignId: 5 }).c, "report"))).toMatchObject({ status: "failed", errorCode: "limit", report: { headline: 'No drafts were written for "Diwali"' } });
    // The person pressing Stop is their own choice, not a failure to report.
    const stoppedByThem = mika();
    stoppedByThem.state.campaign = { ...stoppedByThem.state.campaign, preparing: false, prepareStop: "stopped", prepareStopLabel: "Stopped by you", counts: counts({ members: 2, draft: 2 }) };
    expect(finish(await stoppedByThem.task.step(ctx("mika.campaign", {}, { campaignId: 5 }).c, "report")).status).toBe("completed");
  });
  it("stops following after the limit and says the campaign carries on by itself", async () => {
    const { task, state } = mika();
    state.campaign = { ...state.campaign, preparing: true, counts: counts({ members: 50, draft: 20, queued: 30 }) };
    const late = () => new Date(NOW.getTime() + (LEAGUE_LIMITS.campaignFollowMinutes + 1) * 60_000);
    const out = await task.step(ctx("mika.campaign", {}, { campaignId: 5, since: NOW.toISOString(), last: "" }, late).c, "following");
    expect(out).toMatchObject({ kind: "continue", stage: "report", checkpoint: { stillGoing: true } });
    const rep = finish(await task.step(ctx("mika.campaign", {}, (out as any).checkpoint).c, "report"));
    expect(rep.status).toBe("partial");
    expect(rep.report.notes).toContain("Drafts are still being written: 30 leads waiting. The campaign carries on by itself; open it to see progress.");
    expect(LEAGUE_LIMITS.campaignFollowMinutes).toBeLessThan(45); // inside the runtime's own limit for a task
  });
  it("a campaign with nothing waiting is reported as it stands; any other refusal to start is a failure", async () => {
    const full = mika({ startPreparing: async () => ({ ok: false, status: 409, code: "nothing_to_prepare", message: "Every lead already has a draft." }) });
    full.state.campaign = { ...full.state.campaign, counts: counts({ members: 2, draft: 2 }) };
    const out = await full.task.step(ctx("mika.campaign", {}, { campaignId: 5 }).c, "prepare");
    expect(out).toMatchObject({ kind: "continue", stage: "report", checkpoint: { nothingWaiting: true } });
    expect(finish(await full.task.step(ctx("mika.campaign", {}, (out as any).checkpoint).c, "report"))).toMatchObject({ status: "completed", report: { headline: '2 drafts ready for your approval in "Diwali"' } });
    const viewer = mika({ startPreparing: async () => ({ ok: false, status: 403, code: "forbidden", message: "Your role doesn't allow changing leads." }) });
    expect(finish(await viewer.task.step(ctx("mika.campaign", {}, { campaignId: 5 }).c, "prepare"))).toMatchObject({ status: "failed", errorCode: "forbidden" });
    expect(finish(await mika().task.step(ctx("mika.campaign", {}, {}).c, "prepare"))).toMatchObject({ status: "failed", errorCode: "no_campaign" });
  });
  it("a retried step after the campaign was made does not make a second one", async () => {
    const { task, calls } = mika();
    const first = await task.step(ctx("mika.campaign", { campaignId: null, name: "", leadIds: [1], max: 10 }).c, "start");
    // The runtime resumes from the saved checkpoint at "prepare": "start" is not run again.
    await task.step(ctx("mika.campaign", { campaignId: null, name: "", leadIds: [1], max: 10 }, (first as any).checkpoint).c, "prepare");
    await task.step(ctx("mika.campaign", { campaignId: null, name: "", leadIds: [1], max: 10 }, (first as any).checkpoint).c, "prepare");
    expect(calls.create).toHaveLength(1);
    expect(calls.prepare).toEqual([5, 5]); // pressing Prepare twice is harmless: the campaign has one job
  });
  it("from a search it takes exactly the companies that search saved to Leads, and names the campaign after it", async () => {
    const asked: string[] = [];
    const { task, calls } = mika({ leadsFromSearch: async (_u, runId) => { asked.push(runId); return { ok: true, leadIds: [31, 32, 33], description: "D2C brand · India" }; } });
    const { c, events } = ctx("mika.campaign", { campaignId: null, name: "", leadIds: [], max: 2, runId: "pr_abc123def456" });
    const out = await task.step(c, "start");
    expect(asked).toEqual(["pr_abc123def456"]);
    expect(calls.create).toEqual([{ name: "From search: D2C brand · India", leadIds: [31, 32, 33] }]); // `max` is for "newest leads", not for a search
    expect(calls.audience).toBe(0);
    expect(out).toMatchObject({ kind: "continue", stage: "prepare", checkpoint: { created: true } });
    expect(events[0]).toMatchObject({ kind: "search_read", message: "3 companies from the search are in Leads", data: { href: "/outbound?run=pr_abc123def456" } });
  });
  it("a search that saved nothing to Leads is reported as that: the newest leads are NOT taken instead", async () => {
    const { task, calls } = mika({ leadsFromSearch: async () => ({ ok: true, leadIds: [], description: "D2C brand · India" }) });
    const out = finish(await task.step(ctx("mika.campaign", { campaignId: null, name: "", leadIds: [], max: 10, runId: "pr_abc123def456" }).c, "start"));
    expect(out).toMatchObject({ status: "completed", report: { headline: "That search hasn't saved any company to Leads", next: { href: "/outbound?run=pr_abc123def456" } } });
    expect([calls.create, calls.audience]).toEqual([[], 0]);
  });
  it("a search that isn't the person's, or can't be read, fails the task without making a campaign; leads named win over a search", async () => {
    const gone = mika({ leadsFromSearch: async () => ({ ok: false, status: 404, code: "not_found", message: "That search isn't in your workspace." }) });
    expect(finish(await gone.task.step(ctx("mika.campaign", { runId: "pr_abc123def456", leadIds: [] }).c, "start"))).toMatchObject({ status: "failed", errorCode: "not_found" });
    expect(gone.calls.create).toEqual([]);
    const none = mika(); // a server whose wiring has no search reader
    expect(finish(await none.task.step(ctx("mika.campaign", { runId: "pr_abc123def456", leadIds: [] }).c, "start"))).toMatchObject({ status: "failed", errorCode: "unavailable" });
    let asked = 0;
    const named = mika({ leadsFromSearch: async () => { asked++; return { ok: true, leadIds: [9], description: "x" }; } });
    await named.task.step(ctx("mika.campaign", { runId: "pr_abc123def456", leadIds: [4, 5], name: "Mine" }).c, "start");
    expect([asked, named.calls.create]).toEqual([0, [{ name: "Mine", leadIds: [4, 5] }]]);
  });
  it("a name from a long search description is cut at one of its own breaks, never mid-word", () => {
    expect(nameFromSearch("D2C brand · India")).toBe("From search: D2C brand · India");
    // The real case from a local run, which used to end "… · serves Saa".
    expect(nameFromSearch("digital marketing agency · United States · 5–30 people · serves SaaS companies")).toBe("From search: digital marketing agency · United States · 5–30 people");
    const noBreaks = nameFromSearch("x".repeat(300));
    expect([noBreaks.length, noBreaks.endsWith("…")]).toEqual([80, true]);
    expect(nameFromSearch("  spaced    out  ")).toBe("From search: spaced out");
  });
  it("a long search description still gives a name that fits", async () => {
    const { task, calls } = mika({ leadsFromSearch: async () => ({ ok: true, leadIds: [1], description: "x".repeat(300) }) });
    await task.step(ctx("mika.campaign", { runId: "pr_abc123def456", leadIds: [] }).c, "start");
    expect(calls.create[0].name.length).toBeLessThanOrEqual(80);
  });
  it("its input has safe defaults and limits", () => {
    expect(TASK_INPUT["mika.campaign"].parse({})).toEqual({ campaignId: null, name: "", leadIds: [], max: 10, runId: null });
    expect(TASK_INPUT["mika.campaign"].safeParse({ runId: "not a run id" }).success).toBe(false);
    expect(TASK_INPUT["mika.campaign"].safeParse({ leadIds: Array.from({ length: LEAGUE_LIMITS.campaignLeads + 1 }, (_, i) => i + 1) }).success).toBe(false);
    expect(TASK_INPUT["mika.campaign"].safeParse({ max: LEAGUE_LIMITS.campaignLeads + 1 }).success).toBe(false);
    expect(TASK_INPUT["mika.campaign"].safeParse({ send: true }).success).toBe(false);
  });
});

/* ── Zee ────────────────────────────────────────────────────────────────── */

const camp = (over: Partial<ZeeCampaign> & { n?: Partial<ZeeCampaign["counts"]> } = {}): ZeeCampaign => ({
  id: 1, name: "Diwali", status: "active", preparing: false, prepareStop: null, prepareStopLabel: null, sending: false, sendStop: null, sendStopLabel: null,
  rates: { reply: null, bounce: null }, ...over, counts: { queued: 0, draft: 0, approved: 0, sent: 0, replied: 0, bounced: 0, ...(over.n ?? {}) },
});
function zee(over: Partial<ZeeDeps> = {}) {
  const facts: string[] = [];
  const deps: ZeeDeps = {
    // The deal suite is visible again (shared/flags.ts), so Zee reads the money half too. Empty here: these
    // tests are about campaigns and replies, and an empty briefing keeps them to that.
    briefing: async () => ({ greetingName: "Asha", attentionCount: 0, generatedAt: NOW.toISOString(), protection: {} as any, nextActions: [],
      radar: { overdue: { totalMinor: 0, count: 0, invoices: [] }, dueThisWeek: { totalMinor: 0, count: 0, invoices: [] }, readyToInvoice: { totalMinor: 0, count: 0, contracts: [] }, collectibleMinor: 0 } }),
    followUps: async () => ({ ok: true, today: "2026-11-10", overdue: [], dueToday: [] }),
    waitingDrafts: async () => ({ ok: true, items: [] }),
    locale: async () => ({ currency: "INR", locale: "en-IN" }),
    summarize: async (_u, f) => { facts.push(f); return null; },
    ...over,
  };
  return { task: zeeTask(deps), facts };
}

describe("Zee: campaigns and replies in the briefing", () => {
  it("says what each campaign needs from the person, and how it is doing once something was sent", () => {
    const items = campaignItems([
      camp({ id: 1, name: "A", sendStop: "mailbox_reconnect", sendStopLabel: "Reconnect your Gmail in Settings", n: { approved: 4 } }),
      camp({ id: 2, name: "B", prepareStop: "draft_allowance", prepareStopLabel: "Your plan's AI drafts for this 30-day period are used up", n: { queued: 6, draft: 3 } }),
      camp({ id: 3, name: "C", n: { sent: 10, replied: 2, bounced: 1, approved: 2 }, rates: { reply: 20, bounce: 10 } }),
    ]);
    expect(items.map((i) => [i.title, i.status, i.detail])).toEqual([
      ['Campaign "A": sending paused', "needs_you", "Reconnect your Gmail in Settings"],
      ['Campaign "B": drafting stopped', "needs_you", "Your plan's AI drafts for this 30-day period are used up · 6 leads still waiting"],
      ['Campaign "B": 3 drafts to review', "needs_you", "Read each one and approve it; nothing is sent until you do"],
      ['Campaign "C"', "info", "10 sent · 2 replies (20%) · 1 bounced · 2 approved, not sent"],
    ]);
    expect(items[0].href).toBe("/outbound?view=campaigns&campaign=1");
  });
  it("leaves alone what the person decided themselves, what finished, and what is archived", () => {
    expect(campaignItems([
      camp({ sendStop: "paused", sendStopLabel: "Paused by you" }), camp({ sendStop: "done", sendStopLabel: "Everything approved has been sent" }),
      camp({ prepareStop: "stopped", prepareStopLabel: "Stopped by you", n: { queued: 4 } }), camp({ prepareStop: "draft_allowance", prepareStopLabel: "used up", n: { queued: 0 } }),
      camp({ status: "archived", sendStop: "bounce_rate", sendStopLabel: "Too many bounced", n: { draft: 9, sent: 5 } }),
      camp({ sending: true, sendStop: null, n: {} }),
    ])).toEqual([]);
    expect(campaignItems([camp({ n: { sent: 3 } })])[0].detail).toBe("3 sent · 0 replies"); // no rate invented
  });
  it("puts replies first, counts them, and hands the model nothing from any email", async () => {
    const { task, facts } = zee({
      campaigns: async () => ({ ok: true, campaigns: [camp({ id: 4, name: "Diwali", n: { draft: 2 } })] }),
      replies: async () => ({ ok: true, counts: { needs_review: 3, interested: 1 } }),
    });
    const out = finish(await task.step(ctx("zee.briefing", {}).c, "start"));
    expect(out.status).toBe("completed");
    expect(out.report.items.map((i) => [i.title, i.status])).toEqual([["3 replies to read", "needs_you"], ["1 conversation read as interested", "needs_you"], ['Campaign "Diwali": 2 drafts to review', "needs_you"]]);
    expect(out.report.headline).toBe("3 things need you today");
    expect(out.report.counts).toEqual(expect.arrayContaining([{ label: "Replies to read", value: 3 }, { label: "Campaign drafts to review", value: 2 }]));
    expect(out.report.next).toEqual({ label: "Start with the first one", href: "/outbound?view=inbox" });
    expect(out.report.summary).toBe("3 replies to read · 1 conversation read as interested");
    // What the summary model is given: the items above and nothing else.
    expect(facts[0]).toBe("- 3 replies to read: The rules couldn't tell what they mean. Read each one and say what it is\n- 1 conversation read as interested: Answer these first\n- Campaign \"Diwali\": 2 drafts to review: Read each one and approve it; nothing is sent until you do");
  });
  it("a server without campaigns or the inbox, or a failure reading them, never fails the briefing", async () => {
    for (const over of [
      {},
      { campaigns: async () => ({ ok: false as const, status: 503, code: "CAMPAIGNS_NOT_SETUP", message: "x" }), replies: async () => ({ ok: false as const, status: 503, code: "MAIL_NOT_SETUP", message: "x" }) },
      { campaigns: async () => { throw new Error("db"); }, replies: async () => { throw new Error("db"); } },
    ] as Partial<ZeeDeps>[]) {
      const out = finish(await zee(over).task.step(ctx("zee.briefing", {}).c, "start"));
      expect(out).toMatchObject({ status: "completed", report: { headline: "All clear today", items: [] } });
      // The money counts come from the briefing and are all zero here; the find-clients counts sit between them.
      expect(out.report.counts.map((c) => c.label)).toEqual(["Overdue invoices", "Follow-ups due", "Messages waiting", "Due this week", "Ready to invoice"]);
    }
  });
  it("a campaign with nothing to say adds nothing but its zero count", async () => {
    const out = finish(await zee({ campaigns: async () => ({ ok: true, campaigns: [camp({ sending: true })] }), replies: async () => ({ ok: true, counts: { needs_review: 0, interested: 0 } }) }).task.step(ctx("zee.briefing", {}).c, "start"));
    expect(out.report.items).toEqual([]);
    expect(out.report.headline).toBe("All clear today");
    expect(out.report.counts).toEqual([
      { label: "Overdue invoices", value: 0 }, { label: "Follow-ups due", value: 0 }, { label: "Messages waiting", value: 0 },
      { label: "Replies to read", value: 0 }, { label: "Campaign drafts to review", value: 0 },
      { label: "Due this week", value: 0 }, { label: "Ready to invoice", value: 0 },
    ]);
  });
});
