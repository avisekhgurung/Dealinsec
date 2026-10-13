import multer from "multer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendInternalError, sendUploadError } from "./http-errors";

function fakeRes() {
  const res: any = { headersSent: false, statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; res.headersSent = true; return res; };
  return res;
}
const SECRET_DETAIL = 'relation "invoice_attachments" does not exist at /srv/app/db.ts:42 (password=hunter2)';
afterEach(() => vi.restoreAllMocks());

describe("G: internal errors never reach the client", () => {
  it("a 500 carries a fixed message, a code and an error id; the details are logged under the same id", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = fakeRes();
    const body = sendInternalError(res, "attachments", new Error(SECRET_DETAIL), "storage_not_ready", "Document storage isn't available yet. Please contact support.");
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ code: "storage_not_ready", error: "Document storage isn't available yet. Please contact support.", errorId: body.errorId });
    expect(body.errorId).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(res.body)).not.toMatch(/relation|invoice_attachments|db\.ts|hunter2|Error/);
    expect(String(log.mock.calls[0][0])).toContain(body.errorId);
    expect(log.mock.calls[0][1]).toBeInstanceOf(Error); // the details stay server-side
  });
  it("each error gets its own id; nothing is written twice after a response was sent", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const a = sendInternalError(fakeRes(), "x", new Error("a"), "c", "m").errorId;
    const b = sendInternalError(fakeRes(), "x", new Error("b"), "c", "m").errorId;
    expect(a).not.toBe(b);
    const sent = fakeRes(); sent.headersSent = true;
    sendInternalError(sent, "x", new Error("late"), "c", "m");
    expect(sent.body).toBeUndefined();
  });
  it("multer's errors: size limit → 413, type filter → 400 with useful wording, anything else → 500 without its message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const big = fakeRes(); sendUploadError(big, new multer.MulterError("LIMIT_FILE_SIZE", "proof"));
    expect([big.statusCode, big.body]).toEqual([413, { code: "file_too_large", error: "Files can be up to 5 MB." }]);
    const type = fakeRes(); sendUploadError(type, new Error("Invalid file type"));
    expect([type.statusCode, type.body]).toEqual([400, { code: "file_type", error: "Upload a PDF, JPG, PNG or WEBP file." }]);
    const disk = fakeRes(); sendUploadError(disk, new Error(`EACCES: permission denied, open '/srv/app/uploads/x' ${SECRET_DETAIL}`));
    expect(disk.statusCode).toBe(500);
    expect(disk.body).toMatchObject({ code: "upload_failed", error: "The upload failed. Please try again." });
    expect(JSON.stringify(disk.body)).not.toMatch(/EACCES|\/srv|hunter2/);
  });
});
