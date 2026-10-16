/**
 * One-time migration: how a deal is sold and what work it is (shared/engagement.ts).
 *   deals.engagement_model   varchar(32): retainer | fixed_price | hourly | … (NULL: not set)
 *   deals.service_category   varchar(48): seo_services | web_design_dev | … (NULL: not set)
 *   deals.engagement_terms   jsonb: the model's details (rate, billing frequency, milestones…) (NULL: none)
 *
 * PURELY ADDITIVE and nullable with no default: existing deals are not touched, nothing is backfilled or guessed.
 * Shared Neon DB: run BEFORE deploying code that reads these columns. The server's boot gate refuses to start
 * against a database without them, so the previous instance keeps serving until this has run.
 *
 * Check:    npx tsx --env-file=.env script/migrate-engagement.ts --check   (read-only: says what it would add)
 * Run:      npx tsx --env-file=.env script/migrate-engagement.ts
 * Rollback: ALTER TABLE deals DROP COLUMN IF EXISTS engagement_terms, DROP COLUMN IF EXISTS service_category,
 *           DROP COLUMN IF EXISTS engagement_model;  (loses the engagement details entered since)
 */
import pg from "pg";
const { Pool } = pg;
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }
const dryRun = process.argv.includes("--check");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const COLUMNS: [string, string][] = [["engagement_model", "varchar(32)"], ["service_category", "varchar(48)"], ["engagement_terms", "jsonb"]];

async function main() {
  const c = await pool.connect();
  try {
    const have = new Set((await c.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'deals' AND column_name = ANY($1)`,
      [COLUMNS.map(([n]) => n)],
    )).rows.map((r) => r.column_name));
    const missing = COLUMNS.filter(([n]) => !have.has(n));
    if (dryRun) {
      console.log(missing.length ? `would add to deals: ${missing.map(([n, t]) => `${n} ${t}`).join(", ")}` : "nothing to add (already present)");
      console.log("check passed ✓ (nothing changed)");
      return;
    }
    await c.query("BEGIN");
    for (const [n, t] of COLUMNS) await c.query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS ${n} ${t}`);
    await c.query("COMMIT");
    console.log(missing.length ? `added to deals: ${missing.map(([n]) => n).join(", ")}` : "nothing to add (already present)");
    console.log("migration complete ✓ (additive only)");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { c.release(); await pool.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
