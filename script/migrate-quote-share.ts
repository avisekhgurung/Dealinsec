/**
 * One-time migration: client-facing quotation sharing columns on quotes.
 * PURELY ADDITIVE (shared Neon DB — run BEFORE pushing code that reads them).
 * Run:      npx tsx --env-file=.env script/migrate-quote-share.ts
 * Rollback: ALTER TABLE quotes DROP COLUMN IF EXISTS share_token;
 *           ALTER TABLE quotes DROP COLUMN IF EXISTS share_snapshot;
 *           ALTER TABLE quotes DROP COLUMN IF EXISTS shared_at;
 *           ALTER TABLE quotes DROP COLUMN IF EXISTS share_revoked_at;
 *           ALTER TABLE quotes DROP COLUMN IF EXISTS share_view_count;
 *           ALTER TABLE quotes DROP COLUMN IF EXISTS accepted_at;
 */
import pg from "pg";
const { Pool } = pg;
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  const c = await pool.connect();
  try {
    await c.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS share_token varchar`);
    await c.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS share_snapshot jsonb`);
    await c.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS shared_at timestamp`);
    await c.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS share_revoked_at timestamp`);
    await c.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS share_view_count integer NOT NULL DEFAULT 0`);
    await c.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS accepted_at timestamp`);
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS quotes_share_token_unique ON quotes (share_token) WHERE share_token IS NOT NULL`);
    console.log("migration complete ✓ (additive only)");
  } finally { c.release(); await pool.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
