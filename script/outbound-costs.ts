/**
 * AI Outbound cost and budget report. READ-ONLY: one read-only database session, no writes, no provider calls.
 *
 *   npx tsx --env-file=.env script/outbound-costs.ts [days]        (default 14 days, UTC)
 *
 * Reads provider_calls (web searches and lookups), llm_calls (model spend) and prospect_runs (searches people
 * started), and prints: per UTC day, searches, runs and spend against the platform caps; the cost of a completed run;
 * consumption per workspace over 30 days; and provider errors. The caps shown are the ones in THIS process's
 * environment (the defaults when unset), which may differ from production's: check Render for the live values.
 *
 * Dev and production share one Neon database: this reads production. Workspace ids are shortened; no prospect,
 * request or contact data is printed.
 */
import pg from "pg";
import { globalDailySpendMicroUsd, OUTBOUND_TASKS, poolDailySpendMicroUsd } from "../shared/llm-cost";
import { dailyRunLimit, dailySearchLimit, globalSearchLimit } from "../server/outbound/limits";

pg.types.setTypeParser(1114, (v: string) => new Date(v.replace(" ", "T") + "Z"));

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();
const days = Math.min(90, Math.max(1, Number(process.argv[2]) || 14));
const usd = (micro: number) => `$${(Number(micro) / 1_000_000).toFixed(3)}`;
const pct = (n: number, d: number) => (d > 0 ? `${Math.round((100 * n) / d)}%` : "-");
const short = (id: string) => (id ? `${id.slice(0, 8)}…` : "?");
const quantile = (xs: number[], q: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

async function main() {
  const c = new pg.Client({ connectionString: url, options: "-c TimeZone=UTC" });
  await c.connect();
  await c.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
  const rows = async (text: string, p: unknown[] = []) => (await c.query(text, p)).rows;
  const since = `now() - make_interval(days => $1)`;
  const outboundTasks = [...OUTBOUND_TASKS];

  const caps = { searches: globalSearchLimit(), overall: globalDailySpendMicroUsd(), outbound: poolDailySpendMicroUsd("outbound"), sales: poolDailySpendMicroUsd("sales") };
  console.log(`AI Outbound costs on ${host}, last ${days} days (UTC), read-only`);
  console.log(`Caps in this environment: ${caps.searches} web searches/day, model ${usd(caps.overall)}/day overall, outbound pool ${usd(caps.outbound)}, sales pool ${usd(caps.sales)}; per workspace ${dailyRunLimit()} runs/day, ${dailySearchLimit()} searches/day\n`);

  const perDay = await rows(`
    WITH d AS (SELECT generate_series(date_trunc('day', now() - make_interval(days => $1 - 1)), date_trunc('day', now()), interval '1 day') AS day)
    SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
      (SELECT count(*)::int FROM provider_calls p WHERE p.operation = 'search' AND date_trunc('day', p.created_at) = d.day) AS searches,
      (SELECT count(*)::int FROM provider_calls p WHERE p.operation = 'search' AND NOT p.ok AND date_trunc('day', p.created_at) = d.day) AS search_errors,
      (SELECT COALESCE(sum(cost_micro_usd), 0)::bigint FROM provider_calls p WHERE date_trunc('day', p.created_at) = d.day) AS provider_cost,
      (SELECT COALESCE(sum(cost_micro_usd), 0)::bigint FROM llm_calls l WHERE l.task = ANY($2) AND date_trunc('day', l.created_at) = d.day) AS llm_outbound,
      (SELECT COALESCE(sum(cost_micro_usd), 0)::bigint FROM llm_calls l WHERE NOT (l.task = ANY($2)) AND date_trunc('day', l.created_at) = d.day) AS llm_sales,
      (SELECT count(*)::int FROM prospect_runs r WHERE date_trunc('day', r.created_at) = d.day) AS runs,
      (SELECT count(*)::int FROM prospect_runs r WHERE r.status = 'done' AND date_trunc('day', r.created_at) = d.day) AS runs_done,
      (SELECT count(*)::int FROM prospect_runs r WHERE r.status = 'failed' AND date_trunc('day', r.created_at) = d.day) AS runs_failed,
      (SELECT count(*)::int FROM prospect_runs r WHERE r.counters->>'stoppedBy' = 'global_limit' AND date_trunc('day', r.created_at) = d.day) AS stopped_global
    FROM d ORDER BY d.day`, [days, outboundTasks]);
  console.log("Day         searches (err)  cap-used  runs done/failed/stopped-by-cap   model outbound   model sales   overall-used  providers");
  for (const r of perDay) {
    const llm = Number(r.llm_outbound) + Number(r.llm_sales);
    console.log(`${r.day}  ${String(r.searches).padStart(5)} (${String(r.search_errors).padStart(3)})  ${pct(r.searches, caps.searches).padStart(8)}  ${String(r.runs).padStart(4)} ${String(r.runs_done).padStart(4)}/${r.runs_failed}/${r.stopped_global}`.padEnd(70)
      + `${usd(r.llm_outbound).padStart(9)} (${pct(Number(r.llm_outbound), caps.outbound)})  ${usd(r.llm_sales).padStart(9)} (${pct(Number(r.llm_sales), caps.sales)})  ${pct(llm, caps.overall).padStart(6)}  ${usd(r.provider_cost)}`);
  }

  const done = await rows(`
    SELECT r.id, COALESCE((r.counters->>'searched')::int, 0) AS searched, r.quantity,
      (SELECT COALESCE(sum(cost_micro_usd), 0)::bigint FROM llm_calls l WHERE l.run_id = r.id) AS llm,
      (SELECT COALESCE(sum(cost_micro_usd), 0)::bigint FROM provider_calls p WHERE p.run_id = r.id) AS prov,
      (SELECT count(*)::int FROM provider_calls p WHERE p.run_id = r.id AND p.operation = 'search') AS searches
    FROM prospect_runs r WHERE r.status = 'done' AND r.created_at >= ${since}`, [days]);
  const total = done.map((r) => Number(r.llm) + Number(r.prov));
  console.log(`\nCompleted runs: ${done.length}`);
  if (done.length) {
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    console.log(`  cost per run: avg ${usd(avg(total))}, p50 ${usd(quantile(total, 0.5))}, p90 ${usd(quantile(total, 0.9))}, max ${usd(Math.max(...total))}`);
    console.log(`  of which model ${usd(avg(done.map((r) => Number(r.llm))))}, providers ${usd(avg(done.map((r) => Number(r.prov))))} on average`);
    const s = done.map((r) => Number(r.searches));
    console.log(`  web searches per run: avg ${avg(s).toFixed(1)}, p90 ${quantile(s, 0.9)}, max ${Math.max(...s)}`);
    console.log(`  => runs a day the search cap allows: about ${Math.floor(caps.searches / Math.max(1, avg(s)))}; the outbound model pool: about ${Math.floor(caps.outbound / Math.max(1, avg(done.map((r) => Number(r.llm)))))}`);
  }

  const ws = await rows(`
    SELECT r.organization_id AS org, count(*)::int AS runs,
      count(*) FILTER (WHERE r.status = 'running' OR COALESCE((r.counters->>'searched')::int, 0) > 0)::int AS credits,
      (SELECT count(*)::int FROM provider_calls p WHERE p.organization_id = r.organization_id AND p.operation = 'search' AND p.created_at >= now() - interval '30 days') AS searches,
      (SELECT COALESCE(sum(cost_micro_usd), 0)::bigint FROM llm_calls l WHERE l.organization_id = r.organization_id AND l.task = ANY($1) AND l.created_at >= now() - interval '30 days') AS llm
    FROM prospect_runs r WHERE r.created_at >= now() - interval '30 days' GROUP BY 1 ORDER BY credits DESC, runs DESC LIMIT 20`, [outboundTasks]);
  console.log(`\nWorkspaces, last 30 days (top 20 by credits used): ${ws.length}`);
  for (const w of ws) console.log(`  ${short(w.org)}  credits ${String(w.credits).padStart(3)}  runs ${String(w.runs).padStart(3)}  searches ${String(w.searches).padStart(4)}  outbound model ${usd(w.llm)}`);

  const errs = await rows(`
    SELECT provider, operation, COALESCE(error_code, '?') AS code, count(*)::int AS n FROM provider_calls
    WHERE NOT ok AND created_at >= ${since} GROUP BY 1, 2, 3 ORDER BY n DESC LIMIT 15`, [days]);
  console.log(`\nProvider errors (top 15):${errs.length ? "" : " none"}`);
  for (const e of errs) console.log(`  ${e.provider}/${e.operation}  ${e.code}  × ${e.n}`);
  const llmErr = await rows(`SELECT task, COALESCE(error_code, '?') AS code, count(*)::int AS n FROM llm_calls WHERE NOT ok AND created_at >= ${since} GROUP BY 1, 2 ORDER BY n DESC LIMIT 10`, [days]);
  console.log(`Model call errors (top 10):${llmErr.length ? "" : " none"}`);
  for (const e of llmErr) console.log(`  ${e.task}  ${e.code}  × ${e.n}`);

  await c.end();
  console.log("\nNothing was changed.");
}

main().then(() => process.exit(0), (e) => { console.error((e as Error).message); process.exit(1); });
