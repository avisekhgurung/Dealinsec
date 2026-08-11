/**
 * One-time migration: in-app feedback (rating + suggestion).
 * PURELY ADDITIVE. Run BEFORE pushing (prod + dev share the Neon DB):
 *   npx tsx --env-file=.env script/migrate-feedback.ts
 * Rollback: DROP TABLE IF EXISTS feedback;
 */
import pg from "pg";
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  await pool.query(`CREATE TABLE IF NOT EXISTS feedback (
    id serial PRIMARY KEY,
    user_id varchar NOT NULL,
    organization_id varchar,
    rating integer NOT NULL,
    category varchar(24),
    message text,
    created_at timestamp DEFAULT now()
  )`);
  const r = await pool.query(`SELECT count(*)::int n FROM feedback`);
  console.log("feedback table ready, rows:", r.rows[0].n);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
