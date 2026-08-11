/**
 * One-time migration: company seal + e-stamp certificate reference.
 *
 * TWO DIFFERENT THINGS, deliberately kept apart:
 *
 * 1. users.company_seal / contracts.seal_url — the business's own rubber stamp
 *    or seal image, the companion to a signature. Indian invoices and
 *    agreements conventionally carry both. Purely presentational. Snapshotted
 *    onto the contract at creation for the same reason the signature is: the
 *    document must not change when someone edits their profile later.
 *
 * 2. contracts.estamp_* — a reference to an e-stamp certificate the user
 *    bought themselves (SHCIL or their state portal). DealInSec does NOT sell,
 *    issue or satisfy stamp duty. We store the certificate number, date,
 *    amount and issuing authority so the agreement can cite a real
 *    certificate. An uploaded image of stamp paper would NOT be valid
 *    stamping, which is exactly why this is a reference field and not a file.
 *
 * PURELY ADDITIVE. Run BEFORE pushing code (prod + dev share the Neon DB):
 *   npx tsx --env-file=.env script/migrate-seal-and-estamp.ts
 *
 * Rollback:
 *   ALTER TABLE users DROP COLUMN IF EXISTS company_seal;
 *   ALTER TABLE contracts DROP COLUMN IF EXISTS seal_url,
 *     DROP COLUMN IF EXISTS estamp_certificate_no, DROP COLUMN IF EXISTS estamp_date,
 *     DROP COLUMN IF EXISTS estamp_amount, DROP COLUMN IF EXISTS estamp_authority;
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
    await client.query("BEGIN");
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS company_seal varchar`);
    await client.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS seal_url varchar`);
    await client.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS estamp_certificate_no varchar`);
    await client.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS estamp_date varchar`);
    await client.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS estamp_amount integer`);
    await client.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS estamp_authority varchar`);
    await client.query("COMMIT");

    const cols = await client.query(`
      SELECT table_name, column_name FROM information_schema.columns
       WHERE (table_name = 'users' AND column_name = 'company_seal')
          OR (table_name = 'contracts' AND column_name IN
              ('seal_url','estamp_certificate_no','estamp_date','estamp_amount','estamp_authority'))
       ORDER BY table_name, column_name`);
    console.table(cols.rows);
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
