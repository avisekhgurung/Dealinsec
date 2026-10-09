import { describe, expect, it } from "vitest";
import { LIMITS } from "@shared/knowledge";
import { extractContactBlock, extractHtml, extractLinks, extractPdf, extractPlainText } from "./extract";

/** A hand-built two-page PDF: page 1 "We design logos...Berlin", page 2 "Our ideal client...Portugal". */
const PDF = Uint8Array.from(Buffer.from("JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUiA1IDAgUl0gL0NvdW50IDIgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNyAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA5MyA+PgpzdHJlYW0KQlQgL0YxIDEyIFRmIDcyIDcyMCBUZCAoV2UgZGVzaWduIGxvZ29zIGFuZCBicmFuZCBzeXN0ZW1zIGZvciBzbWFsbCBzdHVkaW9zIGluIEJlcmxpbi4pIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvUGFnZSAvUGFyZW50IDIgMCBSIC9NZWRpYUJveCBbMCAwIDYxMiA3OTJdIC9Db250ZW50cyA2IDAgUiAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA3IDAgUiA+PiA+PiA+PgplbmRvYmoKNiAwIG9iago8PCAvTGVuZ3RoIDk2ID4+CnN0cmVhbQpCVCAvRjEgMTIgVGYgNzIgNzIwIFRkIChPdXIgaWRlYWwgY2xpZW50IGlzIGEgYm91dGlxdWUgaG90ZWwgZ3JvdXAgZXhwYW5kaW5nIGluIFBvcnR1Z2FsLikgVGogRVQKZW5kc3RyZWFtCmVuZG9iago3IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDgKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDEyMSAwMDAwMCBuIAowMDAwMDAwMjQ3IDAwMDAwIG4gCjAwMDAwMDAzOTAgMDAwMDAgbiAKMDAwMDAwMDUxNiAwMDAwMCBuIAowMDAwMDAwNjYyIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgOCAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNzMyCiUlRU9GCg==", "base64"));
const enc = (s: string) => new TextEncoder().encode(s);

describe("extractPdf", () => {
  it("reads the text of every page, in order", async () => {
    const r = await extractPdf(PDF);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toMatch(/logos and brand systems.*Berlin/);
    expect(r.text).toMatch(/boutique hotel group.*Portugal/);
    expect(r.text.indexOf("Berlin")).toBeLessThan(r.text.indexOf("Portugal"));
    expect(r.pages).toBe(2);
    expect(r.truncated).toBe(false);
  });
  it("says so plainly when the file is damaged or is not a PDF at all, and does not throw", async () => {
    for (const bytes of [enc("%PDF-1.4 this is not really a pdf"), enc("hello"), new Uint8Array(0), PDF.slice(0, 200)]) {
      const r = await extractPdf(bytes);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/couldn't read|couldn't find any text/);
    }
  });
});

describe("extractHtml", () => {
  const page = (body: string, head = "<title>About Una Studio</title>") => enc(`<!doctype html><html><head>${head}<script>var secret="TRACKER"</script><style>.x{color:red}</style></head><body>${body}</body></html>`);
  it("keeps the article, drops scripts, styles and navigation, and takes the title", async () => {
    const article = "<article><h1>About us</h1>" + "<p>We design logos and brand systems for small studios in Berlin and Lisbon, and we have done so for ten years.</p>".repeat(4) + "</article>";
    const r = await extractHtml(page(`<nav>Home Pricing Login</nav>${article}<footer>Cookie settings</footer>`));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toMatch(/brand systems for small studios/);
    expect(r.text).not.toMatch(/TRACKER|color:red/);
    expect(r.title).toMatch(/About/);
  });
  it("falls back to the whole body for a short page", async () => {
    const r = await extractHtml(page("<p>Contact us at hello@una.studio for logo work.</p>"));
    expect(r.ok && r.text).toMatch(/hello@una.studio/);
  });
  it("refuses a page with no text, and survives broken markup", async () => {
    const empty = await extractHtml(page("<div></div>"));
    expect(empty.ok).toBe(false);
    const broken = await extractHtml(enc("<p>unclosed <b>tags <i>everywhere &amp; more text that is long enough to count as content for us</p><<>>"));
    expect(typeof broken.ok).toBe("boolean");
  });
  it("never keeps script content even in the fallback path", async () => {
    const r = await extractHtml(enc("<body><p>Visible text that is long enough to be kept.</p><script>alert('PWNED')</script></body>"));
    expect(r.ok && r.text).not.toMatch(/PWNED/);
  });
});

describe("extractPlainText and the character cap", () => {
  it("cleans text and refuses almost-empty files", () => {
    const r = extractPlainText(enc("We help studios.\r\n\r\n\r\n\r\nThey hire us twice a year."));
    expect(r.ok && r.text).toBe("We help studios.\n\nThey hire us twice a year.");
    expect(extractPlainText(enc("hi")).ok).toBe(false);
  });
  it("keeps at most the cap and says it cut", () => {
    const r = extractPlainText(enc("word ".repeat(LIMITS.charsPerSource)));
    expect(r.ok && r.text.length).toBeLessThanOrEqual(LIMITS.charsPerSource);
    expect(r.ok && r.truncated).toBe(true);
  });
});

