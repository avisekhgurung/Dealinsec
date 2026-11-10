/**
 * The unsubscribe link: who can use one, what one click does, and what it can never do. Fake stores; real signing.
 */
import { describe, expect, it, vi } from "vitest";
vi.mock("../db", () => ({ db: {} }));
import { lookupUnsubscribe, publicBase, signToken, unsubscribe, unsubscribePage, unsubscribeSecret, unsubscribeUrl, type UnsubscribeDeps, linkGuard } from "./unsubscribe";
import { maskEmail, unsubscribeLine } from "@shared/unsubscribe";
import { withFooter, OPT_OUT_LINE, hasOptOutLine } from "@shared/campaign";

const SECRET = "a-test-secret-that-is-long-enough";
const NOW = new Date("2026-11-11T10:00:00Z");
function world(over: Partial<UnsubscribeDeps> = {}) {
  const messages = [{ id: 7, orgId: "org-a", leadId: 70, toAddress: "Asha@Organics.example" }, { id: 8, orgId: "org-b", leadId: 80, toAddress: "bob@other.example" }, { id: 9, orgId: "org-a", leadId: 90, toAddress: null }];
  const list: string[] = [], events: string[] = [], marked: string[] = [], logs: any[] = [];
  const deps: UnsubscribeDeps = {
    secret: () => SECRET, ready: async () => true, now: () => NOW,
    message: async (id) => messages.find((m) => m.id === id) ?? null,
    orgName: async (o) => (o === "org-a" ? "Pixel Studio" : "Other Co"),
    isListed: async (o, a) => list.includes(`${o}|${a}`),
    addToList: async (o, a, id) => { list.push(`${o}|${a}`); void id; },
    recordOptOut: async (o, l, id) => { const k = `${o}|${id}`; if (events.includes(k)) return false; events.push(k); return true; },
    markLead: async (o, l) => { marked.push(`${o}|${l}`); },
    log: (event, fields) => logs.push({ event, ...fields }),
    ...over,
  };
  return { deps, list, events, marked, logs };
}
const tok = (org: string, id: number, secret = SECRET) => signToken(secret, org, id);

describe("the link itself", () => {
  it("is this message's own, on the canonical https host in production, and there is none without a secret", () => {
    const env = { NODE_ENV: "production", SESSION_SECRET: SECRET } as any;
    expect(unsubscribeUrl("org-a", 7, env)).toBe(`https://www.dealinsec.com/u/${tok("org-a", 7)}`);
    expect(unsubscribeUrl("org-a", 7, { ...env, CANONICAL_HOST: "app.example.com" })).toMatch(/^https:\/\/app\.example\.com\/u\/7\./);
    expect(unsubscribeUrl("org-a", 7, { APP_URL: "http://localhost:3000/", SESSION_SECRET: SECRET } as any)).toMatch(/^http:\/\/localhost:3000\/u\/7\./);
    expect(unsubscribeUrl("org-a", 7, { NODE_ENV: "production" } as any)).toBeNull();
    expect(unsubscribeUrl("org-a", 7, { SESSION_SECRET: "short" } as any)).toBeNull();
    expect(unsubscribeUrl("org-a", 0, env)).toBeNull();
    expect(unsubscribeSecret({ UNSUBSCRIBE_SECRET: "x".repeat(20), SESSION_SECRET: SECRET } as any)).toBe("x".repeat(20)); // its own secret wins
    expect(publicBase({ NODE_ENV: "production", APP_URL: "http://evil.example" } as any)).toBe("https://www.dealinsec.com"); // never from APP_URL in production
  });
  it("differs per message and per workspace, and says nothing but an id and a signature", () => {
    expect(tok("org-a", 7)).toMatch(/^7\.[A-Za-z0-9_-]{32}$/);
    expect(tok("org-a", 7)).not.toBe(tok("org-a", 8));
    expect(tok("org-a", 7).split(".")[1]).not.toBe(tok("org-b", 7).split(".")[1]);
    expect(tok("org-a", 7)).toBe(tok("org-a", 7));
  });
  it("sits in the footer after the opt-out line, only when it is a real link, and never twice", () => {
    const url = "https://www.dealinsec.com/u/7.abc";
    const body = withFooter("Hello there", "Pixel Studio", url);
    expect(body).toBe(`Hello there\n\nPixel Studio\n${OPT_OUT_LINE}\n${unsubscribeLine(url)}`);
    expect(hasOptOutLine(body)).toBe(true);
    expect(withFooter(body, "Pixel Studio", "https://www.dealinsec.com/u/8.zzz")).toBe(body);
    for (const bad of [null, undefined, "", "javascript:alert(1)", "https://x.example/a b"]) expect(withFooter("Hello there", "", bad as any)).toBe(`Hello there\n\n${OPT_OUT_LINE}`);
  });
});

