import { describe, expect, it } from "vitest";
import { classifyStoredFile, contentMatchesExtension, safeDownloadName } from "./stored-files";

const config = { imagekitEndpoint: "https://ik.imagekit.io/acme", uploadDir: "/srv/app/uploads" };
const NAME = "1791849718123-482910374.pdf";
const proof = (v: unknown, c = config) => classifyStoredFile(v, "proof", c);

describe("stored proof and attachment references are untrusted", () => {
  it("the original exploit: arbitrary server paths are refused, never handed to res.download", () => {
    for (const v of ["/etc/passwd", "/proc/self/environ", "/srv/app/.env", "/srv/app/.git/config", "package.json", "../.env", "/etc/secrets/key",
      `/srv/app/uploads/../${NAME}`, `/srv/app/uploads/sub/${NAME}`, `/other/uploads/${NAME}`, `C:\\uploads\\${NAME}`, `/srv/app/uploads/${NAME}\u0000.txt`,
      "/srv/app/uploads/.env", "/srv/app/uploads/%2e%2e/secret.pdf", "/uploads/../etc/passwd"]) {
      expect(proof(v).type, v).toBe("refuse");
    }
  });
  it("only this app's own upload names are served, by name, from the uploads directory", () => {
    expect(proof(`/srv/app/uploads/${NAME}`)).toEqual({ type: "local", name: NAME }); // a proof: multer's absolute path
    expect(classifyStoredFile(`/uploads/${NAME}`, "attachment", config)).toEqual({ type: "local", name: NAME }); // an attachment's stored form
    for (const ext of ["jpg", "JPEG", "png", "webp"]) expect(proof(`/srv/app/uploads/1791849718123-1.${ext}`).type, ext).toBe("local");
    for (const bad of ["evil.pdf", "1791849718123-1.svg", "1791849718123-1.pdf.exe", "179184971812-1.pdf", ".1791849718123-1.pdf"]) expect(proof(`/srv/app/uploads/${bad}`).type, bad).toBe("refuse");
  });
  it("an ImageKit URL is redirected only under the configured endpoint and that kind's folder, rebuilt from its parts", () => {
    const ok = "https://ik.imagekit.io/acme/dealinsec/contracts/contract-12-proof-1791849718123.pdf";
    expect(proof(ok)).toEqual({ type: "redirect", url: ok });
    expect(proof("https://IK.ImageKit.io/acme/dealinsec/contracts/a.pdf")).toEqual({ type: "redirect", url: "https://ik.imagekit.io/acme/dealinsec/contracts/a.pdf" });
    expect(classifyStoredFile("https://ik.imagekit.io/acme/dealinsec/invoice-documents/a.pdf", "attachment", config).type).toBe("redirect");
  });
  it("lookalike hosts, credentials, ports, other schemes, queries and path tricks are refused", () => {
    const cases: Record<string, string> = {
      "https://ik.imagekit.io.evil.com/acme/dealinsec/contracts/a.pdf": "host",
      "https://evil.com/ik.imagekit.io/acme/dealinsec/contracts/a.pdf": "host",
      "https://user@ik.imagekit.io/acme/dealinsec/contracts/a.pdf": "credentials",
      "https://ik.imagekit.io@evil.com/acme/dealinsec/contracts/a.pdf": "credentials",
      "https://ik.imagekit.io:8443/acme/dealinsec/contracts/a.pdf": "port",
      "https://ik.imagekit.io:443/acme/dealinsec/contracts/a.pdf": "port",
      "http://ik.imagekit.io/acme/dealinsec/contracts/a.pdf": "scheme",
      "ftp://ik.imagekit.io/acme/dealinsec/contracts/a.pdf": "scheme",
      "javascript:alert(1)": "scheme",
      "data:text/html,hi": "scheme",
      "https://ik.imagekit.io/other/dealinsec/contracts/a.pdf": "folder",
      "https://ik.imagekit.io/acme/dealinsec/invoice-documents/a.pdf": "folder", // an attachment's folder is not a proof's
      "https://ik.imagekit.io/acme/dealinsec/contracts/a.pdf?x=1": "unsafe_characters",
      "https://ik.imagekit.io/acme/dealinsec/contracts/a.pdf#x": "unsafe_characters",
      "https://ik.imagekit.io/acme/dealinsec/contracts/../../other/a.pdf": "folder", // the parser collapses it out of the folder
      "https://ik.imagekit.io/acme/dealinsec/contracts/x/../a.pdf": "path", // collapses inside the folder: the raw path still differs
      "https://ik.imagekit.io/acme/dealinsec/contracts/%2e%2e/a.pdf": "unsafe_characters",
      "https://ik.imagekit.io/acme/dealinsec/contracts/": "path",
      "https:///ik.imagekit.io/acme/dealinsec/contracts/a.pdf": "path",
      "https://ik.imagekit.io/acme/dealinsec/contracts/a b.pdf": "unsafe_characters",
    };
    for (const [v, reason] of Object.entries(cases)) expect(proof(v), v).toEqual({ type: "refuse", reason });
  });
  it("no endpoint configured (or an unusable one): no redirect at all", () => {
    const url = "https://ik.imagekit.io/acme/dealinsec/contracts/a.pdf";
    for (const imagekitEndpoint of [null, "", "http://ik.imagekit.io/acme", "https://u:p@ik.imagekit.io/acme", "not a url"]) {
      expect(proof(url, { ...config, imagekitEndpoint }), String(imagekitEndpoint)).toEqual({ type: "refuse", reason: "imagekit_not_configured" });
    }
  });
  it("missing or non-string values are refused", () => {
    for (const v of [null, undefined, "", 7, {}]) expect(proof(v).type).toBe("refuse");
  });
});

describe("upload content must match its extension", () => {
  const bytes = (...b: (number | string)[]) => Uint8Array.from(b.flatMap((x) => (typeof x === "string" ? Array.from(x, (c) => c.charCodeAt(0)) : [x])));
  it("real formats pass", () => {
    expect(contentMatchesExtension(bytes("%PDF-1.7"), "signed.pdf")).toBe(true);
    expect(contentMatchesExtension(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a), "s.PNG")).toBe(true);
    expect(contentMatchesExtension(bytes(0xff, 0xd8, 0xff, 0xe0), "s.jpeg")).toBe(true);
    expect(contentMatchesExtension(bytes("RIFF", 0, 0, 0, 0, "WEBP"), "s.webp")).toBe(true);
  });
  it("a renamed file, an empty file or an unknown extension fails", () => {
    expect(contentMatchesExtension(bytes("<html>"), "signed.pdf")).toBe(false);
    expect(contentMatchesExtension(bytes("%PDF-1.7"), "signed.png")).toBe(false);
    expect(contentMatchesExtension(new Uint8Array(), "signed.pdf")).toBe(false);
    expect(contentMatchesExtension(bytes("%PDF-1.7"), "signed.svg")).toBe(false);
  });
  it("a download name is a name only: no path parts, quotes or control characters, at most 120 characters", () => {
    expect(safeDownloadName("../../etc/passwd", "f")).toBe("passwd");
    expect(safeDownloadName('a"b\r\nc.pdf', "f")).toBe("abc.pdf");
    expect(safeDownloadName("x".repeat(300), "f")).toHaveLength(120);
    expect(safeDownloadName("", "contract-proof")).toBe("contract-proof");
  });
});
