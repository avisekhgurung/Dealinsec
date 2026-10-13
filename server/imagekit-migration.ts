/**
 * Moving files stored before private uploads (public ImageKit URLs) to private ImageKit files.
 *
 * ImageKit can't make an existing file private ("once a file is marked private, its status cannot be changed"), so
 * each public file is COPIED as a new private file (upload-from-URL, isPrivateFile) under an unguessable,
 * owner-tagged name; every row that referenced the old URL is repointed to the new `/files/...` reference with a
 * compare-and-set update; and only afterwards, in a separate step, the original is deleted and its CDN cache purged.
 *
 * Stages (script/migrate-imagekit-private.ts): plan (read-only, counts only) → apply (copies + repoints; journal) →
 * revoke (deletes + purges originals no row references any more). Each stage is explicit; nothing here runs on import.
 *
 * Pure apart from the injected dependencies, so the logic is testable without ImageKit or a database. A test with
 * fakes proves the app's sequencing, not ImageKit's behaviour.
 */
import crypto from "crypto";
import path from "path";
import { classifyStoredFile, uploadOwnerKey, uploadOwnerTag, type StoredFileKind } from "./stored-files";

/** Every column that can hold a file reference, and the kind (folder) it belongs to. */
export const REFERENCE_COLUMNS = [
  { table: "users", column: "digital_signature", kind: "signature" },
  { table: "users", column: "company_seal", kind: "seal" },
  { table: "users", column: "profile_image_url", kind: "profile" },
  { table: "users", column: "cover_image_url", kind: "cover" },
  { table: "contracts", column: "signature_url", kind: "signature" },
  { table: "contracts", column: "seal_url", kind: "seal" },
  { table: "contracts", column: "proof_file_path", kind: "proof" },
  { table: "invoice_attachments", column: "file_url", kind: "attachment" },
] as const satisfies readonly { table: string; column: string; kind: StoredFileKind }[];
export type RefColumn = (typeof REFERENCE_COLUMNS)[number];

/** One stored reference, with the owner of the record that holds it. */
export interface RefRow { table: RefColumn["table"]; column: string; kind: StoredFileKind; id: string | number; value: string; owner: { id: string; organizationId: string | null } }

export interface MigrationGroup {
  kind: StoredFileKind;
  /** The ImageKit path of the public original, relative to the endpoint (e.g. "/dealinsec/contracts/x.pdf"). */
  sourcePath: string;
  sourceUrl: string;
  ownerKey: string;
  rows: RefRow[];
}
export interface MigrationPlan { groups: MigrationGroup[]; counts: Record<string, number> }

/**
 * Which stored references are public ImageKit originals to move, grouped so each (original, owner) pair gets ONE
 * private copy shared by all its rows (a profile signature and the agreement snapshots that copied it). The same
 * original referenced by two organizations gets two copies, each tagged for its owner.
 * Everything else is left alone and only counted: private refs, local uploads, non-ImageKit URLs (e.g. a Google
 * profile photo) and anything malformed.
 */
