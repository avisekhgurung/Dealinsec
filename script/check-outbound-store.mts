/**
 * The real SQL behind the prospect-run lease (server/outbound/store.ts), against the LOCAL test database only:
 * the atomic claim, the claim number (fence) on every write, renew/park/release, the one-statement finish, and that
 * the stored times are UTC whatever the process's timezone is (run it with TZ=America/Los_Angeles to prove it), and the
 * platform-wide search and model budgets under real concurrency (separate connections, one advisory lock).
 *   TZ=America/Los_Angeles DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/check-outbound-store.mts
 */
import { randomUUID } from "node:crypto";
import { LOCAL_TEST_DATABASE_URL, requireLocalDatabaseUrl } from "./local-db-guard.ts";

process.env.DATABASE_URL = requireLocalDatabaseUrl("check-outbound-store.mts") || LOCAL_TEST_DATABASE_URL;
const { outboundStore: store } = await import("../server/outbound/store.ts");
const pg = (await import("pg")).default;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `  -> ${detail}`}`); if (!ok) failed++; };
const ORG = `chk-${randomUUID().slice(0, 8)}`;
const iso = (d: Date) => d.toISOString();
const lease = async (id: string) => (await db.query(`SELECT to_char(lease_until,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS l FROM prospect_runs WHERE id=$1`, [id])).rows[0].l as string | null;
const mkRun = async (key: string) => {
  const id = `pr_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  await store.createRun({ id, orgId: ORG, userId: "u", by: "user", request: "x", icp: {}, quantity: 3, idemKey: key + randomUUID().slice(0, 8), queries: [], now: new Date() });
  return id;
};

