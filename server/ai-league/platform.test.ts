/**
 * The coworker platform's edges: report files are safe to open, the web service leaves background work to a dedicated
 * worker when told to, a campaign keeps its own clock in the runtime, a success clears the error count, Nibo's campaign
 * tool turns local times into exact instants (and refuses impossible ones before anything starts), and the report email
 * escapes what came from the web.
 */
import { describe, expect, it, vi } from "vitest";
vi.mock("../db", () => ({ db: {} }));
import type { LeagueReport } from "@shared/ai-league";
import type { LeagueRunRow, User } from "@shared/schema";
import { csvCell, reportCsv, reportMarkdown } from "./report-files";
import { backgroundWorkIsElsewhere } from "../workflow/runner";
import { leagueWorkflow, MAX_CLAIMS, type RuntimeDeps } from "./runtime";
import { memoryLeagueStore } from "./memory-store";
import { campaignTool } from "./chat";
import { leagueReportEmail } from "../emails";

const report: LeagueReport = {
  headline: "Saved 2 qualified companies",
  counts: [{ label: "Qualified", value: 2 }],
  items: [
    { title: '=HYPERLINK("http://evil.example","click")', detail: "Qualified · Hiring", href: "/leads/1", status: "done", sources: ["https://acme.in/careers"] },
    { title: "Acme *Digital* [x](javascript:alert(1))", detail: "+91 98765", status: "info" },
  ],
  notes: ["Coverage is partial: research stopped because the research time ended."],
};

describe("report files", () => {
  it("CSV: formula triggers are neutralised, quotes doubled, UTF-8 with a BOM", () => {
    expect(csvCell("=1+1")).toBe(`"'=1+1"`);
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvCell('say "hi"')).toBe(`"say ""hi"""`);
    const csv = reportCsv(report);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
    expect(csv).toContain(`"'+91 98765"`);
  });
  it("Markdown: titles are escaped (no live links or formatting from the web), sources only as plain http(s)", () => {
    const md = reportMarkdown(report, { title: "Research campaign", coworker: "nibo", finishedAt: null });
    expect(md).toContain("Acme \\*Digital\\* \\[x\\](javascript:alert(1))");
    expect(md).toContain("Source: <https://acme.in/careers>");
    expect(md).toContain("## Notes");
  });
});

describe("the dedicated worker", () => {
  it("with BACKGROUND_WORKER=external the web service leaves jobs to the worker; the worker (and default setups) run them", () => {
    expect(backgroundWorkIsElsewhere({ BACKGROUND_WORKER: "external" } as any)).toBe(true);
    expect(backgroundWorkIsElsewhere({ BACKGROUND_WORKER: "external", DEALINSEC_PROCESS: "worker" } as any)).toBe(false);
    expect(backgroundWorkIsElsewhere({} as any)).toBe(false);
  });
});

/* ── the runtime ── */
const T = new Date("2026-10-19T16:30:00Z");
function runtime(over: Partial<RuntimeDeps> & { step?: any } = {}) {
  const mem = memoryLeagueStore();
  const store = mem.store;
  let now = T;
  const notified: string[] = [];
  const deps: RuntimeDeps = {
    store,
    handlers: { "nibo.campaign": { step: over.step ?? (async () => ({ kind: "wait", stage: "researching", until: new Date(now.getTime() + 30_000) })) } } as any,
    loadUser: async () => ({ id: "u1", organizationId: "org-1" }) as unknown as User,
    notify: async (r) => { notified.push(r.id); },
    now: () => now, maxMs: 45 * 60_000, ready: async () => true, log: () => {},
    ...over,
  };
  return { deps, store, mem, notified, setNow: (d: Date) => { now = d; } };
}
async function create(store: ReturnType<typeof memoryLeagueStore>["store"], task = "nibo.campaign", input: Record<string, unknown> = { request: "Indian agencies", target: 5, maxSearches: 3, saveLeads: true, startAt: null, workUntil: null, deliverAt: null, timezone: "Asia/Kolkata" }) {
  const { run } = await store.createRun({ id: `lr_${Math.random().toString(16).slice(2, 14)}`, orgId: "org-1", userId: "u1", bot: "nibo", task, input, idemKey: Math.random().toString(), source: "page", now: T, limits: { monthly: { since: new Date(0), max: 100 }, concurrent: 5 } });
  return run as LeagueRunRow;
}

