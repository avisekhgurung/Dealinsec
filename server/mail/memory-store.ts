/**
 * An in-memory MailboxStore for tests: the same rules as the Postgres store (live uniqueness per person and per
 * account, identity on reconnect, sealed tokens bound to their row), and the database's checks asserted on every
 * write. `rows` is exposed so tests can look at what was stored (envelopes, never plaintext).
 */
import { decryptToken, encryptToken, type Keyring, type MailboxProvider } from "./token-crypto";
import { LIVE_STATUSES, type ConnectionView, type MailboxStore, type SaveInput, type SaveResult, type TokenRead } from "./mailbox-store";

export interface MemoryRow extends Omit<ConnectionView, "hasToken"> {
  refreshTokenEnc: string | null;
  tokenKeyVersion: number | null;
  updatedAt: Date;
}

const isLive = (r: MemoryRow) => (LIVE_STATUSES as readonly string[]).includes(r.status);
const bind = (r: MemoryRow) => ({ organizationId: r.organizationId, userId: r.userId, connectionId: r.id, provider: r.provider });
const view = (r: MemoryRow): ConnectionView => {
  const { refreshTokenEnc, tokenKeyVersion: _k, updatedAt: _u, ...v } = r;
  return { ...v, scopes: [...v.scopes], hasToken: refreshTokenEnc !== null };
};

export class MemoryMailboxStore implements MailboxStore {
  readonly rows: MemoryRow[] = [];
  private seq = 0;

  /** The database's check constraints, enforced on every write so tests can't pass on states Postgres would refuse. */
  private assertRow(r: MemoryRow): void {
    if ((r.refreshTokenEnc === null) !== (r.tokenKeyVersion === null)) throw new Error("mailbox_connections_token_pair_ck");
    const ok = (r.status === "active" && r.refreshTokenEnc !== null) || r.status === "needs_reconnect" || ((r.status === "revoked" || r.status === "disconnected") && r.refreshTokenEnc === null);
    if (!ok) throw new Error("mailbox_connections_token_state_ck");
    if (isLive(r) && this.rows.some((x) => x !== r && isLive(x) && x.organizationId === r.organizationId && x.userId === r.userId && x.provider === r.provider)) throw new Error("mailbox_connections_live_user_uq");
    if (isLive(r) && this.rows.some((x) => x !== r && isLive(x) && x.provider === r.provider && x.accountSub === r.accountSub)) throw new Error("mailbox_connections_live_account_uq");
  }

  private liveRow(orgId: string, userId: string, provider: MailboxProvider) {
    return this.rows.find((r) => r.organizationId === orgId && r.userId === userId && r.provider === provider && isLive(r)) ?? null;
  }

  async live(orgId: string, userId: string, provider: MailboxProvider) {
    const r = this.liveRow(orgId, userId, provider);
    return r ? view(r) : null;
  }

  async accountLive(provider: MailboxProvider, sub: string) {
    return this.rows.some((r) => r.provider === provider && r.accountSub === sub && isLive(r));
  }

  async save(i: SaveInput): Promise<SaveResult> {
    const cur = this.liveRow(i.orgId, i.userId, i.provider);
    if (cur && cur.accountSub !== i.account.sub) return { ok: false, code: "identity_mismatch" };
    if (this.rows.some((r) => r !== cur && isLive(r) && r.provider === i.provider && r.accountSub === i.account.sub)) return { ok: false, code: "account_in_use" };
    const row: MemoryRow = cur ?? {
      id: ++this.seq, organizationId: i.orgId, userId: i.userId, provider: i.provider, accountEmail: i.account.email, accountSub: i.account.sub,
      status: "active", scopes: [], refreshTokenEnc: null, tokenKeyVersion: null, lastErrorCode: null, lastErrorAt: null,
      connectedAt: i.now, disconnectedAt: null, updatedAt: i.now,
    };
    const sealed = encryptToken(i.refreshToken, bind(row), i.keyring);
    const next: MemoryRow = { ...row, accountEmail: i.account.email, scopes: [...i.scopes], refreshTokenEnc: sealed.envelope, tokenKeyVersion: sealed.keyVersion, status: "active", lastErrorCode: null, lastErrorAt: null, connectedAt: i.now, updatedAt: i.now };
    this.write(cur, next);
    return { ok: true, connection: view(next), reconnected: !!cur };
  }

  async token(orgId: string, userId: string, provider: MailboxProvider, keyring: Keyring): Promise<TokenRead | null> {
    const r = this.liveRow(orgId, userId, provider);
    if (!r) return null;
    if (!r.refreshTokenEnc) return { connection: view(r), refreshToken: null, reason: "no_token" };
    try { return { connection: view(r), refreshToken: decryptToken(r.refreshTokenEnc, bind(r), keyring) }; } catch { return { connection: view(r), refreshToken: null, reason: "unreadable" }; }
  }

  async markProblem(i: { orgId: string; id: number; code: string; clearToken: boolean; now: Date }) {
    const r = this.rows.find((x) => x.id === i.id && x.organizationId === i.orgId && isLive(x));
    if (!r) return;
    this.write(r, { ...r, status: "needs_reconnect", lastErrorCode: i.code, lastErrorAt: i.now, updatedAt: i.now, ...(i.clearToken ? { refreshTokenEnc: null, tokenKeyVersion: null } : {}) });
  }

  async markHealthy(i: { orgId: string; id: number; scopes: string[]; now: Date }) {
    const r = this.rows.find((x) => x.id === i.id && x.organizationId === i.orgId && isLive(x) && x.refreshTokenEnc !== null);
    if (!r) return;
    this.write(r, { ...r, status: "active", scopes: [...i.scopes], lastErrorCode: null, lastErrorAt: null, updatedAt: i.now });
  }

  async disconnect(i: { orgId: string; userId: string; provider?: MailboxProvider; keyring: Keyring | null; now: Date }) {
    const out: { connection: ConnectionView; refreshToken: string | null }[] = [];
    for (const r of this.rows.filter((x) => x.organizationId === i.orgId && x.userId === i.userId && isLive(x) && (!i.provider || x.provider === i.provider))) {
      let token: string | null = null;
      if (r.refreshTokenEnc && i.keyring) { try { token = decryptToken(r.refreshTokenEnc, bind(r), i.keyring); } catch { token = null; } }
      const next: MemoryRow = { ...r, status: "disconnected", refreshTokenEnc: null, tokenKeyVersion: null, lastErrorCode: null, lastErrorAt: null, disconnectedAt: i.now, updatedAt: i.now };
      this.write(r, next);
      out.push({ connection: view(next), refreshToken: token });
    }
    return out;
  }

  async noteRevokeFailed(orgId: string, id: number, now: Date) {
    const r = this.rows.find((x) => x.id === id && x.organizationId === orgId);
    if (r) this.write(r, { ...r, lastErrorCode: "revoke_failed", lastErrorAt: now, updatedAt: now });
  }

  private write(prev: MemoryRow | null, next: MemoryRow) {
    const idx = prev ? this.rows.indexOf(prev) : -1;
    if (idx < 0) { this.assertRow(next); this.rows.push(next); return; }
    this.rows[idx] = next;
    try { this.assertRow(next); } catch (e) { this.rows[idx] = prev!; throw e; }
  }
}
