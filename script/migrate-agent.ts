/**
 * One-time migration: the AI Deal Operator's tables (sessions, messages, runs,
 * tool calls, approvals, settings).
 *
 * PURELY ADDITIVE: only CREATE TABLE / CREATE INDEX ... IF NOT EXISTS. No column
 * is added to any existing table, so a database without these tables simply has
 * the agent switched off (the server checks for them and answers 503); the rest
 * of the app is unaffected.
 *
 * Dev and production share one Neon database, so run this deliberately:
 *   npx tsx --env-file=.env script/migrate-agent.ts
 * Local test database:
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/migrate-agent.ts
 *
 * Rollback (drops the agent's data only):
 *   DROP TABLE IF EXISTS agent_settings, agent_approvals, agent_tool_calls,
 *     agent_runs, agent_messages, agent_sessions;
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS agent_sessions (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id varchar NOT NULL,
    user_id varchar NOT NULL,
    channel varchar(16) NOT NULL DEFAULT 'web',
    title varchar(120),
    deal_id integer,
    state varchar(32) NOT NULL DEFAULT 'UNDERSTANDING',
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS agent_sessions_user_idx ON agent_sessions (organization_id, user_id, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS agent_messages (
    id serial PRIMARY KEY,
    session_id varchar NOT NULL,
    run_id varchar,
    role varchar(16) NOT NULL,
    content text NOT NULL,
    cards jsonb,
    created_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS agent_messages_session_idx ON agent_messages (session_id, id)`,
  `CREATE TABLE IF NOT EXISTS agent_runs (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id varchar NOT NULL,
    organization_id varchar NOT NULL,
    user_id varchar NOT NULL,
    status varchar(24) NOT NULL DEFAULT 'running',
    provider varchar(24),
    model varchar(48),
    steps integer NOT NULL DEFAULT 0,
    tokens_in integer NOT NULL DEFAULT 0,
    tokens_out integer NOT NULL DEFAULT 0,
    latency_ms integer,
    error_code varchar(40),
    started_at timestamp NOT NULL DEFAULT now(),
    finished_at timestamp
  )`,
  `CREATE INDEX IF NOT EXISTS agent_runs_session_idx ON agent_runs (session_id, started_at)`,
  `CREATE TABLE IF NOT EXISTS agent_tool_calls (
    id serial PRIMARY KEY,
    run_id varchar NOT NULL,
    tool varchar(48) NOT NULL,
    risk varchar(24) NOT NULL,
    status varchar(24) NOT NULL,
    args jsonb,
    result_summary varchar(300),
    error_code varchar(40),
    duration_ms integer,
    created_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS agent_tool_calls_run_idx ON agent_tool_calls (run_id)`,
  `CREATE TABLE IF NOT EXISTS agent_approvals (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id varchar NOT NULL,
    session_id varchar NOT NULL,
    organization_id varchar NOT NULL,
    user_id varchar NOT NULL,
    tool varchar(48) NOT NULL,
    args jsonb NOT NULL,
    args_hash varchar(64) NOT NULL,
    preview jsonb,
    status varchar(16) NOT NULL DEFAULT 'pending',
    result jsonb,
    expires_at timestamp NOT NULL,
    decided_at timestamp,
    created_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS agent_approvals_session_idx ON agent_approvals (session_id)`,
  `CREATE TABLE IF NOT EXISTS agent_settings (
    organization_id varchar PRIMARY KEY,
    autonomy_level integer NOT NULL DEFAULT 0,
    preferences jsonb,
    updated_at timestamp NOT NULL DEFAULT now()
  )`,
];

async function main() {
  console.log(`Database host: ${host}`);
  const pool = new pg.Pool({ connectionString: url });
  try {
    for (const s of STATEMENTS) await pool.query(s);
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name LIKE 'agent\\_%'`,
    );
    console.log(`Agent tables present: ${r.rows[0].n} of 6.`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
