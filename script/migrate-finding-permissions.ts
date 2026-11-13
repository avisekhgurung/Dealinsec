/**
 * Client-finding permissions (13 Nov 2026). Run ONCE on production BEFORE deploying the build that introduces
 * radar.search / leads.manage / outreach.send / ai.tasks (shared/permissions.ts), or custom-role members lose the
 * Client Radar, Leads and AI Team screens they had.
 *
 * What it does, idempotently:
 *   1. Every org_roles row that holds deals.create (what used to gate those screens) gains the four finding
 *      permissions it was implicitly exercising. Rows that already have them are left alone.
 *   2. The formerly seeded Admin / Sales / Accounts rows are deleted where nobody holds them and their permissions
 *      are still the seed set (nothing is seeded any more; a workspace's roles are only the ones its owner made).
 *      A seeded row someone edited, or that a member still holds, is kept.
 *
 * Run:   npx tsx --env-file=<the production env file> script/migrate-finding-permissions.ts
 * Flags: --dry-run   print what would change and change nothing
 *
 * Rollback: the added permission strings can be removed with the reverse UPDATE; the deleted rows were unused copies
 * of DEFAULT_ROLE_SEEDS and can be recreated from the Roles screen.
 */
import pg from "pg";
import { DEFAULT_ROLE_SEEDS, FINDING_PERMISSIONS } from "../shared/permissions";

const { Pool } = pg;
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (run with: npx tsx --env-file=<env file> ...)");
  process.exit(1);
}
const dry = process.argv.includes("--dry-run");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ id: string; organization_id: string; name: string; permissions: string[]; members: number }>(
      `SELECT r.id, r.organization_id, r.name, r.permissions,
              (SELECT count(*)::int FROM users u WHERE u.custom_role_id = r.id AND u.member_status <> 'removed') AS members
         FROM org_roles r ORDER BY r.organization_id, r.name`,
    );
    let granted = 0, removed = 0;
    for (const r of rows) {
      const perms = Array.isArray(r.permissions) ? r.permissions : [];
      const seed = DEFAULT_ROLE_SEEDS.find((s) => s.name === r.name);
      const isUntouchedSeed = !!seed && r.members === 0 &&
        perms.every((p) => seed.permissions.includes(p as any) || (FINDING_PERMISSIONS as string[]).includes(p)) &&
        seed.permissions.every((p) => perms.includes(p));
      if (isUntouchedSeed) {
        removed++;
        console.log(`${dry ? "would remove" : "removing"} unused seeded role "${r.name}" in ${r.organization_id}`);
        if (!dry) await client.query(`DELETE FROM org_roles WHERE id = $1`, [r.id]);
        continue;
      }
      if (perms.includes("deals.create") && FINDING_PERMISSIONS.some((p) => !perms.includes(p))) {
        const next = Array.from(new Set([...perms, ...FINDING_PERMISSIONS]));
        granted++;
        console.log(`${dry ? "would grant" : "granting"} finding permissions to "${r.name}" in ${r.organization_id} (${r.members} member(s))`);
        if (!dry) await client.query(`UPDATE org_roles SET permissions = $1::json, updated_at = now() WHERE id = $2`, [JSON.stringify(next), r.id]);
      }
    }
    console.log(`${rows.length} role(s) looked at: ${granted} granted finding permissions, ${removed} unused seeded role(s) removed${dry ? " (dry run, nothing changed)" : ""} ✓`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
