/**
 * Operator report: what research and outreach cost, against what it produced. READ-ONLY (one READ ONLY transaction);
 * costs are ESTIMATES from the app's own price table (llm_calls.cost_micro_usd, provider_calls.cost_micro_usd), not the
 * providers' bills. Prints per workspace for the window:
 *   researched companies · opportunities (an angle) · replies · est. model cost · est. provider cost
 *   cost per researched company · per opportunity · per reply
 * and, for the companies first FOUND in the window (bulk lists included):
 *   discovered · verified site · qualified · ready · with a named person · with a verified email (contact coverage)
 *   est. spend per discovered · per qualified · per ready company, and the owner's plan
 * and, per outreach campaign created in the window: leads · drafted · sent · replied · est. draft cost, per draft, sent, reply
 * and, per workspace: payments completed in the window beside the estimated spend; with --usd-inr <rate>, a gross margin.
 * Workspace ids only, never names. Point DATABASE_URL at the database you mean; nothing is written.
 *
 * What it counts: every model call the app made (each try of a retried step is its own row, failed ones included);
 * reservations still open (a call in flight, or one a crash never settled) separately, at their reserved estimate;
 * research-provider calls by operation (search, page, contact, company, local_search) at the app's price table.
 * What it can't count: cached-input discounts (input is priced as a cache miss, an upper bound); per-model prices (one
 * price table for every DeepSeek model); a provider's own retry inside one call (only the final usage is reported);
 * free reads (the built-in page reader, robots.txt); WhatsApp conversation charges billed by Meta (recorded at 0);
 * Gmail sends (free); hosting.
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/sales-engine-report.mts --days 30 [--org <id>] [--usd-inr <rupees per dollar>]
 */
