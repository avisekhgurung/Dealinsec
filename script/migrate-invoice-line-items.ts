/**
 * One-time migration: itemised invoice lines.
 *
 * brand_invoices.line_items — the invoice composer (/brand-invoices/new) lets
 * users write real billable rows instead of the app deriving one hardcoded line
 * from the deal. Nullable on purpose: invoices raised before the composer keep
 * rendering their derived line, so nothing already sent to a client changes.
 *
 * The column also carries an optional hsnSac per row, so adding Rule 46 GST
 * columns later is an extension rather than a rewrite.
 *
 * PURELY ADDITIVE. Run BEFORE pushing code (prod + dev share the Neon DB):
 *   npx tsx --env-file=.env script/migrate-invoice-line-items.ts
 *
 * Rollback (non-destructive):
 *   ALTER TABLE brand_invoices DROP COLUMN IF EXISTS line_items;
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
    const before = await client.query(`SELECT count(*)::int AS invoices FROM brand_invoices`);
    console.log("before:", before.rows[0]);

    await client.query(`ALTER TABLE brand_invoices ADD COLUMN IF NOT EXISTS line_items jsonb`);

    const after = await client.query(`
      SELECT count(*) FILTER (WHERE line_items IS NULL)::int AS legacy_derived_line,
             count(*) FILTER (WHERE line_items IS NOT NULL)::int AS itemised
      FROM brand_invoices`);
    console.log("after:", after.rows[0]);
    console.log("migration complete ✓ (additive only — deployed prod code unaffected)");
  } catch (err) {
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
