/**
 * One-time migration: outreach safety (two tables).
 *
 * PURELY ADDITIVE: CREATE TABLE / INDEX IF NOT EXISTS only. Nothing existing is touched. Without it the outreach
 * workflow keeps working exactly as before: with no table there can be no suppressed address, and recording an outcome
 * (reply, bounce, opt-out) or managing the do-not-contact list answers 503 OUTREACH_SAFETY_NOT_SETUP.
 *
 *   outreach_suppressions  an organization's do-not-contact addresses and domains (unique per organization)
 *   outreach_events        what happened to a sent message (unique per message and kind: a repeat counts once)
 *
 * Dev and production share one Neon database, so run this deliberately:
 *   npx tsx --env-file=.env script/migrate-outreach-safety.ts
 * Local test database:
 *   DATABASE_URL=postgresql://<user>@localhost:<port>/<db> npx tsx script/migrate-outreach-safety.ts
 *
 * Rollback:  DROP TABLE IF EXISTS outreach_events; DROP TABLE IF EXISTS outreach_suppressions;
 * (Dropping loses recorded opt-outs: export them first.)
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS outreach_suppressions (
    id serial PRIMARY KEY,
    organization_id varchar NOT NULL,
    kind varchar(8) NOT NULL,
    value varchar(254) NOT NULL,
    reason varchar(12) NOT NULL,
    source_message_id integer,
    note varchar(200),
    created_by varchar,
    created_at timestamp NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS outreach_suppressions_org_kind_value_uq ON outreach_suppressions (organization_id, kind, value)`,
  `CREATE TABLE IF NOT EXISTS outreach_events (
    id serial PRIMARY KEY,
    organization_id varchar NOT NULL,
    lead_id integer NOT NULL,
    message_id integer NOT NULL,
    kind varchar(12) NOT NULL,
    source varchar(8) NOT NULL,
    provider varchar(24),
    provider_message_id varchar(200),
    actor_user_id varchar,
    created_at timestamp NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS outreach_events_org_message_kind_uq ON outreach_events (organization_id, message_id, kind)`,
  `CREATE INDEX IF NOT EXISTS outreach_events_message_idx ON outreach_events (organization_id, message_id)`,
];

const client = new pg.Client({ connectionString: url });
await client.connect();
console.log(`migrating outreach safety on ${host}`);
try {
  for (const s of STATEMENTS) await client.query(s);
  const t = await client.query(`SELECT to_regclass('outreach_suppressions') IS NOT NULL a, to_regclass('outreach_events') IS NOT NULL b`);
  console.log("tables present:", t.rows[0]);
  console.log("migration complete ✓ (additive only)");
} finally {
  await client.end();
}
