/**
 * One-way migration: every stored money amount → MINOR units (paise/cents).
 *
 * WHY: whole rupees as `integer` cannot represent $1,250.50, a €18.81 VAT line,
 * or a 33.33% split of ₹100. The schema comment admitted it. Nothing global —
 * no tax block, no non-INR currency — can be correct until this has run, and
 * the migration gets strictly harder with every invoice issued in the meantime.
 *
 * WHAT IT DOES, in one transaction:
 *   1. claims a key in `app_migrations` (the idempotency gate)
 *   2. refuses to continue if any row is already non-INR
 *   3. widens the four money columns from int4 to int8
 *   4. multiplies every stored amount by 100
 *   5. rewrites brand_invoices.line_items, renaming rate/amount → rateMinor/
 *      amountMinor as it scales them
 *
 * IDEMPOTENCY is by ledger, never by heuristic. Step 1 is an
 * `INSERT ... ON CONFLICT DO NOTHING RETURNING key` inside the same
 * transaction as the rewrite, so the claim and the data move commit or roll
 * back together: a crash halfway through leaves the key unclaimed and the
 * amounts untouched, and the next run redoes it exactly once. Two runs started
 * at the same moment serialise on the primary-key row lock — the loser gets
 * zero rows back and skips.
 *
 * THE FACTOR IS A FLAT 100, deliberately. Every row that exists when this runs
 * is INR by construction: the currency columns land with a NOT NULL 'INR'
 * default in the same transaction, just before it, and nothing in the product
 * could have written a different currency before they existed. Step 2 asserts
 * that rather than assuming it — if a non-INR row is ever found, a flat ×100
 * would be wrong for JPY (exponent 0) and the migration aborts instead of
 * corrupting it.
 *
 * RUN IT once per database, BY HAND, as an operator step. Never from server
 * code. Dev and production share one Neon database, so a boot-time run meant
 * any `npm run dev` could rescale production. It also left a deploy window where
 * the old instance read paise as rupees. server/index.ts therefore only runs a
 * fail-closed schema GATE and refuses to serve until this ledger key and the
 * locale columns exist. The production procedure (stop, back up, run, verify,
 * deploy, start) is MIGRATION_STEPS at the bottom of this file. The command
 * (without --apply it only prints usage and touches nothing):
 *
 *   npx tsx --env-file=.env script/migrate-money-minor-units.ts --apply
 *
 * ROLLBACK is a divide, not a DROP, and it has preconditions. MIGRATION_STEPS
 * part R has the exact SQL: the amounts, the reverse of the step-5 line_items
 * key rewrite, the reverse of the bigint widening, and the ledger row. Integer
 * division is lossless only while nothing has written a genuine sub-unit (or
 * non-INR) amount; R1 checks that before anything changes. Once one exists,
 * this migration is not reversible by arithmetic, only by restoring a backup.
 */

import path from "path";
// The ledger key lives in a module with no side effects, so the server's gate
// and the seed guard can read it without importing THIS file. Re-exported for
// any script that already imports it from here.
import { MONEY_MINOR_UNITS_KEY } from "../shared/migration-keys";
export { MONEY_MINOR_UNITS_KEY };

/** Minimal shape of `pg`'s Client.query (drizzle's db.execute fits it too).
 *  The only caller is the CLI below: there is deliberately no boot path. */
export type SqlExecutor = (sql: string) => Promise<{ rows: any[] }>;

export interface MoneyMigrationResult {
  /** False when the ledger already held the key — the no-op second run. */
  applied: boolean;
  deals: number;
  contracts: number;
  brandInvoices: number;
  /** Invoices whose line_items JSON was rewritten. */
  lineItemInvoices: number;
}

