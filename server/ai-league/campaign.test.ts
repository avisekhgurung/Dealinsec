/**
 * Nibo's research campaign with fake AI Outbound services and a fake clock: the runtime's part (carry the checkpoint,
 * advance time to each wait) is played by `drive`. What it proves: a scheduled start waits; batches move city by city;
 * results are de-duplicated across batches and against Leads; the target, the search cap, the plan's allowance and the
 * execution deadline each stop new research honestly; the report is saved before delivery and delivered at the time asked.
 */
import { describe, expect, it } from "vitest";
import type { LeagueRunRow } from "@shared/schema";
import { campaignTimes, campaignTimesProblem, fromLocal, batchIcp, showTime, domainKey } from "@shared/league-campaign";
import { TASK_INPUT } from "@shared/ai-league";
import { campaignTask, CAMPAIGN_CHECK_MS, type CampaignDeps } from "./tasks/campaign";
import type { StepOutcome, TaskCtx } from "./tasks/types";

const T0 = new Date("2026-10-19T16:30:00Z"); // 22:00 IST
const INDIA_ICP = { industry: "digital marketing agency", keywords: [], countries: ["IN"], locations: [], employeeMin: null, employeeMax: null, targetMarket: [], roles: [], exclusions: [], quantity: 10 };

const card = (id: number, domain: string, over: Record<string, any> = {}) => ({
  id, name: `Agency ${id}`, domain, website: `https://${domain}/`, rejectReason: null, classification: "qualified", classificationLabel: "Qualified",
  ready: false, score: { total: 60 + id }, leadId: null, contact: "none", whyNow: { label: "Hiring", value: "Hiring a web developer", url: `https://${domain}/careers` }, ...over,
});

interface World { batches: any[][]; startResults?: Record<number, any>; running?: Record<number, number> }
function fakeDeps(w: World) {
  const started: { icp: any; searches: string[] }[] = [];
  const added: number[] = [];
  const cancelled: string[] = [];
  let polls: Record<string, number> = {};
  const deps: CampaignDeps = {
    parseIcp: async () => ({ ok: true, icp: INDIA_ICP, searches: ["digital marketing agency India"], description: "digital marketing agencies in India" }),
    startRun: async (_u, raw) => {
      const n = started.length;
      if (w.startResults?.[n]) return w.startResults[n];
      started.push({ icp: raw.icp, searches: raw.searches });
      return { ok: true, existing: false, run: { id: `pr_${n}` } as any };
    },
    getRun: async (_u, id) => {
      const n = Number(id.split("_")[1]);
      polls[id] = (polls[id] ?? 0) + 1;
      const stillRunning = (w.running?.[n] ?? 0) >= polls[id];
      return { ok: true, run: { id, status: stillRunning ? "running" : "done", counters: { discovered: 10, verified: 8 }, errorCode: null } as any, prospects: w.batches[n] ?? [] };
    },
    addToLeads: async (_u, id) => { added.push(id); return { ok: true, leadId: 1000 + id, existing: false }; },
    cancelRun: async (_u, id) => { cancelled.push(id); return { ok: true }; },
  };
  return { deps, started, added, cancelled, resetPolls: () => { polls = {}; } };
}

/** Plays the runtime: one step at a time, carrying the checkpoint; a wait moves the clock to its time. */
async function drive(deps: CampaignDeps, input: Record<string, unknown>, opts: { now?: Date; maxSteps?: number; clock?: (now: Date, stage: string) => Date } = {}) {
  const parsed = TASK_INPUT["nibo.campaign"].parse(input);
  let now = opts.now ?? T0;
  let stage = "start";
  let checkpoint: Record<string, unknown> = {};
  const events: { kind: string; message: string; at: Date }[] = [];
  const waits: { stage: string; until: Date }[] = [];
  const task = campaignTask(deps);
  for (let i = 0; i < (opts.maxSteps ?? 200); i++) {
    const c: TaskCtx = {
      run: { id: "lr_c", organizationId: "org-1", userId: "u1", bot: "nibo", task: "nibo.campaign", input: parsed, status: "running", stage, checkpoint, createdAt: T0 } as unknown as LeagueRunRow,
      user: { id: "u1", organizationId: "org-1" } as any, checkpoint: { ...checkpoint }, now: () => now,
      event: async (kind, message) => { events.push({ kind, message, at: now }); }, addUsage: () => {},
    };
    const out: StepOutcome = await task.step(c, stage);
    if (out.kind === "finish") return { out, events, waits, now };
    if (out.checkpoint) checkpoint = out.checkpoint;
    stage = out.stage;
    if (out.kind === "wait") { waits.push({ stage: out.stage, until: out.until }); now = new Date(Math.max(now.getTime(), out.until.getTime())); }
    if (opts.clock) now = opts.clock(now, stage);
  }
  throw new Error("campaign never finished");
}

