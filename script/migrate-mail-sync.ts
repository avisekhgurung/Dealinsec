/**
 * One-time migration: Gmail reply sync (Release B). Three new tables; nothing existing is touched.
 *
 *   mail_sync_state  per connected mailbox: the Gmail history cursor, lease and retry state
 *   mail_threads     a Gmail thread tied to one outreach message
 *   mail_messages    the synced messages of those conversations (plain text, quoted history removed)
 *
 * Additive and idempotent, in one transaction. It REFUSES, changing nothing, when an existing object of the same name
 * differs (server/mail/mailbox-schema.ts). Without it reply sync stays off; connecting and sending are unaffected.
 *
 * Dev and production share one Neon database, so run this deliberately. Check first (always rolls back):
 *   npx tsx --env-file=.env script/migrate-mail-sync.ts --check
 *   npx tsx --env-file=.env script/migrate-mail-sync.ts
 * Local test database:
 *   DATABASE_URL=postgresql://<user>@localhost:<port>/<db> npx tsx script/migrate-mail-sync.ts
 *
 * Rollback: DROP TABLE IF EXISTS mail_messages; DROP TABLE IF EXISTS mail_threads; DROP TABLE IF EXISTS mail_sync_state;
 * (synced copies only: the mailbox itself is untouched, and the next sync rebuilds them from Gmail).
 */
import pg from "pg";
import { MailboxSchemaError } from "../server/mail/mailbox-schema";
import { runMailSyncMigration } from "../server/mail/mail-sync-schema";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();
const dryRun = process.argv.includes("--check");

const client = new pg.Client({ connectionString: url });
await client.connect();
console.log(`${dryRun ? "checking" : "migrating"} reply-sync tables on ${host}`);
try {
  const r = await runMailSyncMigration((text, params) => client.query(text, params as any[]), { dryRun });
  const verb = dryRun ? "would create" : "created";
  console.log(`tables ${verb}:`, r.created.length ? r.created.join(", ") : "none (already present)");
  if (r.addedChecks.length) console.log(`checks ${dryRun ? "that would be added" : "added"} to existing tables:`, r.addedChecks.join(", "));
  console.log(`indexes ${verb}:`, r.createdIndexes.length ? r.createdIndexes.join(", ") : "none (already present)");
  console.log(dryRun ? "check passed ✓ (rolled back, nothing changed)" : "migration complete ✓ (additive only)");
} catch (e) {
  console.error(e instanceof MailboxSchemaError ? e.message : e);
  process.exitCode = 1;
} finally {
  await client.end();
}