describe("a campaign in the runtime", () => {
  it("isn't stopped by the 45-minute task limit (it keeps its own clock and hard stop)", async () => {
    const { deps, store, setNow } = runtime();
    const run = await create(store);
    const wf = leagueWorkflow(() => deps);
    const claimed = (await wf.claim(T))!;
    await wf.step(claimed, Date.now() + 10_000);
    setNow(new Date(T.getTime() + 3 * 3600_000)); // three hours later
    const again = (await wf.claim(new Date(T.getTime() + 3 * 3600_000)))!;
    expect(again.id).toBe(run.id);
    const out = await wf.step(again, Date.now() + 10_000);
    expect(typeof out === "object" && "wait" in out).toBe(true);
    expect((await store.peek(run.id))?.status).toBe("waiting"); // not "partial: ran past its time limit"
  });

  it("may be claimed many more times than an ordinary task before it counts as stuck", async () => {
    const { deps, store, mem } = runtime();
    const run = await create(store);
    mem.runs.find((r) => r.id === run.id)!.attempts = MAX_CLAIMS + 50;
    const wf = leagueWorkflow(() => deps);
    const claimed = await wf.claim(T);
    expect(claimed?.id).toBe(run.id); // an ordinary task would be failed as stuck here
  });

  it("a step that works clears the error count, so separate blips over a night don't add up to a failure", async () => {
    const { deps, store, mem } = runtime({ step: async (ctx: any) => ({ kind: "continue", stage: "batch", checkpoint: { ...ctx.checkpoint, batch: 1 } }) });
    const run = await create(store);
    mem.runs.find((r) => r.id === run.id)!.checkpoint = { errors: 2 };
    const wf = leagueWorkflow(() => deps);
    const claimed = (await wf.claim(T))!;
    await wf.step(claimed, Date.now() + 10_000);
    expect((await store.peek(run.id))?.checkpoint).toEqual({ batch: 1 });
  });
});

/* ── Nibo's campaign tool ── */
const toolCtx = { user: { id: "u1", organizationId: "org-1", timezone: "Asia/Kolkata" }, sessionId: "s", runId: "r1", userText: "", userMessages: [], progress: () => {} } as any;
/** About 12 hours from now, on the hour, as India local time "YYYY-MM-DDTHH:00" (always inside a campaign's 24 hours). */
const inTwelveHoursIst = () => {
  const ist = new Date(Date.now() + 12 * 3600_000 + 5.5 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${ist.getUTCFullYear()}-${p(ist.getUTCMonth() + 1)}-${p(ist.getUTCDate())}T${p(ist.getUTCHours())}:00`;
};

describe("Nibo's campaign tool", () => {
  it("turns the person's local time into an exact instant, shows it back, and always asks first", async () => {
    const tool = campaignTool(async () => ({ ok: true, run: { id: "lr_x" }, existing: false }));
    const local = inTwelveHoursIst();
    const prep = await tool.prepare!(toolCtx, { request: "Indian digital marketing agencies", target: 50, deliverLocal: local });
    if (!prep.ok) throw new Error(prep.message);
    expect(prep.forceApproval).toBe(true);
    expect(prep.args.timezone).toBe("Asia/Kolkata");
    expect(new Date(String(prep.args.deliverAt)).toISOString()).toBe(new Date(`${local}:00+05:30`).toISOString());
    expect(prep.args.maxSearches).toBe(10); // 50 companies: the most searches a campaign may use
    expect(prep.preview.lines.find((l) => l.label === "Report")?.value).toMatch(new RegExp(`${local.slice(11)} IST$`));
  });
  it("refuses an unreadable or impossible time before anything starts", async () => {
    const tool = campaignTool(async () => { throw new Error("must not start"); });
    expect(await tool.prepare!(toolCtx, { request: "Indian agencies", target: 5, deliverLocal: "2020-01-01T08:00" })).toMatchObject({ ok: false, code: "invalid_times" });
    expect(tool.input.safeParse({ request: "Indian agencies", target: 5, deliverLocal: "8am tomorrow" }).success).toBe(false);
    expect(tool.input.safeParse({ request: "Indian agencies", target: 500 }).success).toBe(false);
  });
});

describe("the report email", () => {
  it("escapes everything that came from the web and links to the report", () => {
    const m = leagueReportEmail({ coworker: "Nibo", taskLabel: "Research campaign", headline: "Saved 2 <script>alert(1)</script>", counts: [{ label: "Qualified", value: 2 }], runId: "lr_abc", partial: true });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("/ai-league?run=lr_abc");
    expect(m.subject).toMatch(/\(partial\)$/);
  });
});
