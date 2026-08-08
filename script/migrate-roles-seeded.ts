/**
 * One-time migration: organizations.roles_seeded flag.
 *
 * Built-in roles (Admin/Sales/Accounts) become per-org EDITABLE rows in
 * org_roles. New orgs are seeded at creation; existing orgs are lazy-seeded
 * on first visit to the roles list. This flag makes the lazy seed one-shot —
 * an owner who deletes a default role must never see it resurrected.
 *
 * PURELY ADDITIVE (shared Neon DB, main auto-deploys — run BEFORE pushing).
 * Run:       npx tsx --env-file=.env script/migrate-roles-seeded.ts
 * Rollback:  ALTER TABLE organizations DROP COLUMN IF EXISTS roles_seeded;
 */
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (run with: npx tsx --env-file=.env ...)");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    await client.query(
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS roles_seeded boolean NOT NULL DEFAULT false`,
    );
    const check = await client.query(`
      SELECT count(*)::int AS orgs,
             count(*) FILTER (WHERE roles_seeded)::int AS seeded
      FROM organizations`);
    console.log("after:", check.rows[0]);
    console.log("migration complete ✓ (additive only)");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("migration failed:", err);
  process.exit(1);
});
