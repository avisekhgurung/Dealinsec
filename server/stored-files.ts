/**
 * What a stored proof or attachment reference may be served as. A stored path
 * or URL is untrusted input: an older create route let a client write any
 * proofFilePath, and res.download/res.redirect will serve whatever they are
 * given. So a reference is served only when it is exactly one of the two
 * shapes the app itself writes:
 *
 *   - an upload this app made: a multer file name (<13-digit time>-<digits>.<ext>)
 *     inside the uploads directory, served BY NAME from that directory with
 *     dotfiles denied — never the stored path itself;
 *   - an ImageKit URL this app received: https, the configured endpoint's exact
 *     host, no credentials, no explicit port, no query or fragment, under the
 *     folder that kind of file is uploaded to. The redirect is rebuilt from the
 *     parsed parts, never the stored text.
 *
 * Anything else is refused with a reason code (logged without the value).
 * Pure apart from reading nothing at all: the endpoint and directory are passed in.
 */
import crypto from "crypto";
import path from "path";

export type StoredFileKind = "proof" | "attachment" | "profile" | "cover" | "seal" | "signature";

/** The folder each kind is uploaded to (uploadFileToImageKit prefixes "/dealinsec/"). */
const IMAGEKIT_FOLDER: Record<StoredFileKind, string> = {
  proof: "/dealinsec/contracts/",
  attachment: "/dealinsec/invoice-documents/",
  profile: "/dealinsec/profiles/",
  cover: "/dealinsec/covers/",
  seal: "/dealinsec/seals/",
  signature: "/dealinsec/signatures/",
};

/**
 * server/routes.ts multer: `${Date.now()}-${random}[-${ownerTag}]${ext}`, ext from the upload filter. Names written
 * before owner tags existed have no tag; they are only served when a server-written record references them.
 */
export const UPLOAD_FILE_NAME = /^\d{13}-\d{1,10}(?:-[0-9a-f]{16})?\.(pdf|jpe?g|png|webp)$/i;

/**
 * The owner tag in a local upload's name: an HMAC of the owning organization (or, for a user with none, the user)
 * under the server's secret, so a name can't be forged to claim another organization's file. 16 hex characters.
 */
export function uploadOwnerTag(secret: string | undefined | null, ownerKey: string): string | null {
  if (!secret || !ownerKey) return null;
  return crypto.createHmac("sha256", secret).update(`dealinsec-upload:${ownerKey}`).digest("hex").slice(0, 16);
}
/** Whose files these are: the organization, or the user when there is none. */
export const uploadOwnerKey = (user: { id: string; organizationId?: string | null }): string =>
  user.organizationId ? `org:${user.organizationId}` : `user:${user.id}`;
/** The owner tag carried by an upload name, or null for an untagged (older) name. Assumes UPLOAD_FILE_NAME matched. */
export function uploadNameTag(name: string): string | null {
  const m = /^\d{13}-\d{1,10}-([0-9a-f]{16})\./i.exec(name);
  return m ? m[1].toLowerCase() : null;
}

export type StoredFileDecision =
  | { type: "redirect"; url: string }
  | { type: "local"; name: string }
  | { type: "refuse"; reason: string };

export interface StoredFileConfig {
  /** IMAGEKIT_URL_ENDPOINT, e.g. https://ik.imagekit.io/acme. Missing = no redirect is ever allowed. */
  imagekitEndpoint?: string | null;
  /** The absolute uploads directory (server/routes.ts uploadDir). */
  uploadDir: string;
}

const UNSAFE_CHARS = /[\u0000- \u007f\\%?#]/;
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The configured endpoint, parsed and checked once per call; null when unusable. */
function endpointOf(raw: string | null | undefined): { host: string; origin: string; basePath: string } | null {
  if (!raw || typeof raw !== "string") return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port || u.search || u.hash) return null;
  return { host: u.hostname, origin: u.origin, basePath: u.pathname.replace(/\/+$/, "") };
}

