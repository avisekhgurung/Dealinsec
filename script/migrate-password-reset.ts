/**
 * One-time migration: password-reset token columns on users.
 * PURELY ADDITIVE (shared Neon DB — run BEFORE pushing code).
 * Run:      npx tsx --env-file=.env script/migrate-password-reset.ts
 * Rollback: ALTER TABLE users DROP COLUMN IF EXISTS reset_token_hash;
 *           ALTER TABLE users DROP COLUMN IF EXISTS reset_token_expires_at;
 */
import pg from "pg";
const { Pool } = pg;
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  const c = await pool.connect();
  try {
    await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash varchar`);
    await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires_at timestamp`);
    console.log("migration complete ✓ (additive only)");
  } finally { c.release(); await pool.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