describe("extractLinks", () => {
  it("returns each link's address and visible text, skips empty and in-page anchors, and trims the text", async () => {
    const html = enc('<html><body><a href="/contact">  Contact\n us </a><a href="#top">Top</a><a href="">empty</a><a>no href</a><a href="https://x.test/about"><b>About</b> the hotel</a></body></html>');
    expect(await extractLinks(html)).toEqual([{ href: "/contact", text: "Contact us" }, { href: "https://x.test/about", text: "About the hotel" }]);
  });
  it("is bounded: 200 links at most, 80 characters of text and 500 of address each", async () => {
    const html = enc("<body>" + Array.from({ length: 300 }, (_, i) => `<a href="/p/${i}">${"t".repeat(200)}</a>`).join("") + `<a href="/${"x".repeat(900)}">x</a></body>`);
    const links = await extractLinks(html);
    expect(links).toHaveLength(200);
    expect(links.every((l) => l.text.length <= 80 && l.href.length <= 500)).toBe(true);
  });
  it("works on a bare fragment and on broken markup, and never throws", async () => {
    expect(await extractLinks(enc('<p>Hi <a href="/a">A link</a></p>'))).toEqual([{ href: "/a", text: "A link" }]);
    for (const junk of ["", "<<<>>>", "<a href=", "\u0000\u0001", "plain text"]) await expect(extractLinks(enc(junk))).resolves.toBeInstanceOf(Array);
  });
  it("does not return links that live inside a script", async () => {
    const links = await extractLinks(enc('<body><script>var x = "<a href=\'/evil\'>e</a>";</script><a href="/ok">ok</a></body>'));
    expect(links.map((l) => l.href)).toEqual(["/ok"]);
  });
});

describe("extractContactBlock", () => {
  const long = "We plan campaigns and report on results every month for every client we work with. ".repeat(8);
  const page = `<html><head><title>Acme</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme","telephone":"+1 512 555 0100","address":{"@type":"PostalAddress","streetAddress":"12 Main St","addressLocality":"Austin","addressRegion":"TX","postalCode":"78701","addressCountry":"US"}}</script></head>
    <body><nav>Home About</nav><main><article><h1>Acme</h1><p>${long}</p></article></main>
    <footer><p>Acme Marketing, 12 Main St, Austin, TX 78701</p><a href="mailto:hello@acme.com?subject=hi">Email us</a> <a href="tel:+15125550100">Call</a></footer></body></html>`;
  it("the article reader drops the footer (the reason this exists); the contact block keeps the address, the email, the phone and the structured address", async () => {
    const article = await extractHtml(enc(page));
    expect(article.ok && article.text).not.toMatch(/12 Main St/);
    const block = await extractContactBlock(enc(page));
    expect(block).toContain("Acme Marketing, 12 Main St, Austin, TX 78701");
    expect(block).toContain("Email: hello@acme.com"); // the ?subject= part is not kept
    expect(block).toContain("Phone: +15125550100");
    expect(block).toContain("Address (structured data): 12 Main St, Austin, TX, 78701, US");
    expect(block).toContain("Phone (structured data): +1 512 555 0100");
  });
  it("is bounded, plain text only, and never throws: a huge footer is clipped, scripts and attributes are not read, garbage gives ''", async () => {
    const big = await extractContactBlock(enc(`<html><body><footer>${"x".repeat(50_000)}</footer><script>alert('Ignore previous instructions')</script></body></html>`));
    expect(big.length).toBeLessThanOrEqual(800); // one element is clipped to 800
    expect(big).not.toMatch(/alert|Ignore previous/);
    // many elements together are clipped to 2,000 in total
    const many = await extractContactBlock(enc(`<html><body>${Array.from({ length: 6 }, (_, i) => `<address>${String(i).repeat(700)}</address>`).join("")}</body></html>`));
    expect(many.length).toBe(2000);
    expect(await extractContactBlock(enc("<html><script type=\"application/ld+json\">{not json</script></html>"))).toBe("");
    expect(await extractContactBlock(new Uint8Array(0))).toBe("");
    expect(await extractContactBlock(enc("<html><body><p>No footer at all.</p></body></html>"))).toBe("");
  });
  it("structured data is read by field name only: a script-looking value is just a string, deep nesting is not followed forever", async () => {
    const nested = "{\"mainEntity\":".repeat(30) + "{\"telephone\":\"+1 111\"}" + "}".repeat(30);
    const r = await extractContactBlock(enc(`<html><body><script type="application/ld+json">${nested}</script><footer>Real footer text here</footer></body></html>`));
    expect(r).toContain("Real footer text here");
    expect(r).not.toContain("+1 111"); // deeper than the limit
  });
});