export function planMigration(rows: RefRow[], endpoint: string | null | undefined): MigrationPlan {
  const counts: Record<string, number> = { scanned: rows.length, already_private: 0, local: 0, other_url: 0, refused: 0, to_move: 0 };
  const groups = new Map<string, MigrationGroup>();
  for (const r of rows) {
    if (!r.value) continue;
    const d = classifyStoredFile(r.value, r.kind, { imagekitEndpoint: endpoint, uploadDir: "/nonexistent" });
    if (d.type === "private") { counts.already_private++; continue; }
    if (d.type === "local") { counts.local++; continue; }
    if (d.type === "refuse") { counts[r.value.startsWith("https://") && d.reason === "host" ? "other_url" : "refused"]++; continue; }
    const ownerKey = uploadOwnerKey(r.owner);
    const key = `${d.path}\u0000${ownerKey}`;
    const g = groups.get(key) ?? { kind: r.kind, sourcePath: d.path, sourceUrl: d.url, ownerKey, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
    counts.to_move++;
  }
  counts.copies_to_make = groups.size;
  return { groups: Array.from(groups.values()), counts };
}

export interface MigrationDeps {
  /** ImageKit upload-from-URL as a private file; must report isPrivateFile. */
  uploadPrivateFromUrl(sourceUrl: string, folder: string, fileName: string): Promise<{ fileId: string; isPrivateFile: boolean; name: string }>;
  /** A signed link to read the original (works whether it's public or the account already requires signatures). */
  signedSourceUrl(sourcePath: string): string;
  /** Compare-and-set: repoint rows that still hold `oldValue`; returns how many changed. One transaction per group. */
  repoint(rows: RefRow[], oldValue: string, newRef: string): Promise<number>;
  deletePrivateCopy(fileId: string): Promise<void>;
}
export interface JournalEntry {
  kind: StoredFileKind; sourcePath: string; sourceUrl: string; ownerKey: string; newRef: string; fileId: string; repointed: number;
  /** Every exact stored string that named this original (e.g. host spelled in different case). */
  values: string[];
}

const FOLDER: Record<StoredFileKind, string> = { proof: "contracts", attachment: "invoice-documents", signature: "signatures", seal: "seals", profile: "profiles", cover: "covers" };

/**
 * Copy each group to a private file and repoint its rows. A copy that ImageKit doesn't report as private, or whose
 * rows all changed meanwhile, is deleted again and journalled as not repointed. Never deletes an original.
 */
export async function applyMigration(plan: MigrationPlan, deps: MigrationDeps, secret: string): Promise<JournalEntry[]> {
  const journal: JournalEntry[] = [];
  for (const g of plan.groups) {
    const tag = uploadOwnerTag(secret, g.ownerKey);
    if (!tag) throw new Error("applyMigration: the server secret is required to tag files");
    const ext = path.extname(g.sourcePath).toLowerCase();
    const name = `${crypto.randomBytes(16).toString("hex")}-${tag}${ext}`;
    const folder = FOLDER[g.kind];
    const up = await deps.uploadPrivateFromUrl(deps.signedSourceUrl(g.sourcePath), `/dealinsec/${folder}`, name);
    if (up.isPrivateFile !== true || up.name !== name) {
      await deps.deletePrivateCopy(up.fileId);
      throw new Error(`applyMigration: ImageKit did not store a private copy (${g.kind}); stopped before repointing`);
    }
    const newRef = `/files/${folder}/${name}`;
    const values = Array.from(new Set(g.rows.map((r) => r.value)));
    let repointed = 0;
    for (const v of values) repointed += await deps.repoint(g.rows.filter((r) => r.value === v), v, newRef);
    if (repointed === 0) await deps.deletePrivateCopy(up.fileId); // every row changed meanwhile: nothing uses the copy
    journal.push({ kind: g.kind, sourcePath: g.sourcePath, sourceUrl: g.sourceUrl, ownerKey: g.ownerKey, newRef, fileId: up.fileId, repointed, values });
  }
  return journal;
}

export interface RevokeDeps {
  /** Rows (any table/column above) that still hold any of these exact values. Must be 0 before an original is removed. */
  countReferences(values: string[]): Promise<number>;
  /** The ImageKit fileId of the original at this path, or null if it no longer exists. */
  findOriginal(sourcePath: string): Promise<string | null>;
  deleteOriginal(fileId: string): Promise<void>;
  /** Purge the original URL from ImageKit's CDN and internal caches (browsers keep their own copies until expiry). */
  purge(sourceUrl: string): Promise<void>;
}

/** Remove originals that nothing references any more; skip (and report) any still referenced. */
export async function revokeOriginals(journal: JournalEntry[], deps: RevokeDeps): Promise<{ revoked: number; stillReferenced: number; missing: number }> {
  const out = { revoked: 0, stillReferenced: 0, missing: 0 };
  // One original may appear in several entries (one copy per owning organization): decide once, on all its values.
  const byPath = new Map<string, { sourceUrl: string; values: Set<string> }>();
  for (const e of journal) {
    const g = byPath.get(e.sourcePath) ?? { sourceUrl: e.sourceUrl, values: new Set<string>() };
    for (const v of e.values) g.values.add(v);
    byPath.set(e.sourcePath, g);
  }
  for (const [sourcePath, e] of Array.from(byPath.entries())) {
    if ((await deps.countReferences(Array.from(e.values))) > 0) { out.stillReferenced++; continue; }
    const fileId = await deps.findOriginal(sourcePath);
    if (!fileId) { out.missing++; continue; }
    await deps.deleteOriginal(fileId);
    await deps.purge(e.sourceUrl);
    out.revoked++;
  }
  return out;
}

// ── Postgres adapter (table and column names come only from REFERENCE_COLUMNS) ──

interface PgLike { query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> }

const ALLOWED = new Set(REFERENCE_COLUMNS.map((c) => `${c.table}.${c.column}`));
const ident = (table: string, column: string) => {
  if (!ALLOWED.has(`${table}.${column}`)) throw new Error(`not a reference column: ${table}.${column}`);
  return { table: `"${table}"`, column: `"${column}"` };
};

/** Reads every stored reference that looks like a URL, with its record's owner; repoints and counts by exact value. */
export function createPgRefStore(db: PgLike) {
  return {
    async loadUrlRefs(): Promise<RefRow[]> {
      const out: RefRow[] = [];
      for (const c of REFERENCE_COLUMNS) {
        const { table, column } = ident(c.table, c.column);
        const sql = c.table === "users"
          ? `SELECT id::text AS id, id AS owner_id, organization_id, ${column} AS value FROM ${table} WHERE ${column} LIKE 'http%'`
          : c.table === "contracts"
          ? `SELECT id::text AS id, user_id AS owner_id, organization_id, ${column} AS value FROM ${table} WHERE ${column} LIKE 'http%'`
          : `SELECT a.id::text AS id, b.user_id AS owner_id, b.organization_id, a.${column} AS value FROM ${table} a JOIN "brand_invoices" b ON b.id = a.brand_invoice_id WHERE a.${column} LIKE 'http%'`;
        for (const r of (await db.query(sql)).rows) {
          out.push({ table: c.table, column: c.column, kind: c.kind, id: r.id, value: r.value, owner: { id: r.owner_id, organizationId: r.organization_id ?? null } });
        }
      }
      return out;
    },
    async repoint(rows: RefRow[], oldValue: string, newRef: string): Promise<number> {
      let changed = 0;
      await db.query("BEGIN");
      try {
        for (const r of rows) {
          const { table, column } = ident(r.table, r.column);
          const res = await db.query(`UPDATE ${table} SET ${column} = $1 WHERE id::text = $2 AND ${column} = $3`, [newRef, String(r.id), oldValue]);
          changed += res.rowCount ?? 0;
        }
        await db.query("COMMIT");
      } catch (err) {
        await db.query("ROLLBACK");
        throw err;
      }
      return changed;
    },
    async countReferences(values: string[]): Promise<number> {
      let n = 0;
      for (const c of REFERENCE_COLUMNS) {
        const { table, column } = ident(c.table, c.column);
        n += Number((await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = ANY($1)`, [values])).rows[0].n);
      }
      return n;
    },
  };
}
