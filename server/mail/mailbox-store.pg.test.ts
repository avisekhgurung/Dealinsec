/**
 * The MailboxStore contract against the real Postgres store. Runs only with MAILBOX_PG_TEST_URL set to a disposable
 * LOCAL database that has the mailbox tables (script/migrate-mailbox.ts); a non-loopback host is refused. Every case
 * uses fresh organization ids; rows are deleted afterwards.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadKeyring } from "./token-crypto";
import type { MailboxStore } from "./mailbox-store";
import { mailboxStoreContract } from "./mailbox-store.contract";

const URL_ = process.env.MAILBOX_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("Postgres mailbox store", () => {
  let store: MailboxStore;
  let client: any;
  beforeAll(async () => {
    process.env.DATABASE_URL = URL_!;
    store = (await import("./mailbox-store-pg")).pgMailboxStore;
    const { default: pg } = await import("pg");
    client = new pg.Client({ connectionString: URL_ });
    await client.connect();
  });
  afterAll(async () => {
    await client?.query(`DELETE FROM mailbox_connections WHERE organization_id LIKE 'o-%'`);
    await client?.end();
  });
  mailboxStoreContract("Postgres", {
    store: () => store,
    rawEnvelope: async (id) => (await client.query(`SELECT refresh_token_enc FROM mailbox_connections WHERE id = $1`, [id])).rows[0]?.refresh_token_enc ?? null,
  });

  const keyring = loadKeyring({ MAILBOX_TOKEN_KEYS: `1:${randomBytes(32).toString("base64")}`, MAILBOX_TOKEN_KEY_CURRENT: "1" });
  const save = (org: string, user: string, sub: string) => store.save({ orgId: org, userId: user, provider: "fake", account: { sub, email: `${user}@example.test` }, scopes: ["email"], refreshToken: `rt-${randomBytes(4).toString("hex")}`, keyring, now: new Date() });

  it("races: the same person connecting twice at once gets one row (one insert, one reconnect)", async () => {
    for (let i = 0; i < 10; i++) {
      const org = `o-race-${randomBytes(4).toString("hex")}`, sub = `s-${randomBytes(4).toString("hex")}`;
      const rs = await Promise.all([save(org, "u1", sub), save(org, "u1", sub), save(org, "u1", sub)]);
      expect(rs.every((r) => r.ok)).toBe(true);
      expect(rs.filter((r) => r.ok && !r.reconnected)).toHaveLength(1);
      expect((await client.query(`SELECT count(*)::int n FROM mailbox_connections WHERE organization_id = $1`, [org])).rows[0].n).toBe(1);
    }
  });

  it("races: two people connecting the same account at once: exactly one wins, the other is account_in_use", async () => {
    for (let i = 0; i < 10; i++) {
      const sub = `s-${randomBytes(4).toString("hex")}`;
      const rs = await Promise.all([save(`o-x-${i}-${sub}`, "u1", sub), save(`o-y-${i}-${sub}`, "u2", sub)]);
      expect(rs.filter((r) => r.ok)).toHaveLength(1);
      expect(rs.find((r) => !r.ok)).toEqual({ ok: false, code: "account_in_use" });
    }
  });
});
