/**
 * One-time migration: Social Intent (saved searches, scans, opportunities).
 *
 * PURELY ADDITIVE and IDEMPOTENT: only CREATE TABLE / CREATE INDEX ... IF NOT EXISTS. No existing table is touched.
 * A database without these tables simply has Social Intent switched off (the server checks for them and answers
 * 503 SOCIAL_NOT_SETUP); everything else is unaffected. So it is safe to run BEFORE deploying, which is the order to
 * use: migrate first, then push.
 *
 * Dev and production share one database, so run this deliberately:
 *   npx tsx --env-file=.env script/migrate-social-intent.ts
 * Local test database:
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/migrate-social-intent.ts
 *
 * Rollback (drops Social Intent's own data only; leads saved from it stay, as ordinary leads):
 *   DROP TABLE IF EXISTS social_opportunities, social_scans, social_profiles;
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS social_profiles (
    id serial PRIMARY KEY,
    organization_id varchar NOT NULL,
    created_by_user varchar NOT NULL,
    name varchar(80) NOT NULL,
    services jsonb NOT NULL DEFAULT '[]'::jsonb,
    keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
    platforms jsonb NOT NULL DEFAULT '[]'::jsonb,
    min_score integer NOT NULL DEFAULT 0,
    status varchar(8) NOT NULL DEFAULT 'active',
    schedule varchar(8) NOT NULL DEFAULT 'off',
    last_run_at timestamp,
    next_run_at timestamp,
    created_at timestamp NOT NULL,
    updated_at timestamp NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS social_profiles_org_idx ON social_profiles (organization_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS social_profiles_due_idx ON social_profiles (next_run_at)`,
  `CREATE TABLE IF NOT EXISTS social_scans (
    id serial PRIMARY KEY,
    organization_id varchar NOT NULL,
    profile_id integer,
    created_by_user varchar NOT NULL,
    trigger varchar(10) NOT NULL,
    sources jsonb NOT NULL DEFAULT '[]'::jsonb,
    read integer NOT NULL DEFAULT 0,
    kept integer NOT NULL DEFAULT 0,
    fresh integer NOT NULL DEFAULT 0,
    created_at timestamp NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS social_scans_org_idx ON social_scans (organization_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS social_opportunities (
    id serial PRIMARY KEY,
    organization_id varchar NOT NULL,
    profile_id integer,
    source varchar(16) NOT NULL,
    origin varchar(8) NOT NULL DEFAULT 'scan',
    url varchar(500) NOT NULL,
    community varchar(80),
    title varchar(160) NOT NULL,
    excerpt varchar(300) NOT NULL,
    posted_at timestamp,
    discovered_at timestamp NOT NULL,
    last_seen_at timestamp NOT NULL,
    intent varchar(16) NOT NULL,
    intent_matched varchar(120),
    service varchar(80),
    signals jsonb NOT NULL DEFAULT '{}'::jsonb,
    score integer NOT NULL,
    score_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    company_url varchar(300),
    status varchar(10) NOT NULL DEFAULT 'new',
    lead_id integer,
    expires_at timestamp,
    created_at timestamp NOT NULL,
    updated_at timestamp NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS social_opportunities_org_url ON social_opportunities (organization_id, url)`,
  `CREATE INDEX IF NOT EXISTS social_opportunities_list_idx ON social_opportunities (organization_id, status, score)`,
  `CREATE INDEX IF NOT EXISTS social_opportunities_expiry_idx ON social_opportunities (expires_at)`,
];

async function main() {
  console.log(`Database host: ${host}`);
  const pool = new pg.Pool({ connectionString: url });
  try {
    for (const s of STATEMENTS) await pool.query(s);
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name IN ('social_profiles','social_scans','social_opportunities')`,
    );
    console.log(`Social Intent tables present: ${r.rows[0].n} of 3.`);
    if (r.rows[0].n !== 3) process.exit(1);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
