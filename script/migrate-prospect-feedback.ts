/**
 * One-time migration: prospect_feedback, a person's verdict on a researched prospect (Relevant, Not relevant,
 * Duplicate, Already contacted). See shared/prospect-feedback.ts and server/outbound/prospect-feedback.ts.
 *
 * PURELY ADDITIVE: one new table and its index; no existing table changes. Until it runs, the feedback buttons answer
 * "not set up yet" and everything else works as before.
 *
 * Dev and production share one Neon database, so run this deliberately:
 *   npx tsx --env-file=.env script/migrate-prospect-feedback.ts
 * Local test database:
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/migrate-prospect-feedback.ts
 *
 * Rollback (drops the feedback only):
 *   DROP TABLE IF EXISTS prospect_feedback;
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS prospect_feedback (
    organization_id varchar NOT NULL,
    prospect_id integer NOT NULL,
    value varchar(20) NOT NULL CHECK (value IN ('relevant', 'not_relevant', 'duplicate', 'already_contacted')),
    user_id varchar NOT NULL,
    updated_at timestamp NOT NULL,
    PRIMARY KEY (organization_id, prospect_id)
  )`,
];

async function main() {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  console.log(`Migrating ${host}: prospect_feedback`);
  try {
    await c.query("BEGIN");
    for (const s of STATEMENTS) await c.query(s);
    await c.query("COMMIT");
    console.log("Done: prospect_feedback is ready.");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Migration failed, nothing changed:", (e as Error).message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}
void main();
