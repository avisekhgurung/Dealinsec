/**
 * The mailbox tables (Gmail Release A: send-only), their migration, and the check that they are really there.
 * No database import here: everything runs through an injected `exec` (a pg Client), so the migration script, the
 * runtime gate and the tests share one definition.
 *
 *   mailbox_connections  a person's connected mailbox: who, which account, its state, and the sealed refresh token
 *   mail_send_jobs       one row per approved message ever handed to a provider, the duplicate-send guard
 *
 * Deliberately NOT here yet (Release B, reply sync): history cursors, watch state, threads, inbound messages. They
 * are additive columns and tables for later; nothing in Release A reads a mailbox.
 *
 * The migration is additive and idempotent, and refuses (changing nothing) when an object of the same name exists but
 * differs: a column of another type or nullability, a same-named index or check with another definition, a view where
 * a table should be. "Differs" is judged by Postgres itself: the expected tables are first created as temporary copies
 * and the catalog's own renderings of the two are compared, so no hand-written type strings can drift.
 */

export type Exec = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export interface TableSpec {
  name: string;
  columns: [name: string, ddl: string][];
  checks: [name: string, expr: string][];
  indexes: { name: string; unique?: boolean; columns: string[]; where?: string }[];
}

const LIVE = `status IN ('active', 'needs_reconnect')`;

export const MAILBOX_TABLES: TableSpec[] = [
  {
    name: "mailbox_connections",
    columns: [
      ["id", "serial PRIMARY KEY"],
      ["organization_id", "varchar NOT NULL"],
      ["user_id", "varchar NOT NULL"], // the only person who may send from it
      ["provider", "varchar(16) NOT NULL"], // gmail (fake: local and tests only)
      ["account_email", "varchar(254) NOT NULL"],
      ["account_sub", "varchar(255) NOT NULL"], // the provider's stable account id; a reconnect must be the same account
      ["status", "varchar(16) NOT NULL"],
      ["scopes", "jsonb NOT NULL DEFAULT '[]'::jsonb"], // what was actually granted (a person can untick a scope)
      ["refresh_token_enc", "text"], // server/mail/token-crypto envelope; never plaintext
      ["token_key_version", "smallint"],
      ["last_error_code", "varchar(40)"],
      ["last_error_at", "timestamp"],
      ["connected_at", "timestamp NOT NULL"],
      ["disconnected_at", "timestamp"],
      ["created_at", "timestamp NOT NULL"],
      ["updated_at", "timestamp NOT NULL"],
    ],
    checks: [
      ["mailbox_connections_status_ck", `status IN ('active', 'needs_reconnect', 'revoked', 'disconnected')`],
      ["mailbox_connections_token_pair_ck", `(refresh_token_enc IS NULL) = (token_key_version IS NULL)`],
      // An active mailbox has a token; a revoked or disconnected one has none left in the database.
      ["mailbox_connections_token_state_ck", `(status = 'active' AND refresh_token_enc IS NOT NULL) OR status = 'needs_reconnect' OR (status IN ('revoked', 'disconnected') AND refresh_token_enc IS NULL)`],
    ],
    indexes: [
      // One live mailbox per person per provider in an organization; one live connection per provider account anywhere,
      // so an account can never feed two organizations.
      { name: "mailbox_connections_live_user_uq", unique: true, columns: ["organization_id", "user_id", "provider"], where: LIVE },
      { name: "mailbox_connections_live_account_uq", unique: true, columns: ["provider", "account_sub"], where: LIVE },
      { name: "mailbox_connections_org_idx", columns: ["organization_id", "status"] },
    ],
  },
  {
    name: "mail_send_jobs",
    columns: [
      ["id", "serial PRIMARY KEY"],
      ["organization_id", "varchar NOT NULL"],
      ["connection_id", "integer NOT NULL"],
      ["lead_id", "integer NOT NULL"],
      ["message_id", "integer NOT NULL"], // lead_messages.id
      ["requested_by", "varchar NOT NULL"],
      ["body_hash", "varchar(64) NOT NULL"], // the exact approved text this job may send
      ["to_address", "varchar(254) NOT NULL"],
      ["rfc_message_id", "varchar(255) NOT NULL"], // our Message-ID header: how an uncertain send is found later
      ["status", "varchar(12) NOT NULL"],
      ["attempts", "integer NOT NULL DEFAULT 0"],
      ["lease_until", "timestamp"], // a 'sending' job past its lease was interrupted: it becomes uncertain, never resent
      ["provider_message_id", "varchar(200)"],
      ["provider_thread_id", "varchar(200)"],
      ["error_code", "varchar(40)"],
      ["resolved_by", "varchar"], // who settled an uncertain send by hand
      ["resolved_at", "timestamp"],
      ["sent_at", "timestamp"],
      ["created_at", "timestamp NOT NULL"],
      ["updated_at", "timestamp NOT NULL"],
    ],
    checks: [
      ["mail_send_jobs_status_ck", `status IN ('sending', 'sent', 'uncertain', 'failed', 'blocked')`],
      // "Sent" needs proof: the provider's id for it, or a person who confirmed it.
      ["mail_send_jobs_sent_ck", `status <> 'sent' OR (sent_at IS NOT NULL AND (provider_message_id IS NOT NULL OR resolved_by IS NOT NULL))`],
      ["mail_send_jobs_attempts_ck", `attempts >= 0`],
    ],
    indexes: [
      { name: "mail_send_jobs_message_uq", unique: true, columns: ["message_id"] }, // a message is handed over at most once
      { name: "mail_send_jobs_rfc_uq", unique: true, columns: ["rfc_message_id"] },
      { name: "mail_send_jobs_provider_uq", unique: true, columns: ["connection_id", "provider_message_id"], where: "provider_message_id IS NOT NULL" },
      { name: "mail_send_jobs_org_status_idx", columns: ["organization_id", "status"] },
      { name: "mail_send_jobs_connection_idx", columns: ["connection_id", "created_at"] },
    ],
  },
];