// ── Locale columns ─────────────────────────────────────────────────────
// Purely additive and idempotent, so no ledger entry: re-running an
// ADD COLUMN IF NOT EXISTS changes nothing. The NOT NULL defaults are the
// India values, which is what backfills every pre-expansion row to
// IN/INR/en-IN/Asia/Kolkata and keeps existing behaviour bit-identical.
//
// Lives here, next to the money migration, because the money migration
// depends on it: its safety guard proves every row is still INR, and it can
// only do that once `currency` exists.
const LOCALE_COLUMNS_DDL = ["users", "organizations"].map(
  (table) => `
    ALTER TABLE ${table}
      ADD COLUMN IF NOT EXISTS country  varchar(2)  NOT NULL DEFAULT 'IN',
      ADD COLUMN IF NOT EXISTS currency varchar(3)  NOT NULL DEFAULT 'INR',
      ADD COLUMN IF NOT EXISTS locale   varchar(35) NOT NULL DEFAULT 'en-IN',
      ADD COLUMN IF NOT EXISTS timezone varchar(64) NOT NULL DEFAULT 'Asia/Kolkata'`,
);

// The currency an agreement or invoice was ISSUED in, frozen on the row so a
// historical document keeps printing in it whatever the org's setting later
// says. Additive like the columns above. 'INR' is the correct backfill for
// every existing row: until this column shipped, no server could store an
// organization currency other than INR (PATCH /api/org did not accept one), so
// no document was ever issued in anything else. On a database the money
// migration has not yet run on, its guard — same transaction, straight after
// this — also proves it, refusing to proceed if any user or org is not INR.
// Must run before the build that selects these columns serves a request.
const ISSUED_CURRENCY_DDL = ["contracts", "brand_invoices"].map(
  (table) => `
    ALTER TABLE ${table}
      ADD COLUMN IF NOT EXISTS currency varchar(3) NOT NULL DEFAULT 'INR'`,
);

/** Adds the country/currency/locale/timezone columns, and the issued-currency
 *  column on contracts and brand_invoices, if they are missing. Idempotent. */
