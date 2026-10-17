/**
 * One-time migration: the outreach channel tables (WhatsApp Business, LinkedIn and X drafts). See shared/channels.ts and
 * server/channels/ddl.ts, which holds the statements.
 *
 * PURELY ADDITIVE: three new tables and their indexes; no existing table changes. Until it runs, the WhatsApp, LinkedIn
 * and X tabs answer "not set up yet" and email outreach works exactly as before.
 *
 * Dev and production share one Neon database, so run this deliberately:
 *   npx tsx --env-file=.env script/migrate-channels.ts
 * Local test database:
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/migrate-channels.ts
 *
 * Rollback (drops the channel messages and WhatsApp connections only):
 *   DROP TABLE IF EXISTS channel_messages; DROP TABLE IF EXISTS whatsapp_contacts; DROP TABLE IF EXISTS whatsapp_connections;
 */
import pg from "pg";
import { CHANNEL_DDL, CHANNEL_TABLES } from "../server/channels/ddl";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();

async function main() {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  console.log(`Migrating ${host}: ${CHANNEL_TABLES.join(", ")}`);
  try {
    await c.query("BEGIN");
    for (const s of CHANNEL_DDL) await c.query(s);
    await c.query("COMMIT");
    console.log("Done: the outreach channel tables are ready.");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Migration failed, nothing changed:", (e as Error).message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}
void main();
