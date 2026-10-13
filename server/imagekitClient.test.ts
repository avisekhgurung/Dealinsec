/**
 * The ImageKit client wrapper: private uploads and signed links.
 *
 * Signing runs the REAL SDK (it is local HMAC work, no network) and is checked against ImageKit's documented
 * algorithm, computed independently here. Uploads run against a mocked SDK class, so this proves what the app
 * ASKS ImageKit to do — not that ImageKit enforces it. Provider-side enforcement (a private file refused without a
 * valid signature, 401 after ik-t) can only be verified against a real ImageKit account.
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  uploads: [] as any[],
  deleted: [] as string[],
  respond: (o: any): any => ({ fileId: "fid-1", name: o.fileName, isPrivateFile: o.isPrivateFile === true }),
}));
vi.mock("imagekit", async (orig) => {
  const Real = ((await (orig as any)()) as any).default;
  return {
    default: class {
      private real: any;
      constructor(cfg: any) { this.real = new Real(cfg); }
      url(o: any) { return this.real.url(o); } // signing: the real SDK
      async upload(o: any) { sdk.uploads.push(o); return sdk.respond(o); }
      async deleteFile(id: string) { sdk.deleted.push(id); }
    },
  };
});

const ENV = { IMAGEKIT_PUBLIC_KEY: "public_local_test", IMAGEKIT_PRIVATE_KEY: "private_local_test_key", IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/acme" };
const TAG = "0123456789abcdef";
let tmp: string;
beforeEach(() => { Object.assign(process.env, ENV); sdk.uploads = []; sdk.deleted = []; tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ik-")); });
afterEach(() => { for (const k of Object.keys(ENV)) delete (process.env as any)[k]; fs.rmSync(tmp, { recursive: true, force: true }); vi.useRealTimers(); });
const file = (name = "Signed Copy.PDF") => { const p = path.join(tmp, `t-${Math.random()}`); fs.writeFileSync(p, "%PDF-1.4"); return { path: p, originalname: name, size: 8 }; };

/** ImageKit's documented signature: HMAC-SHA1(private key, <URL minus "endpoint/"> + <ik-t>), lowercase hex. */
function documentedSignature(url: URL, key: string) {
  const t = url.searchParams.get("ik-t")!;
  const signedPart = `${url.origin}${url.pathname}`.replace(`${ENV.IMAGEKIT_URL_ENDPOINT}/`, "");
  return crypto.createHmac("sha1", key).update(signedPart + t).digest("hex");
}

describe("I: private uploads (mocked SDK — what the app asks for)", () => {
  it("every upload is private, unguessable, owner-tagged, never overwrites, and stores an app reference (not a URL)", async () => {
    const { uploadFileToImageKit } = await import("./imagekitClient");
    const r = await uploadFileToImageKit(file(), { folder: "contracts", ownerTag: TAG });
    const sent = sdk.uploads[0];
    expect(sent).toMatchObject({ folder: "/dealinsec/contracts", isPrivateFile: true, useUniqueFileName: false, overwriteFile: false });
    expect(sent.fileName).toMatch(new RegExp(`^[0-9a-f]{32}-${TAG}\\.pdf$`));
    expect(r.ref).toBe(`/files/contracts/${sent.fileName}`);
    expect(JSON.stringify(r)).not.toMatch(/https?:/);
    const again = await uploadFileToImageKit(file(), { folder: "contracts", ownerTag: TAG });
    expect(again.name).not.toBe(r.name); // 128 random bits per name
  });
  it("refuses (and deletes the upload) if ImageKit doesn't report a private file; refuses without a valid owner tag", async () => {
    const { uploadFileToImageKit } = await import("./imagekitClient");
    const prev = sdk.respond;
    sdk.respond = (o: any) => ({ fileId: "fid-public", name: o.fileName, isPrivateFile: false });
    try {
      await expect(uploadFileToImageKit(file(), { folder: "signatures", ownerTag: TAG })).rejects.toThrow(/private/);
      expect(sdk.deleted).toEqual(["fid-public"]);
    } finally { sdk.respond = prev; }
    await expect(uploadFileToImageKit(file(), { folder: "signatures", ownerTag: "" })).rejects.toThrow(/owner tag/);
    await expect(uploadFileToImageKit(file(), { folder: "signatures", ownerTag: "not-hex-tag-0000" })).rejects.toThrow(/owner tag/);
  });
});

describe("I: signed links (real SDK signing, checked against the documented algorithm)", () => {
  it("a link expires 120 s after issue and carries the documented signature; the key never appears", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-13T12:00:00Z"), toFake: ["Date"] });
    const { signedImageKitUrl } = await import("./imagekitClient");
    const url = new URL(signedImageKitUrl(`/dealinsec/contracts/${"a".repeat(32)}-${TAG}.pdf`));
    expect(url.origin + url.pathname).toBe(`https://ik.imagekit.io/acme/dealinsec/contracts/${"a".repeat(32)}-${TAG}.pdf`);
    expect(Number(url.searchParams.get("ik-t"))).toBe(Date.parse("2026-10-13T12:00:00Z") / 1000 + 120);
    expect(url.searchParams.get("ik-s")).toBe(documentedSignature(url, ENV.IMAGEKIT_PRIVATE_KEY));
    expect(url.toString()).not.toContain(ENV.IMAGEKIT_PRIVATE_KEY);
  });
  it("manipulation breaks the signature: another file, a later expiry, or another key", async () => {
    const { signedImageKitUrl } = await import("./imagekitClient");
    const url = new URL(signedImageKitUrl(`/dealinsec/contracts/${"b".repeat(32)}-${TAG}.pdf`));
    const sig = url.searchParams.get("ik-s");
    const otherFile = new URL(url); otherFile.pathname = otherFile.pathname.replace("b".repeat(32), "c".repeat(32));
    expect(documentedSignature(otherFile, ENV.IMAGEKIT_PRIVATE_KEY)).not.toBe(sig);
    const later = new URL(url); later.searchParams.set("ik-t", String(Number(url.searchParams.get("ik-t")) + 86400));
    expect(documentedSignature(later, ENV.IMAGEKIT_PRIVATE_KEY)).not.toBe(sig);
    expect(documentedSignature(url, "some-other-key")).not.toBe(sig);
  });
});
