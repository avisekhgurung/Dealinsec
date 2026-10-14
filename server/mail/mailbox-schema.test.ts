import { describe, expect, it } from "vitest";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { mailboxConnections, mailSendJobs } from "@shared/schema";
import { compareMailboxSchema, MAILBOX_TABLES, mailboxDdl, type IndexSnap, type NameUse, type TableSnap } from "./mailbox-schema";

/** A catalog snapshot exactly as the spec describes it (types are the DDL's own words; only equality matters). */
function snap(table: (typeof MAILBOX_TABLES)[number], indexPrefix = ""): TableSnap {
  return {
    relkind: "r",
    columns: table.columns.map(([name, ddl]) => ({ name, type: ddl.split(" ")[0], notNull: /NOT NULL|PRIMARY KEY/.test(ddl), default: ddl.includes("serial") ? `nextval('${table.name}_id_seq'::regclass)` : (/DEFAULT (.+)$/.exec(ddl)?.[1] ?? null) })),
    primaryKey: "PRIMARY KEY (id)",
    checks: Object.fromEntries(table.checks.map(([n, e]) => [n, `CHECK (${e})`])),
    indexes: table.indexes.map((i): IndexSnap => ({ name: indexPrefix + i.name, unique: !!i.unique, primary: false, method: "btree", columns: i.columns, predicate: i.where ?? null })),
  };
}
const expected = Object.fromEntries(MAILBOX_TABLES.map((t) => [t.name, snap(t, "_mbx_expect_")]));
const healthy = () => Object.fromEntries(MAILBOX_TABLES.map((t) => [t.name, snap(t)])) as Record<string, TableSnap | null>;
const ownNames = (): NameUse[] => MAILBOX_TABLES.flatMap((t) => [{ name: t.name, relkind: "r", table: null }, ...t.indexes.map((i) => ({ name: i.name, relkind: "i", table: t.name }))]);
const compare = (actual: Record<string, TableSnap | null>, names: NameUse[], final = false) => compareMailboxSchema({ expected, actual, names, final });

describe("mailbox schema: the migration's conflict detection", () => {
  it("an empty database has nothing in the way, but is not final; a complete one is both", () => {
    expect(compare({ mailbox_connections: null, mail_send_jobs: null }, [])).toEqual([]);
    expect(compare({ mailbox_connections: null, mail_send_jobs: null }, [], true)).toEqual(["mailbox_connections: table missing", "mail_send_jobs: table missing"]);
    expect(compare(healthy(), ownNames(), true)).toEqual([]);
  });

  it("refuses a column of another type, nullability or default, a missing column, and a different primary key", () => {
    const a = healthy();
    const c = a.mailbox_connections!;
    c.columns.find((x) => x.name === "account_email")!.type = "text";
    c.columns.find((x) => x.name === "refresh_token_enc")!.notNull = true;
    c.columns.find((x) => x.name === "scopes")!.default = null;
    c.columns = c.columns.filter((x) => x.name !== "account_sub");
    a.mail_send_jobs!.primaryKey = "PRIMARY KEY (message_id)";
    expect(compare(a, ownNames())).toEqual([
      "mailbox_connections.account_email: type is text, expected varchar(254)",
      "mailbox_connections.account_sub: column missing",
      "mailbox_connections.scopes: default is none, expected '[]'::jsonb",
      "mailbox_connections.refresh_token_enc: NOT NULL, expected nullable",
      "mail_send_jobs: primary key is PRIMARY KEY (message_id), expected PRIMARY KEY (id)",
    ]);
  });

  it("allows extra nullable columns, refuses an extra NOT NULL one without a default (inserts would fail)", () => {
    const a = healthy();
    a.mail_send_jobs!.columns.push({ name: "note", type: "text", notNull: false, default: null }, { name: "tenant", type: "text", notNull: true, default: null }, { name: "kind", type: "text", notNull: true, default: "'x'::text" });
    expect(compare(a, ownNames())).toEqual(["mail_send_jobs.tenant: an extra NOT NULL column without a default (inserts would fail)"]);
  });

  it("refuses a same-named check or index with another definition; a missing one is created (not final until it is)", () => {
    const a = healthy();
    a.mailbox_connections!.checks.mailbox_connections_status_ck = "CHECK (status IS NOT NULL)";
    const uq = a.mail_send_jobs!.indexes.find((i) => i.name === "mail_send_jobs_message_uq")!;
    uq.unique = false;
    const live = a.mailbox_connections!.indexes.find((i) => i.name === "mailbox_connections_live_account_uq")!;
    live.predicate = null; // the partial index became total
    expect(compare(a, ownNames())).toHaveLength(3);
    const b = healthy();
    delete b.mail_send_jobs!.checks.mail_send_jobs_sent_ck;
    b.mail_send_jobs!.indexes = b.mail_send_jobs!.indexes.filter((i) => i.name !== "mail_send_jobs_rfc_uq");
    expect(compare(b, ownNames())).toEqual([]);
    expect(compare(b, ownNames(), true)).toEqual(["mail_send_jobs: check mail_send_jobs_sent_ck missing", "mail_send_jobs_rfc_uq: index missing"]);
  });

  it("refuses a view under a table's name, and an index name taken by another table's index or a non-index", () => {
    const view = compare({ mailbox_connections: { ...snap(MAILBOX_TABLES[0]), relkind: "v" }, mail_send_jobs: null }, [{ name: "mailbox_connections", relkind: "v", table: null }]);
    expect(view).toEqual(["mailbox_connections: the name is taken by a non-table object (relkind v)"]);
    const names = [{ name: "mail_send_jobs_rfc_uq", relkind: "i", table: "leads" }, { name: "mailbox_connections_org_idx", relkind: "S", table: null }];
    expect(compare({ mailbox_connections: null, mail_send_jobs: null }, names)).toEqual([
      "mailbox_connections_org_idx: the name is taken by a non-index object (relkind S)",
      "mail_send_jobs_rfc_uq: the name is taken by an index on leads",
    ]);
  });
});