describe("opening the link", () => {
  it("shows the sender's name and a masked address, and changes nothing", async () => {
    const w = world();
    expect(await lookupUnsubscribe(tok("org-a", 7), w.deps)).toEqual({ orgName: "Pixel Studio", address: "a***@organics.example", already: false });
    expect([w.list, w.events, w.marked]).toEqual([[], [], []]);
    expect(maskEmail(null)).toBe("your address");
  });
  it("a wrong, forged, re-pointed or malformed link is simply not found", async () => {
    const w = world();
    const good = tok("org-a", 7);
    const forged = [
      good.slice(0, -1) + (good.endsWith("A") ? "B" : "A"),          // one character changed
      `8.${good.split(".")[1]}`,                                     // a real signature, pointed at another message
      tok("org-b", 7),                                               // signed for another workspace
      tok("org-a", 7, "another-secret-of-enough-length"),            // signed with another secret
      tok("org-a", 404),                                             // no such message
      "7", "7.", ".abc", "7.short", "abc.def", "", "7.%00", `${good}/extra`, ` ${good}`,
    ];
    for (const t of [...forged, null, undefined, 7, {}]) {
      expect(await lookupUnsubscribe(t, w.deps), String(t)).toBeNull();
      expect(await unsubscribe(t, w.deps), String(t)).toEqual({ ok: false });
    }
    expect([w.list, w.events, w.marked]).toEqual([[], [], []]);
  });
  it("is off entirely without a secret or without the outreach tables", async () => {
    const t = tok("org-a", 7);
    for (const over of [{ secret: () => null }, { ready: async () => false }, { ready: async () => { throw new Error("db"); } }] as Partial<UnsubscribeDeps>[]) {
      const w = world(over);
      expect(await lookupUnsubscribe(t, w.deps)).toBeNull();
      expect(await unsubscribe(t, w.deps)).toEqual({ ok: false });
      expect(w.list).toEqual([]);
    }
  });
});

describe("the click", () => {
  it("puts the address on that workspace's list, records the opt-out once, and marks the lead", async () => {
    const w = world();
    const r = await unsubscribe(tok("org-a", 7), w.deps);
    expect(r).toEqual({ ok: true, view: { orgName: "Pixel Studio", address: "a***@organics.example", already: false } });
    expect(w.list).toEqual(["org-a|asha@organics.example"]); // lower-cased: one entry however the address was typed
    expect(w.events).toEqual(["org-a|7"]);
    expect(w.marked).toEqual(["org-a|70"]);
    expect(w.logs).toEqual([{ event: "unsubscribe_link_used", messageId: 7, first: true, listed: true }]);
    expect(JSON.stringify(w.logs)).not.toContain("organics"); // the address is never logged
  });
  it("a second click changes nothing and says so", async () => {
    const w = world();
    await unsubscribe(tok("org-a", 7), w.deps);
    expect(await unsubscribe(tok("org-a", 7), w.deps)).toMatchObject({ ok: true, view: { already: true } });
    expect([w.list.length, w.events.length, w.marked.length]).toEqual([1, 1, 1]);
    expect(await lookupUnsubscribe(tok("org-a", 7), w.deps)).toMatchObject({ already: true });
  });
  it("only ever touches the workspace the message belongs to", async () => {
    const w = world();
    await unsubscribe(tok("org-b", 8), w.deps);
    expect(w.list).toEqual(["org-b|bob@other.example"]);
    expect(w.marked).toEqual(["org-b|80"]);
  });
  it("a message with no address still marks the lead do-not-contact", async () => {
    const w = world();
    expect(await unsubscribe(tok("org-a", 9), w.deps)).toMatchObject({ ok: true, view: { address: "your address", already: false } });
    expect(w.list).toEqual([]);
    expect(w.marked).toEqual(["org-a|90"]);
  });
  it("if the list can't be written, nothing is claimed and nothing else is done", async () => {
    const w = world({ addToList: async () => { throw new Error("db down"); } });
    await expect(unsubscribe(tok("org-a", 7), w.deps)).rejects.toThrow();
    expect([w.events, w.marked]).toEqual([[], []]);
  });
  it("an address already on the list (by a reply, say) is still recorded and the lead still marked, once", async () => {
    const w = world();
    w.list.push("org-a|asha@organics.example");
    expect(await unsubscribe(tok("org-a", 7), w.deps)).toMatchObject({ ok: true, view: { already: false } });
    expect([w.list.length, w.events, w.marked]).toEqual([1, ["org-a|7"], ["org-a|70"]]);
  });
});

describe("the guard on the public link: guessing is limited, unsubscribing never is", () => {
  it("a link that verifies is never counted, however many arrive from one address (a mail provider's one-click requests)", () => {
    const g = linkGuard(30, 600_000);
    for (let i = 0; i < 5_000; i++) expect(g.blocked("66.249.0.1", 1_000 + i)).toBe(false);
  });
  it("30 links that don't verify in 10 minutes and that address is refused, until they age out; other addresses are untouched", () => {
    const g = linkGuard(30, 600_000);
    for (let i = 0; i < 29; i++) g.miss("203.0.113.9", i * 1_000);
    expect(g.blocked("203.0.113.9", 30_000)).toBe(false);
    g.miss("203.0.113.9", 30_000);
    expect(g.blocked("203.0.113.9", 31_000)).toBe(true);
    expect(g.blocked("198.51.100.4", 31_000)).toBe(false);
    // Ten minutes after the first miss, it has aged out and the address is let in again.
    expect(g.blocked("203.0.113.9", 600_001)).toBe(false);
  });
  it("remembers a bounded number of addresses", () => {
    const g = linkGuard(2, 600_000, 3);
    for (const ip of ["a", "b", "c", "d"]) { g.miss(ip, 1); g.miss(ip, 2); }
    expect(g.blocked("a", 3)).toBe(false); // the oldest was dropped to make room
    expect(g.blocked("d", 3)).toBe(true);
  });
});

describe("the page", () => {
  it("escapes whatever it is given, is not indexed, and only offers a button when there is something to do", () => {
    const html = unsubscribePage({ title: "Stop these emails?", body: "<p>x</p>", action: "/u/7.abc\"><script>alert(1)</script>" });
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain('method="post"');
    expect(html).not.toContain("<script>");
    expect(unsubscribePage({ title: "<b>You're unsubscribed</b>", body: "" })).toContain("&lt;b&gt;You&#39;re unsubscribed&lt;/b&gt;");
    expect(unsubscribePage({ title: "Done", body: "" })).not.toContain("<form");
  });
});
