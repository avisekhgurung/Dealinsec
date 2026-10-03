/**
 * One-time migration: the lead pipeline (leads, events, tickets, claims).
 *
 * PURELY ADDITIVE: only CREATE TABLE / CREATE INDEX ... IF NOT EXISTS. No column
 * is added to any existing table (the link to a deal lives on `leads`), so a
 * database without these tables simply has the lead pipeline switched off (the
 * server checks for them and answers 503 LEADS_NOT_SETUP); the rest of the app
 * is unaffected.
 *
 * Dev and production share one Neon database, so run this deliberately:
 *   npx tsx --env-file=.env script/migrate-leads.ts
 * Local test database:
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/migrate-leads.ts
 *
 * Rollback (drops the lead data only):
 *   DROP TABLE IF EXISTS lead_claims, lead_tickets, lead_events, leads;
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS leads (
    id serial PRIMARY KEY,
    organization_id varchar NOT NULL,
    owner_user_id varchar NOT NULL,
    company_name varchar(120) NOT NULL,
    website varchar(300),
    domain varchar(253),
    industry varchar(80),
    location varchar(80),
    size_hint varchar(60),
    source varchar(16) NOT NULL DEFAULT 'manual',
    status varchar(16) NOT NULL DEFAULT 'new',
    status_changed_at timestamp NOT NULL DEFAULT now(),
    fit_summary text,
    est_value_minor bigint,
    currency varchar(3),
    contact_name varchar(100),
    contact_role varchar(100),
    contact_email varchar(254),
    contact_source varchar(200),
    do_not_contact boolean NOT NULL DEFAULT false,
    lost_reason varchar(300),
    converting boolean NOT NULL DEFAULT false,
    converted_deal_id integer,
    archived_at timestamp,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS leads_org_status_idx ON leads (organization_id, status, updated_at DESC)`,
  // One live lead per company per organization.
  `CREATE UNIQUE INDEX IF NOT EXISTS leads_org_domain_uniq ON leads (organization_id, domain) WHERE domain IS NOT NULL AND archived_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS lead_events (
    id serial PRIMARY KEY,
    lead_id integer NOT NULL,
    organization_id varchar NOT NULL,
    kind varchar(24) NOT NULL,
    data jsonb,
    actor varchar(8) NOT NULL DEFAULT 'user',
    actor_user_id varchar,
    created_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS lead_events_lead_idx ON lead_events (lead_id, id)`,
  `CREATE TABLE IF NOT EXISTS lead_tickets (
    id serial PRIMARY KEY,
    lead_id integer NOT NULL,
    organization_id varchar NOT NULL,
    title varchar(200) NOT NULL,
    kind varchar(16) NOT NULL DEFAULT 'other',
    status varchar(12) NOT NULL DEFAULT 'open',
    due_at timestamp,
    created_by varchar(8) NOT NULL DEFAULT 'user',
    done_at timestamp,
    created_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS lead_tickets_lead_idx ON lead_tickets (lead_id)`,
  `CREATE INDEX IF NOT EXISTS lead_tickets_due_idx ON lead_tickets (organization_id, status, due_at)`,
  `CREATE TABLE IF NOT EXISTS lead_claims (
    id serial PRIMARY KEY,
    lead_id integer NOT NULL,
    organization_id varchar NOT NULL,
    field varchar(60) NOT NULL,
    value varchar(400) NOT NULL,
    status varchar(12) NOT NULL,
    evidence_url varchar(500),
    evidence_snippet varchar(500),
    source varchar(8) NOT NULL DEFAULT 'user',
    retrieved_at timestamp NOT NULL DEFAULT now(),
    created_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS lead_claims_lead_idx ON lead_claims (lead_id)`,
];

async function main() {
  console.log(`Database host: ${host}`);
  const pool = new pg.Pool({ connectionString: url });
  try {
    for (const s of STATEMENTS) await pool.query(s);
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name IN ('leads','lead_events','lead_tickets','lead_claims')`,
    );
    console.log(`Lead tables present: ${r.rows[0].n} of 4.`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
