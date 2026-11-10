/**
 * One-time migration: client profiles (acquisition_profiles) — who a workspace wants as clients, saved and named.
 *
 * PURELY ADDITIVE and IDEMPOTENT: only CREATE TABLE / CREATE INDEX ... IF NOT EXISTS. No existing table is touched and
 * no row is written. A database without this table simply has saved profiles switched off (the server checks for it
 * and answers 503 PROFILES_NOT_SETUP); Client Radar and everything else work as before. So it is safe to run BEFORE
 * deploying, which is the order to use: migrate first, then push.
 *
 * Against a database this machine can reach:
 *   npx tsx --env-file=.env script/migrate-acquisition-profiles.ts
 * The production server installs without dev tools (no tsx) and its Postgres listens only on the box, so there the
 * same statements below are applied through the server's own psql, as the application's database role (so the app
 * owns the table). Applied on production that way on 10 Nov 2026.
 * Local test database:
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/migrate-acquisition-profiles.ts
 *
 * Rollback (drops the saved profiles only; searches already started from one keep their own copy of what they looked for):
 *   DROP TABLE IF EXISTS acquisition_profiles;
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS acquisition_profiles (
    id serial PRIMARY KEY,
    organization_id varchar NOT NULL,
    created_by_user varchar NOT NULL,
    name varchar(80) NOT NULL,
    name_key varchar(80) NOT NULL,
    kind varchar(20) NOT NULL DEFAULT 'custom',
    services jsonb NOT NULL DEFAULT '[]'::jsonb,
    industries jsonb NOT NULL DEFAULT '[]'::jsonb,
    keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
    countries jsonb NOT NULL DEFAULT '[]'::jsonb,
    locations jsonb NOT NULL DEFAULT '[]'::jsonb,
    employee_min integer,
    employee_max integer,
    exclusions jsonb NOT NULL DEFAULT '[]'::jsonb,
    signals jsonb NOT NULL DEFAULT '[]'::jsonb,
    requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
    roles jsonb NOT NULL DEFAULT '[]'::jsonb,
    outreach jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamp NOT NULL,
    updated_at timestamp NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS acquisition_profiles_org_idx ON acquisition_profiles (organization_id, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS acquisition_profiles_org_name_uq ON acquisition_profiles (organization_id, name_key)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS acquisition_profiles_one_default ON acquisition_profiles (organization_id) WHERE is_default`,
];

async function main() {
  console.log(`Database host: ${host}`);
  const pool = new pg.Pool({ connectionString: url });
  try {
    for (const s of STATEMENTS) await pool.query(s);
    const t = await pool.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'acquisition_profiles'`);
    const i = await pool.query(`SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'acquisition_profiles'`);
    const rows = await pool.query(`SELECT count(*)::int AS n FROM acquisition_profiles`);
    console.log(`acquisition_profiles: ${t.rows[0].n === 1 ? "present" : "MISSING"}, ${i.rows[0].n} indexes (4 expected), ${rows.rows[0].n} saved profiles.`);
    if (t.rows[0].n !== 1 || i.rows[0].n !== 4) process.exit(1);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
