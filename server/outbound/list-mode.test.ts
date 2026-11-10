/**
 * Bulk list mode: a sweep that stops after verification.
 *
 * The promise of this mode is a cost promise — it makes NO model call — and the two things that keep that promise are
 * both here: the step after verify, and what finalize does with a company that was verified but deliberately never
 * researched. If either regresses, a sweep silently becomes a deep search and starts spending model money, which is
 * exactly the kind of failure nobody notices until the bill. Pure unit test: no network, no model, no database.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { icpSchema } from "@shared/icp";
import type { PipelineDeps } from "./pipeline";

let stepRun: typeof import("./pipeline").stepRun;
let runModeOf: typeof import("./pipeline").runModeOf;
beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused";
  ({ stepRun, runModeOf } = await import("./pipeline"));
});

const NOW = new Date("2026-11-10T12:00:00Z");
const icp = icpSchema.parse({ industry: "dental clinic", services: ["web design"], quantity: 50 });

type Item = { id: number; stage: string; prospectId: number; errorCode?: string | null; prospect: Record<string, unknown> };

/**
 * A run parked at the end of verification: nothing left at "found", some companies verified. That is the exact moment
 * the two modes must part ways.
 */
function harness(mode: "deep" | "list", items: Item[]) {
  const calls = { stage: [] as string[], setItem: [] as any[], scored: [] as number[], chat: [] as any[], finished: [] as any[] };
  const run: any = {
    id: "pr_list", organizationId: "org-list", mode, quantity: 50, stage: "verify", status: "running",
    icp, queries: [{ q: "dental clinics", provider: "tavily", done: true, ok: true }], counters: { searched: 1 }, attempts: 0,
  };
  const deps = {
    now: () => NOW,
    concurrency: 2,
    holdsLease: () => true,
    leadByDomain: async () => null,
    // A model call in a list sweep is the failure this whole file exists to catch.
    chat: async (...a: any[]) => { calls.chat.push(a); throw new Error("a list sweep must not call a model"); },
    allowance: async () => 100,
    store: {
      itemsAt: async () => [],
      runItems: async () => items,
      setItem: async (id: number, patch: any) => {
        calls.setItem.push({ id, ...patch });
        const it = items.find((x) => x.id === id);
        if (it) Object.assign(it, patch);
      },
      updateRun: async (_id: string, _fence: number, patch: any) => { if (patch.stage) calls.stage.push(patch.stage); return true; },
      findingsFor: async () => [],
      runCostMicroUsd: async () => 0,
      finishRun: async (_o: string, _i: string, _f: number, p: any) => { calls.finished.push(p); return true; },
    },
  } as unknown as PipelineDeps;
  return { run, deps, calls, items };
}

const verified = (id: number): Item => ({ id, stage: "verified", prospectId: id + 500, prospect: { id: id + 500, domain: `clinic${id}.in`, status: "verified", ready: false, profile: {}, fit: null } });

describe("bulk list mode", () => {
  it("reads the mode off the run, and anything without one is a deep search", () => {
    expect(runModeOf({ mode: "list" })).toBe("list");
    expect(runModeOf({ mode: "deep" })).toBe("deep");
    // A row written before this column existed, and a run object that simply doesn't carry it.
    expect(runModeOf({ mode: null })).toBe("deep");
    expect(runModeOf({})).toBe("deep");
  });

  it("a sweep goes straight from verify to finalize, never through enrich or research", async () => {
    const { run, deps, calls } = harness("list", [verified(1)]);
    await stepRun(run, Date.now() + 60_000, deps);
    expect(calls.stage).toEqual(["finalize"]);
    expect(calls.chat).toEqual([]);
  });

  it("a deep search still goes verify → enrich, exactly as before", async () => {
    const { run, deps, calls } = harness("deep", [verified(1)]);
    await stepRun(run, Date.now() + 60_000, deps);
    expect(calls.stage).toEqual(["enrich"]);
  });

  // The money question: a verified company in a sweep is the RESULT, not a company that ran out of budget. Were it
  // rejected, every sweep would hand back an empty list and the mode would be worthless.
  it("finalize keeps a sweep's verified companies as results, unscored and not rejected", async () => {
    const { run, deps, calls, items } = harness("list", [verified(1), verified(2), verified(3)]);
    run.stage = "finalize";
    expect(await stepRun(run, Date.now() + 60_000, deps)).toBe("done");
    expect(items.map((i) => i.stage)).toEqual(["done", "done", "done"]);
    expect(items.map((i) => i.errorCode)).toEqual(["not_researched", "not_researched", "not_researched"]);
    expect(calls.setItem.some((c) => c.stage === "rejected")).toBe(false);
    expect(calls.finished[0]).toMatchObject({ status: "done" });
    expect(calls.chat).toEqual([]);
  });

  it("a deep search's verified-but-unresearched companies are still closed as out of budget", async () => {
    const { run, deps, items } = harness("deep", [verified(1)]);
    run.stage = "finalize";
    await stepRun(run, Date.now() + 60_000, deps);
    expect(items[0]).toMatchObject({ stage: "rejected", errorCode: "budget" });
  });

  // A sweep asks for up to 50 companies, so its verify budget is the wide one; the 10-company cap exists to limit
  // RESEARCH cost, which a sweep never incurs.
  it("a sweep's requested quantity drives a far wider verify budget than a deep search's ten", async () => {
    const { runBudget } = await import("@shared/prospect");
    expect(runBudget(50).verify).toBe(120);
    expect(runBudget(10).verify).toBe(40);
  });
});
