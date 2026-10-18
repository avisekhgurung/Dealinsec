/**
 * One-time migration: the AI League tables (Nibo, Mika and Zee). See server/ai-league/ddl.ts for the statements.
 *
 * PURELY ADDITIVE: five new tables and their indexes; no existing table changes. Until it runs, the AI League page says
 * it isn't set up yet and everything else works as before.
 *
 * Dev and production share one Neon database, so run this deliberately:
 *   npx tsx --env-file=.env script/migrate-ai-league.ts
 * Local test database:
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/migrate-ai-league.ts
 *
 * Rollback (drops AI League's own rows only; agent sessions stay in Agent mode's tables):
 *   DROP TABLE IF EXISTS league_memory, league_schedules, league_run_events, league_runs, league_threads;
 */
import pg from "pg";
import { LEAGUE_DDL, LEAGUE_TABLES } from "../server/ai-league/ddl";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();

async function main() {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  console.log(`Migrating ${host}: ${LEAGUE_TABLES.join(", ")}`);
  try {
    await c.query("BEGIN");
    for (const s of LEAGUE_DDL) await c.query(s);
    await c.query("COMMIT");
    console.log("Done: the AI League tables are ready.");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Migration failed, nothing changed:", (e as Error).message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}
void main();