describe("the campaign's clock", () => {
  it("work-until defaults to shortly before delivery; a hard stop caps every campaign", () => {
    const t = campaignTimes({ startAt: null, workUntil: null, deliverAt: "2026-10-20T02:30:00Z", timezone: "Asia/Kolkata" }, T0);
    expect(t.startAt).toEqual(T0);
    expect(t.workUntil.toISOString()).toBe("2026-10-20T02:15:00.000Z"); // 15 minutes to write and deliver the report
    expect(t.hardStop.toISOString()).toBe("2026-10-20T03:00:00.000Z");
    const noDeadline = campaignTimes({ startAt: null, workUntil: null, deliverAt: null, timezone: "Asia/Kolkata" }, T0);
    expect(noDeadline.workUntil.getTime() - T0.getTime()).toBe(4 * 3600_000);
  });

  it("\"8 AM tomorrow, India time\" is an exact instant; times that can't work are refused in words", () => {
    expect(fromLocal("2026-10-20T08:00", "Asia/Kolkata")?.toISOString()).toBe("2026-10-20T02:30:00.000Z");
    expect(fromLocal("20/10 8am", "Asia/Kolkata")).toBeNull();
    expect(showTime(new Date("2026-10-20T02:30:00Z"), "Asia/Kolkata")).toBe("Tue 20 Oct, 08:00 IST");
    const base = { startAt: null, workUntil: null, timezone: "Asia/Kolkata" };
    expect(campaignTimesProblem({ ...base, deliverAt: "2026-10-19T16:40:00Z" }, T0)).toMatch(/too soon/);
    expect(campaignTimesProblem({ ...base, deliverAt: "2026-11-30T02:30:00Z" }, T0)).toMatch(/too far ahead/);
    expect(campaignTimesProblem({ ...base, deliverAt: "2026-10-20T02:30:00Z", timezone: "Mars/Olympus" }, T0)).toMatch(/timezone/);
    expect(campaignTimesProblem({ ...base, deliverAt: "2026-10-20T02:30:00Z", workUntil: "2026-10-20T03:00:00Z" }, T0)).toMatch(/before the report is due/);
    expect(campaignTimesProblem({ ...base, deliverAt: "2026-10-20T02:30:00Z" }, T0)).toBeNull();
  });

  it("a country-wide profile moves city by city; several places take turns; domains are compared without www", () => {
    expect(batchIcp(INDIA_ICP as any, 0).place).toBe("Mumbai");
    expect(batchIcp(INDIA_ICP as any, 1).icp.locations).toEqual(["Bengaluru"]);
    expect(batchIcp({ ...INDIA_ICP, locations: ["Pune", "Nagpur"] } as any, 3).place).toBe("Nagpur");
    expect(domainKey("https://www.Acme.in/about")).toBe("acme.in");
    expect(domainKey("not a domain")).toBeNull();
  });
});

