/**
 * AI League's store against a REAL Postgres: what the database decides.
 *   - concurrent starts: the concurrency cap and the monthly allowance hold (advisory lock with the insert); one run per key
 *   - concurrent claims: a run is held by one worker; a stale worker's write is refused (fence)
 *   - a schedule slot is claimed by one scheduler, and advancing is fenced on the slot
 *   - timestamps round-trip (wake times are real instants)
 * Runs only with MAILBOX_PG_TEST_URL set to a disposable LOCAL database with script/migrate-ai-league.ts applied.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_ = process.env.MAILBOX_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("AI League store (real Postgres)", () => {
  let q: any, mod: typeof import("./store");
  const orgs: string[] = [];
  const org = () => { const o = `t-${randomBytes(5).toString("hex")}`; orgs.push(o); return o; };
  beforeAll(async () => {
    const utc = new URL(URL_!); utc.searchParams.set("options", "-c TimeZone=UTC");
    process.env.DATABASE_URL = utc.toString();
    mod = await import("./store");
    const { default: pg } = await import("pg");
    q = new pg.Client({ connectionString: process.env.DATABASE_URL }); await q.connect();
    const { LEAGUE_DDL } = await import("./ddl");
    for (const s of LEAGUE_DDL) await q.query(s);
  });
  afterAll(async () => {
    for (const o of orgs) for (const t of ["league_run_events", "league_runs", "league_schedules", "league_memory", "league_threads"]) await q.query(`DELETE FROM ${t} WHERE organization_id = $1`, [o]).catch(() => {});
    await q?.end();
  });
  const s = () => mod.leagueStore;
  const newRun = (orgId: string, over: Record<string, unknown> = {}) => s().createRun({ id: `lr_${randomBytes(12).toString("hex")}`, orgId, userId: "u", bot: "zee", task: "zee.briefing", input: {}, idemKey: randomUUID(), source: "page", now: new Date(), limits: { monthly: { since: new Date(Date.now() - 30 * 86_400_000), max: 100 }, concurrent: 2 }, ...over } as any)
    .then((r) => r, (e) => (e instanceof mod.RunLimit ? e.kind : Promise.reject(e)));

  it("concurrent starts never pass the concurrency cap; the same key creates one run", async () => {
    const o = org();
    const out = await Promise.all(Array.from({ length: 6 }, () => newRun(o)));
    expect(out.filter((x) => typeof x === "object")).toHaveLength(2);
    expect(out.filter((x) => x === "concurrent")).toHaveLength(4);
    const o2 = org();
    const same = await Promise.all(Array.from({ length: 4 }, () => newRun(o2, { idemKey: "page:one" })));
    const ids = new Set(same.map((x: any) => x.run.id));
    expect(ids.size).toBe(1);
    expect(same.filter((x: any) => !x.existing)).toHaveLength(1);
    // At a cap of one, a double click still gets the first run back, not a "busy" refusal.
    const o3 = org();
    const one = { monthly: { since: new Date(Date.now() - 30 * 86_400_000), max: 100 }, concurrent: 1 };
    const clicks = await Promise.all(Array.from({ length: 4 }, () => newRun(o3, { idemKey: "page:dbl", limits: one })));
    expect(clicks.every((x) => typeof x === "object")).toBe(true);
    expect(new Set(clicks.map((x: any) => x.run.id)).size).toBe(1);
  });

  it("the monthly allowance counts real work, not runs cancelled before they started", async () => {
    const o = org();
    const limits = { monthly: { since: new Date(Date.now() - 30 * 86_400_000), max: 2 }, concurrent: 10 };
    const a: any = await newRun(o, { limits });
    await s().requestCancel(o, "u", a.run.id, new Date()); // cancelled before it started: doesn't count
    await newRun(o, { limits }); await newRun(o, { limits });
    expect(await newRun(o, { limits })).toBe("monthly");
  });

  it("one worker holds a run; a stale worker's write is refused; the wake time is a real instant", async () => {
    // Claiming is global (a worker serves every workspace): park the earlier cases' runs so only this one is claimable.
    await q.query(`UPDATE league_runs SET status = 'cancelled', lease_until = NULL WHERE organization_id = ANY($1) AND status IN ('queued', 'running', 'waiting')`, [orgs]);
    const o = org();
    const { run }: any = await newRun(o);
    const claims = await Promise.all([s().claim(new Date(), 90_000), s().claim(new Date(), 90_000), s().claim(new Date(), 90_000)]);
    const mine = claims.filter((c) => c && c.id === run.id);
    expect(mine).toHaveLength(1);
    const c = mine[0]!;
    expect(c.status).toBe("running");
    const until = new Date(Date.now() + 60_000);
    expect(await s().setLease(run.id, c.fence, until)).toBe(true);
    const wake = await s().nextWake(new Date());
    expect(wake).toBeInstanceOf(Date);
    expect(Math.abs(wake!.getTime() - until.getTime())).toBeLessThan(1000);
    await q.query(`UPDATE league_runs SET lease_until = now() - interval '1 second' WHERE id = $1`, [run.id]);
    const taken = await s().claim(new Date(), 90_000);
    expect(taken?.id).toBe(run.id);
    expect(await s().save(run.id, c.fence, { status: "completed" }, new Date())).toBe(false); // the old claim
    expect(await s().save(run.id, taken!.fence, { status: "completed", report: { headline: "ok" } }, new Date())).toBe(true);
    expect(await s().save(run.id, taken!.fence, { status: "failed" }, new Date())).toBe(false); // terminal stays terminal
  });

  it("a due schedule slot is claimed once, and advancing is fenced on the slot", async () => {
    const o = org();
    const slot = new Date(Date.now() - 60_000);
    const sch = await s().createSchedule({ organizationId: o, userId: "u", bot: "zee", task: "zee.briefing", input: {}, frequency: "daily", timeOfDay: "09:00", weekday: null, timezone: "Asia/Kolkata", status: "active", nextRunAt: slot, now: new Date() });
    const claims = (await Promise.all([1, 2, 3].map(() => s().claimDueSchedule(new Date(), 60_000)))).filter((x) => x?.id === sch.id);
    expect(claims).toHaveLength(1);
    const next = new Date(Date.now() + 86_400_000);
    await s().advanceSchedule(sch.id, new Date(slot.getTime() + 5), { nextRunAt: next, lastRunId: "lr_a", now: new Date() }); // wrong slot: nothing
    expect((await s().getSchedule(o, "u", sch.id))!.lastRunId).toBeNull();
    await s().advanceSchedule(sch.id, claims[0]!.nextRunAt!, { nextRunAt: next, lastRunId: "lr_a", now: new Date() });
    const after = (await s().getSchedule(o, "u", sch.id))!;
    expect(after).toMatchObject({ lastRunId: "lr_a", leaseUntil: null });
    expect(Math.abs(after.nextRunAt!.getTime() - next.getTime())).toBeLessThan(1000);
  });
});
