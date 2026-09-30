/**
 * One-time migration: the audience (work type) and brand-deal terms columns.
 *   organizations.audience   'client_work' | 'brand_collaboration'; NULL reads
 *                            as client_work, so no existing row changes meaning
 *   deals.brand_terms        jsonb; usage rights / exclusivity / approval for
 *                            brand collaborations, NULL for every other deal
 *
 * PURELY ADDITIVE and nullable with no default: existing rows are not touched
 * and no data is backfilled. Shared Neon DB — run BEFORE pushing code that
 * reads these columns. The server's boot gate refuses to start against a
 * database that lacks them, so the previous instance keeps serving until this
 * has run.
 *
 * Run:      npx tsx --env-file=.env script/migrate-audience.ts
 * Rollback: ALTER TABLE organizations DROP COLUMN IF EXISTS audience;
 *           ALTER TABLE deals DROP COLUMN IF EXISTS brand_terms;
 *           (Dropping loses the work types and brand terms entered since.)
 */
import pg from "pg";
const { Pool } = pg;
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  const c = await pool.connect();
  try {
    await c.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS audience varchar(20)`);
    await c.query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS brand_terms jsonb`);
    console.log("migration complete ✓ (additive only)");
  } finally { c.release(); await pool.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
