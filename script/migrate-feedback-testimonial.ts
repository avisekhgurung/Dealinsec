/**
 * One-time migration: testimonial consent on feedback.
 * A quote may only be published if its author ticked the box — publishing
 * without consent is the fabricated-testimonial problem with extra steps.
 * PURELY ADDITIVE. Run BEFORE pushing:
 *   npx tsx --env-file=.env script/migrate-feedback-testimonial.ts
 * Rollback: ALTER TABLE feedback DROP COLUMN IF EXISTS allow_testimonial;
 */
import pg from "pg";
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  await pool.query(`ALTER TABLE feedback ADD COLUMN IF NOT EXISTS allow_testimonial boolean NOT NULL DEFAULT false`);
  const r = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='feedback' ORDER BY ordinal_position`);
  console.log("feedback columns:", r.rows.map((x) => x.column_name).join(", "));
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
