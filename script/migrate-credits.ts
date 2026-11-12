/**
 * One-time migration: credit top-ups (purchased search/draft credits) + the platform-admin flag.
 *
 * PURELY ADDITIVE: new tables, new nullable columns, nothing renamed or dropped, so the deployed build keeps running
 * while this runs. Run it on the PRODUCTION database BEFORE deploying the code that reads these tables
 * (the fail-closed schema gate aside, the new build selects users.is_platform_admin by name and would 500 without it).
 *
 * Creates:
 *   credit_packs      packs on sale (kind, units, price, active, expiry policy) — all editable without a deploy
 *   credit_purchases  what a credit-pack order buys, frozen at order time
 *   credit_lots       credits a workspace owns (remaining, expiry), one lot per grant
 *   credit_ledger     every credit movement, idempotent by (reason, source_ref)
 *   billing_config    runtime config rows (allowance overrides, warn threshold, spend headroom)
 *   admin_audit_log   every platform-admin change, with the mandatory reason
 * Adds columns:
 *   prospect_runs.funded_by, lead_messages.funded_by, channel_messages.funded_by  ('credit' when a purchased credit
 *     paid for the action; the plan's rolling-window counts skip these rows)
 *   users.is_platform_admin (default false)
 * Seeds credit_packs with the launch price list ONLY when the table is empty (re-running never re-seeds, so edits
 * and deactivations made in the admin screen survive).
 *
 * Run:        npx tsx --env-file=.env script/migrate-credits.ts
 * Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, seed only into an empty table.
 *
 * To make the founder's account the platform admin afterwards (by hand, deliberately not a flag of this script):
 *   UPDATE users SET is_platform_admin = true WHERE email = '<founder email>';
 *
 * Rollback (non-destructive; purchased balances live in credit_lots — dropping them destroys paid value, so only
 * drop tables if nothing was ever sold):
 *   ALTER TABLE prospect_runs    DROP COLUMN IF EXISTS funded_by;
 *   ALTER TABLE lead_messages    DROP COLUMN IF EXISTS funded_by;
 *   ALTER TABLE channel_messages DROP COLUMN IF EXISTS funded_by;
 *   ALTER TABLE users            DROP COLUMN IF EXISTS is_platform_admin;
 *   DROP TABLE IF EXISTS admin_audit_log, billing_config, credit_ledger, credit_lots, credit_purchases, credit_packs;
 */
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (run with: npx tsx --env-file=.env ...)");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** How long bought credits stay usable at launch (months). A PROPOSAL, editable per pack in the admin screen (empty = never expire); shown to the buyer before checkout and in the wallet. */
const SEED_EXPIRY_MONTHS = 12;