const pg = (await import("pg")).default;

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const days = Math.min(365, Math.max(1, Number(arg("days") ?? 30) || 30));
const org = arg("org") ?? null;
/** Rupees per US dollar, for the margin line only. Not guessed: without it, revenue and spend are printed side by side and no margin is worked out. */
const usdInr = (() => { const n = Number(arg("usd-inr")); return Number.isFinite(n) && n > 20 && n < 500 ? n : null; })();
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
  // Campaigns (when the tables exist): what each one's drafts cost. A draft's model calls carry the lead they were for,
  // so a campaign's cost is the "draft" calls for its members made since the campaign was created.
  const hasCampaigns = (await db.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('campaigns', 'campaign_members')`)).rows[0].n === 2;
  const camp = hasCampaigns ? await db.query(`
    SELECT c.organization_id AS o, c.id,
           count(m.id)::int AS members,
           count(*) FILTER (WHERE m.message_id IS NOT NULL)::int AS drafted,
           count(*) FILTER (WHERE lm.status = 'sent')::int AS sent,
           count(*) FILTER (WHERE lm.status = 'sent' AND EXISTS (SELECT 1 FROM outreach_events e WHERE e.organization_id = m.organization_id AND e.message_id = m.message_id AND e.kind = 'replied'))::int AS replied,
           coalesce((SELECT sum(k.cost_micro_usd) FROM llm_calls k
                     WHERE k.organization_id = c.organization_id AND k.task = 'draft' AND k.error_code IS DISTINCT FROM 'reserved' AND k.created_at >= c.created_at
                       AND k.lead_id IN (SELECT lead_id FROM campaign_members x WHERE x.campaign_id = c.id)), 0)::bigint AS draft_micro
    FROM campaigns c LEFT JOIN campaign_members m ON m.campaign_id = c.id
    LEFT JOIN lead_messages lm ON lm.organization_id = m.organization_id AND lm.id = m.message_id
    WHERE c.created_at >= $1 AND ($2::text IS NULL OR c.organization_id = $2)
    GROUP BY c.id ORDER BY c.created_at DESC LIMIT 200`, [since.toISOString().replace("T", " ").replace("Z", ""), org]) : { rows: [] as any[] };

  // Money in, against estimated spend out, per workspace: payments completed in the window (payu_orders holds every
  // completed payment, Razorpay's included; its amount is WHOLE RUPEES — server/billing/purchase-rules.ts — so it is
  // turned into paise here) beside the whole estimated spend of the same window.
  const money = await db.query(`
    WITH paid AS (
      SELECT u.organization_id AS o, (sum(p.amount)::bigint * 100) AS paise, count(*)::int AS payments
      FROM payu_orders p JOIN users u ON u.id = p.user_id
      WHERE p.status = 'completed' AND p.completed_at >= $1 AND u.organization_id IS NOT NULL GROUP BY u.organization_id
    ),
    spend AS (
      SELECT o, sum(micro)::bigint AS micro FROM (
        SELECT organization_id AS o, cost_micro_usd AS micro FROM llm_calls WHERE created_at >= $1 AND error_code IS DISTINCT FROM 'reserved'
        UNION ALL SELECT organization_id, cost_micro_usd FROM provider_calls WHERE created_at >= $1) x GROUP BY o
    )
    SELECT coalesce(paid.o, spend.o) AS o, coalesce(paid.paise, 0)::bigint AS paise, coalesce(paid.payments, 0)::int AS payments, coalesce(spend.micro, 0)::bigint AS micro,
           coalesce((SELECT u.plan FROM users u WHERE u.organization_id = coalesce(paid.o, spend.o) AND u.org_role = 'OWNER' LIMIT 1), '?') AS plan
    FROM paid FULL OUTER JOIN spend ON spend.o = paid.o
    WHERE ($2::text IS NULL OR coalesce(paid.o, spend.o) = $2)
    ORDER BY coalesce(spend.micro, 0) DESC LIMIT 200`, [since.toISOString().replace("T", " ").replace("Z", ""), org]);
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

  // Third table: campaigns.
  if (hasCampaigns) {
    console.log(`\nCampaigns created in the window (drafting cost only; sending from Gmail costs nothing):`);
    console.log(["workspace", "campaign", "leads", "drafted", "sent", "replied", "est. draft cost", "per draft", "per sent", "per reply"].join("\t"));
    const t3 = { m: 0, d: 0, s: 0, r: 0, c: 0 };
    for (const x of camp.rows) {
      const c = Number(x.draft_micro);
      t3.m += x.members; t3.d += x.drafted; t3.s += x.sent; t3.r += x.replied; t3.c += c;
      console.log([String(x.o).slice(0, 12), `#${x.id}`, x.members, x.drafted, x.sent, x.replied, usd(c), per(c, x.drafted), per(c, x.sent), per(c, x.replied)].join("\t"));
    }
    console.log(["TOTAL", `${camp.rows.length}`, t3.m, t3.d, t3.s, t3.r, usd(t3.c), per(t3.c, t3.d), per(t3.c, t3.s), per(t3.c, t3.r)].join("\t"));
    console.log("A draft a campaign took over from before it existed (written by hand, or earlier) has no cost counted here. Campaign ids only, never names.");
  } else console.log("\nCampaigns: the tables aren't on this database.");

  // Fourth table: money in against estimated spend out.
  const inr = (paise: number) => `${paise < 0 ? "-" : ""}₹${(Math.abs(paise) / 100).toFixed(2)}`;
  console.log(`\nMoney in, against estimated spend, per workspace (payments completed in the window):`);
  console.log(["workspace", "owner plan", "payments", "paid", "est. spend", usdInr ? `est. spend at ₹${usdInr}/$` : "est. spend in ₹", usdInr ? "gross margin" : "gross margin", usdInr ? "margin %" : ""].join("\t"));
  const t4 = { paise: 0, micro: 0, n: 0 };
  for (const x of money.rows) {
    const paise = Number(x.paise), micro = Number(x.micro);
    t4.paise += paise; t4.micro += micro; t4.n += x.payments;
    const spendPaise = usdInr ? Math.round((micro / 1e6) * usdInr * 100) : null;
    console.log([String(x.o).slice(0, 12), x.plan, x.payments, inr(paise), usd(micro), spendPaise === null ? "-" : inr(spendPaise), spendPaise === null ? "-" : inr(paise - spendPaise), spendPaise === null || !paise ? (spendPaise === null ? "" : "-") : `${Math.round((100 * (paise - spendPaise)) / paise)}%`].join("\t"));
  }
  const totSpendPaise = usdInr ? Math.round((t4.micro / 1e6) * usdInr * 100) : null;
  console.log(["TOTAL", "", t4.n, inr(t4.paise), usd(t4.micro), totSpendPaise === null ? "-" : inr(totSpendPaise), totSpendPaise === null ? "-" : inr(t4.paise - totSpendPaise), totSpendPaise === null || !t4.paise ? (totSpendPaise === null ? "" : "-") : `${Math.round((100 * (t4.paise - totSpendPaise)) / t4.paise)}%`].join("\t"));
  console.log(usdInr
    ? `Margin = payments received minus estimated AI and research spend, at the rate you gave (₹${usdInr} per $). It leaves out hosting, payment fees, GST and refunds made after capture, and the spend is an estimate from the app's price table, not the providers' bills.`
    : "No margin is worked out: the spend is in dollars and the payments in rupees, and the rate is not guessed. Pass --usd-inr <rupees per dollar> to get one.");
  console.log("A workspace in UNLIMITED_ORG_IDS (yours) pays nothing and still spends: read its row as a cost, not a loss on a customer.");
} finally {
  await db.end();
}
