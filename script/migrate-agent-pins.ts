/**
 * One-time migration: pinned conversations in Agent mode (server/agent/pins.ts).
 *
 * PURELY ADDITIVE: one new table and its index; no existing table changes. Until it runs, the conversation list works
 * as before and pinning answers that it isn't set up yet.
 *
 * Dev and production share one Neon database, so run this deliberately:
 *   npx tsx --env-file=.env script/migrate-agent-pins.ts
 * Local test database:
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/migrate-agent-pins.ts
 *
 * Rollback: DROP TABLE IF EXISTS agent_session_pins;
 */
import pg from "pg";
import { AGENT_PIN_DDL, AGENT_PIN_TABLES } from "../server/agent/pins";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();

async function main() {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  console.log(`Migrating ${host}: ${AGENT_PIN_TABLES.join(", ")}`);
  try {
    await c.query("BEGIN");
    for (const s of AGENT_PIN_DDL) await c.query(s);
    await c.query("COMMIT");
    console.log("Done: pinned conversations are ready.");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Migration failed, nothing changed:", (e as Error).message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}
void main();
