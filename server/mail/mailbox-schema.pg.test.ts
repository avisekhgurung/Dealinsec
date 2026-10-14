/**
 * The mailbox migration against a REAL Postgres: idempotency, the constraints doing their job, and refusal (with
 * nothing changed) when existing objects conflict.
 *
 * Runs only with MAILBOX_PG_TEST_URL set to a disposable LOCAL database. Every case works in its own freshly created
 * schema (search_path) and drops it afterwards, so no existing table is read or written. A non-loopback host is refused.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MailboxSchemaError, mailboxSchemaPresent, runMailboxMigration, type Exec } from "./mailbox-schema";

const URL_ = process.env.MAILBOX_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("mailbox migration (real Postgres, scratch schemas)", () => {
  let pg: any;
  const clients: any[] = [];
  const schemas: string[] = [];
  beforeAll(async () => { ({ default: pg } = await import("pg")); });
  afterAll(async () => {
    const c = new pg.Client({ connectionString: URL_ }); await c.connect();
    for (const s of schemas) await c.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
    await c.end();
    for (const x of clients) await x.end().catch(() => {});
  });

  /** A connection whose current schema is a new, empty one. */
  async function scratch(schema?: string): Promise<{ q: Exec; schema: string }> {
    const s = schema ?? `mbx_t_${randomBytes(5).toString("hex")}`;
    const c = new pg.Client({ connectionString: URL_ }); await c.connect(); clients.push(c);
    if (!schema) { await c.query(`CREATE SCHEMA ${s}`); schemas.push(s); }
    await c.query(`SET search_path TO ${s}`);
    return { q: (t, p) => c.query(t, p as any[]), schema: s };
  }
  const catalog = async (q: Exec, schema: string) => ({
    tables: (await q(`SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY 1`, [schema])).rows.map((r) => r.tablename),
    indexes: (await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 ORDER BY 1`, [schema])).rows,
    checks: (await q(`SELECT conname, pg_get_constraintdef(c.oid) d FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = $1 ORDER BY 1`, [schema])).rows,
  });
  const refusal = async (q: Exec) => { try { await runMailboxMigration(q); return null; } catch (e) { if (e instanceof MailboxSchemaError) return e.problems; throw e; } };
  const NOW = `now()`;

  it("creates everything on an empty schema; a second and third run change nothing; a dry run leaves nothing behind", async () => {
    const dry = await scratch();
    expect(await runMailboxMigration(dry.q, { dryRun: true })).toMatchObject({ created: ["mailbox_connections", "mail_send_jobs"], dryRun: true });
    expect((await catalog(dry.q, dry.schema)).tables).toEqual([]);

    const { q, schema } = await scratch();
    expect(await mailboxSchemaPresent(q)).toMatchObject({ ok: false });
    const first = await runMailboxMigration(q);
    expect(first.created).toEqual(["mailbox_connections", "mail_send_jobs"]);
    expect(first.createdIndexes).toHaveLength(8);
    const after = await catalog(q, schema);
    expect(after.tables).toEqual(["mail_send_jobs", "mailbox_connections"]);
    expect(await mailboxSchemaPresent(q)).toEqual({ ok: true });
    for (let i = 0; i < 2; i++) {
      expect(await runMailboxMigration(q)).toEqual({ created: [], addedChecks: [], createdIndexes: [], dryRun: false });
      expect(await catalog(q, schema)).toEqual(after);
    }
    // the temporary comparison tables are gone with the transaction
    expect((await q(`SELECT count(*)::int n FROM pg_class WHERE relname LIKE '\\_mbx\\_expect\\_%' AND relpersistence = 't'`)).rows[0].n).toBe(0);
  });

  it("two migrations at once both succeed (serialized by the advisory lock), and the result is the same", async () => {
    const a = await scratch();
    const b = await scratch(a.schema);
    const [x, y] = await Promise.all([runMailboxMigration(a.q), runMailboxMigration(b.q)]);
    expect([x.created.length, y.created.length].sort()).toEqual([0, 2]);
    expect(await mailboxSchemaPresent(a.q)).toEqual({ ok: true });
  });

  it("the constraints hold: tokens only where allowed, one live mailbox per person and per account, a message handed over once, 'sent' needs proof", async () => {
    const { q } = await scratch();
    await runMailboxMigration(q);
    const conn = (org: string, user: string, sub: string, status: string, token: string | null) =>
      q(`INSERT INTO mailbox_connections (organization_id, user_id, provider, account_email, account_sub, status, refresh_token_enc, token_key_version, connected_at, created_at, updated_at)
         VALUES ($1, $2, 'gmail', 'rep@example.test', $3, $4, $5, $6, ${NOW}, ${NOW}, ${NOW}) RETURNING id`, [org, user, sub, status, token, token ? 1 : null]);
    const err = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e: any) { return e.constraint ?? e.code; } };
    expect(await err(conn("o1", "u1", "s1", "active", null))).toBe("mailbox_connections_token_state_ck");
    expect(await err(conn("o1", "u1", "s1", "disconnected", "mbt1.x"))).toBe("mailbox_connections_token_state_ck");
    expect(await err(conn("o1", "u1", "s1", "paused", null))).toBe("mailbox_connections_status_ck");
    expect(await err(q(`INSERT INTO mailbox_connections (organization_id, user_id, provider, account_email, account_sub, status, refresh_token_enc, connected_at, created_at, updated_at) VALUES ('o1','u1','gmail','a@b.test','s1','active','mbt1.x',now(),now(),now())`))).toBe("mailbox_connections_token_pair_ck");
    expect(await err(conn("o1", "u1", "s1", "active", "mbt1.x"))).toBe("ok");
    expect(await err(conn("o1", "u1", "s2", "active", "mbt1.y"))).toBe("mailbox_connections_live_user_uq");
    expect(await err(conn("o2", "u9", "s1", "needs_reconnect", null))).toBe("mailbox_connections_live_account_uq"); // same account, another org
    expect(await err(conn("o1", "u1", "s1", "disconnected", null))).toBe("ok"); // history rows don't count
    expect(await err(conn("o1", "u1", "s1", "disconnected", null))).toBe("ok");
    // disconnecting clears the token or is refused
    expect(await err(q(`UPDATE mailbox_connections SET status = 'disconnected' WHERE status = 'active'`))).toBe("mailbox_connections_token_state_ck");
    expect(await err(q(`UPDATE mailbox_connections SET status = 'disconnected', refresh_token_enc = NULL, token_key_version = NULL WHERE status = 'active'`))).toBe("ok");

    const job = (msg: number, rfc: string, status = "sending", extra = "") =>
      q(`INSERT INTO mail_send_jobs (organization_id, connection_id, lead_id, message_id, requested_by, body_hash, to_address, rfc_message_id, status, created_at, updated_at${extra ? ", " + extra.split("=")[0] : ""})
         VALUES ('o1', 1, 1, $1, 'u1', $2, 'ceo@acme.test', $3, $4, ${NOW}, ${NOW}${extra ? ", " + extra.split("=")[1] : ""})`, [msg, "0".repeat(64), rfc, status]);
    expect(await err(job(10, "<a@d>"))).toBe("ok");
    expect(await err(job(10, "<b@d>"))).toBe("mail_send_jobs_message_uq");
    expect(await err(job(11, "<a@d>"))).toBe("mail_send_jobs_rfc_uq");
    expect(await err(job(12, "<c@d>", "sent"))).toBe("mail_send_jobs_sent_ck");
    expect(await err(job(12, "<c@d>", "sent", "sent_at=now()"))).toBe("mail_send_jobs_sent_ck");
    expect(await err(job(12, "<c@d>", "queued"))).toBe("mail_send_jobs_status_ck");
    expect(await err(q(`UPDATE mail_send_jobs SET status = 'sent', sent_at = now(), provider_message_id = 'g1' WHERE message_id = 10`))).toBe("ok");
    expect(await err(q(`UPDATE mail_send_jobs SET attempts = -1 WHERE message_id = 10`))).toBe("mail_send_jobs_attempts_ck");
  });

  it("refuses, changing nothing, when an existing table has a column of another type or nullability", async () => {
    for (const ddl of [
      `CREATE TABLE mailbox_connections (id serial PRIMARY KEY, organization_id varchar NOT NULL, user_id varchar NOT NULL, provider varchar(16) NOT NULL, account_email text NOT NULL, account_sub varchar(255) NOT NULL, status varchar(16) NOT NULL, scopes jsonb NOT NULL DEFAULT '[]'::jsonb, refresh_token_enc text, token_key_version smallint, last_error_code varchar(40), last_error_at timestamp, connected_at timestamp NOT NULL, disconnected_at timestamp, created_at timestamp NOT NULL, updated_at timestamp NOT NULL)`,
      `CREATE TABLE mail_send_jobs (id serial PRIMARY KEY, organization_id varchar NOT NULL, message_id integer)`,
    ]) {
      const { q, schema } = await scratch();
      await q(ddl);
      const before = await catalog(q, schema);
      const problems = await refusal(q);
      expect(problems?.length).toBeGreaterThan(0);
      expect(await catalog(q, schema)).toEqual(before);
    }
    const { q } = await scratch();
    await q(`CREATE TABLE mailbox_connections (id serial PRIMARY KEY, organization_id varchar NOT NULL, user_id varchar NOT NULL, provider varchar(16) NOT NULL, account_email text NOT NULL, account_sub varchar(255) NOT NULL, status varchar(16) NOT NULL, scopes jsonb NOT NULL DEFAULT '[]'::jsonb, refresh_token_enc text NOT NULL, token_key_version smallint, last_error_code varchar(40), last_error_at timestamp, connected_at timestamp NOT NULL, disconnected_at timestamp, created_at timestamp NOT NULL, updated_at timestamp NOT NULL)`);
    expect(await refusal(q)).toEqual([
      "mailbox_connections.account_email: type is text, expected character varying(254)",
      "mailbox_connections.refresh_token_enc: NOT NULL, expected nullable",
    ]);
  });

  it("refuses a same-named index or check with another definition, an index name used elsewhere, and a view in a table's place", async () => {
    const a = await scratch();
    await runMailboxMigration(a.q);
    await a.q(`DROP INDEX mail_send_jobs_message_uq`);
    await a.q(`CREATE INDEX mail_send_jobs_message_uq ON mail_send_jobs (message_id)`); // no longer unique
    await a.q(`DROP INDEX mailbox_connections_live_account_uq`);
    await a.q(`CREATE UNIQUE INDEX mailbox_connections_live_account_uq ON mailbox_connections (provider, account_sub) WHERE status = 'active'`); // narrower
    await a.q(`ALTER TABLE mail_send_jobs DROP CONSTRAINT mail_send_jobs_sent_ck`);
    await a.q(`ALTER TABLE mail_send_jobs ADD CONSTRAINT mail_send_jobs_sent_ck CHECK (true)`);
    const p = await refusal(a.q);
    expect(p).toHaveLength(3);
    expect(p!.join("\n")).toMatch(/mail_send_jobs_message_uq: defined as btree/);
    expect(p!.join("\n")).toMatch(/mailbox_connections_live_account_uq: .*WHERE \(\(status\)::text = 'active'/);
    expect(p!.join("\n")).toMatch(/check mail_send_jobs_sent_ck is "CHECK \(true\)"/);

    const b = await scratch();
    await b.q(`CREATE TABLE other (x int)`);
    await b.q(`CREATE INDEX mail_send_jobs_rfc_uq ON other (x)`);
    expect(await refusal(b.q)).toEqual(["mail_send_jobs_rfc_uq: the name is taken by an index on other"]);
    expect((await catalog(b.q, b.schema)).tables).toEqual(["other"]);

    const c = await scratch();
    await c.q(`CREATE VIEW mailbox_connections AS SELECT 1 AS id`);
    expect(await refusal(c.q)).toEqual(["mailbox_connections: the name is taken by a non-table object (relkind v)"]);
  });

  it("a table created without its checks (e.g. by an older drizzle-kit push) gets them, validated: rows that break one stop the migration", async () => {
    const strip = (q: Exec) => q(`ALTER TABLE mailbox_connections DROP CONSTRAINT mailbox_connections_token_state_ck`);
    const ok = await scratch();
    await runMailboxMigration(ok.q);
    await strip(ok.q);
    expect(await runMailboxMigration(ok.q)).toMatchObject({ created: [], addedChecks: ["mailbox_connections_token_state_ck"] });

    const bad = await scratch();
    await runMailboxMigration(bad.q);
    await strip(bad.q);
    await bad.q(`INSERT INTO mailbox_connections (organization_id, user_id, provider, account_email, account_sub, status, connected_at, created_at, updated_at) VALUES ('o','u','gmail','a@b.test','s','active',now(),now(),now())`);
    await expect(runMailboxMigration(bad.q)).rejects.toMatchObject({ code: "23514" }); // check_violation
    expect(await mailboxSchemaPresent(bad.q)).toEqual({ ok: false, missing: ["mailbox_connections_token_state_ck"] });
  });
});
