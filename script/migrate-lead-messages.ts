/**
 * One-time migration: outreach messages (one table).
 *
 * PURELY ADDITIVE: CREATE TABLE / INDEX IF NOT EXISTS only. Nothing existing is touched. Without it (and
 * script/migrate-llm-calls.ts) drafting outreach is off: the server answers 503 SALES_NOT_SETUP and everything
 * else works, including research and the score.
 *
 * The partial unique index makes "at most one unsent message per lead" a database guarantee, so two clicks at
 * once cannot create two drafts.
 *
 * Dev and production share one Neon database, so run this deliberately:
 *   npx tsx --env-file=.env script/migrate-lead-messages.ts
 * Local test database:
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/migrate-lead-messages.ts
 *
 * Rollback:  DROP TABLE IF EXISTS lead_messages;
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS lead_messages (
    id serial PRIMARY KEY,
    lead_id integer NOT NULL,
    organization_id varchar NOT NULL,
    direction varchar(3) NOT NULL DEFAULT 'out',
    channel varchar(12) NOT NULL DEFAULT 'manual',
    subject varchar(200),
    body text NOT NULL,
    body_hash varchar(64) NOT NULL,
    to_address varchar(254),
    to_source varchar(8),
    status varchar(12) NOT NULL,
    research_id integer,
    claim_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    prompt_version varchar(20),
    edited boolean NOT NULL DEFAULT false,
    created_by varchar(8) NOT NULL DEFAULT 'user',
    created_by_user varchar,
    approved_by varchar,
    approved_at timestamp,
    sent_at timestamp,
    created_at timestamp NOT NULL,
    updated_at timestamp NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS lead_messages_lead_idx ON lead_messages (lead_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS lead_messages_org_idx ON lead_messages (organization_id, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS lead_messages_one_unsent ON lead_messages (lead_id) WHERE direction = 'out' AND status IN ('draft', 'approved')`,
];

async function main() {
  console.log(`Database host: ${host}`);
  const pool = new pg.Pool({ connectionString: url });
  try {
    for (const s of STATEMENTS) await pool.query(s);
    const r = await pool.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'lead_messages'`);
    console.log(`Messages table present: ${r.rows[0].n} of 1.`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
