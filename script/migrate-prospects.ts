/**
 * One-time migration: AI Outbound (prospect discovery and intelligence). Five tables.
 *
 * PURELY ADDITIVE: CREATE TABLE / INDEX IF NOT EXISTS only. Nothing existing is touched. Without it the AI Outbound
 * feature is off (503 PROSPECTS_NOT_SETUP) and everything else works.
 *
 * Database guarantees it adds:
 *   - one prospect per organization and domain (a company found by several runs is one row);
 *   - one row per run and prospect;
 *   - at most one ACTIVE run per organization and ICP (the idempotency key), so starting the same search twice
 *     returns the run already in progress.
 *
 * Dev and production share one Neon database, so run this deliberately:
 *   npx tsx --env-file=.env script/migrate-prospects.ts
 * Local test database:
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/migrate-prospects.ts
 *
 * Rollback:  DROP TABLE IF EXISTS prospect_findings, prospect_run_items, prospects, prospect_runs, provider_calls;
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();

const TABLES = ["prospect_runs", "prospects", "prospect_run_items", "prospect_findings", "provider_calls"];
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS prospect_runs (
    id varchar(40) PRIMARY KEY,
    organization_id varchar NOT NULL,
    created_by_user varchar NOT NULL,
    created_by varchar(8) NOT NULL DEFAULT 'user',
    request text NOT NULL,
    icp jsonb NOT NULL,
    quantity integer NOT NULL,
    status varchar(12) NOT NULL,
    stage varchar(16) NOT NULL,
    counters jsonb NOT NULL DEFAULT '{}'::jsonb,
    queries jsonb NOT NULL DEFAULT '[]'::jsonb,
    cost_micro_usd integer NOT NULL DEFAULT 0,
    error_code varchar(30),
    idem_key varchar(64) NOT NULL,
    lease_until timestamp,
    attempts integer NOT NULL DEFAULT 0,
    created_at timestamp NOT NULL,
    updated_at timestamp NOT NULL,
    finished_at timestamp
  )`,
  `CREATE INDEX IF NOT EXISTS prospect_runs_org_idx ON prospect_runs (organization_id, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS prospect_runs_one_active ON prospect_runs (organization_id, idem_key) WHERE status = 'running'`,
  `CREATE TABLE IF NOT EXISTS prospects (
    id serial PRIMARY KEY,
    organization_id varchar NOT NULL,
    domain varchar(253) NOT NULL,
    name varchar(120) NOT NULL,
    website varchar(300) NOT NULL,
    status varchar(12) NOT NULL,
    reject_reason varchar(40),
    sources jsonb NOT NULL DEFAULT '[]'::jsonb,
    profile jsonb NOT NULL DEFAULT '{}'::jsonb,
    fit jsonb,
    score jsonb,
    angle jsonb,
    ready boolean NOT NULL DEFAULT false,
    content_hash varchar(64),
    verified_at timestamp,
    researched_at timestamp,
    lead_id integer,
    created_at timestamp NOT NULL,
    updated_at timestamp NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS prospects_org_domain_uq ON prospects (organization_id, domain)`,
  `CREATE TABLE IF NOT EXISTS prospect_run_items (
    id serial PRIMARY KEY,
    run_id varchar(40) NOT NULL,
    organization_id varchar NOT NULL,
    prospect_id integer NOT NULL,
    rank integer NOT NULL DEFAULT 0,
    stage varchar(12) NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    error_code varchar(30),
    next_attempt_at timestamp,
    updated_at timestamp NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS prospect_run_items_run_prospect_uq ON prospect_run_items (run_id, prospect_id)`,
  `CREATE INDEX IF NOT EXISTS prospect_run_items_run_stage_idx ON prospect_run_items (run_id, stage)`,
  `CREATE TABLE IF NOT EXISTS prospect_findings (
    id serial PRIMARY KEY,
    organization_id varchar NOT NULL,
    prospect_id integer NOT NULL,
    kind varchar(16) NOT NULL,
    type varchar(40) NOT NULL,
    value varchar(400) NOT NULL,
    status varchar(12) NOT NULL,
    source_url varchar(500),
    source_type varchar(12) NOT NULL,
    quote varchar(500),
    content_hash varchar(64),
    observed_at timestamp,
    confidence varchar(8) NOT NULL DEFAULT 'medium',
    supporting_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    meta jsonb NOT NULL DEFAULT '{}'::jsonb,
    batch varchar(60) NOT NULL,
    retrieved_at timestamp NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS prospect_findings_prospect_idx ON prospect_findings (prospect_id, kind)`,
  `CREATE TABLE IF NOT EXISTS provider_calls (
    id serial PRIMARY KEY,
    organization_id varchar NOT NULL,
    run_id varchar(40),
    provider varchar(24) NOT NULL,
    operation varchar(24) NOT NULL,
    ok boolean NOT NULL,
    error_code varchar(30),
    latency_ms integer NOT NULL DEFAULT 0,
    cost_micro_usd integer NOT NULL DEFAULT 0,
    created_at timestamp NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS provider_calls_org_created_idx ON provider_calls (organization_id, created_at)`,
];

async function main() {
  console.log(`Database host: ${host}`);
  const pool = new pg.Pool({ connectionString: url });
  try {
    for (const s of STATEMENTS) await pool.query(s);
    const r = await pool.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY($1)`, [TABLES]);
    console.log(`AI Outbound tables present: ${r.rows[0].n} of ${TABLES.length}.`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
