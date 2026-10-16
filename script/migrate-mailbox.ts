/**
 * One-time migration: connected mailboxes, Gmail Release A (send-only). Two new tables; nothing existing is touched.
 *
 *   mailbox_connections  a person's connected mailbox and its sealed refresh token
 *   mail_send_jobs       one row per approved message handed to the provider (the duplicate-send guard)
 *
 * Additive and idempotent, in one transaction. It REFUSES, changing nothing, when an existing object of the same name
 * differs (column type or nullability, index or check definition, a non-table under a table's name); see
 * server/mail/mailbox-schema.ts. Without it the Gmail integration stays off (its gate reports not_migrated).
 *
 * Dev and production share one Neon database, so run this deliberately. Check first (always rolls back):
 *   npx tsx --env-file=.env script/migrate-mailbox.ts --check
 *   npx tsx --env-file=.env script/migrate-mailbox.ts
 * Local test database:
 *   DATABASE_URL=postgresql://<user>@localhost:<port>/<db> npx tsx script/migrate-mailbox.ts
 *
 * Rollback (before any mailbox is connected):  DROP TABLE IF EXISTS mail_send_jobs; DROP TABLE IF EXISTS mailbox_connections;
 * After mailboxes are connected, dropping loses the send history that prevents duplicate sends: export it first.
 */
import pg from "pg";
import { MailboxSchemaError, runMailboxMigration } from "../server/mail/mailbox-schema";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();
const dryRun = process.argv.includes("--check");

const client = new pg.Client({ connectionString: url });
await client.connect();
console.log(`${dryRun ? "checking" : "migrating"} mailbox tables on ${host}`);
try {
  const r = await runMailboxMigration((text, params) => client.query(text, params as any[]), { dryRun });
  const verb = dryRun ? "would create" : "created";
  console.log(`tables ${verb}:`, r.created.length ? r.created.join(", ") : "none (already present)");
  if (r.addedColumns.length) console.log(`columns ${dryRun ? "that would be added" : "added"} to existing tables:`, r.addedColumns.join(", "));
  if (r.addedChecks.length) console.log(`checks ${dryRun ? "that would be added" : "added"} to existing tables:`, r.addedChecks.join(", "));
  console.log(`indexes ${verb}:`, r.createdIndexes.length ? r.createdIndexes.join(", ") : "none (already present)");
  console.log(dryRun ? "check passed ✓ (rolled back, nothing changed)" : "migration complete ✓ (additive only)");
} catch (e) {
  console.error(e instanceof MailboxSchemaError ? e.message : e);
  process.exitCode = 1;
} finally {
  await client.end();
}