export const MAILBOX_TABLE_NAMES = MAILBOX_TABLES.map((t) => t.name);
const EXPECT = "_mbx_expect_"; // temporary copies, dropped with the transaction
const MIGRATION_LOCK = 7_310_040; // advisory namespace: one mailbox migration at a time

const createTable = (t: TableSpec, name = t.name, temp = false) =>
  `CREATE ${temp ? "TEMP TABLE" : "TABLE IF NOT EXISTS"} ${name} (\n  ${[
    ...t.columns.map(([c, d]) => `${c} ${d}`),
    ...t.checks.map(([n, e]) => `CONSTRAINT ${n} CHECK (${e})`),
  ].join(",\n  ")}\n)${temp ? " ON COMMIT DROP" : ""}`;
const createIndex = (t: TableSpec, i: TableSpec["indexes"][number], prefix = "", temp = false) =>
  `CREATE ${i.unique ? "UNIQUE " : ""}INDEX ${temp ? "" : "IF NOT EXISTS "}${prefix}${i.name} ON ${prefix}${t.name} (${i.columns.join(", ")})${i.where ? ` WHERE ${i.where}` : ""}`;

/** The statements a fresh database gets (also the documentation of the schema). */
export function mailboxDdl(tables: TableSpec[] = MAILBOX_TABLES): string[] {
  return tables.flatMap((t) => [createTable(t), ...t.indexes.map((i) => createIndex(t, i))]);
}

// ---------------------------------------------------------------------------------------------------------------
// Catalog snapshots, and the pure comparison

export interface ColumnSnap { name: string; type: string; notNull: boolean; default: string | null }
export interface IndexSnap { name: string; unique: boolean; primary: boolean; method: string; columns: string[]; predicate: string | null }
export interface TableSnap {
  relkind: string; // 'r' ordinary table
  columns: ColumnSnap[];
  primaryKey: string | null; // pg_get_constraintdef, e.g. "PRIMARY KEY (id)"
  checks: Record<string, string>;
  indexes: IndexSnap[];
}
/** What sits under each name the migration wants: a table, an index, or something else (relkind), or nothing. */
export interface NameUse { name: string; relkind: string; table: string | null }

const qualified = (temp: boolean) => (temp ? `format('pg_temp.%I', $1::text)` : `format('%I.%I', current_schema(), $1::text)`);

