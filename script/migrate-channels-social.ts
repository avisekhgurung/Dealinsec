/**
 * One-time migration: lets channel_messages hold Instagram and Facebook Messenger drafts (server/channels/ddl.ts
 * SOCIAL_CHANNEL_DDL). It widens one CHECK constraint; no row, column or table changes. Every existing row passes the
 * new check. Until it runs, Instagram and Messenger show "not switched on yet" and every other channel works as before.
 *
 *   Check only:  DATABASE_URL=… npx tsx script/migrate-channels-social.ts --check
 *   Apply:       DATABASE_URL=… npx tsx script/migrate-channels-social.ts
 * Local test database:
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/migrate-channels-social.ts
 * On the production server the same statement can be run with psql (it is one line, in SOCIAL_CHANNEL_DDL).
 *
 * Rollback (only while no Instagram or Messenger row exists):
 *   ALTER TABLE channel_messages DROP CONSTRAINT channel_messages_channel_ck,
 *     ADD CONSTRAINT channel_messages_channel_ck CHECK (channel IN ('whatsapp', 'linkedin', 'x'));
 */
import pg from "pg";
import { SOCIAL_CHANNEL_DDL } from "../server/channels/ddl";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();
const checkOnly = process.argv.includes("--check");

async function main() {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const table = (await c.query(`SELECT to_regclass('channel_messages') IS NOT NULL AS present`)).rows[0]?.present;
    if (!table) { console.error(`${host}: channel_messages doesn't exist. Run script/migrate-channels.ts first.`); process.exitCode = 1; return; }
    const def = String((await c.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'channel_messages_channel_ck'`)).rows[0]?.def ?? "(none)");
    const done = def.includes("'instagram'") && def.includes("'messenger'");
    console.log(`${host}: channel check is ${def}`);
    if (done) { console.log("Already done: Instagram and Messenger are allowed."); return; }
    if (checkOnly) { console.log("Check only: nothing changed. Run without --check to apply."); return; }
    await c.query("BEGIN");
    for (const s of SOCIAL_CHANNEL_DDL) await c.query(s);
    await c.query("COMMIT");
    console.log("Done: Instagram and Messenger drafts can be stored.");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Migration failed, nothing changed:", (e as Error).message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}
void main();
