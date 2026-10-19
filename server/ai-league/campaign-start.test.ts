/** Starting a campaign checks its times before anything is stored: the person hears it now, not at midnight. */
import { describe, expect, it, vi } from "vitest";
vi.mock("../db", () => ({ db: {} }));
import * as svc from "./service";
import { memoryLeagueStore } from "./memory-store";

const T0 = new Date("2026-10-19T16:30:00Z");
const owner = { id: "u1", organizationId: "org-1", orgRole: "OWNER" } as any;
const deps = (mem: ReturnType<typeof memoryLeagueStore>) => ({ store: mem.store, now: () => T0, ready: async () => true, kick: () => {}, tier: async () => "pro" as const });

describe("starting a campaign", () => {
  it("refuses a report time in the past, and stores nothing", async () => {
    const mem = memoryLeagueStore();
    const r = await svc.startLeagueRun(owner, "nibo.campaign", { request: "Indian digital marketing agencies", target: 5, deliverAt: "2026-10-19T10:00:00Z", timezone: "Asia/Kolkata" }, { source: "page" }, deps(mem));
    expect(r).toMatchObject({ ok: false, code: "invalid_times" });
    expect(mem.runs).toHaveLength(0);
  });
  it("accepts a valid overnight campaign and stores it before anything else happens", async () => {
    const mem = memoryLeagueStore();
    const r = await svc.startLeagueRun(owner, "nibo.campaign", { request: "Indian digital marketing agencies", target: 50, maxSearches: 10, startAt: "2026-10-19T18:30:00Z", deliverAt: "2026-10-20T02:30:00Z", timezone: "Asia/Kolkata" }, { source: "page" }, deps(mem));
    expect(r.ok).toBe(true);
    expect(mem.runs).toHaveLength(1);
    expect(mem.runs[0]).toMatchObject({ task: "nibo.campaign", bot: "nibo", status: "queued" });
    if (r.ok) expect(r.run.timing).toEqual({ startAt: "2026-10-19T18:30:00Z", deliverAt: "2026-10-20T02:30:00Z", timezone: "Asia/Kolkata" });
  });
  it("a campaign can't ask for more than the limits, whatever the request says", async () => {
    const mem = memoryLeagueStore();
    const r = await svc.startLeagueRun(owner, "nibo.campaign", { request: "Indian digital marketing agencies", target: 500, maxSearches: 100 }, { source: "page" }, deps(mem));
    expect(r).toMatchObject({ ok: false, code: "invalid" });
  });
});