describe("mailbox schema: definitions", () => {
  it("is additive only: CREATE … IF NOT EXISTS, no DROP, ALTER, UPDATE or DELETE, and no existing table referenced", () => {
    const ddl = mailboxDdl();
    expect(ddl).toHaveLength(2 + MAILBOX_TABLES.reduce((n, t) => n + t.indexes.length, 0));
    for (const s of ddl) {
      expect(s).toMatch(/^CREATE (TABLE|(UNIQUE )?INDEX) IF NOT EXISTS /);
      expect(s).not.toMatch(/\b(DROP|ALTER|UPDATE|DELETE|TRUNCATE|REFERENCES)\b/i);
      expect(s).toMatch(/ (ON )?(mailbox_connections|mail_send_jobs)\b/);
    }
  });

  it("stores no plaintext token column and no mailbox content (Release A reads nothing)", () => {
    const cols = MAILBOX_TABLES.flatMap((t) => t.columns.map(([c]) => `${t.name}.${c}`));
    expect(cols.filter((c) => /token/.test(c))).toEqual(["mailbox_connections.refresh_token_enc", "mailbox_connections.token_key_version"]);
    expect(cols.filter((c) => /body|text|snippet|history|thread_sync|watch/.test(c) && !c.endsWith("body_hash"))).toEqual([]);
  });

  it("the drizzle tables in shared/schema.ts agree with the migration: columns, types, nullability, checks, indexes", () => {
    const dialect = new PgDialect();
    const render = (s: any) => dialect.sqlToQuery(s).sql;
    for (const [table, spec] of [[mailboxConnections, MAILBOX_TABLES[0]], [mailSendJobs, MAILBOX_TABLES[1]]] as const) {
      const cfg = getTableConfig(table);
      expect(cfg.name).toBe(spec.name);
      expect(cfg.columns.map((c) => [c.name, c.getSQLType(), c.notNull])).toEqual(spec.columns.map(([n, ddl]) => [n, ddl.split(" ")[0], /NOT NULL|PRIMARY KEY/.test(ddl)]));
      expect(cfg.checks.map((c) => [c.name, render(c.value)])).toEqual(spec.checks);
      expect(cfg.indexes.map((i) => [i.config.name, !!i.config.unique, i.config.columns.map((c: any) => c.name), i.config.where ? render(i.config.where) : undefined]))
        .toEqual(spec.indexes.map((i) => [i.name, !!i.unique, i.columns, i.where]));
    }
  });
});
