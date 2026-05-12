/**
 * ImageKit.io client wrapper.
 *
 * Used for storing uploaded files (profile photos, digital signatures,
 * contract proof PDFs/images) on ImageKit so they survive Railway
 * redeploys (the local `/uploads` folder is ephemeral).
 *
 * Required env vars:
 *   IMAGEKIT_PUBLIC_KEY
 *   IMAGEKIT_PRIVATE_KEY
 *   IMAGEKIT_URL_ENDPOINT   (e.g. https://ik.imagekit.io/yourusername)
 */
import ImageKit from "imagekit";
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

export interface UploadOptions {
  /** Folder path on ImageKit (e.g. "profiles", "signatures", "contracts") */
  folder: string;
  /** Optional file name (without extension). Random suffix is appended. */
  baseName?: string;
}

export interface UploadResult {
  url: string;
  fileId: string;
  name: string;
  size: number;
}

/**
 * Upload a multer-handled file (with `path` on disk) to ImageKit and
 * delete the local temp file afterwards. Returns the public CDN URL.
 */
export async function uploadFileToImageKit(
  multerFile: { path: string; originalname: string; size: number },
  opts: UploadOptions,
): Promise<UploadResult> {
  const client = getClient();
  const buffer = await fs.promises.readFile(multerFile.path);
  const ext = path.extname(multerFile.originalname) || "";
  const base = opts.baseName || path.basename(multerFile.originalname, ext);
  const safe = base.replace(/[^a-zA-Z0-9-_]/g, "_");
  const uniqueName = `${safe}-${Date.now()}${ext}`;

  try {
    const res = await client.upload({
      file: buffer,
      fileName: uniqueName,
      folder: `/dealinsec/${opts.folder}`,
      useUniqueFileName: false,
    });
    return {
      url: res.url,
      fileId: res.fileId,
      name: res.name,
      size: multerFile.size,
    };
  } finally {
    // Best-effort cleanup of temp file — don't crash if it fails
    fs.promises.unlink(multerFile.path).catch(() => {});
  }
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
