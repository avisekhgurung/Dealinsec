/**
 * One-time migration: the sales agent's research runs (one table).
 *
 * PURELY ADDITIVE: CREATE TABLE / INDEX IF NOT EXISTS only. Nothing existing is touched. Without it
 * (and script/migrate-llm-calls.ts) the sales agent is off: the server answers 503 SALES_NOT_SETUP and
 * everything else works. The findings themselves live in lead_claims; this table records each run.
 *
 * The partial unique index makes "one running research per lead" a database guarantee, so two clicks at
 * once cannot start two runs.
 *
 * Dev and production share one Neon database, so run this deliberately:
 *   npx tsx --env-file=.env script/migrate-lead-research.ts
 * Local test database:
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/migrate-lead-research.ts
 *
 * Rollback:  DROP TABLE IF EXISTS lead_research;
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS lead_research (
    id serial PRIMARY KEY,
    lead_id integer NOT NULL,
    organization_id varchar NOT NULL,
    status varchar(12) NOT NULL,
    started_at timestamp NOT NULL,
    finished_at timestamp,
    pages jsonb NOT NULL DEFAULT '[]'::jsonb,
    claim_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    summary jsonb,
    error_code varchar(30),
    model varchar(80),
    prompt_version varchar(20),
    created_by varchar(8) NOT NULL DEFAULT 'user',
    created_by_user varchar
  )`,
  `CREATE INDEX IF NOT EXISTS lead_research_lead_idx ON lead_research (lead_id, started_at)`,
  `CREATE INDEX IF NOT EXISTS lead_research_org_idx ON lead_research (organization_id, started_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS lead_research_one_running ON lead_research (lead_id) WHERE status = 'running'`,
];

async function main() {
  console.log(`Database host: ${host}`);
  const pool = new pg.Pool({ connectionString: url });
  try {
    for (const s of STATEMENTS) await pool.query(s);
    const r = await pool.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'lead_research'`);
    console.log(`Research table present: ${r.rows[0].n} of 1.`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
