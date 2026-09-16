/**
 * Guards for the scripts that WRITE test data: demo-data, pdf-scenarios and
 * e2e-smoke.
 *
 * WHY: dev and production share one Neon database, and `.env` points at it.
 * A seed script started with `--env-file=.env` would reset a real user's
 * records or plant fixtures among the 26 live deals. So every writer
 * refuses outright unless DATABASE_URL names a loopback host. There is no
 * override flag on purpose: to seed somewhere else, change this file and say
 * why in review.
 *
 * The money check exists because the seeds write MINOR units. Run against a
 * database the minor-units migration has not claimed yet, they would leave
 * paise beside rupees, and running the migration afterwards (which is exactly
 * what the server's schema gate tells you to do) would multiply the seeded
 * paise by 100 again. The only safe order is: migrate first, then seed.
 */
import { toMinor } from "../shared/schema.ts";
// The key alone, never the migration script: importing that module would load
// its CLI into every seed script, ahead of requireLocalDatabaseUrl().
import { MONEY_MINOR_UNITS_KEY } from "../shared/migration-keys.ts";

/** The local test database every script documents. */
export const LOCAL_TEST_DATABASE_URL = "postgresql://dealtest@localhost:5544/dealinsec_pdftest";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * The host `pg` would actually connect to, or null when it cannot be pinned
 * down to one explicit host.
 *
 * A plain regex over the URL is not enough. `pg-connection-string` lets a
 * `?host=` query parameter override the authority, so
 * `postgresql://u@localhost/db?host=ep-x.neon.tech` connects to Neon. An empty
 * host makes `pg` fall back to $PGHOST. A leading "/" is a socket path. All of
 * those return null here, which makes the caller refuse.
 */
export function effectiveDatabaseHost(url: string | undefined): string | null {
  if (!url || url.startsWith("/")) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return null;
  const hostParams = parsed.searchParams.getAll("host");
  if (hostParams.length > 1) return null;
  const host = hostParams.length === 1 ? hostParams[0] : parsed.hostname;
  return host ? host.toLowerCase() : null;
}

export function isLocalDatabaseUrl(url: string | undefined): boolean {
  const host = effectiveDatabaseHost(url);
  return host !== null && LOOPBACK_HOSTS.has(host);
}

/** Returns DATABASE_URL, or exits before any connection is opened. */
export function requireLocalDatabaseUrl(script: string): string {
  const url = process.env.DATABASE_URL;
  if (!isLocalDatabaseUrl(url)) {
    console.error(
      `REFUSING: ${script} writes test data and runs only against a LOCAL database.\n` +
      `DATABASE_URL must point at localhost / 127.0.0.1 (host seen: ${effectiveDatabaseHost(url) ?? "none"}).\n` +
      `Dev and production share one Neon database, so never run this with --env-file=.env. Use:\n` +
      `    DATABASE_URL=${LOCAL_TEST_DATABASE_URL} npx tsx script/${script}`,
    );
    process.exit(1);
  }
  return url!;
}

/** Minimal shape of pg's Client / PoolClient `query`. */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

/**
 * Exits unless this database already stores money in minor units: the ledger
 * holds the migration key AND the locale columns exist. These are the same two
 * facts server/index.ts gates on, so a database the seeds accept is one the
 * server will serve.
 */
export async function requireMinorUnitMoney(client: Queryable, script: string): Promise<void> {
  const { rows } = await client.query(`
    SELECT to_regclass('app_migrations') IS NOT NULL AS ledger,
           EXISTS (
             SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'organizations' AND column_name = 'currency'
           ) AS locale_columns`);
  let migrated = false;
  if (rows[0]?.ledger) {
    const claimed = await client.query(`SELECT 1 FROM app_migrations WHERE key = $1`, [MONEY_MINOR_UNITS_KEY]);
    migrated = claimed.rows.length > 0;
  }
  if (!migrated || !rows[0]?.locale_columns) {
    console.error(
      `REFUSING: ${script} seeds amounts in MINOR units (paise), but this local database has not been\n` +
      `migrated to minor units yet. Seeding first and migrating afterwards would multiply the seeded\n` +
      `amounts by 100 a second time. Migrate the LOCAL database first (no --env-file), then re-run:\n` +
      `    DATABASE_URL=${LOCAL_TEST_DATABASE_URL} npx tsx script/migrate-money-minor-units.ts --apply`,
    );
    process.exit(1);
  }
}

/** Whole rupees → paise, for fixtures written as the rupee figures a person
 *  reads on screen. The factor comes from the app's own toMinor so a script
 *  can never disagree with the server about what a paisa is. Pinned to INR
 *  because the seeds pin their organization to INR (see INDIA_LOCALE). Whole
 *  rupees only: toMinor would round a typo like 32500.5 instead of failing. */
export function inr(rupees: number): number {
  if (!Number.isSafeInteger(rupees) || rupees < 0) {
    throw new RangeError(`inr(): fixture amounts are whole, non-negative rupees; got ${rupees}`);
  }
  return toMinor(rupees, "INR");
}

/**
 * The India locale columns, written explicitly on seeded orgs and users.
 *
 * The column defaults already say IN/INR, but ON CONFLICT DO NOTHING would keep
 * a local org someone had switched to USD while testing, and every INR fixture
 * below would then render as dollars and cents. Resetting just these four
 * columns keeps the fixture amounts meaningful.
 */
export const INDIA_LOCALE = { country: "IN", currency: "INR", locale: "en-IN", timezone: "Asia/Kolkata" } as const;
