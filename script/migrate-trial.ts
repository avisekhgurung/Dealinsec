/**
 * One-time migration: 7-day Pro trial columns.
 *
 * PURELY ADDITIVE: prod and dev share the same Neon database and `main`
 * auto-deploys, so this must run BEFORE any code that selects the new
 * columns is pushed. The currently-deployed build lists columns explicitly
 * (Drizzle never emits SELECT *), so the new columns are invisible to it.
 *
 * - Adds users.trial_started_at / trial_ends_at (nullable, no default — the
 *   deployed createUser doesn't supply them, a NOT NULL would break signup).
 * - Adds users.email_canonical + index, backfilled with the same
 *   gmail-dot/+tag folding as shared/email.ts (keep the two in sync
 *   byte-for-byte — the trial grant's dedupe subquery compares them).
 * - Marks every ALREADY-ONBOARDED account as having CONSUMED its trial
 *   (trial_started_at = trial_ends_at = created_at). This prevents
 *   (a) gifting 7 free days to the existing base and (b) a replayed
 *   PATCH /api/profile retroactively minting one. started == ends is the
 *   sentinel the UI uses to keep these accounts plain FREE, never
 *   TRIAL_EXPIRED. Accounts mid-onboarding stay NULL — they get a genuine
 *   trial when they finish.
 *
 * Run:       npx tsx --env-file=.env script/migrate-trial.ts
 * Idempotent: ADD COLUMN IF NOT EXISTS; backfills touch only NULL rows.
 *
 * Rollback (non-destructive):
 *   ALTER TABLE users DROP COLUMN IF EXISTS trial_started_at;
 *   ALTER TABLE users DROP COLUMN IF EXISTS trial_ends_at;
 *   ALTER TABLE users DROP COLUMN IF EXISTS email_canonical;
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
             count(*) FILTER (WHERE onboarding_complete)::int AS onboarded,
             count(*) FILTER (WHERE org_role = 'OWNER')::int AS owners
      FROM users`);
    console.log("before:", before.rows[0]);

    await client.query("BEGIN");

    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_started_at timestamp`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at timestamp`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_canonical varchar(255)`);

    // Gmail dot/+tag canonicalization — mirrors shared/email.ts exactly.
    const canon = await client.query(`
      UPDATE users SET email_canonical = CASE
          WHEN split_part(lower(btrim(email)), '@', 2) IN ('gmail.com','googlemail.com')
            THEN replace(split_part(split_part(lower(btrim(email)),'@',1), '+', 1), '.', '') || '@gmail.com'
          ELSE split_part(split_part(lower(btrim(email)),'@',1), '+', 1)
               || '@' || split_part(lower(btrim(email)), '@', 2)
        END
      WHERE email_canonical IS NULL AND email IS NOT NULL AND position('@' in email) > 1`);
    console.log(`email_canonical backfilled for ${canon.rowCount} user(s)`);

    await client.query(
      `CREATE INDEX IF NOT EXISTS users_email_canonical_idx ON users (email_canonical)`,
    );

    // Existing onboarded base: trial already consumed, never active.
    const consumed = await client.query(`
      UPDATE users
         SET trial_started_at = COALESCE(created_at, now()),
             trial_ends_at    = COALESCE(created_at, now())
       WHERE trial_started_at IS NULL AND onboarding_complete = true`);
    console.log(`trial marked consumed for ${consumed.rowCount} already-onboarded user(s)`);

    await client.query("COMMIT");

    const after = await client.query(`
      SELECT count(*)::int AS users,
             count(*) FILTER (WHERE email_canonical IS NOT NULL)::int AS canonicalized,
             count(*) FILTER (WHERE trial_started_at IS NOT NULL)::int AS trial_consumed,
             count(*) FILTER (WHERE trial_started_at IS NULL)::int AS trial_eligible
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
