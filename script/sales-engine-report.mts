/**
 * Operator report: what research and outreach cost, against what it produced. READ-ONLY (one READ ONLY transaction);
 * costs are ESTIMATES from the app's own price table (llm_calls.cost_micro_usd, provider_calls.cost_micro_usd), not the
 * providers' bills. Prints per workspace for the window:
 *   researched companies · opportunities (an angle) · replies · est. model cost · est. provider cost
 *   cost per researched company · per opportunity · per reply
 * and, for the companies first FOUND in the window (bulk lists included):
 *   discovered · verified site · qualified · ready · with a named person · with a verified email (contact coverage)
 *   est. spend per discovered · per qualified · per ready company, and the owner's plan
 * Workspace ids only, never names. Point DATABASE_URL at the database you mean; nothing is written.
 *
 * What it counts: every model call the app made (each try of a retried step is its own row, failed ones included);
 * reservations still open (a call in flight, or one a crash never settled) separately, at their reserved estimate;
 * research-provider calls by operation (search, page, contact, company, local_search) at the app's price table.
 * What it can't count: cached-input discounts (input is priced as a cache miss, an upper bound); per-model prices (one
 * price table for every DeepSeek model); a provider's own retry inside one call (only the final usage is reported);
 * free reads (the built-in page reader, robots.txt); WhatsApp conversation charges billed by Meta (recorded at 0);
 * Gmail sends (free); hosting.
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/sales-engine-report.mts --days 30 [--org <id>]
 */
