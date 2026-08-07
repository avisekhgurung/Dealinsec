/**
 * One-time migration: single-user → organization-based platform.
 *
 * ADDITIVE ONLY (the deployed prod build shares this DB and selects columns
 * by name — nothing is renamed or dropped):
 *  - Creates organizations / invitations / activity_logs tables.
 *  - Adds org membership columns to users and organization_id to the five
 *    business entity tables.
 *  - Backfills: one organization per existing user (they become its OWNER),
 *    then stamps organization_id onto every existing deal/quote/contract/
 *    invoice/brand_invoice via its user_id.
 *
 * Billing stays on the owner's user row — organizations resolve entitlements
 * through their owner, so no payment/credit data moves.
 *
 * Run:       npx tsx --env-file=.env script/migrate-organizations.ts
 * Idempotent: CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS; the
 * backfill only touches rows where organization_id IS NULL.
 */
import pg from "pg";
import crypto from "crypto";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (run with: npx tsx --env-file=.env ...)");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    // ── Tables ──
    await c.query(`CREATE TABLE IF NOT EXISTS organizations (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar NOT NULL,
      slug varchar UNIQUE,
      logo varchar,
      industry varchar,
      extra_seats integer NOT NULL DEFAULT 0,
      extra_seats_expires_at timestamp,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    )`);

    await c.query(`CREATE TABLE IF NOT EXISTS invitations (
      id serial PRIMARY KEY,
      organization_id varchar NOT NULL REFERENCES organizations(id),
      email varchar NOT NULL,
      org_role varchar NOT NULL DEFAULT 'SALES',
      token varchar NOT NULL UNIQUE,
      invited_by varchar REFERENCES users(id),
      status varchar NOT NULL DEFAULT 'pending',
      expires_at timestamp NOT NULL,
      created_at timestamp DEFAULT now()
    )`);

    await c.query(`CREATE TABLE IF NOT EXISTS activity_logs (
      id serial PRIMARY KEY,
      organization_id varchar NOT NULL REFERENCES organizations(id),
      user_id varchar REFERENCES users(id),
      user_name varchar,
      action varchar NOT NULL,
      entity_type varchar NOT NULL,
      entity_id varchar,
      detail varchar,
      created_at timestamp DEFAULT now()
    )`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_activity_org_time ON activity_logs (organization_id, created_at DESC)`);

    // ── users membership columns ──
    await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS organization_id varchar`);
    await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS org_role varchar NOT NULL DEFAULT 'OWNER'`);
    await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS member_status varchar NOT NULL DEFAULT 'active'`);
    await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by varchar`);
    await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS joined_at timestamp`);

    // ── entity organization_id ──
    for (const t of ["deals", "quotes", "contracts", "invoices", "brand_invoices"]) {
      await c.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS organization_id varchar`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_${t}_org ON ${t} (organization_id)`);
    }

    // ── Backfill: one org per user without one ──
    const orphans = await c.query(
      `SELECT id, email, first_name, last_name, created_at FROM users WHERE organization_id IS NULL`,
    );
    let created = 0;
    for (const u of orphans.rows) {
      const base = (u.first_name || (u.email || "my").split("@")[0] || "My").trim();
      const name = `${base}'s Workspace`;
      const slug =
        base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) +
        "-" + crypto.randomBytes(3).toString("hex");
      const org = await c.query(
        `INSERT INTO organizations (name, slug, created_at) VALUES ($1, $2, COALESCE($3, now())) RETURNING id`,
        [name, slug, u.created_at],
      );
      await c.query(
        `UPDATE users SET organization_id = $1, org_role = 'OWNER', member_status = 'active',
           joined_at = COALESCE(joined_at, created_at, now()) WHERE id = $2`,
        [org.rows[0].id, u.id],
      );
      created++;
    }

    // ── Backfill entity organization_id from the row's user ──
    const counts: Record<string, number> = {};
    for (const t of ["deals", "quotes", "contracts", "invoices", "brand_invoices"]) {
      const r = await c.query(
        `UPDATE ${t} e SET organization_id = u.organization_id
         FROM users u WHERE e.user_id = u.id AND e.organization_id IS NULL`,
      );
      counts[t] = r.rowCount ?? 0;
    }

    await c.query("COMMIT");

    const after = await c.query(`
      SELECT (SELECT count(*)::int FROM organizations) AS orgs,
             (SELECT count(*)::int FROM users WHERE organization_id IS NULL) AS users_without_org,
             (SELECT count(*)::int FROM deals WHERE organization_id IS NULL) AS deals_without_org`);
    console.log(`orgs created this run: ${created}`);
    console.log("entity rows backfilled:", counts);
    console.log("after:", after.rows[0]);
    console.log("migration complete ✓ (additive only)");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("migration failed:", err);
  process.exit(1);
});