async function snapTable(exec: Exec, name: string, temp = false): Promise<TableSnap | null> {
  const rel = (await exec(`SELECT c.oid::int AS oid, c.relkind::text AS relkind FROM pg_class c WHERE c.oid = to_regclass(${qualified(temp)})`, [name])).rows[0];
  if (!rel) return null;
  const columns = (await exec(
    `SELECT a.attname::text AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS "notNull", pg_get_expr(d.adbin, d.adrelid) AS default
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = $1::oid AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [rel.oid])).rows;
  const cons = (await exec(`SELECT conname::text AS name, contype::text AS type, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = $1::oid`, [rel.oid])).rows;
  const indexes = (await exec(
    `SELECT i.relname::text AS name, ix.indisunique AS unique, ix.indisprimary AS primary, am.amname::text AS method,
            pg_get_expr(ix.indpred, ix.indrelid) AS predicate,
            ARRAY(SELECT coalesce(a.attname::text, '(expression)') FROM unnest(ix.indkey::int2[]) WITH ORDINALITY k(n, ord)
                    LEFT JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.n ORDER BY k.ord) AS columns
       FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid JOIN pg_am am ON am.oid = i.relam
      WHERE ix.indrelid = $1::oid`, [rel.oid])).rows;
  return {
    relkind: rel.relkind,
    columns: columns.map((c) => ({ name: c.name, type: c.type, notNull: !!c.notNull, default: c.default ?? null })),
    primaryKey: cons.find((c) => c.type === "p")?.def ?? null,
    checks: Object.fromEntries(cons.filter((c) => c.type === "c").map((c) => [c.name, c.def])),
    indexes: indexes.map((i) => ({ name: i.name, unique: !!i.unique, primary: !!i.primary, method: i.method, columns: i.columns, predicate: i.predicate ?? null })),
  };
}

async function snapNames(exec: Exec, names: string[]): Promise<NameUse[]> {
  return (await exec(
    `SELECT c.relname::text AS name, c.relkind::text AS relkind, t.relname::text AS "table"
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_index ix ON ix.indexrelid = c.oid LEFT JOIN pg_class t ON t.oid = ix.indrelid
      WHERE n.nspname = current_schema() AND c.relname = ANY($1::text[])`, [names])).rows.map((r) => ({ name: r.name, relkind: r.relkind, table: r.table ?? null }));
}

/** Serial defaults name their own sequence; any nextval() counts as the same default. */
const sameDefault = (a: string | null, b: string | null) =>
  a === b || (!!a && !!b && a.startsWith("nextval(") && b.startsWith("nextval("));

/**
 * What stands in the way, as human-readable problems. `final` (after the migration) requires every object;
 * otherwise only conflicts count, since a missing table, index or check is what the migration creates.
 */
export function compareMailboxSchema(input: {
  expected: Record<string, TableSnap>;
  actual: Record<string, TableSnap | null>;
  names: NameUse[];
  final: boolean;
  tables?: TableSpec[];
}): string[] {
  const problems: string[] = [];
  for (const spec of input.tables ?? MAILBOX_TABLES) {
    const exp = input.expected[spec.name];
    const act = input.actual[spec.name];
    const own = new Set(spec.indexes.map((i) => i.name));
    // A name the migration needs, taken by something else, would make IF NOT EXISTS skip silently.
    for (const n of input.names) {
      if (n.name === spec.name && n.relkind !== "r") problems.push(`${spec.name}: the name is taken by a non-table object (relkind ${n.relkind})`);
      if (own.has(n.name) && (n.relkind !== "i" || n.table !== spec.name)) problems.push(`${n.name}: the name is taken by ${n.relkind === "i" ? `an index on ${n.table}` : `a non-index object (relkind ${n.relkind})`}`);
    }
    if (!act) {
      if (input.final) problems.push(`${spec.name}: table missing`);
      continue;
    }
    if (act.relkind !== "r") continue; // reported above
    for (const c of exp.columns) {
      const a = act.columns.find((x) => x.name === c.name);
      if (!a) { problems.push(`${spec.name}.${c.name}: column missing`); continue; }
      if (a.type !== c.type) problems.push(`${spec.name}.${c.name}: type is ${a.type}, expected ${c.type}`);
      if (a.notNull !== c.notNull) problems.push(`${spec.name}.${c.name}: ${a.notNull ? "NOT NULL" : "nullable"}, expected ${c.notNull ? "NOT NULL" : "nullable"}`);
      if (!sameDefault(a.default, c.default)) problems.push(`${spec.name}.${c.name}: default is ${a.default ?? "none"}, expected ${c.default ?? "none"}`);
    }
    for (const a of act.columns) {
      if (!exp.columns.some((c) => c.name === a.name) && a.notNull && a.default === null) problems.push(`${spec.name}.${a.name}: an extra NOT NULL column without a default (inserts would fail)`);
    }
    if (act.primaryKey !== exp.primaryKey) problems.push(`${spec.name}: primary key is ${act.primaryKey ?? "none"}, expected ${exp.primaryKey}`);
    for (const [name, def] of Object.entries(exp.checks)) {
      const a = act.checks[name];
      if (a === undefined) { if (input.final) problems.push(`${spec.name}: check ${name} missing`); }
      else if (a !== def) problems.push(`${spec.name}: check ${name} is "${a}", expected "${def}"`);
    }
    for (const i of spec.indexes) {
      const e = exp.indexes.find((x) => x.name === EXPECT + i.name)!;
      const a = act.indexes.find((x) => x.name === i.name);
      if (!a) { if (input.final) problems.push(`${i.name}: index missing`); continue; }
      const differs = a.unique !== e.unique || a.method !== e.method || a.columns.join(",") !== e.columns.join(",") || a.predicate !== e.predicate;
      if (differs) problems.push(`${i.name}: defined as ${a.unique ? "UNIQUE " : ""}${a.method} (${a.columns.join(", ")})${a.predicate ? ` WHERE ${a.predicate}` : ""}, expected ${e.unique ? "UNIQUE " : ""}${e.method} (${e.columns.join(", ")})${e.predicate ? ` WHERE ${e.predicate}` : ""}`);
    }
  }
  return problems;
}

export class MailboxSchemaError extends Error {
  constructor(readonly problems: string[]) {
    super(`the mailbox schema conflicts with existing objects; nothing was changed:\n  - ${problems.join("\n  - ")}`);
    this.name = "MailboxSchemaError";
  }
}

async function inspect(exec: Exec, final: boolean, tables: TableSpec[]): Promise<string[]> {
  const expected: Record<string, TableSnap> = {};
  const actual: Record<string, TableSnap | null> = {};
  for (const t of tables) {
    expected[t.name] = (await snapTable(exec, EXPECT + t.name, true))!;
    actual[t.name] = await snapTable(exec, t.name);
  }
  const names = await snapNames(exec, tables.flatMap((t) => [t.name, ...t.indexes.map((i) => i.name)]));
  return compareMailboxSchema({ expected, actual, names, final, tables });
}

export interface MailboxMigrationResult { created: string[]; addedChecks: string[]; createdIndexes: string[]; dryRun: boolean }

/**
 * Brings the mailbox tables into being, in one transaction on `exec` (a single connection; this function issues
 * BEGIN/COMMIT itself). Refuses with MailboxSchemaError, rolling back, if anything conflicts. `dryRun` checks and
 * rolls back without changing anything.
 */
export async function runMailboxMigration(exec: Exec, opts: { dryRun?: boolean; tables?: TableSpec[] } = {}): Promise<MailboxMigrationResult> {
  const tables = opts.tables ?? MAILBOX_TABLES;
  await exec("BEGIN");
  try {
    await exec(`SELECT pg_advisory_xact_lock($1::int, 0)`, [MIGRATION_LOCK]);
    for (const t of tables) {
      await exec(createTable(t, EXPECT + t.name, true));
      for (const i of t.indexes) await exec(createIndex(t, i, EXPECT, true));
    }
    const conflicts = await inspect(exec, false, tables);
    if (conflicts.length) throw new MailboxSchemaError(conflicts);

    const result: MailboxMigrationResult = { created: [], addedChecks: [], createdIndexes: [], dryRun: !!opts.dryRun };
    for (const t of tables) {
      const before = await snapTable(exec, t.name);
      if (!before) result.created.push(t.name);
      await exec(createTable(t));
      // A table that already existed (e.g. created by `drizzle-kit push`) gets any missing check, validated against its rows.
      if (before) {
        for (const [n, e] of t.checks) {
          if (before.checks[n] === undefined) { await exec(`ALTER TABLE ${t.name} ADD CONSTRAINT ${n} CHECK (${e})`); result.addedChecks.push(n); }
        }
      }
      for (const i of t.indexes) {
        if (!before?.indexes.some((x) => x.name === i.name)) result.createdIndexes.push(i.name);
        await exec(createIndex(t, i));
      }
    }
    const remaining = await inspect(exec, true, tables);
    if (remaining.length) throw new MailboxSchemaError(remaining);
    await exec(opts.dryRun ? "ROLLBACK" : "COMMIT");
    return result;
  } catch (e) {
    await exec("ROLLBACK").catch(() => {});
    throw e;
  }
}

/**
 * The runtime check (read-only, no temporary tables): every table, column, check and index is present by name and
 * every table is an ordinary table. The migration has already judged definitions; this only answers "was it run?".
 */
export async function mailboxSchemaPresent(exec: Exec, tables: TableSpec[] = MAILBOX_TABLES): Promise<{ ok: true } | { ok: false; missing: string[] }> {
  const missing: string[] = [];
  for (const t of tables) {
    const s = await snapTable(exec, t.name);
    if (!s || s.relkind !== "r") { missing.push(t.name); continue; }
    for (const [c] of t.columns) if (!s.columns.some((x) => x.name === c)) missing.push(`${t.name}.${c}`);
    for (const [n] of t.checks) if (s.checks[n] === undefined) missing.push(n);
    for (const i of t.indexes) if (!s.indexes.some((x) => x.name === i.name)) missing.push(i.name);
  }
  return missing.length ? { ok: false, missing } : { ok: true };
}
