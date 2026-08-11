/**
 * One-time migration: invoice numbers are unique PER ORGANISATION, not globally.
 *
 * brand_invoices.invoice_number carried a global UNIQUE constraint, inherited
 * from when numbers were `BINV-<epoch>-<counter>` and effectively unguessable.
 * Financial-year numbering (INV-2627-0001) restarts at 0001 for every
 * organisation each April — which is exactly what a CA expects — so under the
 * global constraint the SECOND organisation to raise an invoice would collide
 * on its very first one and get a 500. Every new customer's first invoice would
 * have failed.
 *
 * Replaces it with UNIQUE (organization_id, invoice_number): still prevents a
 * duplicate number inside one business's books, which is the constraint that
 * actually matters, and lets two businesses each have their own INV-2627-0001.
 *
 * Rows with a NULL organization_id (pre-organisation invoices) are unaffected —
 * Postgres treats NULLs as distinct in a unique index.
 *
 * Run BEFORE pushing code (prod + dev share the Neon DB):
 *   npx tsx --env-file=.env script/migrate-invoice-number-per-org.ts
 *
 * Rollback:
 *   ALTER TABLE brand_invoices DROP CONSTRAINT IF EXISTS brand_invoices_org_invoice_number_unique;
 *   ALTER TABLE brand_invoices ADD CONSTRAINT brand_invoices_invoice_number_unique UNIQUE (invoice_number);
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
    const dupes = await client.query(`
      SELECT organization_id, invoice_number, count(*) AS n
        FROM brand_invoices
       GROUP BY 1, 2 HAVING count(*) > 1`);
    if (dupes.rowCount) {
      console.error("Refusing to run — these (org, number) pairs are already duplicated:");
      console.table(dupes.rows);
      process.exit(1);
    }

    const before = await client.query(`
      SELECT conname FROM pg_constraint
       WHERE conrelid = 'brand_invoices'::regclass AND contype = 'u'`);
    console.log("unique constraints before:", before.rows.map((r) => r.conname));

    await client.query("BEGIN");
    await client.query(`ALTER TABLE brand_invoices DROP CONSTRAINT IF EXISTS brand_invoices_invoice_number_unique`);
    await client.query(`
      ALTER TABLE brand_invoices
        ADD CONSTRAINT brand_invoices_org_invoice_number_unique
        UNIQUE (organization_id, invoice_number)`);
    await client.query("COMMIT");

    const after = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'brand_invoices'::regclass AND contype = 'u'`);
    console.log("unique constraints after:");
    console.table(after.rows);
    console.log("migration complete ✓");
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
