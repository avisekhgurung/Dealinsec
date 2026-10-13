import { describe, expect, it } from "vitest";
import { LIMITS } from "@shared/knowledge";
import { extractContactBlock, extractHtml, extractLinks, extractPdf, extractPlainText, extractPeople, extractPeopleBlock, hasContactForm } from "./extract";

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

describe("hasContactForm", () => {
  it("sees a form a visitor can write to the company with, or a known form embed", () => {
    for (const h of ['<form action="/send"><input name="name"><input type="email" name="email"><textarea name="message"></textarea><button>Send</button></form>',
      '<form action="/send"><input name="name"><input type="email" name="email"><input name="company"><button>Get a proposal</button></form>',
      '<script src="//js.hsforms.net/forms/v2.js"></script><script>hbspt.forms.create({})</script>', '<iframe src="https://form.jotform.com/123"></iframe>', '<div class="gform_wrapper"></div>', '<div class="wpforms-form"></div>', '<form id="mktoForm_12"></form>', '<a href="https://calendly.com/acme/intro">Book</a>'])
      expect(hasContactForm(enc(`<html><body>${h}</body></html>`)), h).toBe(true);
  });
  it("R1: a link, a newsletter sign-up, a search box, a login or a lone email box is not a contact form", () => {
    for (const h of ["<p>Write to us at hello@acme.com</p>", "<p>The word form appears in this sentence: platform, formation, uniform.</p>", "",
      '<nav><a href="/contact-us">Contact Us</a></nav>', // a menu link only
      '<form action="https://acme.us1.list-manage.com/subscribe/post"><input type="email" name="EMAIL"><button>Subscribe</button></form>', // newsletter
      '<form><input name="name"><input type="email" name="email" placeholder="Your email"><button>Join our newsletter</button></form>', // newsletter with a name box
      '<form role="search"><input type="search" name="q"><button>Search</button></form>', '<form action="/"><input name="s"><input type="submit" value="Search"></form>', // site search
      '<form action="/search"><input name="query"><select name="category"><option>All</option></select><button>Go</button></form>', // a search form with two fields
      '<form action="/login"><input type="email" name="email"><input type="password" name="password"><button>Sign in</button></form>', // login
      '<form><input type="email" name="email"><button>Go</button></form>', // one email box: can't tell, so not a route
      '<form><input type="hidden" name="token"><input type="submit"></form>',
      '<form id="commentform" action="https://acme.com/wp-comments-post.php"><textarea name="comment"></textarea><input name="author"><input name="email"></form>'])
      expect(hasContactForm(enc(`<html><body>${h}</body></html>`)), h).toBe(false);
    // A real contact form next to a newsletter box still counts.
    expect(hasContactForm(enc('<html><body><form><input type="email" name="email"><button>Subscribe</button></form><form><input name="name"><input type="email" name="email"><textarea name="message"></textarea></form></body></html>'))).toBe(true);
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
    // the address a reader SEES wins over a broken mailto target (found: "info@www.firebrand.marketing" behind "info@firebrand.marketing")
    const broken = await extractContactBlock(enc('<html><body><footer><a href="mailto:info@www.acme.com">info@acme.com</a> <a href="mailto:sales@acme.com">Email sales</a></footer></body></html>'));
    expect(broken).toContain("Email: info@acme.com");
    expect(broken).not.toContain("info@www.acme.com");
    expect(broken).toContain("Email: sales@acme.com"); // link text is not an address: the target is used
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

describe("extractPeopleBlock (team grids the article reader drops)", () => {
  const filler = "We plan campaigns and report on results every month for every client. ".repeat(6);
  const grid = `<html><body><main><article><h1>Our team</h1><p>${filler}</p></article>
    <section class="team"><div class="card"><h3>Mara Whitfield</h3><p>Founder</p></div><div class="card"><h3>Ana Silva</h3><p>Head of Growth</p></div>
    <div class="card"><p>Inês Duarte</p><p>Content Strategist</p></div></section>
    <section class="quotes"><blockquote>They doubled our pipeline.</blockquote><p>Tess Harlow, Head of Marketing, Brightline</p></section>
    <nav><a href="/x">For Business Owner</a> <a href="/y">Native Performance Partner</a><div><a href="/z">Jordan Blake</a><span>Managing Partner</span></div></nav></body></html>`;
  it("the block keeps each name with its role, in the page's own words (the article reader, when it keeps a grid at all, never pairs them)", async () => {
    const article = await extractHtml(enc(grid));
    expect(article.ok && article.text).not.toContain("Mara Whitfield, Founder");
    const b = await extractPeopleBlock(enc(grid));
    expect(b).toContain("Mara Whitfield, Founder");
    expect(b).toContain("Ana Silva, Head of Growth");
    expect(b).not.toContain("Tess Harlow"); // a client under a quote: not a staff line…
    expect((await extractPeople(enc(grid))).quoted).toEqual(["Tess Harlow, Head of Marketing, Brightline"]); // …but kept, as quoted, for the staff check
    expect(b).not.toMatch(/Business Owner|Performance Partner|Jordan Blake/); // a menu is never read for people
  });
  it("a card that puts the role first is read in its own order: a name is never paired with the next person's role", async () => {
    const roleFirst = `<html><body><section><div><p>Founder</p><h3>Dana Ortiz</h3></div><div><p>Head of Growth</p><h3>Lee Park</h3></div></section></body></html>`;
    const b = await extractPeopleBlock(enc(roleFirst));
    expect(b).toContain("Dana Ortiz, Founder");
    expect(b).toContain("Lee Park, Head of Growth");
    expect(b).not.toContain("Dana Ortiz, Head of Growth");
    const flat = `<html><body><section><h2>Leadership</h2><h3>Dana Ortiz</h3><p>Founder</p><h3>Lee Park</h3><p>Head of Growth</p></section></body></html>`;
    expect(await extractPeopleBlock(enc(flat))).toBe("Dana Ortiz, Founder\nLee Park, Head of Growth");
    const inline = `<html><body><div class="card"><a href="/team/dana">Dana Ortiz</a><span>Founder</span></div></body></html>`;
    expect(await extractPeopleBlock(enc(inline))).toBe("Dana Ortiz, Founder");
  });
  // The markup of one live team page (names invented): client testimonial cards ("Name" "Role" "at" "Client", a video
  // marked testimonial, a quote), the agency's co-founder quoted, then the leadership grid, each card wrapped in a link.
  const testimonial = (name: string, role: string, client: string) => `<div role="listitem" class="c-wrap w-dyn-item"><div class="c-card"><div class="c-wrap"><div class="c-test_top">
    <div aria-label="testimonial-video" class="c-wrap"><img alt="${name}" class="c-test_img"></div>
    <div class="c-wrap"><div class="c-wrap"><div class="c-text_s">${name}</div><div class="c-wrap cc-horizontal"><div class="c-text_s">${role}</div><div class="c-text_s">at</div><div class="c-text_s">${client}</div></div></div><img alt="${client}" class="c-test_logo"></div></div>
    <div class="c-wrap"><p class="c-paragraph_m">The benefit of working with them is fast-forwarding through the learning curve.</p></div></div></div></div>`;
  const member = (name: string, role: string) => `<div role="listitem" class="c-team_member"><a href="/team/${name.split(" ")[0].toLowerCase()}" class="c-wrap"><img alt="${name}" class="c-team_img"><div class="c-wrap"><div class="c-text">${name}</div><div class="c-text_s">${role}</div></div></a></div>`;
  const clients = [["Priya Holt", "CEO", "StandupHive"], ["Gil Navarro", "Cofounder", "VolunteerNest"], ["Rosa Kemp", "VP of Ops", "Outpost.ai"], ["Ivan Petrov", "Head of Marketing", "Harbor Logistics"], ["Hugo Lane", "Founder", "Bidwell"]];
  const tigerPage = (n: number) => `<html><body><main>
    <div class="c-section"><div class="c-wrap"><p class="c-paragraph_m">An agency partner is only as good as the results they produce.</p><img alt="Opening quotation marks" class="c-quotes"></div>
      <div class="c-wrap"><img alt="Owen Vance" class="c-headshot"><div class="c-wrap"><div class="c-text_s">Owen Vance</div><div class="c-text_s">BrightTiger Co-founder</div></div></div></div>
    <div role="list" class="c-slider">${Array.from({ length: n }, (_, i) => { const [name, role, client] = clients[i % clients.length]; return testimonial(i < clients.length ? name : `${name}${String.fromCharCode(97 + i)}`, role, client); }).join("")}</div>
    <div id="team" class="c-section"><h2>Meet the <span>BrightTiger</span> Leadership</h2>
      <div role="list" class="c-team">${member("Mara Quill", "CEO")}${member("Owen Vance", "CSO")}${member("Lena Brook", "Chief of Staff")}${member("Tom Reyes", "SEO Manager")}</div></div>
  </main></body></html>`;
  it("client testimonials are not staff: each keeps its company, goes to `quoted`, and never crowds out the team", async () => {
    const p = await extractPeople(enc(tigerPage(5)));
    expect(p.staff).toEqual(["Mara Quill, CEO", "Owen Vance, CSO", "Lena Brook, Chief of Staff", "Tom Reyes, SEO Manager"]); // the grid, link-wrapped cards included
    expect(p.quoted).toEqual(["Owen Vance, BrightTiger Co-founder", "Priya Holt, CEO at StandupHive", "Gil Navarro, Cofounder at VolunteerNest", "Rosa Kemp, VP of Ops at Outpost.ai", "Ivan Petrov, Head of Marketing at Harbor Logistics", "Hugo Lane, Founder at Bidwell"]);
    const crowded = await extractPeople(enc(tigerPage(25))); // more testimonials than both lists hold
    expect(crowded.staff).toEqual(p.staff);
    expect(crowded.quoted.length).toBeLessThanOrEqual(10);
  });
  it("a client's logo on a person's card is client context; a LinkedIn icon or the person's photo is not", async () => {
    const card = (name: string, role: string, img: string) => `<div class="card"><img alt="${name}" class="photo">${img}<h3>${name}</h3><p>${role}</p></div>`;
    const page = `<html><body><section>${card("Dana Ortiz", "Founder", `<img alt="Orchard Labs" class="company-logo" src="/img/orchard-logo.svg">`)}
      ${card("Lee Park", "Head of Growth", `<a href="https://linkedin.com/in/x"><img alt="LinkedIn" class="social-logo" src="/img/linkedin-logo.svg"></a>`)}</section></body></html>`;
    expect(await extractPeople(enc(page))).toEqual({ staff: ["Lee Park, Head of Growth"], quoted: ["Dana Ortiz, Founder"] });
  });
  it("a heading decides a plain card's context: \"What our clients say\" is quoted, \"Meet the team\" is staff", async () => {
    const page = `<html><body><section><h2>What our clients say</h2><div><h3>Dana Ortiz</h3><p>Founder</p></div></section>
      <section><h2>Meet the team</h2><div><h3>Lee Park</h3><p>Head of Growth</p></div></section></body></html>`;
    expect(await extractPeople(enc(page))).toEqual({ staff: ["Lee Park, Head of Growth"], quoted: ["Dana Ortiz, Founder"] });
  });
  it("is bounded and never throws: at most 20 people, about 1,500 characters, garbage gives ''", async () => {
    const many = `<html><body>${Array.from({ length: 40 }, (_, i) => `<div><h3>Person Number${String.fromCharCode(65 + (i % 26))}x</h3><p>Director of Marketing</p></div>`).join("")}</body></html>`;
    const b = await extractPeopleBlock(enc(many));
    expect(b.split("\n").length).toBeLessThanOrEqual(20);
    expect(b.length).toBeLessThanOrEqual(1500);
    expect(await extractPeopleBlock(new Uint8Array(0))).toBe("");
    expect(await extractPeopleBlock(enc("<html><body><p>No people here.</p></body></html>"))).toBe("");
  });
});
