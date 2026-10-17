/**
 * Mailbox refresh tokens, encrypted at rest (AES-256-GCM). Pure: no database, no network.
 *
 * Every token is sealed with a fresh random 96-bit IV and a 128-bit authentication tag, under a numbered key from
 * MAILBOX_TOKEN_KEYS, and bound (as associated data) to the organization, user, connection and provider it belongs to.
 * A ciphertext copied into another connection's row, or edited in any byte, does not decrypt.
 *
 *   MAILBOX_TOKEN_KEYS="1:<base64 of 32 random bytes>,2:<…>"   every key that may still be in use
 *   MAILBOX_TOKEN_KEY_CURRENT=2                                the one new tokens are sealed with
 *
 * A key is generated with `openssl rand -base64 32`. Rotating: add the new key, point CURRENT at it, re-seal the rows
 * still on the old version (rotateToken), and only then remove the old key. Errors never carry key material or tokens.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const MAILBOX_PROVIDERS = ["gmail", "fake"] as const;
export type MailboxProvider = (typeof MAILBOX_PROVIDERS)[number];
/** Every provider whose credential may be sealed here: mailboxes, and a workspace's WhatsApp Business access token. */
export const SEALED_PROVIDERS = [...MAILBOX_PROVIDERS, "whatsapp"] as const;
export type SealedProvider = (typeof SEALED_PROVIDERS)[number];

/** Who a token belongs to. All four are sealed into the ciphertext as associated data. */
export interface TokenBinding {
  organizationId: string;
  userId: string;
  connectionId: number;
  provider: SealedProvider;
}

export interface Keyring {
  current: number;
  keys: ReadonlyMap<number, Buffer>;
}

export type TokenCryptoErrorCode =
  | "config_missing" // no keys configured
  | "config_invalid" // keys configured, but not usable
  | "unknown_key_version" // sealed with a key that is no longer configured
  | "malformed" // not an envelope this module wrote
  | "auth_failed" // tampered, or bound to another connection
  | "bad_binding"; // the binding itself is incomplete

export class TokenCryptoError extends Error {
  constructor(readonly code: TokenCryptoErrorCode, message: string) {
    super(message);
    this.name = "TokenCryptoError";
  }
}

const FORMAT = "mbt1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_VERSION = 32_767; // fits the smallint key-version column
const B64_KEY = /^[A-Za-z0-9+/_-]{43}=?$/; // 32 bytes, base64 or base64url
const B64URL = /^[A-Za-z0-9_-]+$/;

/** Reads the keyring from the environment. Throws (config_missing / config_invalid) rather than guess. */
export function loadKeyring(env: Record<string, string | undefined> = process.env): Keyring {
  const rawKeys = (env.MAILBOX_TOKEN_KEYS ?? "").trim();
  const rawCurrent = (env.MAILBOX_TOKEN_KEY_CURRENT ?? "").trim();
  if (!rawKeys) throw new TokenCryptoError("config_missing", "MAILBOX_TOKEN_KEYS is not set");
  if (!rawCurrent) throw new TokenCryptoError("config_missing", "MAILBOX_TOKEN_KEY_CURRENT is not set");
  const keys = new Map<number, Buffer>();
  const parts = rawKeys.split(",");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const m = /^\s*(\d{1,5}):(\S+)\s*$/.exec(part);
    if (!m) throw new TokenCryptoError("config_invalid", `MAILBOX_TOKEN_KEYS entry ${i + 1} is not "<version>:<base64 key>"`);
    const version = Number(m[1]);
    if (!Number.isInteger(version) || version < 1 || version > MAX_VERSION) throw new TokenCryptoError("config_invalid", `MAILBOX_TOKEN_KEYS entry ${i + 1}: the version must be 1–${MAX_VERSION}`);
    if (keys.has(version)) throw new TokenCryptoError("config_invalid", `MAILBOX_TOKEN_KEYS: version ${version} appears twice`);
    if (!B64_KEY.test(m[2])) throw new TokenCryptoError("config_invalid", `MAILBOX_TOKEN_KEYS: key ${version} is not 32 bytes of base64`);
    const key = Buffer.from(m[2].replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (key.length !== KEY_BYTES) throw new TokenCryptoError("config_invalid", `MAILBOX_TOKEN_KEYS: key ${version} is not 32 bytes`);
    if (key.every((b) => b === key[0])) throw new TokenCryptoError("config_invalid", `MAILBOX_TOKEN_KEYS: key ${version} is a constant byte, not a random key`);
    keys.set(version, key);
  }
  if (!/^\d{1,5}$/.test(rawCurrent)) throw new TokenCryptoError("config_invalid", "MAILBOX_TOKEN_KEY_CURRENT must be a key version number");
  const current = Number(rawCurrent);
  if (!keys.has(current)) throw new TokenCryptoError("config_invalid", `MAILBOX_TOKEN_KEY_CURRENT is ${current}, which is not in MAILBOX_TOKEN_KEYS`);
  return { current, keys };
}

