/**
 * One-time migration: document authenticity.
 *
 * 1. contracts.signer_* — the agreement records WHO signed it and with WHICH
 *    signature image, captured at creation. Until now the PDF rendered the
 *    *current viewer's* profile signature, so any teammate opening a signed
 *    agreement saw their own signature on it, and changing your signature
 *    retroactively altered every past document. Existing rows are backfilled
 *    from their creator so historic agreements keep rendering sensibly.
 *
 * 2. invoice_counters — per-organization, per-financial-year sequence so
 *    invoice numbers read INV-2627-0001 instead of BINV-<epoch>-<counter>
 *    (which reset on every deploy and looked unprofessional to clients).
 *    Indian FY starts 1 April. Existing invoice numbers are NOT rewritten —
 *    they are already printed on documents clients hold.
 *
 * PURELY ADDITIVE. Run BEFORE pushing code (prod + dev share the Neon DB):
 *   npx tsx --env-file=.env script/migrate-document-authenticity.ts
 *
 * Rollback (non-destructive):
 *   ALTER TABLE contracts DROP COLUMN IF EXISTS signer_user_id,
 *     DROP COLUMN IF EXISTS signer_name, DROP COLUMN IF EXISTS signature_url;
 *   DROP TABLE IF EXISTS invoice_counters;
 */
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (run with: npx tsx --env-file=.env ...)");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    const before = await client.query(`
      SELECT count(*)::int AS contracts,
             count(*) FILTER (WHERE status = 'Signed')::int AS signed
      FROM contracts`);
    console.log("before:", before.rows[0]);

    await client.query("BEGIN");

    await client.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS signer_user_id varchar`);
    await client.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS signer_name varchar`);
    await client.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS signature_url varchar`);

    // Backfill: the creator is the signer for every existing agreement.
    const filled = await client.query(`
      UPDATE contracts c
         SET signer_user_id = u.id,
             signer_name    = NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), ''),
             signature_url  = u.digital_signature
        FROM users u
       WHERE c.user_id = u.id AND c.signer_user_id IS NULL`);
    console.log(`signer snapshot backfilled for ${filled.rowCount} agreement(s)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS invoice_counters (
        organization_id varchar NOT NULL,
        fy              varchar(9) NOT NULL,
        last_no         integer NOT NULL DEFAULT 0,
        PRIMARY KEY (organization_id, fy)
      )`);

    await client.query("COMMIT");

    const after = await client.query(`
      SELECT count(*) FILTER (WHERE signer_user_id IS NOT NULL)::int AS with_signer,
             count(*) FILTER (WHERE signature_url IS NOT NULL)::int AS with_signature
      FROM contracts`);
    console.log("after:", after.rows[0]);
    console.log("migration complete ✓ (additive only — deployed prod code unaffected)");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("migration failed:", err);
  process.exit(1);
});
