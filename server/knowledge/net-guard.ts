/**
 * Fetching a page a person pasted, without letting the server be used to reach
 * places only the server can reach (its own network, cloud metadata, a database).
 *
 *  - https only, no credentials in the link, port 443, a real hostname (no IP
 *    literals, no "localhost", no ".internal"/".local").
 *  - The name is resolved HERE, every address must be public, and the request
 *    then connects to that exact address (with the hostname for TLS), so the
 *    name cannot resolve somewhere else between the check and the connection.
 *  - Redirects are followed by hand (at most 3) and each hop is checked again.
 *  - Size, time and content type are capped.
 *
 * The network is behind `PageIO` so every rule is tested without one.
 */
import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import { LIMITS } from "@shared/knowledge";

// ── addresses ──────────────────────────────────────────────────────────────

const v4ToInt = (ip: string): number => ip.split(".").reduce((n, p) => n * 256 + Number(p), 0);
const inV4 = (n: number, base: string, bits: number) => {
  const size = 2 ** (32 - bits);
  const b = v4ToInt(base);
  return n >= b && n < b + size;
};
const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

/** Eight 16-bit groups, or null when it is not an IPv6 address. Handles "::" and a trailing dotted IPv4. */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    if (!net.isIPv4(dotted[1])) return null;
    const n = v4ToInt(dotted[1]);
    s = s.slice(0, -dotted[1].length) + ((n >>> 16) & 0xffff).toString(16) + ":" + (n & 0xffff).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (all.length !== 8 || !all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16));
}

/** True for anything that is not an ordinary public internet address. Unparseable input counts as blocked. */
export function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = v4ToInt(ip);
    return BLOCKED_V4.some(([b, bits]) => inV4(n, b, bits));
  }
  const g = v6Groups(ip);
  if (!g) return true;
  const embeddedV4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  const first = g[0];
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isBlockedAddress(embeddedV4(g[6], g[7])); // ::ffff:a.b.c.d
  if (g.slice(0, 6).every((x) => x === 0)) return true; // ::a.b.c.d (deprecated, compatible)
  if (first === 0x64 && g[1] === 0xff9b) return isBlockedAddress(embeddedV4(g[6], g[7])); // NAT64
  if (first === 0x2002) return true; // 6to4
  if (first === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true; // Teredo, documentation
  if ((first & 0xfe00) === 0xfc00) return true; // unique local
  if ((first & 0xffc0) === 0xfe80) return true; // link local
  if ((first & 0xffc0) === 0xfec0) return true; // site local (deprecated)
  if ((first & 0xff00) === 0xff00) return true; // multicast
  return false;
}

// ── the link ───────────────────────────────────────────────────────────────

export type UrlCheck = { ok: true; url: URL } | { ok: false; message: string };

