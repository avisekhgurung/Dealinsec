/**
 * One-time migration: `prospect_runs.mode` — what a Client Radar search is for.
 *
 *   deep  the full pipeline: search, verify, enrich, research, score. The only kind that existed before this,
 *         which is why it is the DEFAULT: every existing row becomes a deep search, exactly what it was.
 *   list  a bulk list sweep that stops after verification. Many companies, no model calls, nothing researched.
 *
 * PURELY ADDITIVE and IDEMPOTENT: one ADD COLUMN IF NOT EXISTS with a default. It adds no table, drops nothing and
 * rewrites no row's meaning. A server running the OLD code against the migrated database is unaffected — it never
 * selects the column by name (Drizzle selects the columns it knows) and every insert leaves it to its default. So this
 * is safe to run BEFORE deploying, which is the order to use: migrate first, then push.
 *
 * Dev and production share one Neon database, so run this deliberately:
 *   npx tsx --env-file=.env script/migrate-run-mode.ts
 * Local test database:
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/migrate-run-mode.ts
 *
 * Rollback (every run becomes a deep search again, which is what they all were before list mode):
 *   ALTER TABLE prospect_runs DROP COLUMN IF EXISTS mode;
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();

const STATEMENTS = [
  `ALTER TABLE prospect_runs ADD COLUMN IF NOT EXISTS mode varchar(8) NOT NULL DEFAULT 'deep'`,
];

async function main() {
  console.log(`Database host: ${host}`);
  const pool = new pg.Pool({ connectionString: url });
  try {
    const [{ rows: before }] = [await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'prospect_runs'`,
    )];
    if (!before[0].n) { console.log("prospect_runs isn't in this database: Client Radar isn't set up here. Nothing to do."); return; }
    for (const s of STATEMENTS) await pool.query(s);
    const r = await pool.query(
      `SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'prospect_runs' AND column_name = 'mode'`,
    );
    if (!r.rows.length) { console.error("mode column still missing after the migration."); process.exit(1); }
    const c = r.rows[0];
    console.log(`prospect_runs.mode present: ${c.data_type}, default ${c.column_default}, nullable ${c.is_nullable}.`);
    // Every pre-existing run must now read as a deep search; a single 'list' row here would mean the default didn't apply.
    const counts = await pool.query(`SELECT mode, count(*)::int AS n FROM prospect_runs GROUP BY mode ORDER BY mode`);
    console.log(counts.rows.length ? counts.rows.map((x) => `  ${x.mode}: ${x.n}`).join("\n") : "  (no runs yet)");
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