function checkBinding(b: TokenBinding): void {
  const ok = typeof b?.organizationId === "string" && b.organizationId.length > 0
    && typeof b.userId === "string" && b.userId.length > 0
    && Number.isSafeInteger(b.connectionId) && b.connectionId > 0
    && (SEALED_PROVIDERS as readonly string[]).includes(b.provider);
  if (!ok) throw new TokenCryptoError("bad_binding", "a token must be bound to an organization, a user, a saved connection and a provider");
}

/** The associated data: unambiguous (a JSON array, so no field can bleed into the next) and versioned. */
function associatedData(version: number, b: TokenBinding): Buffer {
  // A mailbox token keeps the label it was first sealed under; another provider's credential has its own, so a sealed
  // value can never be read as the other kind.
  const label = b.provider === "whatsapp" ? "dealinsec/whatsapp-access-token/v1" : "dealinsec/mailbox-refresh-token/v1";
  return Buffer.from(JSON.stringify([label, version, b.organizationId, b.userId, b.connectionId, b.provider]), "utf8");
}

/** Seals a token under the current key. The envelope is `mbt1.<key version>.<iv>.<tag>.<ciphertext>` (base64url). */
export function encryptToken(plaintext: string, binding: TokenBinding, keyring: Keyring): { envelope: string; keyVersion: number } {
  checkBinding(binding);
  if (typeof plaintext !== "string" || plaintext.length === 0) throw new TokenCryptoError("bad_binding", "there is no token to encrypt");
  const key = keyring.keys.get(keyring.current);
  if (!key) throw new TokenCryptoError("config_invalid", "the current key is not in the keyring");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(associatedData(keyring.current, binding));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { envelope: [FORMAT, keyring.current, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join("."), keyVersion: keyring.current };
}

function parseEnvelope(envelope: string): { version: number; iv: Buffer; tag: Buffer; ct: Buffer } {
  const parts = typeof envelope === "string" ? envelope.split(".") : [];
  if (parts.length !== 5 || parts[0] !== FORMAT || !/^\d{1,5}$/.test(parts[1]) || !parts.slice(2).every((p) => B64URL.test(p))) {
    throw new TokenCryptoError("malformed", "not a sealed mailbox token");
  }
  const iv = Buffer.from(parts[2], "base64url");
  const tag = Buffer.from(parts[3], "base64url");
  const ct = Buffer.from(parts[4], "base64url");
  // A shortened tag would weaken the check: accept exactly 16 bytes, never fewer.
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ct.length === 0) throw new TokenCryptoError("malformed", "not a sealed mailbox token");
  // Only the canonical spelling: base64 has spare bits in its last character, so two strings can decode alike.
  if (iv.toString("base64url") !== parts[2] || tag.toString("base64url") !== parts[3] || ct.toString("base64url") !== parts[4]) {
    throw new TokenCryptoError("malformed", "not a sealed mailbox token");
  }
  return { version: Number(parts[1]), iv, tag, ct };
}

/** The key version an envelope was sealed with (for finding rows to re-seal). */
export function envelopeKeyVersion(envelope: string): number {
  return parseEnvelope(envelope).version;
}

/** Opens a token. Fails (auth_failed) if any byte changed or the binding is not the one it was sealed with. */
export function decryptToken(envelope: string, binding: TokenBinding, keyring: Keyring): string {
  checkBinding(binding);
  const { version, iv, tag, ct } = parseEnvelope(envelope);
  const key = keyring.keys.get(version);
  if (!key) throw new TokenCryptoError("unknown_key_version", `this token was sealed with key ${version}, which is not configured`);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(associatedData(version, binding));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    throw new TokenCryptoError("auth_failed", "the token did not authenticate (altered, or bound to another connection)");
  }
}

/** Re-seals a token under the current key if it is on an older one. Authenticates it first. */
export function rotateToken(envelope: string, binding: TokenBinding, keyring: Keyring): { envelope: string; keyVersion: number; rotated: boolean } {
  const plaintext = decryptToken(envelope, binding, keyring);
  const version = envelopeKeyVersion(envelope);
  if (version === keyring.current) return { envelope, keyVersion: version, rotated: false };
  return { ...encryptToken(plaintext, binding, keyring), rotated: true };
}
