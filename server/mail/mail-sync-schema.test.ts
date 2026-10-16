import { describe, expect, it } from "vitest";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { mailMessages, mailSyncState, mailThreads, outreachFollowups } from "@shared/schema";
import { mailboxDdl, MAILBOX_TABLES } from "./mailbox-schema";
import { MAIL_SYNC_TABLES } from "./mail-sync-schema";

describe("reply-sync schema: definitions", () => {
  it("is additive only and separate from the mailbox tables (their gate never waits on this migration)", () => {
    const ddl = mailboxDdl(MAIL_SYNC_TABLES);
    expect(ddl).toHaveLength(4 + MAIL_SYNC_TABLES.reduce((n, t) => n + t.indexes.length, 0));
    for (const s of ddl) {
      expect(s).toMatch(/^CREATE (TABLE|(UNIQUE )?INDEX) IF NOT EXISTS /);
      expect(s).not.toMatch(/\b(DROP|ALTER|UPDATE|DELETE|TRUNCATE|REFERENCES)\b/i);
      expect(s).toMatch(/ (ON )?(mail_sync_state|mail_threads|mail_messages|outreach_followups)\b/);
    }
    const names = new Set(MAILBOX_TABLES.map((t) => t.name));
    expect(MAIL_SYNC_TABLES.some((t) => names.has(t.name))).toBe(false);
  });

  it("keeps no token, no raw message, no HTML and no attachment: plain text and ids only", () => {
    const cols = MAIL_SYNC_TABLES.flatMap((t) => t.columns.map(([c]) => `${t.name}.${c}`));
    expect(cols.filter((c) => /token|secret|raw|html|attachment|snippet|label|cc_|bcc/.test(c))).toEqual([]);
    expect(cols.filter((c) => /body/.test(c))).toEqual(["mail_messages.body_text", "mail_messages.body_trimmed", "mail_messages.body_removed_at"]);
  });

  it("a message is stored once per mailbox (the sync's idempotency key)", () => {
    const uq = MAIL_SYNC_TABLES.find((t) => t.name === "mail_messages")!.indexes.find((i) => i.unique)!;
    expect([uq.name, uq.columns, uq.where]).toEqual(["mail_messages_provider_uq", ["connection_id", "provider_message_id"], undefined]);
  });

  it("the drizzle tables in shared/schema.ts agree with the migration: columns, types, nullability, checks, indexes", () => {
    const dialect = new PgDialect();
    const render = (s: any) => dialect.sqlToQuery(s).sql;
    for (const [table, spec] of [[mailSyncState, MAIL_SYNC_TABLES[0]], [mailThreads, MAIL_SYNC_TABLES[1]], [mailMessages, MAIL_SYNC_TABLES[2]], [outreachFollowups, MAIL_SYNC_TABLES[3]]] as const) {
      const cfg = getTableConfig(table);
      expect(cfg.name).toBe(spec.name);
      expect(cfg.columns.map((c) => [c.name, c.getSQLType(), c.notNull])).toEqual(spec.columns.map(([n, ddl]) => [n, ddl.split(" ")[0], /NOT NULL|PRIMARY KEY/.test(ddl)]));
      expect(cfg.checks.map((c) => [c.name, render(c.value)])).toEqual(spec.checks);
      expect(cfg.indexes.map((i) => [i.config.name, !!i.config.unique, i.config.columns.map((c: any) => c.name), i.config.where ? render(i.config.where) : undefined]))
        .toEqual(spec.indexes.map((i) => [i.name, !!i.unique, i.columns, i.where]));
    }
  });
});
