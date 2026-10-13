/**
 * ImageKit.io client wrapper.
 *
 * Every file this app stores on ImageKit is a customer document (agreement
 * proofs, invoice documents, signatures, seals, profile photos, covers), so
 * every upload is a PRIVATE file (ImageKit `isPrivateFile`): ImageKit serves a
 * private file only through a valid signed URL (or an account-level named
 * transformation — keep none defined; see the README). The app never stores a
 * deliverable URL. It stores an app reference, `/files/<folder>/<name>`, and
 * GET /files/:folder/:name issues a short-lived signed URL only after the
 * requester's organization and permission are checked (server/routes.ts).
 *
 * Names are unguessable and carry the owning organization's tag:
 * `<32 random hex>-<16 hex owner tag><ext>` (server/stored-files.ts).
 *
 * Required env vars:
 *   IMAGEKIT_PUBLIC_KEY
 *   IMAGEKIT_PRIVATE_KEY   (signs URLs; never sent to the client)
 *   IMAGEKIT_URL_ENDPOINT  (e.g. https://ik.imagekit.io/yourusername)
 */
import ImageKit from "imagekit";
import crypto from "crypto";
import path from "path";
import fs from "fs";

let _client: ImageKit | null = null;

export function isImageKitConfigured(): boolean {
  return Boolean(
    process.env.IMAGEKIT_PUBLIC_KEY &&
    process.env.IMAGEKIT_PRIVATE_KEY &&
    process.env.IMAGEKIT_URL_ENDPOINT,
  );
}

function getClient(): ImageKit {
  if (_client) return _client;
  if (!isImageKitConfigured()) {
    throw new Error(
      "ImageKit not configured. Set IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, IMAGEKIT_URL_ENDPOINT.",
    );
  }
  _client = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY!,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY!,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT!,
  });
  return _client;
}

/** The ImageKit folders the app writes, under "/dealinsec/". */
export const IMAGEKIT_FOLDERS = ["contracts", "invoice-documents", "signatures", "seals", "profiles", "covers"] as const;
export type ImageKitFolder = (typeof IMAGEKIT_FOLDERS)[number];

/** How long an issued link works. Each page view asks the app again, so this only has to outlive one fetch. */
export const SIGNED_URL_SECONDS = 120;

export interface UploadOptions {
  folder: ImageKitFolder;
  /** The owning organization's tag (server/stored-files.ts uploadOwnerTag). Required: an untagged private file couldn't be served. */
  ownerTag: string;
}

export interface UploadResult {
  /** What the app stores: `/files/<folder>/<name>`. Never a deliverable URL. */
  ref: string;
  fileId: string;
  name: string;
  size: number;
}

/**
 * Upload a multer-handled file to ImageKit as a PRIVATE file with an
 * unguessable, owner-tagged name, and delete the local temp file afterwards.
 * Refuses (and deletes the upload) if ImageKit reports it as not private.
 */
export async function uploadFileToImageKit(
  multerFile: { path: string; originalname: string; size: number },
  opts: UploadOptions,
): Promise<UploadResult> {
  if (!/^[0-9a-f]{16}$/.test(opts.ownerTag)) throw new Error("uploadFileToImageKit: an owner tag is required");
  const client = getClient();
  const ext = path.extname(multerFile.originalname).toLowerCase();
  const name = `${crypto.randomBytes(16).toString("hex")}-${opts.ownerTag}${ext}`;
  try {
    const buffer = await fs.promises.readFile(multerFile.path);
    const res = await client.upload({
      file: buffer,
      fileName: name,
      folder: `/dealinsec/${opts.folder}`,
      useUniqueFileName: false,
      overwriteFile: false,
      isPrivateFile: true,
    });
    if (res.isPrivateFile !== true || res.name !== name) {
      await client.deleteFile(res.fileId).catch(() => {});
      throw new Error("ImageKit did not store the upload as the expected private file");
    }
    return { ref: `/files/${opts.folder}/${name}`, fileId: res.fileId, name, size: multerFile.size };
  } finally {
    // Best-effort cleanup of temp file — don't crash if it fails
    fs.promises.unlink(multerFile.path).catch(() => {});
  }
}

/**
 * A signed, short-lived delivery URL for a path under the endpoint (e.g.
 * "/dealinsec/contracts/<name>"). Call ONLY after the requester's access to
 * the file has been checked: the URL itself is the capability.
 */
export function signedImageKitUrl(filePath: string, expireSeconds = SIGNED_URL_SECONDS): string {
  return getClient().url({ path: filePath, signed: true, expireSeconds });
}

/**
 * Delete a previously uploaded file by fileId (optional cleanup).
 */
export async function deleteFromImageKit(fileId: string): Promise<void> {
  if (!isImageKitConfigured()) return;
  try {
    await getClient().deleteFile(fileId);
  } catch (err) {
    console.warn("ImageKit delete failed (non-fatal):", err);
  }
}
