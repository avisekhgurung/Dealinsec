/**
 * Error responses that never carry internals. A 500's details (often a database
 * or driver message: table names, SQL, paths) go to the server log under a
 * short error id; the client gets a fixed message, a code and that id to quote.
 */
import crypto from "crypto";
import multer from "multer";

export interface InternalErrorBody { code: string; error: string; errorId: string }

export function sendInternalError(res: any, scope: string, error: unknown, code: string, message: string): InternalErrorBody {
  const errorId = crypto.randomBytes(6).toString("hex");
  console.error(`[${scope}] error ${errorId}:`, error);
  const body = { code, error: message, errorId };
  if (!res.headersSent) res.status(500).json(body);
  return body;
}

/**
 * What an upload route answers when multer itself fails (it used to fall through
 * to the app-wide handler, which returns the raw error message). Validation
 * problems get a clear 4xx; anything else is a logged 500 with an error id.
 */
export function sendUploadError(res: any, err: any): void {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ code: "file_too_large", error: "Files can be up to 5 MB." });
    return;
  }
  if (err?.message === "Invalid file type") {
    res.status(400).json({ code: "file_type", error: "Upload a PDF, JPG, PNG or WEBP file." });
    return;
  }
  sendInternalError(res, "upload", err, "upload_failed", "The upload failed. Please try again.");
}
