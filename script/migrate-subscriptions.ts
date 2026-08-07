/**
 * One-time migration: pay-per-agreement → subscription-first model.
 *
 * PURELY ADDITIVE by design: the local/dev env and the deployed production app
 * share the same Neon database, and the deployed build selects users columns
 * by name — renaming contract_credits would break prod auth instantly. So the
 * legacy contract_credits column KEEPS its SQL name and simply becomes the
 * "purchased Deal Credits" bucket (drizzle maps purchasedDealCredits → the
 * contract_credits column). Old balances are preserved in place; old prod code
 * keeps running until staging is promoted.
 *
 * - contract_credits default 3 → 0 (new-model signups start with 0 purchased;
 *   old prod code sets the value explicitly at signup, so it never relied on
 *   the column default).
 * - Adds monthly_deal_credits (4/month free allowance), monthly_credits_reset_at
 *   (lazy-reset watermark), plan_term (monthly|yearly), deal_boost_expires_at.
 * - Backfills plan_term='yearly' for existing Pro users (they keep Pro until
 *   their current plan_expires_at — nobody loses paid value; leftover old
 *   credits live on as purchased Deal Credits, spent after monthly runs out).
 *
 * Run:       npx tsx --env-file=.env script/migrate-subscriptions.ts
 * Idempotent: ADD COLUMN IF NOT EXISTS; backfill touches only NULL plan_term.
 *
 * Rollback (non-destructive):
 *   ALTER TABLE users ALTER COLUMN contract_credits SET DEFAULT 3;
 *   ALTER TABLE users DROP COLUMN IF EXISTS monthly_deal_credits;
 *   ALTER TABLE users DROP COLUMN IF EXISTS monthly_credits_reset_at;
 *   ALTER TABLE users DROP COLUMN IF EXISTS plan_term;
 *   ALTER TABLE users DROP COLUMN IF EXISTS deal_boost_expires_at;
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
    const before = await client.query(`
      SELECT count(*)::int AS users,
             count(*) FILTER (WHERE plan = 'pro')::int AS pro_users,
             COALESCE(sum(contract_credits), 0)::int AS legacy_credit_sum
      FROM users`);
    console.log("before:", before.rows[0]);

    await client.query("BEGIN");

    await client.query(`ALTER TABLE users ALTER COLUMN contract_credits SET DEFAULT 0`);
    await client.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_deal_credits integer NOT NULL DEFAULT 4`,
    );
    await client.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_credits_reset_at timestamp NOT NULL DEFAULT (now() + interval '1 month')`,
    );
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_term varchar`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deal_boost_expires_at timestamp`);

    const backfill = await client.query(
      `UPDATE users SET plan_term = 'yearly' WHERE plan = 'pro' AND plan_term IS NULL`,
    );
    console.log(`plan_term backfilled for ${backfill.rowCount} pro user(s)`);

    await client.query("COMMIT");

    const after = await client.query(`
      SELECT count(*)::int AS users,
             count(*) FILTER (WHERE plan = 'pro')::int AS pro_users,
             count(*) FILTER (WHERE plan = 'pro' AND plan_term = 'yearly')::int AS pro_yearly,
             COALESCE(sum(contract_credits), 0)::int AS purchased_sum,
             COALESCE(sum(monthly_deal_credits), 0)::int AS monthly_sum
      FROM users`);
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
