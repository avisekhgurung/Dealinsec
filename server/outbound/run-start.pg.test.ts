/**
 * Starting Client Radar runs against a REAL Postgres: concurrent starts in one workspace can't go past its limit
 * together (createRun re-counts under a per-workspace advisory lock with the insert), and another workspace is not
 * held up by it.
 *
 * Runs only with MAILBOX_PG_TEST_URL set to a disposable LOCAL database with the prospect tables. Fresh organization
 * ids per case; only their rows are deleted.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_ = process.env.MAILBOX_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("run start limits (real Postgres)", () => {
  let pg: any, q: any;
  let mod: typeof import("./store");
  const orgs: string[] = [];
  beforeAll(async () => {
    process.env.DATABASE_URL = URL_!;
    mod = await import("./store");
    ({ default: pg } = await import("pg"));
    q = new pg.Client({ connectionString: URL_ }); await q.connect();
  });
  afterAll(async () => {
    for (const o of orgs) await q.query(`DELETE FROM prospect_runs WHERE organization_id = $1`, [o]).catch(() => {});
    await q?.end();
  });

  const start = (org: string, max: number, mode?: "deep" | "list") => mod.outboundStore.createRun({
    id: `pr_${randomUUID()}`, orgId: org, userId: "u", by: "user", request: "x", icp: {}, quantity: 3, mode,
    idemKey: randomUUID(), queries: [], now: new Date(), limits: [{ since: new Date(Date.now() - 86_400_000), max, ...(mode ? { mode } : {}) }],
  }).then(() => "started" as const, (e) => (e instanceof mod.RunLimitReached ? "limit" as const : Promise.reject(e)));

  it("twelve concurrent starts against a limit of 3 start exactly 3", async () => {
    const org = `t-${randomBytes(5).toString("hex")}`; orgs.push(org);
    const out = await Promise.all(Array.from({ length: 12 }, () => start(org, 3)));
    expect(out.filter((x) => x === "started")).toHaveLength(3);
    expect((await q.query(`SELECT count(*)::int AS n FROM prospect_runs WHERE organization_id = $1`, [org])).rows[0].n).toBe(3);
  });

  // The separate allowance, against the real column and the real lock: running out of deep searches must not stop a
  // list sweep, because they are rationed apart. A shared counter here would quietly merge the two pools.
  it("a workspace out of deep searches can still start a list sweep", async () => {
    const org = `t-${randomBytes(5).toString("hex")}`; orgs.push(org);
    expect(await start(org, 1, "deep")).toBe("started");
    expect(await start(org, 1, "deep")).toBe("limit");
    expect(await start(org, 1, "list")).toBe("started");
    expect(await start(org, 1, "list")).toBe("limit");
    const rows = (await q.query(`SELECT mode, count(*)::int AS n FROM prospect_runs WHERE organization_id = $1 GROUP BY mode ORDER BY mode`, [org])).rows;
    expect(rows).toEqual([{ mode: "deep", n: 1 }, { mode: "list", n: 1 }]);
  });

  // A sweep researches nothing, so it must hold none of the researched-prospects allowance; a deep run of the same
  // size holds all of it. Were a sweep to hold its quantity, one wide sweep would eat half of Pro's monthly research.
  it("a list sweep holds none of the researched-prospects allowance; a deep search holds its quantity", async () => {
    const org = `t-${randomBytes(5).toString("hex")}`; orgs.push(org);
    const since = new Date(Date.now() - 86_400_000);
    expect(await start(org, 10, "list")).toBe("started");
    expect(await mod.outboundStore.prospectsHeldSince(org, since)).toBe(0);
    expect(await start(org, 10, "deep")).toBe("started");
    expect(await mod.outboundStore.prospectsHeldSince(org, since)).toBe(3);
  });

  it("one workspace at its limit doesn't block another", async () => {
    const a = `t-${randomBytes(5).toString("hex")}`, b = `t-${randomBytes(5).toString("hex")}`; orgs.push(a, b);
    await start(a, 1);
    expect(await start(a, 1)).toBe("limit");
    expect(await start(b, 1)).toBe("started");
  });
});
