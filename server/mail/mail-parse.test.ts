import { describe, expect, it } from "vitest";
import { addressList, addressOf, bodyOf, htmlToText, messageIds, parseMail, stripQuoted, subjectKey } from "./mail-parse";
import type { MailboxMessage, MailHeader } from "./provider";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
function msg(headers: Record<string, string>, parts: { type: string; body: string; charset?: string; filename?: string }[] = [], labels = ["INBOX"]): MailboxMessage {
  const hs: MailHeader[] = Object.entries(headers).map(([name, value]) => ({ name, value }));
  return {
    id: "m1", threadId: "t1", labelIds: labels, internalDate: new Date("2026-10-15T10:00:00Z"),
    payload: { mimeType: "multipart/alternative", headers: hs, parts: parts.map((p) => ({ mimeType: p.type, filename: p.filename, headers: [{ name: "Content-Type", value: `${p.type}; charset=${p.charset ?? "utf-8"}` }], body: { data: p.charset === "latin1" ? Buffer.from(p.body, "latin1").toString("base64url") : b64(p.body) } })) },
  };
}

describe("addresses: only the address part identifies anyone", () => {
  it("takes <address> over a display name that looks like another address", () => {
    expect(addressOf(`"jo@acme.com" <attacker@evil.test>`)).toEqual({ address: "attacker@evil.test", name: "jo@acme.com" });
    expect(addressOf("Jo Bloggs <JO@Acme.COM>")).toEqual({ address: "jo@acme.com", name: "Jo Bloggs" });
    expect(addressOf("jo@acme.com").address).toBe("jo@acme.com");
    expect(addressOf("Jo Bloggs").address).toBeNull(); // a name alone is nobody
  });
  it("splits lists on commas outside quotes and brackets", () => {
    expect(addressList(`"Bloggs, Jo" <jo@acme.com>, ana@agency.test, Not An Address`)).toEqual(["jo@acme.com", "ana@agency.test"]);
  });
  it("reads Message-IDs from References in order, lower case, ignoring junk", () => {
    expect(messageIds("<A@x.com> junk <b@y.com>\r\n <c@z.com>")).toEqual(["<a@x.com>", "<b@y.com>", "<c@z.com>"]);
  });
});

describe("parseMail", () => {
  it("reads the matching fields", () => {
    const p = parseMail(msg({ From: "Jo <jo@acme.com>", To: "ana@agency.test", Cc: "boss@acme.com", Subject: "Re: A quick idea", "Message-ID": "<R1@acme.com>", "In-Reply-To": "<dis-1@dealinsec.com>", References: "<dis-1@dealinsec.com>", Date: "Thu, 15 Oct 2026 11:00:00 +0000" }));
    expect(p).toMatchObject({ from: "jo@acme.com", fromName: "Jo", to: ["ana@agency.test"], cc: ["boss@acme.com"], rfcMessageId: "<r1@acme.com>", inReplyTo: "<dis-1@dealinsec.com>", references: ["<dis-1@dealinsec.com>"], automated: false, bounce: false });
    expect(p.date?.toISOString()).toBe("2026-10-15T11:00:00.000Z");
  });
  it("recognizes auto-replies by header or subject, and bounces by sender or report type", () => {
    expect(parseMail(msg({ From: "jo@acme.com", "Auto-Submitted": "auto-replied" })).automated).toBe(true);
    expect(parseMail(msg({ From: "jo@acme.com", "Auto-Submitted": "no" })).automated).toBe(false);
    expect(parseMail(msg({ From: "jo@acme.com", Subject: "Out of Office: back Monday" })).automated).toBe(true);
    expect(parseMail(msg({ From: "jo@acme.com", Precedence: "bulk" })).automated).toBe(true);
    expect(parseMail(msg({ From: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" })).bounce).toBe(true);
    expect(parseMail(msg({ From: "x@acme.com", "Content-Type": "multipart/report; report-type=delivery-status; boundary=x" })).bounce).toBe(true);
  });
  it("falls back to the internal date when the Date header is unreadable", () => {
    expect(parseMail(msg({ From: "jo@acme.com", Date: "not a date" })).date?.toISOString()).toBe("2026-10-15T10:00:00.000Z");
  });
});

describe("bodies: plain text only, quoted history cut", () => {
  it("prefers text/plain and cuts Gmail's \"On … wrote:\" quote", () => {
    const b = bodyOf(msg({}, [{ type: "text/plain", body: "Sounds good, call Tuesday?\n\nJo\n\nOn Wed, 14 Oct 2026 at 12:00, Ana <ana@agency.test> wrote:\n> Hi Jo,\n> idea" }, { type: "text/html", body: "<p>ignored</p>" }]));
    expect(b).toEqual({ text: "Sounds good, call Tuesday?\n\nJo", trimmed: true });
  });
  it("handles a wrapped \"wrote:\" line and Outlook's From/Sent block", () => {
    expect(stripQuoted("Yes please.\n\nOn Wed, 14 Oct 2026 at 12:00, Ana Silva <ana@agency.test>\nwrote:\n> old").text).toBe("Yes please.\n");
    expect(stripQuoted("Not now.\n________________________________\nFrom: Ana\nSent: Wednesday\nSubject: idea").text).toBe("Not now.");
  });
  it("keeps everything when cutting would leave nothing (a reply that is only a quote is still shown)", () => {
    expect(stripQuoted("> just a quote")).toEqual({ text: "> just a quote", trimmed: false });
  });
  it("turns HTML into text: no tags, no scripts, entities decoded, Gmail's quote block cut", () => {
    const h = htmlToText(`<div>Hi Ana,<br>Let&#39;s talk &amp; plan.<script>alert(1)</script></div><div class="gmail_quote">On Wed … wrote:<blockquote>old</blockquote></div>`);
    expect(h.trimmed).toBe(true);
    expect(h.text).toContain("Let's talk & plan.");
    expect(h.text).not.toMatch(/<|alert|old/);
  });
  it("uses the part's charset, skips attachments, strips control characters, and caps length", () => {
    expect(bodyOf(msg({}, [{ type: "text/plain", body: "Olá, açaí", charset: "latin1" }])).text).toBe("Olá, açaí");
    expect(bodyOf(msg({}, [{ type: "text/plain", body: "secret attachment", filename: "notes.txt" }])).text).toBeNull();
    expect(bodyOf(msg({}, [{ type: "text/plain", body: "a\u0000b\u0007c" }])).text).toBe("abc");
    const long = bodyOf(msg({}, [{ type: "text/plain", body: "x".repeat(25_000) }]));
    expect(long.text!.length).toBe(20_001);
    expect(long.trimmed).toBe(true);
  });
});

describe("subjectKey", () => {
  it("ignores reply/forward prefixes, case and spacing", () => {
    expect(subjectKey("RE: Fwd:  A quick   idea")).toBe("a quick idea");
    expect(subjectKey("AW[2]: Sv: a quick idea")).toBe("a quick idea");
    expect(subjectKey("A different idea")).not.toBe(subjectKey("A quick idea"));
  });
});
