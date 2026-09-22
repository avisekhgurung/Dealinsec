/**
 * One-time migration: document integrity hash column on contracts.
 * PURELY ADDITIVE (shared Neon DB — run BEFORE pushing code that reads it).
 * Run:      npx tsx --env-file=.env script/migrate-document-hash.ts
 * Rollback: ALTER TABLE contracts DROP COLUMN IF EXISTS document_hash;
 */
import pg from "pg";
const { Pool } = pg;
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  const c = await pool.connect();
  try {
    await c.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS document_hash varchar`);
    console.log("migration complete ✓ (additive only)");
  } finally { c.release(); await pool.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
