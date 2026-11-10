/**
 * The map half of the combined search, against a fake store and a fake listings source.
 *
 * The rules this guards are Google's, not ours: a listing's content may not be stored or sent to a model. So the
 * only things that may leave this function are the website it points at and the place ID as provenance — never the
 * listing's name, address, phone or category. Pure unit test: no network, no model, no database.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { icpSchema } from "@shared/icp";
import type { PlaceListing } from "../discovery/google-places";
import type { PipelineDeps, RunCountersExt } from "./pipeline";

// pipeline.ts transitively imports the db module, which refuses to load without a DATABASE_URL. The fake store
// below means no query ever runs, so a placeholder satisfies the import guard.
let localScan: typeof import("./pipeline").localScan;
let computeCounters: typeof import("./pipeline").computeCounters;
beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused";
  ({ localScan, computeCounters } = await import("./pipeline"));
});

const NOW = new Date("2026-11-10T12:00:00Z");
const listing = (over: Partial<PlaceListing> = {}): PlaceListing => ({
  placeId: "ChIJaaaaaaaaaaaaaaaaaaaaaaa",
  name: "Pearl Dental Clinic", address: "12 Hill Cart Road, Siliguri", category: "Dental clinic",
  website: "https://pearldental.in/", domain: "pearldental.in", phone: "+91 90000 00000", ...over,
});

function harness(listings: PlaceListing[] | Error, opts: { provider?: boolean; reservation?: number | null | "workspace" } = {}) {
  const calls: Record<string, any[]> = { upsert: [], items: [], reserve: [], provider: [], query: [], settle: [] };
  let nextId = 200;
  const deps = {
    now: () => NOW,
    localProvider: () =>
      opts.provider === false
        ? null
        : {
            name: "google_places",
            searchText: async (q: string, o: unknown) => { calls.query.push({ q, o }); if (listings instanceof Error) throw listings; return listings; },
          },
    store: {
      reserveSearch: async (o: any) => { calls.reserve.push(o); return opts.reservation === undefined ? 1 : opts.reservation; },
      // settledSearch settles every reserved call; a fake store missing it would surface only as a caught
      // "error:TypeError" on the scan, which is indistinguishable from a provider failure. Hence the assertions
      // below that the scan recorded no error at all.
      settleProviderCall: async (o: any) => { calls.settle.push(o); },
      upsertProspect: async (_org: string, c: any) => { calls.upsert.push(c); return { id: nextId++, domain: c.domain }; },
      addRunItem: async (i: any) => { calls.items.push(i); },
      recordProviderCall: async (o: any) => { calls.provider.push(o); },
    },
  } as unknown as PipelineDeps;
  return { deps, calls };
}
const run = { id: "pr_local", organizationId: "org-local" };
const icp = (over: object = {}) =>
  icpSchema.parse({ industry: "dental clinic", locations: ["Siliguri"], countries: ["IN"], ...over });

describe("the map scan", () => {
  it("seeds a listing's website, and keeps nothing else the listing said", async () => {
    const { deps, calls } = harness([listing()]);
    const counters: RunCountersExt = {} as RunCountersExt;
    await localScan(run, icp(), counters, deps);

    expect(counters.localScan).toMatchObject({ done: true, listings: 1, seeded: 1, noWebsite: 0 });
    const saved = calls.upsert[0];
    expect(saved).toMatchObject({ domain: "pearldental.in", name: "pearldental.in", website: "https://pearldental.in/" });
    // The name is the DOMAIN, never the listing's name; the pipeline learns the real name from the site itself.
    expect(saved.name).not.toContain("Pearl");
    const blob = JSON.stringify(saved);
    for (const leaked of ["Pearl Dental Clinic", "Hill Cart Road", "+91 90000 00000", "Dental clinic"]) {
      expect(blob).not.toContain(leaked);
    }
    expect(saved.sources[0]).toMatchObject({ provider: "google_places", placeId: "ChIJaaaaaaaaaaaaaaaaaaaaaaa" });
    expect(saved.sources[0].url).toBe("https://www.google.com/maps/place/?q=place_id:ChIJaaaaaaaaaaaaaaaaaaaaaaa");
    expect(calls.items[0]).toMatchObject({ runId: "pr_local", orgId: "org-local", prospectId: 200, stage: "found" });
  });

  it("searches for the ICP's trade in the ICP's place, in the ICP's country", async () => {
    const { deps, calls } = harness([]);
    const counters: RunCountersExt = {} as RunCountersExt;
    await localScan(run, icp(), counters, deps);
    expect(calls.query[0].q).toBe("dental clinic in Siliguri");
    expect(calls.query[0].o).toMatchObject({ regionCode: "IN" });
    expect(counters.localScan?.error).toBeUndefined();
    expect(calls.settle).toHaveLength(1);
  });

  it("skips a listing with no website: there is nothing to research", async () => {
    const { deps, calls } = harness([listing({ website: null, domain: null }), listing({ placeId: "ChIJbbbbbbbbbbbbbbbbbbbbbbb", website: "https://smilecare.in/" })]);
    const counters: RunCountersExt = {} as RunCountersExt;
    await localScan(run, icp(), counters, deps);
    expect(counters.localScan).toMatchObject({ listings: 2, seeded: 1, noWebsite: 1 });
    expect(calls.upsert).toHaveLength(1);
    expect(calls.upsert[0].domain).toBe("smilecare.in");
  });

  it("seeds one company once, however many listings point at the same site", async () => {
    const { deps, calls } = harness([listing(), listing({ placeId: "ChIJccccccccccccccccccccccc", website: "https://pearldental.in/contact" })]);
    const counters: RunCountersExt = {} as RunCountersExt;
    await localScan(run, icp(), counters, deps);
    expect(counters.localScan).toMatchObject({ seeded: 1 });
    expect(calls.upsert).toHaveLength(1);
  });

  it("does nothing at all without a source, a place or a country — the web search alone, as before", async () => {
    for (const [label, d, i] of [
      ["no source", harness([], { provider: false }), icp()],
      ["no place", harness([listing()]), icp({ locations: [] })],
      ["no country", harness([listing()]), icp({ countries: [] })],
    ] as const) {
      const counters: RunCountersExt = {} as RunCountersExt;
      await localScan(run, i, counters, (d as any).deps);
      expect(counters.localScan, label).toEqual({ done: true });
      expect((d as any).calls.upsert, label).toHaveLength(0);
      expect((d as any).calls.reserve, label).toHaveLength(0);
    }
  });

  it("is skipped, not charged, when the platform's daily map budget or the workspace ceiling is spent", async () => {
    for (const [reservation, error] of [[null, "global_limit"], ["workspace", "workspace_budget"]] as const) {
      const { deps, calls } = harness([listing()], { reservation });
      const counters: RunCountersExt = {} as RunCountersExt;
      await localScan(run, icp(), counters, deps);
      expect(counters.localScan).toMatchObject({ done: true, error });
      expect(calls.query).toHaveLength(0);
      expect(calls.upsert).toHaveLength(0);
    }
  });

  it("a failing source records its type and never its message, and never stops the run", async () => {
    const { deps, calls } = harness(Object.assign(new Error("places said: Pearl Dental Clinic, 12 Hill Cart Road"), { name: "TypeError" }));
    const counters: RunCountersExt = {} as RunCountersExt;
    await expect(localScan(run, icp(), counters, deps)).resolves.toBeUndefined();
    expect(counters.localScan?.error).toBe("error:TypeError");
    expect(JSON.stringify(counters.localScan)).not.toContain("Hill Cart Road");
    expect(calls.upsert).toHaveLength(0);
  });

  it("marks itself done so a resumed run never searches the map twice", async () => {
    const { deps } = harness([listing()]);
    const counters: RunCountersExt = {} as RunCountersExt;
    await localScan(run, icp(), counters, deps);
    expect(counters.localScan?.done).toBe(true);
  });

  // The runner checkpoints after every step that has more to do, and a checkpoint REPLACES the run's counters with
  // freshly computed ones. A recount that dropped the marker would make the next search step scan the map again and
  // pay again — up to once per query. The marker is a fact of the run, so the recount has to carry it.
  it("the done marker survives a mid-run recount, so a checkpoint can't make the run pay twice", async () => {
    const store = { runItems: async () => [], findingsFor: async () => [], runCostMicroUsd: async () => 0 } as any;
    const deps = { now: () => NOW, store } as unknown as PipelineDeps;
    const before = { done: true, listings: 7, seeded: 2, noWebsite: 5 };
    const recounted = await computeCounters({ id: "pr_test", organizationId: "org-local", counters: { localScan: before } } as any, deps);
    expect(recounted.localScan).toEqual(before);
  });
});