function imagekitDecision(value: string, kind: StoredFileKind, endpointRaw: string | null | undefined): StoredFileDecision {
  const endpoint = endpointOf(endpointRaw);
  if (!endpoint) return { type: "refuse", reason: "imagekit_not_configured" };
  if (value.length > 2048 || UNSAFE_CHARS.test(value)) return { type: "refuse", reason: "unsafe_characters" };
  if (!value.toLowerCase().startsWith("https://")) return { type: "refuse", reason: "scheme" };
  // The authority as written: no userinfo, no port (the parser would quietly drop ":443").
  const authority = value.slice("https://".length).split("/")[0];
  if (authority.includes("@")) return { type: "refuse", reason: "credentials" };
  if (authority.includes(":")) return { type: "refuse", reason: "port" };
  let u: URL;
  try { u = new URL(value); } catch { return { type: "refuse", reason: "unparseable" }; }
  if (u.protocol !== "https:") return { type: "refuse", reason: "scheme" };
  if (u.username || u.password) return { type: "refuse", reason: "credentials" };
  if (u.port) return { type: "refuse", reason: "port" };
  if (u.hostname !== endpoint.host) return { type: "refuse", reason: "host" };
  if (u.search || u.hash) return { type: "refuse", reason: "query" };
  const prefix = `${endpoint.basePath}${IMAGEKIT_FOLDER[kind]}`;
  if (!u.pathname.startsWith(prefix)) return { type: "refuse", reason: "folder" };
  // The raw path must be the parsed path (no dot segments the parser removed), and every segment plain.
  const rawPath = value.slice("https://".length + authority.length);
  if (rawPath !== u.pathname) return { type: "refuse", reason: "path" };
  const rest = u.pathname.slice(prefix.length).split("/");
  if (!rest.length || rest.some((s) => !SAFE_SEGMENT.test(s) || s === "." || s === "..")) return { type: "refuse", reason: "path" };
  return { type: "redirect", url: `${endpoint.origin}${u.pathname}` };
}

function localDecision(value: string, uploadDir: string): StoredFileDecision {
  if (UNSAFE_CHARS.test(value)) return { type: "refuse", reason: "unsafe_characters" };
  const name = value.split("/").pop() ?? "";
  if (!UPLOAD_FILE_NAME.test(name)) return { type: "refuse", reason: "not_an_upload" };
  // Exactly the shapes the app writes: proofs store multer's absolute path, attachments "/uploads/<name>".
  const shapes = [path.join(uploadDir, name), `/uploads/${name}`, `uploads/${name}`];
  if (!shapes.includes(value)) return { type: "refuse", reason: "not_in_uploads" };
  return { type: "local", name };
}

export function classifyStoredFile(value: unknown, kind: StoredFileKind, config: StoredFileConfig): StoredFileDecision {
  if (typeof value !== "string" || !value) return { type: "refuse", reason: "missing" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return imagekitDecision(value, kind, config.imagekitEndpoint);
  return localDecision(value, config.uploadDir);
}

/**
 * May a profile image field (signature, seal, photo, cover) be set to this value? A client sends these after an
 * upload, so the value is untrusted: it must be a clear (null or ""), the value already stored, an ImageKit URL in
 * that kind's folder, or a local upload carrying the requester's own owner tag. Anything else could point at
 * another organization's file (which the /uploads handler would then treat as referenced) or at a remote URL.
 */
export function profileImageRefAllowed(value: unknown, current: string | null | undefined, kind: StoredFileKind, ownerTag: string | null, config: StoredFileConfig): boolean {
  if (value === null || value === "") return true;
  if (typeof value !== "string") return false;
  if (current && value === current) return true;
  const d = classifyStoredFile(value, kind, config);
  if (d.type === "redirect") return true;
  if (d.type === "local" && value === `/uploads/${d.name}`) return !!ownerTag && uploadNameTag(d.name) === ownerTag;
  return false;
}

// ── Content checks for an upload (the extension alone is the client's word) ──

const startsWith = (head: Uint8Array, bytes: number[], at = 0) => bytes.every((b, i) => head[at + i] === b);
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** True when the file's first bytes match its extension's format. Needs the first 16 bytes. */
export function contentMatchesExtension(head: Uint8Array, fileName: string): boolean {
  const ext = path.extname(String(fileName ?? "")).toLowerCase();
  switch (ext) {
    case ".pdf": return startsWith(head, ascii("%PDF-"));
    case ".png": return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case ".jpg": case ".jpeg": return startsWith(head, [0xff, 0xd8, 0xff]);
    case ".webp": return startsWith(head, ascii("RIFF")) && startsWith(head, ascii("WEBP"), 8);
    default: return false;
  }
}

/** The client's file name, as a download name only: no control characters or path parts, at most 120 characters. */
export function safeDownloadName(name: unknown, fallback: string): string {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 120);
  return cleaned || fallback;
}
