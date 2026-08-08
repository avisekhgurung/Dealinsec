/**
 * One-time migration: owner-minted custom roles with a permission matrix.
 *
 * PURELY ADDITIVE (prod and dev share the Neon DB; main auto-deploys —
 * run this BEFORE pushing code that selects the new columns):
 * - org_roles table (org-scoped, name unique per org)
 * - users.custom_role_id / invitations.custom_role_id (nullable)
 *
 * Run:       npx tsx --env-file=.env script/migrate-custom-roles.ts
 * Idempotent: IF NOT EXISTS everywhere.
 *
 * Rollback (non-destructive):
 *   ALTER TABLE users DROP COLUMN IF EXISTS custom_role_id;
 *   ALTER TABLE invitations DROP COLUMN IF EXISTS custom_role_id;
 *   DROP TABLE IF EXISTS org_roles;
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
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS org_roles (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id varchar NOT NULL,
        name varchar(40) NOT NULL,
        permissions json NOT NULL DEFAULT '[]'::json,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )`);
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS org_roles_org_name_uniq ON org_roles (organization_id, lower(name))`,
    );
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role_id varchar`);
    await client.query(`ALTER TABLE invitations ADD COLUMN IF NOT EXISTS custom_role_id varchar`);
    await client.query("COMMIT");

    const check = await client.query(`
      SELECT (SELECT count(*)::int FROM org_roles) AS roles,
             (SELECT count(*)::int FROM users WHERE custom_role_id IS NOT NULL) AS custom_members`);
    console.log("after:", check.rows[0]);
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
