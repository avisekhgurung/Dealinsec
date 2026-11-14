/**
 * Company size on the ideal client (14 Nov 2026). Run ONCE on production BEFORE deploying the build that adds the
 * size criterion, or every read of client_profiles fails on the missing columns.
 *
 * Why: the ideal client could say what kind of company and where, but not how big. So a 400-person agency in a target
 * city and a target industry was a full match, and nothing in drafting ever objected. The two columns let a workspace
 * say "up to 10 people", which the fit check compares against a headcount the company states about itself
 * (shared/fit.ts sizeSignal) and never against a guess.
 *
 * What it does, idempotently:
 *   ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS min_employees integer, max_employees integer
 *
 * Both are NULL for every existing workspace, which means "no size criterion" — so no workspace's verdicts change
 * until its owner sets a size.
 *
 * Run:   npx tsx --env-file=<the production env file> script/migrate-ideal-size.ts
 * Flags: --dry-run   print what would change and change nothing
 *
 * Rollback: ALTER TABLE client_profiles DROP COLUMN min_employees, DROP COLUMN max_employees. Nothing else reads them.
 */
import pg from "pg";

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
    const { rows: present } = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'client_profiles' AND column_name IN ('min_employees', 'max_employees')`,
    );
    const have = new Set(present.map((r) => r.column_name));
    const missing = ["min_employees", "max_employees"].filter((c) => !have.has(c));
    const { rows: [count] } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM client_profiles`);

    if (!missing.length) {
      console.log(`Nothing to do: both columns already exist (${count?.n ?? 0} saved ideal client(s)).`);
      return;
    }
    console.log(`${dry ? "Would add" : "Adding"} to client_profiles: ${missing.join(", ")} (${count?.n ?? 0} saved ideal client(s), all left with no size criterion).`);
    if (dry) return;

    await client.query("BEGIN");
    await client.query(`ALTER TABLE client_profiles
      ADD COLUMN IF NOT EXISTS min_employees integer,
      ADD COLUMN IF NOT EXISTS max_employees integer`);
    await client.query("COMMIT");
    console.log("Done. Both columns are NULL everywhere, so no workspace's fit verdicts change yet.");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
