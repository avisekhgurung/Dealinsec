/**
 * One-time migration: document styles (one table).
 *
 * PURELY ADDITIVE: one CREATE TABLE IF NOT EXISTS. Nothing existing is touched.
 * Without it the style feature is simply off (the server answers 503
 * DOCUMENT_STYLE_NOT_SETUP and documents print in the default style).
 *
 * Dev and production share one Neon database, so run this deliberately:
 *   npx tsx --env-file=.env script/migrate-document-style.ts
 * Local test database:
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/migrate-document-style.ts
 *
 * Rollback:  DROP TABLE IF EXISTS document_styles;
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS document_styles (
    organization_id varchar PRIMARY KEY,
    accent varchar(12) NOT NULL DEFAULT 'emerald',
    font varchar(8) NOT NULL DEFAULT 'sans',
    footer_note varchar(200),
    updated_by varchar NOT NULL,
    updated_at timestamp NOT NULL DEFAULT now()
  )`,
];

async function main() {
  console.log(`Database host: ${host}`);
  const pool = new pg.Pool({ connectionString: url });
  try {
    for (const s of STATEMENTS) await pool.query(s);
    const r = await pool.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'document_styles'`);
    console.log(`Document style table present: ${r.rows[0].n} of 1.`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
