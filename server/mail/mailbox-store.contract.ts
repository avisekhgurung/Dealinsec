/**
 * The MailboxStore contract, run against the in-memory store (always) and the Postgres store (with a local
 * database). Not a test file itself: mailbox-store.test.ts and mailbox-store.pg.test.ts call it.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { MailboxStore } from "./mailbox-store";
import { decryptToken, loadKeyring } from "./token-crypto";

export interface StoreHarness {
  store: () => MailboxStore;
  /** The stored row's sealed token, read straight from storage (null when none). */
  rawEnvelope: (id: number) => Promise<string | null>;
}

export function mailboxStoreContract(name: string, h: StoreHarness) {
  const keyring = loadKeyring({ MAILBOX_TOKEN_KEYS: `1:${randomBytes(32).toString("base64")}`, MAILBOX_TOKEN_KEY_CURRENT: "1" });
  const otherKeys = loadKeyring({ MAILBOX_TOKEN_KEYS: `1:${randomBytes(32).toString("base64")}`, MAILBOX_TOKEN_KEY_CURRENT: "1" });
  const uniq = () => randomBytes(6).toString("hex");
  const now = new Date("2026-10-14T12:00:00Z");
  const input = (o: { org: string; user: string; sub: string; token?: string; email?: string }) => ({
    orgId: o.org, userId: o.user, provider: "fake" as const, account: { sub: o.sub, email: o.email ?? `${o.user}@example.test` },
    scopes: ["email", "openid", "https://www.googleapis.com/auth/gmail.send"], refreshToken: o.token ?? `rt-${uniq()}`, keyring, now,
  });

  describe(`MailboxStore contract: ${name}`, () => {
    it("connects with the token sealed to its own row: readable through the store, opaque in storage, bound to org/user/id/provider", async () => {
      const s = h.store();
      const org = `o-${uniq()}`, sub = `s-${uniq()}`;
      const r = await s.save(input({ org, user: "u1", sub, token: "rt-secret-1" }));
      if (!r.ok) throw new Error(r.code);
      expect(r).toMatchObject({ reconnected: false, connection: { status: "active", hasToken: true, organizationId: org, userId: "u1", accountSub: sub } });
      expect(JSON.stringify(r.connection)).not.toContain("rt-secret-1");
      const env = await h.rawEnvelope(r.connection.id);
      expect(env).toMatch(/^mbt1\.1\./);
      expect(env).not.toContain("rt-secret-1");
      const bind = { organizationId: org, userId: "u1", connectionId: r.connection.id, provider: "fake" as const };
      expect(decryptToken(env!, bind, keyring)).toBe("rt-secret-1");
      expect(() => decryptToken(env!, { ...bind, connectionId: r.connection.id + 1 }, keyring)).toThrow();
      expect(() => decryptToken(env!, { ...bind, organizationId: "other" }, keyring)).toThrow();
      expect(await s.token(org, "u1", "fake", keyring)).toMatchObject({ refreshToken: "rt-secret-1" });
      expect(await s.token(org, "u1", "fake", otherKeys)).toMatchObject({ refreshToken: null, reason: "unreadable" });
    });

    it("reconnecting the same account keeps the row and replaces the token; a different account is identity_mismatch", async () => {
      const s = h.store();
      const org = `o-${uniq()}`, sub = `s-${uniq()}`;
      const a = await s.save(input({ org, user: "u1", sub, token: "old" }));
      const b = await s.save(input({ org, user: "u1", sub, token: "new", email: "renamed@example.test" }));
      if (!a.ok || !b.ok) throw new Error("save failed");
      expect(b).toMatchObject({ reconnected: true, connection: { id: a.connection.id, accountEmail: "renamed@example.test" } });
      expect((await s.token(org, "u1", "fake", keyring)) as any).toMatchObject({ refreshToken: "new" });
      expect(await s.save(input({ org, user: "u1", sub: `s-${uniq()}` }))).toEqual({ ok: false, code: "identity_mismatch" });
      expect((await s.token(org, "u1", "fake", keyring)) as any).toMatchObject({ refreshToken: "new" });
    });

    it("one live connection per account across DealInSec: another member or another organization gets account_in_use", async () => {
      const s = h.store();
      const org = `o-${uniq()}`, sub = `s-${uniq()}`;
      expect((await s.save(input({ org, user: "u1", sub }))).ok).toBe(true);
      expect(await s.save(input({ org, user: "u2", sub }))).toEqual({ ok: false, code: "account_in_use" });
      expect(await s.save(input({ org: `o-${uniq()}`, user: "u9", sub }))).toEqual({ ok: false, code: "account_in_use" });
      expect(await s.accountLive("fake", sub)).toBe(true);
      expect(await s.accountLive("gmail", sub)).toBe(false);
    });

    it("a problem marks it for reconnecting (optionally deleting the token); healthy only with a token; reconnect restores it", async () => {
      const s = h.store();
      const org = `o-${uniq()}`, sub = `s-${uniq()}`;
      const r = await s.save(input({ org, user: "u1", sub }));
      if (!r.ok) throw new Error(r.code);
      await s.markProblem({ orgId: org, id: r.connection.id, code: "revoked", clearToken: true, now });
      expect(await s.live(org, "u1", "fake")).toMatchObject({ status: "needs_reconnect", hasToken: false, lastErrorCode: "revoked" });
      expect(await h.rawEnvelope(r.connection.id)).toBeNull();
      expect(await s.token(org, "u1", "fake", keyring)).toMatchObject({ refreshToken: null, reason: "no_token" });
      await s.markHealthy({ orgId: org, id: r.connection.id, scopes: ["email"], now });
      expect(await s.live(org, "u1", "fake")).toMatchObject({ status: "needs_reconnect" });
      const again = await s.save(input({ org, user: "u1", sub, token: "fresh" }));
      expect(again).toMatchObject({ ok: true, reconnected: true, connection: { status: "active", hasToken: true, lastErrorCode: null } });
    });

    it("disconnect deletes the token, keeps a minimal row, frees the account; returns the token for revoking (or null without keys)", async () => {
      const s = h.store();
      const org = `o-${uniq()}`, sub = `s-${uniq()}`;
      const r = await s.save(input({ org, user: "u1", sub, token: "to-revoke" }));
      if (!r.ok) throw new Error(r.code);
      const out = await s.disconnect({ orgId: org, userId: "u1", keyring, now });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ refreshToken: "to-revoke", connection: { id: r.connection.id, status: "disconnected", hasToken: false, accountEmail: "u1@example.test" } });
      expect(await h.rawEnvelope(r.connection.id)).toBeNull();
      expect(await s.live(org, "u1", "fake")).toBeNull();
      expect(await s.accountLive("fake", sub)).toBe(false);
      expect(await s.disconnect({ orgId: org, userId: "u1", keyring, now })).toEqual([]);
      // the account can now be connected by someone else, and history rows don't block
      expect((await s.save(input({ org, user: "u2", sub }))).ok).toBe(true);
      const blind = await s.disconnect({ orgId: org, userId: "u2", keyring: null, now });
      expect(blind[0].refreshToken).toBeNull();
      await s.noteRevokeFailed(org, blind[0].connection.id, now);
    });

    it("never crosses organizations: another org's id or user can't be read, marked or disconnected", async () => {
      const s = h.store();
      const orgA = `o-${uniq()}`, orgB = `o-${uniq()}`;
      const a = await s.save(input({ org: orgA, user: "u1", sub: `s-${uniq()}` }));
      if (!a.ok) throw new Error(a.code);
      expect(await s.live(orgB, "u1", "fake")).toBeNull();
      expect(await s.token(orgB, "u1", "fake", keyring)).toBeNull();
      await s.markProblem({ orgId: orgB, id: a.connection.id, code: "revoked", clearToken: true, now });
      expect(await s.disconnect({ orgId: orgB, userId: "u1", keyring, now })).toEqual([]);
      expect(await s.live(orgA, "u1", "fake")).toMatchObject({ status: "active", hasToken: true });
    });
  });
}
