/**
 * One-time migration: client-facing e-signature columns on contracts.
 * PURELY ADDITIVE (shared Neon DB — run BEFORE pushing code that reads them).
 * Run:      npx tsx --env-file=.env script/migrate-contract-esign.ts
 * Rollback: ALTER TABLE contracts DROP COLUMN IF EXISTS client_share_token;
 *           ALTER TABLE contracts DROP COLUMN IF EXISTS client_shared_at;
 *           ALTER TABLE contracts DROP COLUMN IF EXISTS client_share_revoked_at;
 *           ALTER TABLE contracts DROP COLUMN IF EXISTS client_share_view_count;
 *           ALTER TABLE contracts DROP COLUMN IF EXISTS client_sign_share_snapshot;
 *           ALTER TABLE contracts DROP COLUMN IF EXISTS client_signed_at;
 *           ALTER TABLE contracts DROP COLUMN IF EXISTS client_signer_name;
 *           ALTER TABLE contracts DROP COLUMN IF EXISTS client_signer_email;
 *           ALTER TABLE contracts DROP COLUMN IF EXISTS client_signature_data_url;
 *           ALTER TABLE contracts DROP COLUMN IF EXISTS client_signer_ip;
 */
import pg from "pg";
const { Pool } = pg;
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  const c = await pool.connect();
  try {
    await c.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS client_share_token varchar`);
    await c.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS client_shared_at timestamp`);
    await c.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS client_share_revoked_at timestamp`);
    await c.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS client_share_view_count integer NOT NULL DEFAULT 0`);
    await c.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS client_sign_share_snapshot jsonb`);
    await c.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS client_signed_at timestamp`);
    await c.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS client_signer_name varchar`);
    await c.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS client_signer_email varchar`);
    await c.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS client_signature_data_url text`);
    await c.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS client_signer_ip varchar`);
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS contracts_client_share_token_unique ON contracts (client_share_token) WHERE client_share_token IS NOT NULL`);
    console.log("migration complete ✓ (additive only)");
  } finally { c.release(); await pool.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
