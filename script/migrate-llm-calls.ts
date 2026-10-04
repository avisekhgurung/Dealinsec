/**
 * One-time migration: the LLM trace (one table).
 *
 * PURELY ADDITIVE: CREATE TABLE / INDEX IF NOT EXISTS only. Nothing existing is touched.
 * Without it the sales features are off (the server answers 503 SALES_NOT_SETUP);
 * everything else works. The table holds metadata only (model, tokens, latency, cost
 * estimate, ok/error), never a prompt or a reply.
 *
 * Dev and production share one Neon database, so run this deliberately:
 *   npx tsx --env-file=.env script/migrate-llm-calls.ts
 * Local test database:
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/migrate-llm-calls.ts
 *
 * Rollback:  DROP TABLE IF EXISTS llm_calls;
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS llm_calls (
    id serial PRIMARY KEY,
    organization_id varchar NOT NULL,
    user_id varchar,
    task varchar(40) NOT NULL,
    model varchar(80) NOT NULL,
    prompt_version varchar(20) NOT NULL,
    tokens_in integer NOT NULL DEFAULT 0,
    tokens_out integer NOT NULL DEFAULT 0,
    latency_ms integer NOT NULL DEFAULT 0,
    cost_micro_usd integer NOT NULL DEFAULT 0,
    ok boolean NOT NULL,
    error_code varchar(30),
    lead_id integer,
    run_id varchar(40),
    created_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS llm_calls_org_created_idx ON llm_calls (organization_id, created_at)`,
];

async function main() {
  console.log(`Database host: ${host}`);
  const pool = new pg.Pool({ connectionString: url });
  try {
    for (const s of STATEMENTS) await pool.query(s);
    const r = await pool.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'llm_calls'`);
    console.log(`LLM trace table present: ${r.rows[0].n} of 1.`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
