/**
 * One-time migration: message versions (draft variants) on lead_messages.
 *
 * PURELY ADDITIVE: ALTER TABLE ... ADD COLUMN IF NOT EXISTS only. Nothing existing is touched, no row changes.
 * The columns record how a message opens (its strategy), which generation batch it came from, and when it was
 * picked over its siblings. Without them a server running the variants code would fail on insert, so run this
 * BEFORE deploying that code. A server without the code ignores the columns entirely.
 *
 * Dev and production share one Neon database, so run this deliberately:
 *   npx tsx --env-file=.env script/migrate-draft-variants.ts
 * Local test database:
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/migrate-draft-variants.ts
 *
 * Rollback: ALTER TABLE lead_messages DROP COLUMN IF EXISTS strategy, DROP COLUMN IF EXISTS variant_group, DROP COLUMN IF EXISTS chosen_at;
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();

const STATEMENTS = [
  `ALTER TABLE lead_messages ADD COLUMN IF NOT EXISTS strategy varchar(12)`,
  `ALTER TABLE lead_messages ADD COLUMN IF NOT EXISTS variant_group varchar(36)`,
  `ALTER TABLE lead_messages ADD COLUMN IF NOT EXISTS chosen_at timestamp`,
];

async function main() {
  console.log(`Database host: ${host}`);
  const pool = new pg.Pool({ connectionString: url });
  try {
    for (const s of STATEMENTS) await pool.query(s);
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'lead_messages' AND column_name IN ('strategy', 'variant_group', 'chosen_at')`,
    );
    console.log(`Variant columns present: ${r.rows[0].n} of 3.`);
    if (r.rows[0].n !== 3) process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
