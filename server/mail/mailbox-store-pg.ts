/**
 * The Postgres MailboxStore (tables from script/migrate-mailbox.ts). See mailbox-store.ts for the contract.
 *
 * A connect runs in one transaction under a per-person advisory lock, so two simultaneous callbacks for the same
 * person can't both insert; the live unique indexes are the final word between different people. A new row's id is
 * drawn from its sequence first, so the token can be sealed to that id before the row exists.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { mailboxConnections, type MailboxConnectionRow } from "@shared/schema";
import { decryptToken, encryptToken, type Keyring, type MailboxProvider } from "./token-crypto";
import { LIVE_STATUSES, type ConnectionView, type MailboxStore, type SaveInput, type SaveResult, type TokenRead } from "./mailbox-store";

const CONNECT_LOCK = 7_310_041; // advisory namespace: one connect per person at a time
const live = inArray(mailboxConnections.status, [...LIVE_STATUSES]);
const bind = (r: MailboxConnectionRow) => ({ organizationId: r.organizationId, userId: r.userId, connectionId: r.id, provider: r.provider as MailboxProvider });
const view = (r: MailboxConnectionRow): ConnectionView => ({
  id: r.id, organizationId: r.organizationId, userId: r.userId, provider: r.provider as MailboxProvider,
  accountEmail: r.accountEmail, accountSub: r.accountSub, status: r.status as ConnectionView["status"],
  scopes: Array.isArray(r.scopes) ? (r.scopes as string[]) : [], hasToken: r.refreshTokenEnc !== null,
  lastErrorCode: r.lastErrorCode, lastErrorAt: r.lastErrorAt, connectedAt: r.connectedAt, disconnectedAt: r.disconnectedAt,
});
const pgCode = (e: any): { code?: string; constraint?: string } => ({ code: e?.code ?? e?.cause?.code, constraint: e?.constraint ?? e?.cause?.constraint });

export const pgMailboxStore: MailboxStore = {
  async live(orgId, userId, provider) {
    const [r] = await db.select().from(mailboxConnections)
      .where(and(eq(mailboxConnections.organizationId, orgId), eq(mailboxConnections.userId, userId), eq(mailboxConnections.provider, provider), live)).limit(1);
    return r ? view(r) : null;
  },

  async accountLive(provider, sub) {
    const [r] = await db.select({ id: mailboxConnections.id }).from(mailboxConnections)
      .where(and(eq(mailboxConnections.provider, provider), eq(mailboxConnections.accountSub, sub), live)).limit(1);
    return !!r;
  },

  async save(i: SaveInput): Promise<SaveResult> {
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${CONNECT_LOCK}::int, hashtext(${`${i.orgId}|${i.userId}|${i.provider}`}))`);
        const [cur] = await tx.select().from(mailboxConnections)
          .where(and(eq(mailboxConnections.organizationId, i.orgId), eq(mailboxConnections.userId, i.userId), eq(mailboxConnections.provider, i.provider), live))
          .for("update");
        if (cur && cur.accountSub !== i.account.sub) return { ok: false, code: "identity_mismatch" } as const;
        const [other] = await tx.select({ id: mailboxConnections.id }).from(mailboxConnections)
          .where(and(eq(mailboxConnections.provider, i.provider), eq(mailboxConnections.accountSub, i.account.sub), live, cur ? sql`${mailboxConnections.id} <> ${cur.id}` : sql`true`)).limit(1);
        if (other) return { ok: false, code: "account_in_use" } as const;
        const fields = { accountEmail: i.account.email, scopes: i.scopes, status: "active", lastErrorCode: null, lastErrorAt: null, connectedAt: i.now, updatedAt: i.now };
        if (cur) {
          const sealed = encryptToken(i.refreshToken, bind(cur), i.keyring);
          const [row] = await tx.update(mailboxConnections).set({ ...fields, refreshTokenEnc: sealed.envelope, tokenKeyVersion: sealed.keyVersion })
            .where(eq(mailboxConnections.id, cur.id)).returning();
          return { ok: true, connection: view(row), reconnected: true } as const;
        }
        const idRow = await tx.execute(sql`SELECT nextval(pg_get_serial_sequence('mailbox_connections', 'id'))::int AS id`);
        const id = Number((idRow.rows[0] as { id: unknown }).id);
        const sealed = encryptToken(i.refreshToken, { organizationId: i.orgId, userId: i.userId, connectionId: id, provider: i.provider }, i.keyring);
        const [row] = await tx.insert(mailboxConnections).values({
          id, organizationId: i.orgId, userId: i.userId, provider: i.provider, accountSub: i.account.sub, ...fields,
          refreshTokenEnc: sealed.envelope, tokenKeyVersion: sealed.keyVersion, createdAt: i.now,
        }).returning();
        return { ok: true, connection: view(row), reconnected: false } as const;
      });
    } catch (e) {
      // Another person connected the same account between our check and our insert: the index decides.
      const { code, constraint } = pgCode(e);
      if (code === "23505" && constraint === "mailbox_connections_live_account_uq") return { ok: false, code: "account_in_use" };
      throw e;
    }
  },

  async token(orgId, userId, provider, keyring: Keyring): Promise<TokenRead | null> {
    const [r] = await db.select().from(mailboxConnections)
      .where(and(eq(mailboxConnections.organizationId, orgId), eq(mailboxConnections.userId, userId), eq(mailboxConnections.provider, provider), live)).limit(1);
    if (!r) return null;
    if (!r.refreshTokenEnc) return { connection: view(r), refreshToken: null, reason: "no_token" };
    try { return { connection: view(r), refreshToken: decryptToken(r.refreshTokenEnc, bind(r), keyring) }; } catch { return { connection: view(r), refreshToken: null, reason: "unreadable" }; }
  },

  async markProblem({ orgId, id, code, clearToken, now }) {
    await db.update(mailboxConnections)
      .set({ status: "needs_reconnect", lastErrorCode: code, lastErrorAt: now, updatedAt: now, ...(clearToken ? { refreshTokenEnc: null, tokenKeyVersion: null } : {}) })
      .where(and(eq(mailboxConnections.id, id), eq(mailboxConnections.organizationId, orgId), live));
  },

  async markHealthy({ orgId, id, scopes, now }) {
    await db.update(mailboxConnections)
      .set({ status: "active", scopes, lastErrorCode: null, lastErrorAt: null, updatedAt: now })
      .where(and(eq(mailboxConnections.id, id), eq(mailboxConnections.organizationId, orgId), live, sql`${mailboxConnections.refreshTokenEnc} IS NOT NULL`));
  },

  async disconnect({ orgId, userId, provider, keyring, now }) {
    return db.transaction(async (tx) => {
      const rows = await tx.select().from(mailboxConnections)
        .where(and(eq(mailboxConnections.organizationId, orgId), eq(mailboxConnections.userId, userId), live, provider ? eq(mailboxConnections.provider, provider) : sql`true`))
        .for("update");
      const out: { connection: ConnectionView; refreshToken: string | null }[] = [];
      for (const r of rows) {
        let token: string | null = null;
        if (r.refreshTokenEnc && keyring) { try { token = decryptToken(r.refreshTokenEnc, bind(r), keyring); } catch { token = null; } }
        const [next] = await tx.update(mailboxConnections)
          .set({ status: "disconnected", refreshTokenEnc: null, tokenKeyVersion: null, lastErrorCode: null, lastErrorAt: null, disconnectedAt: now, updatedAt: now })
          .where(eq(mailboxConnections.id, r.id)).returning();
        out.push({ connection: view(next), refreshToken: token });
      }
      return out;
    });
  },

  async noteRevokeFailed(orgId, id, now) {
    await db.update(mailboxConnections).set({ lastErrorCode: "revoke_failed", lastErrorAt: now, updatedAt: now })
      .where(and(eq(mailboxConnections.id, id), eq(mailboxConnections.organizationId, orgId)));
  },
};