export async function runLocaleColumnsMigration(exec: SqlExecutor): Promise<void> {
  for (const stmt of LOCALE_COLUMNS_DDL) await exec(stmt);
  for (const stmt of ISSUED_CURRENCY_DDL) await exec(stmt);

  // invoice_counters has always needed a composite key for the invoice-number
  // upsert (ON CONFLICT (organization_id, fy)); production has one, but it was
  // never declared in the schema, so any database built from the schema 500s on
  // every invoice. Additive and idempotent: skipped where it already exists.
  await exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'invoice_counters'::regclass AND contype IN ('p', 'u')
      ) THEN
        ALTER TABLE invoice_counters
          ADD CONSTRAINT invoice_counters_pkey PRIMARY KEY (organization_id, fy);
      END IF;
    END $$;`);
}

const LEDGER_DDL = `
  CREATE TABLE IF NOT EXISTS app_migrations (
    key text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;

const CLAIM = `
  INSERT INTO app_migrations (key) VALUES ('${MONEY_MINOR_UNITS_KEY}')
  ON CONFLICT (key) DO NOTHING
  RETURNING key`;

// Nothing in this file interpolates user input — every value is a literal
// defined above — so raw statements are safe to hand to drizzle's sql.raw().
const GUARD_NON_INR = `
  SELECT count(*)::int AS n FROM (
    SELECT currency FROM users         WHERE upper(currency) <> 'INR'
    UNION ALL
    SELECT currency FROM organizations WHERE upper(currency) <> 'INR'
  ) x`;

// int4 tops out at 2,147,483,647 — ₹21.47 crore once amounts are in paise, a
// ceiling a single commercial fit-out can reach. Widen BEFORE multiplying;
// Postgres raises on int4 overflow rather than wrapping, so the wrong order
// aborts the migration on exactly the customer who matters most.
//
// Driven off information_schema so a column `drizzle-kit push` has already
// widened is skipped rather than rewritten a second time for nothing.
const WIDEN = `
  DO $$
  DECLARE r record;
  BEGIN
    FOR r IN
      SELECT table_name::text AS t, column_name::text AS c
        FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND (table_name::text, column_name::text) IN (
               ('deals',          'deal_amount'),
               ('contracts',      'contract_value'),
               ('contracts',      'estamp_amount'),
               ('brand_invoices', 'deal_amount'))
         AND data_type <> 'bigint'
    LOOP
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE bigint', r.t, r.c);
    END LOOP;
  END $$`;

const SCALE_DEALS = `
  UPDATE deals SET deal_amount = deal_amount * 100 RETURNING id`;

const SCALE_CONTRACTS = `
  UPDATE contracts
     SET contract_value = contract_value * 100,
         estamp_amount  = estamp_amount  * 100
   RETURNING id`;

const SCALE_BRAND_INVOICES = `
  UPDATE brand_invoices SET deal_amount = deal_amount * 100 RETURNING id`;

// Rewrites each element as (element minus the old keys) merged with the new
// ones, so description / quantity / hsnSac and any key added later survive
// untouched. WITH ORDINALITY + ORDER BY keeps the line order a client already
// saw on an issued invoice. An element missing rate or amount passes through
// unchanged rather than being zeroed — a malformed row is worth reporting, not
// worth silently turning into a free line.
const SCALE_LINE_ITEMS = `
  UPDATE brand_invoices bi
     SET line_items = (
       SELECT jsonb_agg(
                CASE
                  WHEN jsonb_typeof(li) = 'object' AND li ? 'rate' AND li ? 'amount'
                  THEN (li - 'rate' - 'amount') || jsonb_build_object(
                         'rateMinor',   (round((li->>'rate')::numeric   * 100))::bigint,
                         'amountMinor', (round((li->>'amount')::numeric * 100))::bigint
                       )
                  ELSE li
                END
                ORDER BY ord
              )
       FROM jsonb_array_elements(bi.line_items) WITH ORDINALITY AS t(li, ord)
     )
   WHERE bi.line_items IS NOT NULL
     AND jsonb_typeof(bi.line_items) = 'array'
     AND jsonb_array_length(bi.line_items) > 0
   RETURNING bi.id`;

/**
 * Runs the migration through `exec`, which MUST already be inside a
 * transaction — the ledger claim and the rewrite have to commit together.
 * Returns { applied: false } and touches nothing if the key is already held.
 */
export async function runMoneyMinorUnitsMigration(exec: SqlExecutor): Promise<MoneyMigrationResult> {
  await exec(LEDGER_DDL);

  const claimed = await exec(CLAIM);
  if (claimed.rows.length === 0) {
    return { applied: false, deals: 0, contracts: 0, brandInvoices: 0, lineItemInvoices: 0 };
  }

  const guard = await exec(GUARD_NON_INR);
  const nonInr = Number(guard.rows[0]?.n ?? 0);
  if (nonInr > 0) {
    throw new Error(
      `refusing to scale: ${nonInr} user/organization row(s) are not INR. ` +
      `A flat x100 is only correct while every row is a 2-decimal rupee amount ` +
      `(it would be wrong for JPY, exponent 0). Migrate those rows by currency by hand.`,
    );
  }

  await exec(WIDEN);

  const deals = await exec(SCALE_DEALS);
  const contracts = await exec(SCALE_CONTRACTS);
  const brandInvoices = await exec(SCALE_BRAND_INVOICES);
  const lineItems = await exec(SCALE_LINE_ITEMS);

  return {
    applied: true,
    deals: deals.rows.length,
    contracts: contracts.rows.length,
    brandInvoices: brandInvoices.rows.length,
    lineItemInvoices: lineItems.rows.length,
  };
}

// ── CLI ────────────────────────────────────────────────────────────────
// Two independent locks, so that LOADING this module can never migrate:
//
//  1. The entry file must BE this script, compared by exact basename. The old
//     check was a substring of argv[1], the entry's full absolute path, so a
//     checkout or worktree in a directory named after this script (say
//     .claude/worktrees/migrate-money-minor-units/) made `npm run dev`, whose
//     entry is server/index.ts, run the migration at import time against the
//     shared production database.
//  2. `--apply` must be passed. Running the file to see what it does, or a
//     future import from another script, stops at the usage line and never
//     opens a connection.
//
// process.argv rather than import.meta.url, and no top-level await, so the file
// stays loadable from CJS tooling as well as tsx.
const ENTRY_FILE = /^migrate-money-minor-units\.(ts|mts|cts|js|mjs|cjs)$/;
const APPLY_FLAG = "--apply";

if (ENTRY_FILE.test(path.basename(process.argv[1] ?? ""))) {
  if (process.argv.slice(2).includes(APPLY_FLAG)) {
    void runCli();
  } else {
    console.error(
      "This migrates every stored amount to minor units (x100) and cannot be undone by re-running it.\n" +
      "Nothing was changed. Follow MIGRATION_STEPS at the bottom of this file, then run:\n" +
      `    npx tsx --env-file=.env script/migrate-money-minor-units.ts ${APPLY_FLAG}`,
    );
    process.exitCode = 1;
  }
}

async function runCli() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set (run with: npx tsx --env-file=.env ...)");
    process.exit(1);
  }

  const { Pool } = (await import("pg")).default;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  const snapshot = `
    SELECT (SELECT coalesce(sum(deal_amount), 0)::text    FROM deals)          AS deals_total,
           (SELECT coalesce(sum(contract_value), 0)::text FROM contracts)      AS contracts_total,
           (SELECT coalesce(sum(deal_amount), 0)::text    FROM brand_invoices) AS invoices_total`;

  try {
    console.log("before:", (await client.query(snapshot)).rows[0]);

    await client.query("BEGIN");
    // Locale columns first, because the money migration's INR guard reads
    // `currency`.
    await runLocaleColumnsMigration((sql) => client.query(sql));
    const result = await runMoneyMinorUnitsMigration((sql) => client.query(sql));
    await client.query("COMMIT");

    console.log(result.applied ? "applied:" : "already applied (no-op):", result);
    console.log("after: ", (await client.query(snapshot)).rows[0]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("MONEY MIGRATION FAILED — nothing was changed:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

/* ═══════════════════════════════════════════════════════════════════════
 * MIGRATION_STEPS: the production runbook. An operator runs this, never code.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * THE ONE INVARIANT: the rupee-era build (every commit before this change;
 * main was at 8833014 when this was written) must never serve a request against
 * migrated rows, and nothing may write between the migration and the new build
 * coming up. Old code reading paise shows every amount 100× too large, and
 * anything it saves is a rupee figure in a paise column that nobody can later
 * tell apart. The NEW build is safe on both sides: before the migration its
 * schema gate refuses to boot (so that deploy fails instead of serving); after
 * it, it serves correctly.
 *
 * NEVER, during or after the window: `npm run db:push` from a checkout older
 * than this change. drizzle-kit would narrow the money columns back to integer
 * WITHOUT dividing (paise the old build then prints as rupees) and propose
 * dropping app_migrations, after which the gate refuses to serve.
 *
 * Every psql step targets production. Load the URL without echoing it, and
 * `unset PROD_URL` when done:
 *   export PROD_URL="$(node --env-file=.env -p 'process.env.DATABASE_URL')"
 *   psql "$PROD_URL"
 *
 * ── F: FORWARD ─────────────────────────────────────────────────────────
 *
 * F0. Before the window.
 *     - Note the commit Render serves now (Render → infludeal → Events, the
 *       latest live deploy). That SHA is the rollback target in R4.
 *     - Logged in as a real account, screenshot the dashboard pipeline value,
 *       one issued quotation, one signed agreement that has an e-stamp amount,
 *       and one itemised invoice. After F7 each must match to the rupee.
 *     - Stop every `npm run dev` that loads .env, on every machine. An old
 *       checkout left running (or restarted) after F4 writes rupees.
 *     - Render → infludeal → Settings → Auto-Deploy: Off. Then merge/push the
 *       new build. Nothing deploys until F6 says so.
 *
 * F1. Stop the live instance's traffic. Render → infludeal → Settings →
 *     Maintenance Mode: On. Every public request now gets a 503, so the old
 *     instance can neither receive a request nor write; the server runs no
 *     background jobs, and every money write arrives over HTTP. Use Maintenance
 *     Mode, not Suspend: F6 deploys a chosen commit over the old instance,
 *     whereas coming back from Suspend goes through Resume, which can bring a
 *     previous deploy (the old build) back up before a chosen commit replaces it.
 *     Confirm the public URL answers 503, then look at who is connected:
 *       SELECT application_name, client_addr, state, backend_start
 *         FROM pg_stat_activity
 *        WHERE datname = current_database() AND pid <> pg_backend_pid();
 *     Idle connections from the Render instance's pool are expected. Anything
 *     active that you cannot account for: find it and stop it first. Neon's
 *     pooler can hide client_addr, so F0's "stop every dev server" is the real
 *     control, not this query.
 *
 * F2. Back up. Create a Neon branch of production as of now:
 *       Neon Console → the project → Branches → New branch; parent: the
 *       production branch; point in time: now; name: pre-money-minor-units-YYYYMMDD
 *     (or `neonctl branches create --name pre-money-minor-units-YYYYMMDD
 *     --parent <production branch>`). A local dump as well:
 *       pg_dump "$PROD_URL" --format=custom --file=dealinsec-pre-minor-units-$(date +%Y%m%d-%H%M).dump
 *     Do not continue without the branch. It is the undo for a mistake in F4
 *     and for a failed R1 precondition later.
 *
 * F3. Pre-flight snapshot. Run all four and SAVE the output: F5 and part R are
 *     checked against it.
 *       -- P0: the key ROW must not exist yet. The table alone may exist (drizzle-kit
 *       -- push creates it empty); run the second query only if the first says true.
 *       -- If the row exists, this database is ALREADY in minor units: run
 *       -- nothing else, skip to F5.
 *       SELECT to_regclass('app_migrations') IS NOT NULL AS ledger_exists;
 *       SELECT key, applied_at FROM app_migrations WHERE key = '2026_09_money_minor_units';
 *       -- P1: column types. R2 narrows back only what is integer here.
 *       SELECT table_name, column_name, data_type
 *         FROM information_schema.columns
 *        WHERE table_schema = current_schema()
 *          AND (table_name::text, column_name::text) IN (
 *                ('deals', 'deal_amount'), ('contracts', 'contract_value'),
 *                ('contracts', 'estamp_amount'), ('brand_invoices', 'deal_amount'))
 *        ORDER BY 1, 2;
 *       -- P2: row counts and money totals.
 *       SELECT (SELECT count(*) FROM deals)                              AS deals_n,
 *              (SELECT coalesce(sum(deal_amount), 0) FROM deals)          AS deals_total,
 *              (SELECT count(*) FROM contracts)                          AS contracts_n,
 *              (SELECT coalesce(sum(contract_value), 0) FROM contracts)   AS contracts_total,
 *              (SELECT coalesce(sum(estamp_amount), 0) FROM contracts)    AS estamp_total,
 *              (SELECT count(*) FROM brand_invoices)                     AS invoices_n,
 *              (SELECT coalesce(sum(deal_amount), 0) FROM brand_invoices) AS invoices_total;
 *       -- P3: invoice lines.
 *       SELECT count(*)                                                 AS line_n,
 *              count(*) FILTER (WHERE jsonb_typeof(li) = 'object'
 *                                 AND li ? 'rate' AND li ? 'amount')    AS legacy_n,
 *              count(*) FILTER (WHERE jsonb_typeof(li) = 'object'
 *                                 AND li ? 'rateMinor')                 AS minor_n,
 *              coalesce(sum((li->>'amount')::numeric), 0)               AS line_amount_total,
 *              coalesce(sum((li->>'amountMinor')::numeric), 0)          AS line_amount_minor_total
 *         FROM brand_invoices bi
 *        CROSS JOIN LATERAL jsonb_array_elements(
 *              CASE WHEN jsonb_typeof(bi.line_items) = 'array'
 *                   THEN bi.line_items ELSE '[]'::jsonb END) AS li;
 *     STOP and investigate before F4 if P1 shows a type other than integer or
 *     bigint, if P3 minor_n > 0 (minor-unit lines in a rupee database: mixed
 *     units already), or if legacy_n < line_n (lines the rewrite passes over).
 *
 * F4. Migrate, from the repo root, checked out at the NEW build's commit.
 *     First `unset DATABASE_URL` in this shell: --env-file never overrides a
 *     variable that is already set, so a local test URL exported earlier would
 *     quietly migrate the wrong database.
 *       npx tsx --env-file=.env script/migrate-money-minor-units.ts --apply
 *     Its `before:` totals must equal F3's P2 deals_total, contracts_total and
 *     invoices_total; if they do not, it ran against some other database.
 *     It prints `before:`, then `applied: {…}`, then `after:`. It is one
 *     transaction: "MONEY MIGRATION FAILED — nothing was changed" means exactly
 *     that; fix the cause and run it again. "already applied (no-op)" means the
 *     key was already held and this run scaled nothing. If this network cannot
 *     reach Neon, move to one that can. Never move this into server boot to get
 *     around it (see server/index.ts).
 *
 * F5. Verify. Re-run P0–P3. ALL of these must hold:
 *       P0  the key row exists
 *       P1  all four columns are bigint
 *       P2  every *_n equals F3; deals_total, contracts_total, estamp_total and
 *           invoices_total are EXACTLY 100 × their F3 values
 *       F4  applied.deals / .contracts / .brandInvoices equal the F3 *_n counts
 *       P3  line_n equals F3; legacy_n = 0; minor_n = F3 legacy_n (on clean data
 *           that is line_n); line_amount_minor_total is EXACTLY
 *           100 × F3 line_amount_total
 *     Any mismatch: do NOT deploy. Stay in maintenance and run part R, or
 *     restore the F2 branch.
 *
 * F6. Deploy the new build. Render → infludeal → Manual Deploy → Deploy a
 *     specific commit → the new build's SHA. Maintenance Mode stays On. The
 *     deploy log must show:
 *       schema gate: money in minor units and locale columns present
 *     "REFUSING TO SERVE" instead means the gate did not find the migration:
 *     that deploy fails, the old instance stays behind the maintenance page
 *     where it can receive no request, and you go back to F5. If Render lifts
 *     Maintenance Mode on its own when the deploy goes live, that is safe too:
 *     the new build serves only after its gate has passed.
 *
 * F7. Start. Maintenance Mode: Off. Log in and compare every F0 screenshot:
 *     same ₹ figures, same lakh/crore grouping, same invoice numbers, same
 *     wording. Set Auto-Deploy back to what it was. Keep the F2 branch for at
 *     least one full billing cycle.
 *
 * ── R: REVERSE ─────────────────────────────────────────────────────────
 * Returns the database to whole rupees for the OLD build. The locale columns,
 * the issued-currency columns on contracts/brand_invoices and the
 * app_migrations TABLE stay: they are additive, the old build never reads
 * them, and dropping them would discard settings users chose since. Only the
 * ledger ROW goes, which makes the new build's gate refuse this database and
 * lets a later forward run (F0–F7 again) start cleanly.
 *
 * R0. Stop and back up as in F0 (note the live SHA; Auto-Deploy Off), F1 and F2
 *     (branch name pre-money-rollback-YYYYMMDD). Rows written since the
 *     migration exist only in production and in this branch. The F2 branch
 *     predates them.
 *
 * R1. Preconditions. Every column must be 0. If any is not, STOP: the divide
 *     would silently drop a sub-unit amount or relabel another currency's
 *     amount as rupees. The options are then fixing those rows by hand or
 *     restoring the F2 branch and re-entering what was written since.
 *       SELECT
 *         (SELECT count(*) FROM deals          WHERE deal_amount    % 100 <> 0) AS deals_subunit,
 *         (SELECT count(*) FROM contracts      WHERE contract_value % 100 <> 0
 *                                                 OR estamp_amount  % 100 <> 0) AS contracts_subunit,
 *         (SELECT count(*) FROM brand_invoices WHERE deal_amount    % 100 <> 0) AS invoices_subunit,
 *         (SELECT count(*)
 *            FROM brand_invoices bi
 *           CROSS JOIN LATERAL jsonb_array_elements(
 *                 CASE WHEN jsonb_typeof(bi.line_items) = 'array'
 *                      THEN bi.line_items ELSE '[]'::jsonb END) AS li
 *           WHERE jsonb_typeof(li) = 'object'
 *             AND ((li->>'rateMinor')::numeric   % 100 <> 0
 *               OR (li->>'amountMinor')::numeric % 100 <> 0))                  AS lines_subunit,
 *         (SELECT count(*) FROM users          WHERE upper(currency) <> 'INR')
 *       + (SELECT count(*) FROM organizations  WHERE upper(currency) <> 'INR')
 *       + (SELECT count(*) FROM contracts      WHERE upper(currency) <> 'INR')
 *       + (SELECT count(*) FROM brand_invoices WHERE upper(currency) <> 'INR') AS non_inr;
 *     Then re-run P1–P3 and SAVE the output as the R1 snapshot.
 *
 * R2. Reverse, in ONE transaction. Divide BEFORE narrowing: a paise value above
 *     2,147,483,647 would abort the ALTER. Narrow only the columns F3's P1
 *     recorded as integer (if P1 was not saved: the rupee-era schema declared
 *     all four integer). If any statement errors, ROLLBACK; nothing changed.
 *       BEGIN;
 *       -- the amounts (step 4 reversed)
 *       UPDATE deals          SET deal_amount    = deal_amount    / 100;
 *       UPDATE contracts      SET contract_value = contract_value / 100,
 *                                 estamp_amount  = estamp_amount  / 100;
 *       UPDATE brand_invoices SET deal_amount    = deal_amount    / 100;
 *       -- the line_items key rewrite (step 5 reversed). The exact inverse of
 *       -- SCALE_LINE_ITEMS: rateMinor/amountMinor back to rate/amount, the same
 *       -- element order, every other key untouched. bigint division is exact
 *       -- because R1 proved every value a multiple of 100, and it yields JSON
 *       -- integers, as the rupee-era z.number().int() line schema wrote them.
 *       UPDATE brand_invoices bi
 *          SET line_items = (
 *            SELECT jsonb_agg(
 *                     CASE
 *                       WHEN jsonb_typeof(li) = 'object' AND li ? 'rateMinor' AND li ? 'amountMinor'
 *                       THEN (li - 'rateMinor' - 'amountMinor') || jsonb_build_object(
 *                              'rate',   (li->>'rateMinor')::bigint   / 100,
 *                              'amount', (li->>'amountMinor')::bigint / 100
 *                            )
 *                       ELSE li
 *                     END
 *                     ORDER BY ord
 *                   )
 *              FROM jsonb_array_elements(bi.line_items) WITH ORDINALITY AS t(li, ord)
 *          )
 *        WHERE bi.line_items IS NOT NULL
 *          AND jsonb_typeof(bi.line_items) = 'array'
 *          AND jsonb_array_length(bi.line_items) > 0;
 *       -- the bigint widening (step 3 reversed)
 *       ALTER TABLE deals          ALTER COLUMN deal_amount    TYPE integer;
 *       ALTER TABLE contracts      ALTER COLUMN contract_value TYPE integer,
 *                                  ALTER COLUMN estamp_amount  TYPE integer;
 *       ALTER TABLE brand_invoices ALTER COLUMN deal_amount    TYPE integer;
 *       -- the ledger claim (step 1 reversed): the row only, never the table
 *       DELETE FROM app_migrations WHERE key = '2026_09_money_minor_units';
 *       COMMIT;
 *
 * R3. Verify against the R1 snapshot. Re-run P0–P3:
 *       P0  the key row is gone
 *       P1  the columns are back to F3's types (integer)
 *       P2  every *_n equals R1; every total is EXACTLY the R1 total ÷ 100 (and
 *           equals F3 if nothing was written since the migration)
 *       P3  line_n equals R1; legacy_n = R1 minor_n; minor_n = 0;
 *           line_amount_total is EXACTLY R1 line_amount_minor_total ÷ 100
 *
 * R4. Deploy the OLD build. Render → infludeal → Manual Deploy → Deploy a
 *     specific commit → the pre-migration SHA noted in F0. Maintenance Mode
 *     stays On until that deploy is live. The new build cannot come back on
 *     this database by accident: its gate now refuses it.
 *
 * R5. Start. Maintenance Mode: Off. Compare the F0 screenshots. Leave
 *     Auto-Deploy Off while main still carries the minor-unit build; a push
 *     would otherwise try to deploy it. Its gate would make that deploy fail
 *     rather than serve, but do not use the gate as a deploy switch.
 */