const pg = (await import("pg")).default;

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const days = Math.min(365, Math.max(1, Number(arg("days") ?? 30) || 30));
const org = arg("org") ?? null;
if (!process.env.DATABASE_URL) { console.error("Set DATABASE_URL to the database to read."); process.exit(2); }

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN READ ONLY");
  const since = new Date(Date.now() - days * 86_400_000);
  const { rows } = await db.query(`
    WITH orgs AS (
      SELECT DISTINCT organization_id AS o FROM prospects WHERE researched_at >= $1 AND ($2::text IS NULL OR organization_id = $2)
    ),
    research AS (
      SELECT organization_id AS o, count(*) AS researched, count(*) FILTER (WHERE angle IS NOT NULL) AS opportunities,
             array_agg(lead_id) FILTER (WHERE lead_id IS NOT NULL) AS leads
      FROM prospects WHERE researched_at >= $1 GROUP BY organization_id
    ),
    replies AS (
      SELECT e.organization_id AS o, count(DISTINCT e.lead_id) AS replied
      FROM outreach_events e JOIN research r ON r.o = e.organization_id AND e.lead_id = ANY(r.leads)
      WHERE e.kind = 'replied' GROUP BY e.organization_id
    ),
    model AS (
      SELECT organization_id AS o,
             sum(cost_micro_usd) FILTER (WHERE error_code IS DISTINCT FROM 'reserved') AS micro,
             count(*) FILTER (WHERE error_code IS DISTINCT FROM 'reserved') AS calls,
             count(*) FILTER (WHERE NOT ok AND error_code IS DISTINCT FROM 'reserved') AS failed,
             sum(cost_micro_usd) FILTER (WHERE error_code = 'reserved') AS reserved_micro
      FROM llm_calls WHERE created_at >= $1 GROUP BY organization_id),
    provider AS (SELECT organization_id AS o, sum(cost_micro_usd) AS micro, count(*) AS calls, string_agg(DISTINCT operation, ',') AS ops FROM provider_calls WHERE created_at >= $1 GROUP BY organization_id),
    wa_replies AS (
      SELECT cm.organization_id AS o, count(DISTINCT cm.lead_id) AS replied
      FROM channel_messages cm JOIN research r ON r.o = cm.organization_id AND cm.lead_id = ANY(r.leads)
      WHERE cm.direction = 'in' GROUP BY cm.organization_id)
    SELECT orgs.o, coalesce(r.researched, 0)::int AS researched, coalesce(r.opportunities, 0)::int AS opportunities,
           greatest(coalesce(rp.replied, 0), coalesce(wa.replied, 0))::int AS replied,
           coalesce(m.micro, 0)::bigint AS model_micro, coalesce(m.calls, 0)::int AS model_calls, coalesce(m.failed, 0)::int AS model_failed, coalesce(m.reserved_micro, 0)::bigint AS reserved_micro,
           coalesce(p.micro, 0)::bigint AS provider_micro, coalesce(p.calls, 0)::int AS provider_calls, coalesce(p.ops, '') AS provider_ops
    FROM orgs LEFT JOIN research r ON r.o = orgs.o LEFT JOIN replies rp ON rp.o = orgs.o LEFT JOIN wa_replies wa ON wa.o = orgs.o LEFT JOIN model m ON m.o = orgs.o LEFT JOIN provider p ON p.o = orgs.o
    ORDER BY researched DESC`, [since.toISOString().replace("T", " ").replace("Z", ""), org]);   // UTC text: the columns are UTC timestamps without a zone
  // Discovery and coverage: every company the workspace FOUND in the window (a bulk list finds many and researches
  // none, so this is counted from when a company was first seen, not from when it was researched).
  const cov = await db.query(`
    WITH found AS (
      SELECT p.id, p.organization_id AS o, p.verified_at IS NOT NULL AND p.status <> 'rejected' AS verified,
             p.status <> 'rejected' AND p.fit->>'verdict' IN ('strong', 'partial') AS qualified, p.ready,
             EXISTS (SELECT 1 FROM prospect_findings f WHERE f.organization_id = p.organization_id AND f.prospect_id = p.id AND f.kind = 'decision_maker') AS person,
             EXISTS (SELECT 1 FROM prospect_findings f WHERE f.organization_id = p.organization_id AND f.prospect_id = p.id AND f.kind = 'decision_maker' AND f.meta->>'emailStatus' = 'verified') AS verified_email
      FROM prospects p WHERE p.created_at >= $1 AND ($2::text IS NULL OR p.organization_id = $2)
    ),
    spend AS (
      SELECT o, sum(micro) AS micro FROM (
        SELECT organization_id AS o, cost_micro_usd AS micro FROM llm_calls WHERE created_at >= $1 AND error_code IS DISTINCT FROM 'reserved'
        UNION ALL SELECT organization_id, cost_micro_usd FROM provider_calls WHERE created_at >= $1) x GROUP BY o
    )
    SELECT f.o, count(*)::int AS discovered, count(*) FILTER (WHERE f.verified)::int AS verified, count(*) FILTER (WHERE f.qualified)::int AS qualified,
           count(*) FILTER (WHERE f.ready)::int AS ready, count(*) FILTER (WHERE f.person)::int AS person, count(*) FILTER (WHERE f.verified_email)::int AS verified_email,
           coalesce(max(s.micro), 0)::bigint AS micro,
           coalesce((SELECT u.plan FROM users u WHERE u.organization_id = f.o AND u.org_role = 'OWNER' LIMIT 1), '?') AS plan
    FROM found f LEFT JOIN spend s ON s.o = f.o GROUP BY f.o ORDER BY discovered DESC`, [since.toISOString().replace("T", " ").replace("Z", ""), org]);
  await db.query("ROLLBACK");

  const usd = (micro: number) => `$${(micro / 1e6).toFixed(4)}`;
  const per = (micro: number, n: number) => (n ? usd(micro / n) : "-");
  console.log(`Window: last ${days} days (since ${since.toISOString().slice(0, 10)}). Costs are estimates from the app's price table, not provider bills.`);
  console.log(["workspace", "researched", "opportunities", "replied", "model est. (calls, failed)", "open reservations", "provider est. (calls: ops)", "per company", "per opportunity", "per reply"].join("\t"));
  let tot = { r: 0, o: 0, rp: 0, m: 0, p: 0, res: 0, calls: 0, failed: 0 };
  for (const x of rows) {
    const m = Number(x.model_micro), p = Number(x.provider_micro), res = Number(x.reserved_micro), all = m + p;
    tot = { r: tot.r + x.researched, o: tot.o + x.opportunities, rp: tot.rp + x.replied, m: tot.m + m, p: tot.p + p, res: tot.res + res, calls: tot.calls + x.model_calls, failed: tot.failed + x.model_failed };
    console.log([String(x.o).slice(0, 12), x.researched, x.opportunities, x.replied, `${usd(m)} (${x.model_calls}, ${x.model_failed})`, usd(res), `${usd(p)} (${x.provider_calls}: ${x.provider_ops || "-"})`, per(all, x.researched), per(all, x.opportunities), per(all, x.replied)].join("\t"));
  }
  const all = tot.m + tot.p;
  console.log(["TOTAL", tot.r, tot.o, tot.rp, `${usd(tot.m)} (${tot.calls}, ${tot.failed})`, usd(tot.res), usd(tot.p), per(all, tot.r), per(all, tot.o), per(all, tot.rp)].join("\t"));
  if (tot.res) console.log("Open reservations are calls in flight or never settled (a crash); they are not in the per-unit figures.");
  console.log("Model cost covers every AI task of these workspaces in the window (research, angles, drafts, chat), so per-company figures are an upper bound for research alone.");

  // Second table: what discovery produced, how reachable it is, and what each step cost (all estimated spend / count).
  const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : "-");
  console.log(`\nDiscovery and coverage, companies first found in the window:`);
  console.log(["workspace", "owner plan", "discovered", "verified site", "qualified (fits)", "ready", "named person", "verified email", "est. spend", "per discovered", "per qualified", "per ready"].join("\t"));
  const t2 = { d: 0, v: 0, q: 0, r: 0, p: 0, e: 0, m: 0 };
  for (const x of cov.rows) {
    const m = Number(x.micro);
    t2.d += x.discovered; t2.v += x.verified; t2.q += x.qualified; t2.r += x.ready; t2.p += x.person; t2.e += x.verified_email; t2.m += m;
    console.log([String(x.o).slice(0, 12), x.plan, x.discovered, `${x.verified} (${pct(x.verified, x.discovered)})`, `${x.qualified} (${pct(x.qualified, x.discovered)})`, x.ready, `${x.person} (${pct(x.person, x.discovered)})`, `${x.verified_email} (${pct(x.verified_email, x.discovered)})`, usd(m), per(m, x.discovered), per(m, x.qualified), per(m, x.ready)].join("\t"));
  }
  console.log(["TOTAL", "", t2.d, `${t2.v} (${pct(t2.v, t2.d)})`, `${t2.q} (${pct(t2.q, t2.d)})`, t2.r, `${t2.p} (${pct(t2.p, t2.d)})`, `${t2.e} (${pct(t2.e, t2.d)})`, usd(t2.m), per(t2.m, t2.d), per(t2.m, t2.q), per(t2.m, t2.r)].join("\t"));
  console.log("Spend here is the workspace's whole estimated spend in the window, so the per-unit figures are upper bounds. \"Verified email\" stays 0 until a contact provider is connected.");
  console.log("Margin: compare a workspace's est. spend with what its plan pays for the same window. Prices and currency conversion are not in this database, so no margin figure is printed.");
} finally {
  await db.end();
}
