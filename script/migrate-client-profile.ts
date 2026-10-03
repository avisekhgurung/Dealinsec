/**
 * One-time migration: the ideal-client profile (one table).
 *
 * PURELY ADDITIVE: one CREATE TABLE IF NOT EXISTS. Nothing existing is touched.
 * A database without it simply has the ideal-client feature switched off (the
 * server answers 503 PROFILE_NOT_SETUP); leads and everything else keep working.
 *
 * Dev and production share one Neon database, so run this deliberately:
 *   npx tsx --env-file=.env script/migrate-client-profile.ts
 * Local test database:
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/migrate-client-profile.ts
 *
 * Rollback (drops the profiles only):
 *   DROP TABLE IF EXISTS client_profiles;
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS client_profiles (
    organization_id varchar PRIMARY KEY,
    about text,
    services jsonb NOT NULL DEFAULT '[]'::jsonb,
    target_industries jsonb NOT NULL DEFAULT '[]'::jsonb,
    target_locations jsonb NOT NULL DEFAULT '[]'::jsonb,
    exclusions jsonb NOT NULL DEFAULT '[]'::jsonb,
    min_deal_minor bigint,
    currency varchar(3),
    updated_by varchar NOT NULL,
    updated_at timestamp NOT NULL DEFAULT now()
  )`,
];

async function main() {
  console.log(`Database host: ${host}`);
  const pool = new pg.Pool({ connectionString: url });
  try {
    for (const s of STATEMENTS) await pool.query(s);
    const r = await pool.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'client_profiles'`);
    console.log(`Profile table present: ${r.rows[0].n} of 1.`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
