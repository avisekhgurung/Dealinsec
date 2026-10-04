import { describe, expect, it } from "vitest";
import { fetchPublicPage, isBlockedAddress, validatePublicUrl, type PageIO, type PageResponse } from "./net-guard";

describe("isBlockedAddress", () => {
  it("blocks every private, loopback, link-local, metadata and reserved IPv4 range, at both edges", () => {
    for (const ip of ["0.0.0.0", "10.0.0.1", "10.255.255.255", "100.64.0.1", "100.127.255.255", "127.0.0.1", "127.255.255.254", "169.254.169.254", "172.16.0.1", "172.31.255.255",
      "192.168.1.1", "192.0.0.8", "198.18.0.1", "198.19.255.255", "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255", "203.0.113.5"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });
  it("allows ordinary public IPv4, including addresses just outside the private ranges", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "192.169.0.1", "198.17.255.255", "198.20.0.1", "11.0.0.1"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });
  it("blocks IPv6 loopback, unspecified, local, link-local, multicast and the tunnelling forms", () => {
    for (const ip of ["::", "::1", "0:0:0:0:0:0:0:1", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0", "febf::1", "ff02::1", "2001:db8::1", "2001::1", "2002:7f00:1::1", "::127.0.0.1"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });
  it("sees through IPv4-mapped and NAT64 forms: a private address in costume is still private, a public one is public", () => {
    for (const ip of ["::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "::ffff:10.1.2.3", "64:ff9b::7f00:1", "64:ff9b::a00:1"]) expect(isBlockedAddress(ip), ip).toBe(true);
    for (const ip of ["::ffff:8.8.8.8", "64:ff9b::808:808"]) expect(isBlockedAddress(ip), ip).toBe(false);
  });
  it("allows ordinary public IPv6 and blocks anything it cannot parse", () => {
    for (const ip of ["2606:4700:4700::1111", "2a00:1450:4001:81b::200e"]) expect(isBlockedAddress(ip), ip).toBe(false);
    for (const ip of ["", "not-an-ip", "1.2.3", "1.2.3.4.5", "999.1.1.1", "1:2:3:4:5:6:7:8:9", "::1::2", "gggg::1"]) expect(isBlockedAddress(ip), ip).toBe(true);
  });
});

describe("validatePublicUrl", () => {
  const ok = (u: string) => validatePublicUrl(u).ok;
  it("accepts ordinary https links, and a bare host is taken as https", () => {
    expect(ok("https://example.com/about")).toBe(true);
    expect(ok("example.com/about?x=1")).toBe(true);
    expect(ok("https://sub.example.co.uk:443/a")).toBe(true);
    const r = validatePublicUrl("https://example.com/a#frag"); expect(r.ok && r.url.hash).toBe("");
  });
  it("refuses other schemes, plain http, credentials and odd ports", () => {
    for (const u of ["http://example.com", "ftp://example.com", "file:///etc/passwd", "gopher://example.com", "javascript:alert(1)", "data:text/html,hi", "https://user:pw@example.com", "https://user@example.com", "https://example.com:8080/", "https://example.com:22/"]) expect(ok(u), u).toBe(false);
  });
  it("refuses IP literals in every spelling, localhost and internal names", () => {
    for (const u of ["https://127.0.0.1/", "https://0x7f.0.0.1/", "https://2130706433/", "https://[::1]/", "https://[::ffff:127.0.0.1]/", "https://169.254.169.254/latest/meta-data", "https://10.0.0.5/", "https://localhost/", "https://app.localhost/", "https://db.internal/", "https://printer.local/", "https://intranet/", "https://example/"]) expect(ok(u), u).toBe(false);
  });
  it("refuses empty, huge and malformed input", () => {
    for (const u of ["", "   ", "https://", "https://exa mple.com", "x".repeat(2001), "https://exam\u0000ple.com"]) expect(ok(u), JSON.stringify(u).slice(0, 30)).toBe(false);
  });
});

// ── the fetch, with a fake network ─────────────────────────────────────────

const body = (s: string) => new TextEncoder().encode(s);
function res(status: number, headers: Record<string, string>, content = ""): PageResponse {
  return { status, headers, read: async (max) => { const b = body(content); if (b.length > max) throw Object.assign(new Error("big"), { constructor: { name: "TooBig" } }); return b; } };
}
function io(dns: Record<string, string[]>, pages: Record<string, PageResponse>, log: string[] = []): PageIO {
  return {
    lookup: async (h) => { log.push(`dns ${h}`); if (!dns[h]) throw new Error("ENOTFOUND"); return dns[h]; },
    get: async (u, address) => { log.push(`get ${address} ${u.hostname}${u.pathname}`); const p = pages[u.hostname + u.pathname]; if (!p) throw new Error("ECONNREFUSED"); return p; },
  };
}
const html = { "content-type": "text/html; charset=utf-8" };

describe("fetchPublicPage", () => {
  it("fetches a public page, connecting to the address it checked", async () => {
    const log: string[] = [];
    const r = await fetchPublicPage("https://example.com/a", io({ "example.com": ["93.184.216.34"] }, { "example.com/a": res(200, html, "<p>hi</p>") }, log));
    expect(r.ok && r.contentType).toBe("html");
    expect(log).toEqual(["dns example.com", "get 93.184.216.34 example.com/a"]);
  });
  it("never connects when the name resolves to a private address, or to a mix with one", async () => {
    for (const answer of [["10.0.0.7"], ["127.0.0.1"], ["169.254.169.254"], ["::1"], ["93.184.216.34", "10.0.0.7"], ["::ffff:192.168.0.1"]]) {
      const log: string[] = [];
      const r = await fetchPublicPage("https://evil.example.com/", io({ "evil.example.com": answer }, { "evil.example.com/": res(200, html, "secret") }, log));
      expect(r.ok, answer.join()).toBe(false);
      expect(log.some((l) => l.startsWith("get")), answer.join()).toBe(false);
    }
  });
  it("checks every redirect hop again: a public page cannot bounce the server into the private network", async () => {
    for (const target of ["https://10.0.0.5/admin", "http://example.com/x", "https://localhost/", "https://internal.example.com/", "file:///etc/passwd", "https://169.254.169.254/latest"]) {
      const log: string[] = [];
      const r = await fetchPublicPage("https://example.com/start", io({ "example.com": ["93.184.216.34"], "internal.example.com": ["10.1.1.1"] }, { "example.com/start": res(302, { location: target }) }, log));
      expect(r.ok, target).toBe(false);
      expect(log.filter((l) => l.startsWith("get"))).toEqual(["get 93.184.216.34 example.com/start"]);
    }
  });
  it("follows a normal redirect, including a relative one, and gives up after three", async () => {
    const dns = { "example.com": ["93.184.216.34"] };
    const ok = await fetchPublicPage("https://example.com/a", io(dns, { "example.com/a": res(301, { location: "/b" }), "example.com/b": res(200, html, "<p>b</p>") }));
    expect(ok.ok && ok.url.pathname).toBe("/b");
    const loop = await fetchPublicPage("https://example.com/a", io(dns, { "example.com/a": res(302, { location: "/a" }) }));
    expect(!loop.ok && loop.message).toMatch(/too many/);
  });
  it("accepts only html, text and pdf, and refuses errors", async () => {
    const dns = { "example.com": ["93.184.216.34"] };
    for (const type of ["application/json", "image/png", "application/octet-stream", "text/javascript", ""]) {
      const r = await fetchPublicPage("https://example.com/", io(dns, { "example.com/": res(200, { "content-type": type }, "x") }));
      expect(r.ok, type).toBe(false);
    }
    for (const [type, kind] of [["text/plain", "text"], ["application/pdf", "pdf"], ["application/xhtml+xml", "html"]] as const) {
      const r = await fetchPublicPage("https://example.com/", io(dns, { "example.com/": res(200, { "content-type": type }, "x") }));
      expect(r.ok && r.contentType, type).toBe(kind);
    }
    const notFound = await fetchPublicPage("https://example.com/", io(dns, { "example.com/": res(404, html, "no") }));
    expect(!notFound.ok && notFound.code).toBe("bad_response");
  });
  it("refuses a page that declares itself too large without reading it, and one that turns out too large", async () => {
    const dns = { "example.com": ["93.184.216.34"] };
    let read = false;
    const declared = { status: 200, headers: { ...html, "content-length": "999999999" }, read: async () => { read = true; return body(""); } };
    const a = await fetchPublicPage("https://example.com/", io(dns, { "example.com/": declared }), 1000);
    expect(!a.ok && a.code).toBe("too_big"); expect(read).toBe(false);
    class Big extends Error {}
    const b = await fetchPublicPage("https://example.com/", io(dns, { "example.com/": { status: 200, headers: html, read: async () => { throw new Big(); } } }), 1000);
    expect(b.ok).toBe(false);
  });
  it("reports an unknown host and an unreachable one in plain words", async () => {
    const a = await fetchPublicPage("https://nowhere.example.com/", io({}, {}));
    expect(!a.ok && a.message).toMatch(/couldn't find/);
    const b = await fetchPublicPage("https://example.com/", io({ "example.com": ["93.184.216.34"] }, {}));
    expect(!b.ok && b.message).toMatch(/couldn't reach/);
  });
});
