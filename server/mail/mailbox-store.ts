/**
 * Where connected mailboxes live. One interface, two implementations: mailbox-store-pg.ts (the app) and
 * memory-store.ts (tests). The same contract suite (mailbox-store.contract.ts) runs against both.
 *
 * Every call is scoped by the organization AND the user it acts for, taken from the signed-in session, never from
 * the request. Tokens are sealed here with token-crypto, bound to (organization, user, connection id, provider);
 * nothing outside a store sees an envelope, and nothing returns a token except the calls that must (to refresh or
 * revoke it).
 */
import type { Keyring, MailboxProvider } from "./token-crypto";

export const LIVE_STATUSES = ["active", "needs_reconnect"] as const;

/** A connection as the rest of the app may see it: no token, no envelope. */
export interface ConnectionView {
  id: number;
  organizationId: string;
  userId: string;
  provider: MailboxProvider;
  accountEmail: string;
  accountSub: string;
  status: "active" | "needs_reconnect" | "revoked" | "disconnected";
  scopes: string[];
  hasToken: boolean;
  lastErrorCode: string | null;
  lastErrorAt: Date | null;
  connectedAt: Date;
  disconnectedAt: Date | null;
}

export type SaveResult =
  | { ok: true; connection: ConnectionView; reconnected: boolean }
  | { ok: false; code: "identity_mismatch" | "account_in_use" };

export type TokenRead =
  | { connection: ConnectionView; refreshToken: string }
  | { connection: ConnectionView; refreshToken: null; reason: "no_token" | "unreadable" };

export interface SaveInput {
  orgId: string;
  userId: string;
  provider: MailboxProvider;
  account: { sub: string; email: string };
  scopes: string[];
  refreshToken: string;
  keyring: Keyring;
  now: Date;
}

export interface MailboxStore {
  /** The person's live (active or needs-reconnect) connection for a provider, if any. */
  live(orgId: string, userId: string, provider: MailboxProvider): Promise<ConnectionView | null>;
  /** Whether this provider account is live anywhere (so revoking its grant would cut someone else off). */
  accountLive(provider: MailboxProvider, sub: string): Promise<boolean>;
  /**
   * Connects, or reconnects the same account. A different account while one is live is identity_mismatch; an
   * account live for anyone else (another member, another organization) is account_in_use. Atomic per person.
   */
  save(input: SaveInput): Promise<SaveResult>;
  /** The live connection's refresh token, decrypted, or why it can't be. */
  token(orgId: string, userId: string, provider: MailboxProvider, keyring: Keyring): Promise<TokenRead | null>;
  /** Needs reconnecting, with a reason code; `clearToken` deletes a token that can no longer work. */
  markProblem(input: { orgId: string; id: number; code: string; clearToken: boolean; now: Date }): Promise<void>;
  /** Working again (only a connection that still holds a token). */
  markHealthy(input: { orgId: string; id: number; scopes: string[]; now: Date }): Promise<void>;
  /**
   * Disconnects the person's live connections (one provider, or all): token deleted, status disconnected, the row
   * kept as the audit record. Returns each with its token (decrypted for revoking; null when there was none, it
   * could not be read, or no keyring was given).
   */
  disconnect(input: { orgId: string; userId: string; provider?: MailboxProvider; keyring: Keyring | null; now: Date }): Promise<{ connection: ConnectionView; refreshToken: string | null }[]>;
  /** Records that the provider did not confirm a revoke (the stored token is already gone). */
  noteRevokeFailed(orgId: string, id: number, now: Date): Promise<void>;
}
