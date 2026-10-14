import { describe, expect, it } from "vitest";
import { buildMime, encodeWords, rfc5322Date, toBase64Url } from "./mime";
import { MailProviderError, type OutgoingMail } from "./provider";

const mail = (o: Partial<OutgoingMail> = {}): OutgoingMail => ({
  from: "ana@agency.test", fromName: "Ana Silva", to: "ceo@acme.test", subject: "Quick question about Acme", text: "Hi Jo,\n\nShort note.\n\nAna",
  rfcMessageId: "<dis-abc123@dealinsec.com>", date: new Date("2026-10-14T09:05:03Z"), ...o,
});
/** Splits a built message into headers (unfolded) and the decoded body. */
function parse(raw: string) {
  const at = raw.indexOf("\r\n\r\n");
  const head = raw.slice(0, at).replace(/\r\n /g, " ");
  const headers = Object.fromEntries(head.split("\r\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 2)]));
  const body = Buffer.from(raw.slice(at + 4).replace(/\r\n/g, ""), "base64").toString("utf8");
  return { headers, body, lines: raw.split("\r\n") };
}
const decodeWords = (v: string) => v.replace(/=\?UTF-8\?B\?([^?]*)\?=\s*/g, (_m, b) => Buffer.from(b, "base64").toString("utf8")).trim();

describe("buildMime", () => {
  it("builds a standard plain-text message: the exact subject and body, our Message-ID, CRLF everywhere", () => {
    const raw = buildMime(mail());
    const { headers, body, lines } = parse(raw);
    expect(headers).toEqual({
      From: '"Ana Silva" <ana@agency.test>', To: "ceo@acme.test", Subject: "Quick question about Acme", Date: "Wed, 14 Oct 2026 09:05:03 +0000",
      "Message-ID": "<dis-abc123@dealinsec.com>", "MIME-Version": "1.0", "Content-Type": "text/plain; charset=UTF-8", "Content-Transfer-Encoding": "base64",
    });
    expect(body).toBe("Hi Jo,\r\n\r\nShort note.\r\n\r\nAna");
    expect(raw).not.toMatch(/(^|[^\r])\n/); // no bare LF
    expect(lines.every((l) => l.length <= 78)).toBe(true);
    expect(Buffer.from(toBase64Url(raw), "base64url").toString("utf8")).toBe(raw);
  });

  it("encodes non-ASCII subjects and names (RFC 2047) without splitting characters, and folds long ones", () => {
    const subject = "Olá — uma pergunta rápida sobre a vossa loja em Lisboa, café e pastelaria ☕";
    const { headers, lines } = parse(buildMime(mail({ subject, fromName: "Ana Sílva" })));
    expect(decodeWords(headers.Subject)).toBe(subject);
    expect(decodeWords(headers.From.replace(/\s*<ana@agency\.test>$/, ""))).toBe("Ana Sílva");
    expect(headers.From).toMatch(/<ana@agency\.test>$/);
    expect(lines.every((l) => l.length <= 78)).toBe(true);
    for (const w of encodeWords("💡".repeat(30))) expect(Buffer.from(w.slice(10, -2), "base64").toString("utf8")).toMatch(/^(💡)+$/);
  });

  it("quotes specials in an ASCII display name; text that looks like an encoded word is encoded, not passed through", () => {
    expect(parse(buildMime(mail({ fromName: 'Ana "AS" \\ Co' }))).headers.From).toBe('"Ana \\"AS\\" \\\\ Co" <ana@agency.test>');
    expect(parse(buildMime(mail({ subject: "=?UTF-8?B?aGFjaw==?=" }))).headers.Subject).toMatch(/^=\?UTF-8\?B\?PT9VVEYtOD9CP2FHRmphdz09Pz0=\?=$/);
  });

  it("refuses header injection and control characters anywhere in a header, and a body with NUL", () => {
    const bad: Partial<OutgoingMail>[] = [
      { subject: "Hi\r\nBcc: everyone@x.test" }, { subject: "Hi\nX: y" }, { subject: "Hi there" }, { subject: "tab\there" },
      { fromName: "Ana\r\nBcc: x@y.test" }, { to: "ceo@acme.test\r\nCc: x@y.test" }, { to: "a@x.test, b@y.test" }, { to: "Name <a@x.test>" },
      { from: "ana@agency.test\nBcc: z@z.test" }, { rfcMessageId: "<a@b>\r\nX: y" }, { text: "hi\u0000there" }, { subject: "" }, { text: "   " },
      { subject: "x".repeat(201) }, { text: "x".repeat(20_001) },
    ];
    for (const b of bad) expect(() => buildMime(mail(b)), JSON.stringify(b)).toThrow(MailProviderError);
  });

  it("a body line that looks like a header or the end of data stays inside the base64 body", () => {
    const text = "Line one\nBcc: everyone@x.test\n.\nFrom: boss@x.test\r\nend";
    const { headers, body } = parse(buildMime(mail({ text })));
    expect(Object.keys(headers)).not.toContain("Bcc");
    expect(body).toBe("Line one\r\nBcc: everyone@x.test\r\n.\r\nFrom: boss@x.test\r\nend");
  });

  it("formats dates in UTC", () => {
    expect(rfc5322Date(new Date("2026-01-02T03:04:05Z"))).toBe("Fri, 02 Jan 2026 03:04:05 +0000");
  });
});