/** The launch price list (seeded only when credit_packs is empty; after that the DB rows are the truth). */
const SEED_PACKS: { kind: "search" | "draft"; units: number; priceRupees: number; sortOrder: number }[] = [
  { kind: "search", units: 5, priceRupees: 49, sortOrder: 1 },
  { kind: "search", units: 15, priceRupees: 129, sortOrder: 2 },
  { kind: "search", units: 30, priceRupees: 229, sortOrder: 3 },
  { kind: "search", units: 50, priceRupees: 349, sortOrder: 4 },
  { kind: "draft", units: 25, priceRupees: 49, sortOrder: 1 },
  { kind: "draft", units: 50, priceRupees: 89, sortOrder: 2 },
  { kind: "draft", units: 100, priceRupees: 149, sortOrder: 3 },
  { kind: "draft", units: 250, priceRupees: 299, sortOrder: 4 },
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS credit_packs (
        id serial PRIMARY KEY,
        kind varchar(8) NOT NULL,
        units integer NOT NULL,
        price_rupees integer NOT NULL,
        active boolean NOT NULL DEFAULT true,
        sort_order integer NOT NULL DEFAULT 0,
        expiry_months integer,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT credit_packs_kind_ck CHECK (kind IN ('search', 'draft')),
        CONSTRAINT credit_packs_units_ck CHECK (units >= 1),
        CONSTRAINT credit_packs_price_ck CHECK (price_rupees >= 1)
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS credit_purchases (
        order_id varchar PRIMARY KEY,
        organization_id varchar NOT NULL,
        user_id varchar NOT NULL,
        pack_id integer NOT NULL,
        kind varchar(8) NOT NULL,
        units integer NOT NULL,
        price_rupees integer NOT NULL,
        expiry_months integer,
        created_at timestamp NOT NULL
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS credit_lots (
        id serial PRIMARY KEY,
        organization_id varchar NOT NULL,
        kind varchar(8) NOT NULL,
        units integer NOT NULL,
        remaining integer NOT NULL,
        source varchar(12) NOT NULL,
        order_id varchar,
        pack_id integer,
        expires_at timestamp,
        created_at timestamp NOT NULL,
        CONSTRAINT credit_lots_kind_ck CHECK (kind IN ('search', 'draft')),
        CONSTRAINT credit_lots_remaining_ck CHECK (remaining >= 0 AND remaining <= units)
      )`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS credit_lots_order_uq ON credit_lots (order_id) WHERE order_id IS NOT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS credit_lots_open_idx ON credit_lots (organization_id, kind) WHERE remaining > 0`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS credit_ledger (
        id serial PRIMARY KEY,
        organization_id varchar NOT NULL,
        kind varchar(8) NOT NULL,
        delta integer NOT NULL,
        reason varchar(16) NOT NULL,
        lot_id integer,
        source_ref varchar(80),
        note varchar(300),
        actor_user_id varchar,
        created_at timestamp NOT NULL
      )`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_reason_ref_uq ON credit_ledger (reason, source_ref) WHERE source_ref IS NOT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS credit_ledger_org_idx ON credit_ledger (organization_id, created_at)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS billing_config (
        key varchar(40) PRIMARY KEY,
        value jsonb NOT NULL,
        updated_by varchar,
        updated_at timestamp NOT NULL
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id serial PRIMARY KEY,
        admin_user_id varchar NOT NULL,
        action varchar(40) NOT NULL,
        target varchar(120),
        reason varchar(300),
        detail jsonb,
        created_at timestamp NOT NULL
      )`);
    await client.query(`CREATE INDEX IF NOT EXISTS admin_audit_log_when_idx ON admin_audit_log (created_at)`);

    await client.query(`ALTER TABLE prospect_runs ADD COLUMN IF NOT EXISTS funded_by varchar(8)`);
    await client.query(`ALTER TABLE lead_messages ADD COLUMN IF NOT EXISTS funded_by varchar(8)`);
    await client.query(`ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS funded_by varchar(8)`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false`);

    const { rows: [{ n }] } = await client.query(`SELECT count(*)::int AS n FROM credit_packs`);
    if (n === 0) {
      for (const p of SEED_PACKS) {
        await client.query(
          `INSERT INTO credit_packs (kind, units, price_rupees, sort_order, expiry_months) VALUES ($1, $2, $3, $4, $5)`,
          [p.kind, p.units, p.priceRupees, p.sortOrder, SEED_EXPIRY_MONTHS],
        );
      }
      console.log(`seeded ${SEED_PACKS.length} credit packs (launch price list, credits valid ${SEED_EXPIRY_MONTHS} months)`);
    } else {
      console.log(`credit_packs already has ${n} row(s) — seed skipped`);
    }

    await client.query("COMMIT");

    const after = await client.query(`
      SELECT (SELECT count(*)::int FROM credit_packs) AS packs,
             (SELECT count(*)::int FROM credit_lots) AS lots,
             (SELECT count(*)::int FROM credit_ledger) AS ledger_lines,
             (SELECT count(*)::int FROM users WHERE is_platform_admin) AS platform_admins`);
    console.log("after:", after.rows[0]);
    console.log("migration complete ✓ (additive only — deployed prod code unaffected)");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("migration failed:", err);
  process.exit(1);
});
