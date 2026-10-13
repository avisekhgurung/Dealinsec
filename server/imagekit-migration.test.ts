/**
 * The public→private migration's logic, with FAKE ImageKit and storage. This checks the app's sequencing and
 * safety rules only; whether ImageKit copies, privatises, deletes and purges as documented needs a real account.
 */
import { describe, expect, it } from "vitest";
import { applyMigration, planMigration, revokeOriginals, type RefRow } from "./imagekit-migration";
import { parsePrivateRef, uploadOwnerKey, uploadOwnerTag } from "./stored-files";

const EP = "https://ik.imagekit.io/acme";
const SECRET = "test-secret";
const org1 = { id: "u1", organizationId: "org-1" }, org2 = { id: "u2", organizationId: "org-2" };
const row = (over: Partial<RefRow>): RefRow => ({ table: "users", column: "digital_signature", kind: "signature", id: "u1", value: `${EP}/dealinsec/signatures/user-u1-signature-1.png`, owner: org1, ...over });
const SIG = `${EP}/dealinsec/signatures/user-u1-signature-1.png`;

function fakes(opts: { private?: boolean; concurrentChange?: boolean } = {}) {
  const calls = { uploads: [] as { source: string; folder: string; name: string }[], repoints: [] as { ids: (string | number)[]; old: string; ref: string }[], deletedCopies: [] as string[] };
  return {
    calls,
    deps: {
      uploadPrivateFromUrl: async (source: string, folder: string, name: string) => { calls.uploads.push({ source, folder, name }); return { fileId: `copy-${calls.uploads.length}`, isPrivateFile: opts.private !== false, name }; },
      signedSourceUrl: (p: string) => `${EP}${p}?ik-t=1&ik-s=sig`,
      repoint: async (rows: RefRow[], old: string, ref: string) => { calls.repoints.push({ ids: rows.map((r) => r.id), old, ref }); return opts.concurrentChange ? 0 : rows.length; },
      deletePrivateCopy: async (id: string) => { calls.deletedCopies.push(id); },
    },
  };
}

describe("I: migration plan (read-only)", () => {
  it("moves only public ImageKit originals; counts everything else; one copy per (original, owner)", () => {
    const rows = [
      row({}),                                                                                       // profile signature
      row({ table: "contracts", column: "signature_url", id: 7 }),                                   // the agreement snapshot that copied it
      row({ table: "contracts", column: "signature_url", id: 8, owner: org2, value: SIG }),          // same original, another org → own copy
      row({ column: "profile_image_url", kind: "profile", value: "https://lh3.googleusercontent.com/a/x" }), // Google photo: not ours
      row({ value: "/files/signatures/" + "a".repeat(32) + "-" + "0".repeat(16) + ".png" }),        // already private
      row({ value: "/uploads/1791849718123-5.png" }),                                                // local upload
      row({ value: "https://ik.imagekit.io.evil.example/dealinsec/signatures/x.png" }),              // refused
    ];
    const plan = planMigration(rows, EP);
    expect(plan.counts).toMatchObject({ scanned: 7, to_move: 3, copies_to_make: 2, already_private: 1, local: 1 });
    expect(plan.counts.other_url + plan.counts.refused).toBe(2);
    expect(plan.groups.map((g) => [g.ownerKey, g.rows.length])).toEqual([[uploadOwnerKey(org1), 2], [uploadOwnerKey(org2), 1]]);
    expect(plan.groups[0].sourcePath).toBe("/dealinsec/signatures/user-u1-signature-1.png");
  });
  it("without a configured endpoint nothing is moved", () => {
    expect(planMigration([row({})], null).counts.to_move).toBe(0);
  });
});

describe("I: migration apply (fakes)", () => {
  it("copies from a signed source link as a private, owner-tagged file in the kind's folder and repoints by compare-and-set", async () => {
    const { deps, calls } = fakes();
    const journal = await applyMigration(planMigration([row({}), row({ table: "contracts", column: "signature_url", id: 7 })], EP), deps, SECRET);
    expect(calls.uploads).toHaveLength(1);
    expect(calls.uploads[0].source).toMatch(/\?ik-t=.*ik-s=/);
    expect(calls.uploads[0].folder).toBe("/dealinsec/signatures");
    const ref = journal[0].newRef;
    expect(parsePrivateRef(ref)).toMatchObject({ folder: "signatures", tag: uploadOwnerTag(SECRET, uploadOwnerKey(org1)) });
    expect(calls.repoints).toEqual([{ ids: ["u1", 7], old: SIG, ref }]);
    expect(journal[0]).toMatchObject({ repointed: 2, values: [SIG] });
  });
  it("a copy ImageKit doesn't report as private is deleted and the run stops before any row changes", async () => {
    const { deps, calls } = fakes({ private: false });
    await expect(applyMigration(planMigration([row({})], EP), deps, SECRET)).rejects.toThrow(/private copy/);
    expect(calls.deletedCopies).toEqual(["copy-1"]);
    expect(calls.repoints).toEqual([]);
  });
  it("rows changed meanwhile are left alone and their unused copy is deleted; the secret is required", async () => {
    const { deps, calls } = fakes({ concurrentChange: true });
    const journal = await applyMigration(planMigration([row({})], EP), deps, SECRET);
    expect(journal[0].repointed).toBe(0);
    expect(calls.deletedCopies).toEqual(["copy-1"]);
    await expect(applyMigration(planMigration([row({})], EP), fakes().deps, "")).rejects.toThrow(/secret/);
  });
});

describe("I: revocation (fakes) — originals are removed only when nothing references them", () => {
  it("deletes and purges an unreferenced original once (even with one copy per org); skips referenced or missing ones", async () => {
    const { deps } = fakes();
    const journal = await applyMigration(planMigration([row({}), row({ table: "contracts", column: "signature_url", id: 8, owner: org2 })], EP), deps, SECRET);
    expect(journal).toHaveLength(2);
    const log: string[] = [];
    const r = await revokeOriginals(journal, {
      countReferences: async (vals) => { log.push(`count:${vals.length}`); return 0; },
      findOriginal: async (p) => `orig:${p}`,
      deleteOriginal: async (id) => { log.push(`delete:${id}`); },
      purge: async (u) => { log.push(`purge:${u}`); },
    });
    expect(r).toEqual({ revoked: 1, stillReferenced: 0, missing: 0 });
    expect(log).toEqual(["count:1", "delete:orig:/dealinsec/signatures/user-u1-signature-1.png", `purge:${SIG}`]);
    const kept = await revokeOriginals(journal, { countReferences: async () => 1, findOriginal: async () => "x", deleteOriginal: async () => { throw new Error("must not delete"); }, purge: async () => { throw new Error("must not purge"); } });
    expect(kept).toEqual({ revoked: 0, stillReferenced: 1, missing: 0 });
    const gone = await revokeOriginals(journal, { countReferences: async () => 0, findOriginal: async () => null, deleteOriginal: async () => { throw new Error("no"); }, purge: async () => { throw new Error("no"); } });
    expect(gone).toEqual({ revoked: 0, stillReferenced: 0, missing: 1 });
  });
});
