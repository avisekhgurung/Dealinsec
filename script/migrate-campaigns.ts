/**
 * One-time migration: campaigns (campaigns, campaign_members) — a named group of leads written to together.
 *
 * PURELY ADDITIVE and IDEMPOTENT: only CREATE TABLE / CREATE INDEX ... IF NOT EXISTS. No existing table is touched and
 * no row is written. A database without these tables simply has campaigns switched off (the server checks for them
 * and answers 503 CAMPAIGNS_NOT_SETUP); outreach and everything else work as before. Safe to run BEFORE deploying,
 * which is the order to use: migrate first, then deploy.
 *
 * Against a database this machine can reach:
 *   npx tsx --env-file=.env script/migrate-campaigns.ts
 * Local test database:
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/migrate-campaigns.ts
 * The production server has no tsx and its Postgres listens only on the box: there the same statements are applied
 * through the server's own psql, as the application's database role. Applied on production that way on 10 Nov 2026.
 *
 * Rollback (drops the grouping only; every message a campaign prepared stays in Outreach as an ordinary message):
 *   DROP TABLE IF EXISTS campaign_members, campaigns;
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS campaigns (
    id serial PRIMARY KEY,
    organization_id varchar NOT NULL,
    created_by_user varchar NOT NULL,
    name varchar(80) NOT NULL,
    profile_id integer,
    profile_name varchar(80),
    status varchar(10) NOT NULL DEFAULT 'active',
    footer_note varchar(200) NOT NULL DEFAULT '',
    preparing boolean NOT NULL DEFAULT false,
    prepare_user_id varchar,
    prepare_stop varchar(24),
    sending boolean NOT NULL DEFAULT false,
    sender_user_id varchar,
    send_stop varchar(24),
    daily_limit integer NOT NULL DEFAULT 20,
    gap_seconds integer NOT NULL DEFAULT 180,
    next_send_at timestamp,
    lease_until timestamp,
    created_at timestamp NOT NULL,
    updated_at timestamp NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS campaigns_org_idx ON campaigns (organization_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS campaigns_work_idx ON campaigns (preparing, sending)`,
  `CREATE TABLE IF NOT EXISTS campaign_members (
    id serial PRIMARY KEY,
    campaign_id integer NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    organization_id varchar NOT NULL,
    lead_id integer NOT NULL,
    message_id integer,
    state varchar(10) NOT NULL DEFAULT 'queued',
    reason varchar(24),
    attempts integer NOT NULL DEFAULT 0,
    hold_reason varchar(24),
    hold_hash varchar(64),
    lease_until timestamp,
    created_at timestamp NOT NULL,
    updated_at timestamp NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS campaign_members_campaign_lead_uq ON campaign_members (campaign_id, lead_id)`,
  `CREATE INDEX IF NOT EXISTS campaign_members_lead_idx ON campaign_members (organization_id, lead_id)`,
  `CREATE INDEX IF NOT EXISTS campaign_members_queue_idx ON campaign_members (campaign_id, state)`,
];

async function main() {
  console.log(`Database host: ${host}`);
  const pool = new pg.Pool({ connectionString: url });
  try {
    for (const s of STATEMENTS) await pool.query(s);
    const t = await pool.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('campaigns', 'campaign_members')`);
    const i = await pool.query(`SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname = current_schema() AND tablename IN ('campaigns', 'campaign_members')`);
    console.log(`Campaign tables present: ${t.rows[0].n} of 2, ${i.rows[0].n} indexes (7 expected).`);
    if (t.rows[0].n !== 2 || i.rows[0].n !== 7) process.exit(1);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