describe("Nibo's research campaign", () => {
  it("overnight: waits for its start, searches city by city until the target, saves leads without duplicates, reports before delivery and delivers at 8 AM IST", async () => {
    const w: World = {
      batches: [
        [card(1, "a1.in"), card(2, "a2.in"), card(3, "a3.in", { classification: "not_a_fit", rejectReason: "off_topic" })],
        [card(4, "www.a1.in"), card(5, "a5.in", { leadId: 77 }), card(6, "a6.in")], // a1 again (www.), a5 already a lead
        [card(7, "a7.in"), card(8, "a8.in")],
      ],
      running: { 0: 2 }, // the first search is still running for two checks
    };
    const f = fakeDeps(w);
    const startAt = "2026-10-19T18:30:00Z", deliverAt = "2026-10-20T02:30:00Z"; // midnight and 08:00 IST
    const { out, events, waits, now } = await drive(f.deps, { request: "Indian digital marketing agencies that may need web development", target: 4, maxSearches: 5, startAt, deliverAt, timezone: "Asia/Kolkata" });
    expect(waits[0]).toEqual({ stage: "start", until: new Date(startAt) });
    expect(events[0]).toMatchObject({ kind: "scheduled", message: expect.stringContaining("Tue 20 Oct, 00:00 IST") });
    expect(f.started.map((s) => s.icp.locations)).toEqual([["Mumbai"], ["Bengaluru"], ["Delhi NCR"]]);
    expect(waits.filter((x) => x.stage === "researching").length).toBeGreaterThanOrEqual(3); // followed, not polled in a loop
    expect(f.added).toEqual([2, 1, 6, 8]); // best first; a1 never twice, a5 already a lead, target 4 reached (a7 reported, not saved)
    if (out.kind !== "finish") throw new Error();
    expect(out.status).toBe("completed");
    expect(out.report.headline).toBe("Saved 4 qualified companies, as asked");
    expect(out.report.counts.find((c) => c.label === "Already in Leads")?.value).toBe(1);
    const ready = events.find((e) => e.kind === "report_ready")!;
    expect(ready.at.getTime()).toBeLessThan(new Date(deliverAt).getTime()); // saved before delivery
    expect(waits.at(-1)).toEqual({ stage: "deliver", until: new Date(deliverAt) });
    expect(now.toISOString()).toBe(new Date(deliverAt).toISOString()); // delivered at 08:00 IST, not when research ended
    expect(out.report.items[0].sources?.[0]).toMatch(/^https:\/\/.+\/careers$/); // evidence links kept
  });

  it("the plan's allowance running out stops new searches and the report says so (partial, not failed)", async () => {
    const f = fakeDeps({ batches: [[card(1, "b1.in")]], startResults: { 1: { ok: false, status: 429, code: "monthly_limit", message: "you've used the 10 AI Outbound searches in your plan" } } });
    const { out } = await drive(f.deps, { request: "Indian digital marketing agencies", target: 5, maxSearches: 5 });
    if (out.kind !== "finish") throw new Error();
    expect(out.status).toBe("partial");
    expect(out.report.headline).toBe("Saved 1 of the 5 qualified companies asked for");
    expect(out.report.notes?.join(" ")).toMatch(/Coverage is partial: research stopped because you've used the 10 AI Outbound searches/);
  });

  it("the execution deadline cancels a running search, keeps what it found and still delivers on time", async () => {
    const f = fakeDeps({ batches: [[card(1, "c1.in"), card(2, "c2.in")]], running: { 0: 999 } });
    const deliverAt = "2026-10-19T18:00:00Z"; // 90 minutes after T0; research must end by 17:45
    const { out, now } = await drive(f.deps, { request: "Indian digital marketing agencies", target: 10, deliverAt, timezone: "Asia/Kolkata" });
    expect(f.cancelled).toEqual(["pr_0"]);
    if (out.kind !== "finish") throw new Error();
    expect(out.status).toBe("partial");
    expect(out.report.notes?.join(" ")).toMatch(/research time ended at Mon 19 Oct, 23:15 IST/);
    expect(now.getTime()).toBe(new Date(deliverAt).getTime());
    expect(f.added).toEqual([2, 1]); // what the cancelled search had found is kept (best first)
  });

  it("a search that can't be read is skipped and the campaign carries on", async () => {
    const f = fakeDeps({ batches: [[card(1, "d1.in")], [card(2, "d2.in")]] });
    const realGet = f.deps.getRun;
    let calls = 0;
    f.deps.getRun = async (u, id) => (id === "pr_0" && ++calls <= 1 ? { ok: false, status: 503, code: "unavailable", message: "provider timed out" } : realGet(u, id));
    const { out, events } = await drive(f.deps, { request: "Indian digital marketing agencies", target: 1, maxSearches: 3 });
    expect(events.some((e) => e.kind === "batch_failed")).toBe(true);
    if (out.kind !== "finish") throw new Error();
    expect(out.status).toBe("completed");
    expect(out.report.notes?.join(" ")).toMatch(/1 search failed and were skipped|1 search failed and was skipped|failed and were skipped/);
  });

  it("nothing qualifies: an honest empty report, never invented companies", async () => {
    const f = fakeDeps({ batches: [[card(1, "e1.in", { classification: "insufficient_evidence" })], [], []] });
    const { out } = await drive(f.deps, { request: "Indian digital marketing agencies", target: 3, maxSearches: 3 });
    if (out.kind !== "finish") throw new Error();
    expect(out.report.headline).toBe("No company passed the checks in this campaign");
    expect(out.report.items).toEqual([]);
    expect(f.added).toEqual([]);
  });

  it("past the hard stop, whatever it was doing, it reports what it has", async () => {
    const f = fakeDeps({ batches: [[card(1, "f1.in")]], running: { 0: 999 } });
    // A clock that jumps a day ahead after the first search starts (a long outage).
    const { out } = await drive(f.deps, { request: "Indian digital marketing agencies", target: 5 }, { clock: (now, stage) => (stage === "researching" ? new Date(now.getTime() + 25 * 3600_000) : now) });
    if (out.kind !== "finish") throw new Error();
    expect(["partial", "failed", "completed"]).toContain(out.status);
    expect(out.report.notes?.join(" ")).toMatch(/longest a campaign may run|research time ended/);
  });

  it("checks a running search every 30 seconds (parked between checks)", () => { expect(CAMPAIGN_CHECK_MS).toBe(30_000); });
});