try {
  console.log(`process timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone} (offset ${new Date().getTimezoneOffset()} min)`);
  const id = await mkRun("a");
  const t0 = new Date(Date.UTC(2026, 9, 9, 10, 0, 0));
  const a = await store.claimRun(t0, 90_000);
  check("a free run is claimed with claim number 1", a?.id === id && a.fence === 1, JSON.stringify(a && { id: a.id, fence: a.fence }));
  check("the stored lease is UTC (now + 90 s), whatever the process timezone", (await lease(id)) === iso(new Date(t0.getTime() + 90_000)), String(await lease(id)));
  check("a second claim while the lease is held finds nothing", (await store.claimRun(new Date(t0.getTime() + 1000), 90_000)) === null);
  const b = await store.claimRun(new Date(t0.getTime() + 91_000), 90_000);
  check("after the lease expires it is claimed again, claim number 2", b?.id === id && b.fence === 2, JSON.stringify(b && b.fence));
  check("the old holder can't write, renew, park, release or finish", !(await store.updateRun(id, 1, { stage: "verify" })) && !(await store.setLease(id, 1, null)) && !(await store.setLease(id, 1, new Date(t0.getTime() + 9e6))) && !(await store.finishRun(ORG, id, 1, { status: "done", counters: {}, costMicroUsd: 0, errorCode: null, now: t0 })));
  check("…and the new holder's lease and stage are untouched", (await lease(id)) === iso(new Date(t0.getTime() + 91_000 + 90_000)) && (await store.getRun(ORG, id))!.stage === "search");
  check("the new holder can write, renew and park", (await store.updateRun(id, 2, { stage: "verify", updatedAt: t0 })) && (await store.setLease(id, 2, new Date(t0.getTime() + 200_000))) && (await lease(id)) === iso(new Date(t0.getTime() + 200_000)));
  const wake = await store.nextLeaseExpiry(new Date(t0.getTime() + 100_000));
  check("the next wake is the parked run's lease end, in UTC", wake?.getTime() === t0.getTime() + 200_000, String(wake && wake.toISOString()));
  check("nothing to wake for once that time has passed", (await store.nextLeaseExpiry(new Date(t0.getTime() + 300_000))) === null);
  check("a parked run can't be claimed early", (await store.claimRun(new Date(t0.getTime() + 150_000), 90_000)) === null);
  check("release clears the lease", (await store.setLease(id, 2, null)) && (await lease(id)) === null);

  await store.setRunStatus(ORG, id, "running", "cancelled", new Date(), "cancelled"); // out of the way: only the three below are claimable
  // Many workers claiming at once: each available run goes to exactly one of them (FOR UPDATE SKIP LOCKED).
  const many = await Promise.all([mkRun("b1"), mkRun("b2"), mkRun("b3")]);
  const tNow = new Date();
  const got = (await Promise.all(Array.from({ length: 9 }, () => store.claimRun(tNow, 90_000)))).filter((r) => r && r.organizationId === ORG) as NonNullable<Awaited<ReturnType<typeof store.claimRun>>>[];
  check("nine simultaneous claims hand each of three runs to exactly one worker", got.length === 3 && new Set(got.map((r) => r.id)).size === 3 && many.every((m) => got.some((g) => g.id === m)), JSON.stringify(got.map((r) => r.id)));
  check("each of those claims has its own claim number 1", got.every((g) => g.fence === 1));
  const id3 = await mkRun("c");
  await db.query(`UPDATE prospect_runs SET lease_until=NULL WHERE id=$1`, [id3]);
  const c = (await store.claimRun(new Date(), 90_000)) ?? (await store.claimRun(new Date(Date.now() + 1e6), 90_000));
  const mineC = c && c.organizationId === ORG ? c : null;
  if (mineC) {
    const fin = await store.finishRun(ORG, mineC.id, mineC.fence, { status: "failed", counters: { stoppedBy: "x" }, costMicroUsd: 42, errorCode: "search_unavailable", now: new Date() });
    const row = (await db.query(`SELECT stage, status, error_code, cost_micro_usd, lease_until, finished_at FROM prospect_runs WHERE id=$1`, [mineC.id])).rows[0];
    check("finishing is ONE statement: stage, status, error, cost, finish time and lease together", fin && row.stage === "done" && row.status === "failed" && row.error_code === "search_unavailable" && row.cost_micro_usd === 42 && row.lease_until === null && !!row.finished_at, JSON.stringify(row));
    check("a finished run can't be finished or written again", !(await store.finishRun(ORG, mineC.id, mineC.fence, { status: "done", counters: {}, costMicroUsd: 0, errorCode: null, now: new Date() })) && !(await store.updateRun(mineC.id, mineC.fence, { stage: "x" })));
  }
  const cancelled = await mkRun("d");
  await store.setRunStatus(ORG, cancelled, "running", "cancelled", new Date(), "cancelled");
  check("a cancelled run is never claimed", (await db.query(`SELECT status FROM prospect_runs WHERE id=$1`, [cancelled])).rows[0].status === "cancelled" && !(await store.updateRun(cancelled, 0, { stage: "x" })));

  // ── the platform-wide budgets: concurrent reservations over separate connections never pass the limit ──
  // Searches are dated in a far-future day so nothing else in this database counts; the model budget is measured from now.
  const day = new Date(Date.UTC(2099, 0, 1)), at = new Date(Date.UTC(2099, 0, 1, 0, 0, 1));
  const grants = await Promise.all(Array.from({ length: 12 }, () => store.reserveSearch({ orgId: ORG, runId: null, provider: "chk", costMicroUsd: 8000, limit: 5, since: day, now: at })));
  const rows = (await db.query(`SELECT id, ok, error_code FROM provider_calls WHERE organization_id=$1 AND operation='search'`, [ORG])).rows;
  check("twelve searches reserved at once against a limit of five: exactly five granted, five rows", grants.filter((g) => g !== null).length === 5 && rows.length === 5, JSON.stringify({ granted: grants.filter((g) => g !== null).length, rows: rows.length }));
  const first = grants.find((g) => g !== null)!;
  await store.settleProviderCall(first, { ok: false, errorCode: "rate_limited", latencyMs: 12, costMicroUsd: 8000 });
  const settled = (await db.query(`SELECT ok, error_code, latency_ms FROM provider_calls WHERE id=$1`, [first])).rows[0];
  check("a settled search keeps one row (no second insert) with what really happened; a failure still counts", settled.error_code === "rate_limited" && settled.latency_ms === 12 && (await store.reserveSearch({ orgId: ORG, runId: null, provider: "chk", costMicroUsd: 8000, limit: 5, since: day, now: at })) === null);
  const nextDay = new Date(Date.UTC(2099, 0, 2));
  check("the next UTC day starts empty (rollover)", (await store.reserveSearch({ orgId: ORG, runId: null, provider: "chk", costMicroUsd: 8000, limit: 5, since: nextDay, now: new Date(nextDay.getTime() + 1000) })) !== null);
  const { traceStore } = await import("../server/llm/trace-store.ts");
  const since = new Date(Date.now() - 1000);
  const spent0 = Number((await db.query(`SELECT coalesce(sum(cost_micro_usd),0)::bigint n FROM llm_calls WHERE created_at >= $1`, [since.toISOString()])).rows[0].n);
  const row = (cost: number) => ({ organizationId: ORG, userId: null, task: "signals", model: "chk", promptVersion: "chk", tokensIn: 0, tokensOut: 0, latencyMs: 0, costMicroUsd: cost, ok: false, errorCode: "reserved", leadId: null, runId: null });
  const ids = await Promise.all(Array.from({ length: 10 }, () => traceStore.reserve(row(10_000), { limitMicroUsd: spent0 + 35_000, since })));
  check("ten model calls reserved at once with room for three estimates: exactly three granted", ids.filter((x) => x !== null).length === 3, JSON.stringify(ids));
  const one = ids.find((x) => x !== null)!;
  await traceStore.settle(one, { ...row(400), tokensIn: 1000, tokensOut: 100, ok: true, errorCode: null });
  check("settling replaces the estimate with the real cost, which frees room for another call", (await traceStore.reserve(row(10_000), { limitMicroUsd: spent0 + 35_000, since })) !== null);
  check("…and a settled call counts for its workspace's allowance; a reservation in flight doesn't", (await traceStore.count({ orgId: ORG, task: "signals", since })) === 1);
} finally {
  await db.query(`DELETE FROM prospect_runs WHERE organization_id=$1`, [ORG]);
  await db.query(`DELETE FROM provider_calls WHERE organization_id=$1`, [ORG]);
  await db.query(`DELETE FROM llm_calls WHERE organization_id=$1`, [ORG]);
  await db.end();
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
