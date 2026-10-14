import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, envelopeKeyVersion, loadKeyring, rotateToken, TokenCryptoError, type TokenBinding } from "./token-crypto";

const k = () => randomBytes(32).toString("base64");
const K1 = k(), K2 = k();
const ring = (keys: string, current: string) => loadKeyring({ MAILBOX_TOKEN_KEYS: keys, MAILBOX_TOKEN_KEY_CURRENT: current });
const bind: TokenBinding = { organizationId: "org-a", userId: "user-1", connectionId: 7, provider: "gmail" };
const TOKEN = "1//0g-refresh-token-example_ABC";

const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof TokenCryptoError ? e.code : `other: ${(e as Error).message}`; } return "no error"; };
/** Flips one bit in one decoded part of the envelope (2 iv, 3 tag, 4 ciphertext) and re-encodes it canonically. */
function flip(envelope: string, part: 2 | 3 | 4, byte = 0): string {
  const p = envelope.split(".");
  const b = Buffer.from(p[part], "base64url");
  b[byte] ^= 0x01;
  p[part] = b.toString("base64url");
  return p.join(".");
}

describe("mailbox token encryption (AES-256-GCM)", () => {
  it("round-trips, with a fresh IV every time and no plaintext in the envelope", () => {
    const r = ring(`1:${K1}`, "1");
    const a = encryptToken(TOKEN, bind, r), b = encryptToken(TOKEN, bind, r);
    expect(a.keyVersion).toBe(1);
    expect(a.envelope).toMatch(/^mbt1\.1\.[\w-]{16}\.[\w-]{22}\.[\w-]+$/);
    expect(a.envelope).not.toBe(b.envelope);
    expect(a.envelope.split(".")[2]).not.toBe(b.envelope.split(".")[2]);
    expect(a.envelope).not.toContain(TOKEN);
    expect(decryptToken(a.envelope, bind, r)).toBe(TOKEN);
    expect(decryptToken(b.envelope, bind, r)).toBe(TOKEN);
    const unicode = "tök€n-✓";
    expect(decryptToken(encryptToken(unicode, bind, r).envelope, bind, r)).toBe(unicode);
  });

  it("rejects any altered byte: ciphertext, tag, IV (auth_failed); a truncated tag or garbage (malformed)", () => {
    const r = ring(`1:${K1}`, "1");
    const { envelope } = encryptToken(TOKEN, bind, r);
    for (const part of [2, 3, 4] as const) expect(code(() => decryptToken(flip(envelope, part), bind, r))).toBe("auth_failed");
    expect(code(() => decryptToken(flip(envelope, 4, Buffer.from(envelope.split(".")[4], "base64url").length - 1), bind, r))).toBe("auth_failed");
    const p = envelope.split(".");
    const short = [...p.slice(0, 3), Buffer.from(p[3], "base64url").subarray(0, 12).toString("base64url"), p[4]].join(".");
    expect(code(() => decryptToken(short, bind, r))).toBe("malformed");
    // the same bytes spelled non-canonically (spare low bits in the last base64 character) are refused too
    const last = p[3].at(-1)!;
    const alt = [...p.slice(0, 3), p[3].slice(0, -1) + "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".indexOf(last) ^ 1)], p[4]].join(".");
    expect(code(() => decryptToken(alt, bind, r))).toBe("malformed");
    for (const bad of ["", "mbt1", "mbt2.1.a.b.c", "mbt1.x.a.b.c", `${envelope}.extra`, envelope.replace("mbt1.", "mbt0."), "mbt1.1.!!.##.$$"]) {
      expect(code(() => decryptToken(bad, bind, r))).toBe("malformed");
    }
  });

  it("is bound to its organization, user, connection and provider: any other binding fails", () => {
    const r = ring(`1:${K1}`, "1");
    const { envelope } = encryptToken(TOKEN, bind, r);
    for (const other of [
      { ...bind, organizationId: "org-b" },
      { ...bind, userId: "user-2" },
      { ...bind, connectionId: 8 },
      { ...bind, provider: "fake" as const },
      // no field can bleed into its neighbour ("org-a" + "user-1" is not "org-au" + "ser-1")
      { ...bind, organizationId: "org-au", userId: "ser-1" },
    ]) expect(code(() => decryptToken(envelope, other, r))).toBe("auth_failed");
    // an envelope moved under another key version number does not open either
    const r2 = ring(`1:${K1},2:${K2}`, "1");
    expect(code(() => decryptToken(envelope.replace("mbt1.1.", "mbt1.2."), bind, r2))).toBe("auth_failed");
  });

  it("refuses an incomplete binding or an empty token", () => {
    const r = ring(`1:${K1}`, "1");
    for (const b of [{ ...bind, organizationId: "" }, { ...bind, userId: "" }, { ...bind, connectionId: 0 }, { ...bind, connectionId: 1.5 }, { ...bind, provider: "outlook" as any }]) {
      expect(code(() => encryptToken(TOKEN, b, r))).toBe("bad_binding");
    }
    expect(code(() => encryptToken("", bind, r))).toBe("bad_binding");
  });

  it("rotates keys: old tokens still open while their key is configured, re-seal moves them, and a removed key is reported", () => {
    const old = encryptToken(TOKEN, bind, ring(`1:${K1}`, "1")).envelope;
    const both = ring(`1:${K1},2:${K2}`, "2");
    expect(decryptToken(old, bind, both)).toBe(TOKEN);
    const fresh = encryptToken(TOKEN, bind, both);
    expect(fresh.keyVersion).toBe(2);
    const moved = rotateToken(old, bind, both);
    expect(moved).toMatchObject({ rotated: true, keyVersion: 2 });
    expect(envelopeKeyVersion(moved.envelope)).toBe(2);
    expect(rotateToken(moved.envelope, bind, both)).toMatchObject({ rotated: false, envelope: moved.envelope });
    const onlyNew = ring(`2:${K2}`, "2");
    expect(decryptToken(moved.envelope, bind, onlyNew)).toBe(TOKEN);
    expect(code(() => decryptToken(old, bind, onlyNew))).toBe("unknown_key_version");
    // rotating never launders a tampered or misbound token
    expect(code(() => rotateToken(flip(old, 4), bind, both))).toBe("auth_failed");
    expect(code(() => rotateToken(old, { ...bind, connectionId: 9 }, both))).toBe("auth_failed");
    // the same version number with a different key does not open it
    expect(code(() => decryptToken(old, bind, ring(`1:${K2}`, "1")))).toBe("auth_failed");
  });

  it("missing or unusable configuration fails loudly, and the message never contains key material", () => {
    expect(code(() => loadKeyring({}))).toBe("config_missing");
    expect(code(() => loadKeyring({ MAILBOX_TOKEN_KEYS: `1:${K1}` }))).toBe("config_missing");
    expect(code(() => loadKeyring({ MAILBOX_TOKEN_KEY_CURRENT: "1" }))).toBe("config_missing");
    const cases: [string, string][] = [
      [`1:${K1}`, "2"], // current not configured
      [`1:${K1}`, "one"],
      [`1:${K1},1:${K2}`, "1"], // duplicate version
      [`0:${K1}`, "0"],
      [`40000:${K1}`, "40000"],
      [`1:${randomBytes(16).toString("base64")}`, "1"], // 128-bit key
      [`1:${randomBytes(33).toString("base64")}`, "1"],
      [`1:${Buffer.alloc(32).toString("base64")}`, "1"], // all zero
      [`1:not base64 at all`, "1"],
      [K1, "1"], // no version
    ];
    for (const [keys, current] of cases) {
      let err: unknown;
      try { loadKeyring({ MAILBOX_TOKEN_KEYS: keys, MAILBOX_TOKEN_KEY_CURRENT: current }); } catch (e) { err = e; }
      expect(err, `${keys} / ${current}`).toBeInstanceOf(TokenCryptoError);
      expect((err as TokenCryptoError).code).toBe("config_invalid");
      expect((err as Error).message).not.toContain(K1.slice(0, 12));
      expect((err as Error).message).not.toContain(K2.slice(0, 12));
    }
    // base64url keys are accepted, and whitespace around entries is tolerated
    const url = randomBytes(32).toString("base64url");
    expect(ring(` 3:${url} , 1:${K1} `, "3").current).toBe(3);
  });
});