export function validatePublicUrl(raw: string): UrlCheck {
  const text = raw.trim();
  if (!text || text.length > 2000) return { ok: false, message: "That link isn't usable." };
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`); } catch { return { ok: false, message: "That doesn't look like a web link." }; }
  if (url.protocol !== "https:") return { ok: false, message: "Only secure (https) links can be added." };
  if (url.username || url.password) return { ok: false, message: "Links with a username or password in them can't be added." };
  if (url.port && url.port !== "443") return { ok: false, message: "Only standard web addresses can be added." };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || net.isIP(host) || host.startsWith("[") || /(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(host) || !/^[a-z0-9.¡-￿-]+$/.test(host)) {
    return { ok: false, message: "That address isn't a public website." };
  }
  url.hash = "";
  return { ok: true, url };
}

// ── the fetch ──────────────────────────────────────────────────────────────

export interface PageResponse { status: number; headers: Record<string, string | undefined>; read(maxBytes: number): Promise<Uint8Array> }
export interface PageIO {
  lookup(host: string): Promise<string[]>;
  /** Connect to `address` (not the name), speak TLS for `url.hostname`, send one GET. */
  get(url: URL, address: string, signal: AbortSignal): Promise<PageResponse>;
}
export type PageResult =
  | { ok: true; url: URL; contentType: "html" | "text" | "pdf"; bytes: Uint8Array }
  | { ok: false; code: "blocked" | "unreachable" | "bad_response" | "too_big" | "unsupported"; message: string };

const MAX_REDIRECTS = 3;
const TOTAL_MS = 15_000;

export async function fetchPublicPage(raw: string, io: PageIO = realPageIO, maxBytes: number = LIMITS.pageBytes): Promise<PageResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TOTAL_MS);
  try {
    let current = raw;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const checked = validatePublicUrl(current);
      if (!checked.ok) return { ok: false, code: "blocked", message: checked.message };
      const url = checked.url;
      let addresses: string[];
      try { addresses = await io.lookup(url.hostname); } catch { return { ok: false, code: "unreachable", message: "I couldn't find that website." }; }
      if (!addresses.length) return { ok: false, code: "unreachable", message: "I couldn't find that website." };
      // One private answer among public ones is how rebinding is dressed up: refuse the lot.
      if (addresses.some(isBlockedAddress)) return { ok: false, code: "blocked", message: "That address isn't a public website." };
      let res: PageResponse;
      try { res = await io.get(url, addresses[0], ac.signal); } catch { return { ok: false, code: "unreachable", message: ac.signal.aborted ? "That website took too long to answer." : "I couldn't reach that website." }; }
      if (res.status >= 300 && res.status < 400 && res.headers.location) {
        try { current = new URL(res.headers.location, url).toString(); } catch { return { ok: false, code: "bad_response", message: "That website sent me somewhere that isn't valid." }; }
        continue;
      }
      if (res.status !== 200) return { ok: false, code: "bad_response", message: `That website answered with an error (${res.status}).` };
      const type = (res.headers["content-type"] ?? "").toLowerCase().split(";")[0].trim();
      const contentType = type === "text/html" || type === "application/xhtml+xml" ? "html" : type === "text/plain" ? "text" : type === "application/pdf" ? "pdf" : null;
      if (!contentType) return { ok: false, code: "unsupported", message: "That link isn't a web page, text or PDF." };
      const declared = Number(res.headers["content-length"]);
      if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, code: "too_big", message: "That page is too large." };
      try { return { ok: true, url, contentType, bytes: await res.read(maxBytes) }; }
      catch (e) { return e instanceof TooBig ? { ok: false, code: "too_big", message: "That page is too large." } : { ok: false, code: "unreachable", message: ac.signal.aborted ? "That website took too long to answer." : "I couldn't read that website." }; }
    }
    return { ok: false, code: "bad_response", message: "That link redirects too many times." };
  } finally {
    clearTimeout(timer);
  }
}

class TooBig extends Error {}

export const realPageIO: PageIO = {
  async lookup(host) {
    const r = await dns.lookup(host, { all: true, verbatim: true });
    return r.map((a) => a.address);
  },
  get(url, address, signal) {
    return new Promise<PageResponse>((resolve, reject) => {
      const req = https.request({
        host: address, port: 443, method: "GET", path: url.pathname + url.search, servername: url.hostname,
        headers: { Host: url.hostname, "User-Agent": "DealInSec/1.0 (adds a page you chose to your workspace)", Accept: "text/html,text/plain,application/pdf;q=0.8", "Accept-Encoding": "identity" },
        signal, timeout: 10_000,
      }, (res) => {
        const headers: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(res.headers)) headers[k] = Array.isArray(v) ? v[0] : v;
        resolve({
          status: res.statusCode ?? 0, headers,
          read: (max) => new Promise<Uint8Array>((ok, bad) => {
            const parts: Buffer[] = []; let total = 0;
            res.on("data", (c: Buffer) => { total += c.length; if (total > max) { res.destroy(); bad(new TooBig()); return; } parts.push(c); });
            res.on("end", () => ok(Buffer.concat(parts)));
            res.on("error", bad);
            res.on("close", () => { if (!res.complete) bad(new Error("closed")); });
          }),
        });
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) res.resume();
      });
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", reject);
      req.end();
    });
  },
};
