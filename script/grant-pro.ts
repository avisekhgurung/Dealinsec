/**
 * Operator: give one existing account Pro until a date (the founder's own accounts, a comp). DRY RUN unless --apply.
 * It changes exactly one row's plan, plan_term and plan_expires_at, found by exact email; it creates no account and
 * never touches a password. It prints the account's workspace id, which is what UNLIMITED_ORG_IDS takes
 * (server/unlimited.ts) to lift that workspace's usage limits.
 *
 *   npx tsx --env-file=.env script/grant-pro.ts someone@example.com                      show what would change
 *   npx tsx --env-file=.env script/grant-pro.ts someone@example.com --apply              Pro until 2099-12-31
 *   npx tsx --env-file=.env script/grant-pro.ts someone@example.com --until 2027-12-31 --apply
 *
 * With --env-file=.env this is the PRODUCTION database (dev and production share one): run it deliberately.
 */
const pg = (await import("pg")).default;

const email = (process.argv[2] ?? "").trim().toLowerCase();
const apply = process.argv.includes("--apply");
const untilArg = (() => { const i = process.argv.indexOf("--until"); return i > 0 ? process.argv[i + 1] : "2099-12-31"; })();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error("Usage: grant-pro.ts <email> [--until YYYY-MM-DD] [--apply]"); process.exit(2); }
if (!/^\d{4}-\d{2}-\d{2}$/.test(untilArg) || !(new Date(`${untilArg}T23:59:59Z`).getTime() > Date.now())) { console.error("--until must be a future date, YYYY-MM-DD"); process.exit(2); }
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(2); }
const until = `${untilArg} 23:59:59`;   // stored as UTC wall time (timestamp without time zone)

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN");
  const rows = (await db.query(`SELECT id, organization_id, plan, plan_term, plan_expires_at FROM users WHERE lower(email) = $1 FOR UPDATE`, [email])).rows;
  if (rows.length !== 1) {
    await db.query("ROLLBACK");
    console.error(rows.length ? `More than one account has that email (${rows.length}); nothing changed.` : "No account with that email. Sign up first (you choose the password), then run this again.");
    process.exit(1);
  }
  const u = rows[0];
  console.log(`Account found. Workspace id (for UNLIMITED_ORG_IDS): ${u.organization_id ?? "(none yet: finish signing up first)"}`);
  console.log(`Now:   plan=${u.plan} term=${u.plan_term ?? "-"} expires=${u.plan_expires_at ? new Date(u.plan_expires_at).toISOString() : "-"}`);
  console.log(`After: plan=pro term=yearly expires=${until} UTC`);
  if (!apply) { await db.query("ROLLBACK"); console.log("Dry run: nothing changed. Add --apply to make the change."); process.exit(0); }
  const r = await db.query(`UPDATE users SET plan = 'pro', plan_term = 'yearly', plan_expires_at = $2::timestamp WHERE id = $1`, [u.id, until]);
  if (r.rowCount !== 1) throw new Error("expected exactly one row");
  await db.query("COMMIT");
  console.log("Done: Pro until", until, "UTC. Sign out and back in (or reload) to see it.");
} catch (e) {
  await db.query("ROLLBACK").catch(() => {});
  console.error("Failed, nothing changed:", (e as Error).message);
  process.exit(1);
} finally {
  await db.end();
}
