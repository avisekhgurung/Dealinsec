/**
 * Evidence dating from real HTML: each fixture (fixtures/dated-pages, synthetic pages shaped like the failures the
 * Oct 2026 diagnostic found) goes through the production reader, the production page composition at the model's budget
 * and the production validator. No network, no model, no database.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CUT_MARK, DATED_ITEMS_BLOCK, PAGE_DATES_BLOCK } from "@shared/page-dates";
import { MISSING_REASON, readiness, type FindingLike } from "@shared/prospect";
import { normalizeResearch } from "@shared/prospect-intel";
import { DATED_PAGE_CASES, READ_AT, type DatedPageCase } from "./fixtures/dated-pages/cases";
import { PAGE_TEXT_CHARS, readHtml, researchPage } from "./providers";
import { SIGNALS_PAGE_CHARS } from "./prompts";

const SITE = "northwind.example";
async function read(file: string, path: string) {
  const r = await readHtml(new Uint8Array(readFileSync(join(__dirname, "fixtures/dated-pages", file))), new URL(`https://${SITE}${path}`), READ_AT);
  if (!r.ok) throw new Error(`unreadable fixture ${file}`);
  return r;
}
async function run(c: Pick<DatedPageCase, "file" | "path" | "type" | "quote" | "dateQuote">) {
  const r = await read(c.file, c.path);
  const page = researchPage(r, 1, SIGNALS_PAGE_CHARS);
  const raw = { findings: [{ kind: "signal", type: c.type, value: c.quote.slice(0, 80), quote: c.quote, page: 1, ...(c.dateQuote ? { date_quote: c.dateQuote } : {}) }] };
  const res = normalizeResearch(raw, [page], SITE, { retrievedAt: READ_AT, icp: { roles: [] }, knownFactIds: [] });
  return { r, page, res, sig: res.signals[0] };
}
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

describe("known failures, before the limit and the validator", () => {
  it.each(DATED_PAGE_CASES.map((c) => [c.name, c] as const))("%s", async (_n, c) => {
    const { sig, page, res } = await run(c);
    expect(sig, `the quote must be on the page the model sees (${JSON.stringify(res.rejected)})`).toBeDefined();
    expect(day(sig.observedAt)).toBe(c.expect.observed);
    expect(sig.observedAt ? sig.dateSource : null).toBe(c.expect.source);
    // The model's text never exceeds its budget, and the retrieval time never stands in for a missing date.
    expect(page.text.length).toBeLessThanOrEqual(SIGNALS_PAGE_CHARS);
    if (!c.expect.observed) expect(sig.observedAt).toBeNull();
  });
});

describe("what the reader takes from the markup", () => {
  it("a list's entries keep their own dates; a list has no single publication date", async () => {
    const r = await read("blog-index-time.html", "/blog");
    expect(r.dates?.items.map((i) => i.date)).toEqual(["September 14, 2026", "August 28, 2026", "July 2, 2026", "May 19, 2026"]);
    expect(r.dates?.published).toBeNull();
    expect(r.text).toContain(`${DATED_ITEMS_BLOCK}\n[entry] Northwind launches a LinkedIn Ads practice for SaaS — September 14, 2026`);
  });
  it("structured data: the publication date, with the modified date kept apart and never used", async () => {
    const r = await read("article-jsonld.html", "/blog/linkedin-ads");
    expect(r.dates?.published).toMatchObject({ date: "2026-09-22", source: "json_ld", precision: "day" });
    expect(r.dates?.modified).toBe("2026-10-05");
    expect(r.text.startsWith(`${PAGE_DATES_BLOCK} Published 2026-09-22 (structured data). Last modified 2026-10-05 (not a publication date).`)).toBe(true);
  });
  it("a byline date the article reader drops; related posts in a sidebar neither date the article nor make it a list", async () => {
    const r = await read("article-byline.html", "/blog/growing-seo-team");
    expect(r.parts?.body).not.toContain("September 30, 2026"); // what the reader alone kept
    expect(r.dates?.published).toMatchObject({ date: "2026-09-30", source: "byline" });
    expect(r.dates?.items.map((i) => i.title)).toEqual(expect.arrayContaining(["A guide to SaaS keyword research", "Why we invest in content"]));
  });
  it("a long article: its date (past the old cut) is read first; the cut is marked and the labelled blocks survive", async () => {
    const r = await read("article-long.html", "/blog/uk-expansion");
    expect(r.parts!.body.length).toBeGreaterThan(PAGE_TEXT_CHARS);
    expect(r.parts!.body.indexOf("Published October 2, 2026")).toBeGreaterThan(PAGE_TEXT_CHARS - 200); // where the old limit cut
    const page = researchPage(r, 1, SIGNALS_PAGE_CHARS);
    expect(page.truncated).toBe(true);
    expect(page.text.startsWith(`${PAGE_DATES_BLOCK} Published 2026-10-02 (the visible byline).`)).toBe(true);
    expect(page.text).toContain(CUT_MARK);
    expect(page.text).toContain("[Footer and contact details]");
    expect(page.text).not.toContain("Published October 2, 2026"); // the text past the cut is not claimed as read
  });
  it("conflicting, future and malformed dates give no publication date, and say why", async () => {
    expect((await read("conflict.html", "/news/funding")).dates).toMatchObject({ published: null, discarded: ["conflict"] });
    expect((await read("future.html", "/blog/analytics")).dates).toMatchObject({ published: null, discarded: ["future"] });
    expect((await read("malformed.html", "/blog/cro")).dates?.published).toBeNull();
    expect((await read("home-with-meta.html", "/")).dates?.published).toBeNull();
    expect((await read("misleading-dates.html", "/blog/austin-office")).dates?.published).toBeNull();
  });
  it("the calendar day as the page wrote it, across a time zone boundary", async () => {
    expect((await read("timezone.html", "/news/head-of-growth")).dates?.published).toMatchObject({ date: "2026-09-30" });
  });
  it("the page's language decides numeric order; an unknown order is not guessed", async () => {
    expect((await read("numeric-us.html", "/press/partner-program")).dates).toMatchObject({ order: "mdy", published: { date: "2026-09-12" } });
    expect((await read("numeric-dotted.html", "/press/berlin")).dates).toMatchObject({ order: "dmy", published: { date: "2026-09-12" } });
    expect((await read("numeric-ambiguous.html", "/press/partner-program")).dates).toMatchObject({ order: null, published: null });
  });
});

describe("provenance and readiness", () => {
  it("a statement in a labelled block is never dated by the page's publication date", async () => {
    const r = await read("article-jsonld.html", "/blog/linkedin-ads");
    const page = researchPage(r, 1, SIGNALS_PAGE_CHARS);
    const raw = { findings: [{ kind: "signal", type: "OTHER", value: "Contact", quote: "hello@northwind.example", page: 1 }] };
    const sig = normalizeResearch(raw, [page], SITE, { retrievedAt: READ_AT, icp: { roles: [] }, knownFactIds: [] }).signals[0];
    expect(sig?.observedAt ?? null).toBeNull();
  });
  it("a statement that names a different year keeps it, rather than taking the article's date", async () => {
    const r = await read("article-jsonld.html", "/blog/linkedin-ads");
    const page = researchPage(r, 1, SIGNALS_PAGE_CHARS);
    const text = page.text.replace("for B2B SaaS teams.", "for B2B SaaS teams since 2019.");
    const p2 = { ...page, text, body: page.body!.replace("for B2B SaaS teams.", "for B2B SaaS teams since 2019.") };
    const raw = { findings: [{ kind: "signal", type: "NEW_SERVICE", value: "LinkedIn Ads", quote: "launch our new LinkedIn Ads practice for B2B SaaS teams since 2019.", page: 1 }] };
    const sig = normalizeResearch(raw, [p2], SITE, { retrievedAt: READ_AT, icp: { roles: [] }, knownFactIds: [] }).signals[0];
    expect(sig).toMatchObject({ observedAt: null, datePrecision: "year", dateYear: 2019, dateSource: "quote" });
  });
  it("readiness is unchanged: an undated page stays blocked, a dated one can qualify", async () => {
    const like = (s: { type: string; observedAt: Date | null; datePrecision: string | null }): FindingLike => ({ id: 1, kind: "signal", type: s.type, value: "x", status: "confirmed", sourceUrl: null, observedAt: s.observedAt, retrievedAt: READ_AT, meta: { datePrecision: s.datePrecision } });
    const person: FindingLike = { id: 2, kind: "decision_maker", type: "Founder", value: "Ana Silva, Founder and CEO", status: "confirmed", sourceUrl: null, observedAt: null, retrievedAt: READ_AT, meta: { name: "Ana Silva", title: "Founder and CEO" } };
    const undated = (await run(DATED_PAGE_CASES.find((c) => c.file === "careers-undated.html")!)).sig;
    const r1 = readiness({ verified: true, fitVerdict: "strong", findings: [like(undated), person], now: READ_AT });
    expect(r1.ready).toBe(false);
    expect(r1.missing).toEqual([MISSING_REASON]);
    const dated = (await run(DATED_PAGE_CASES.find((c) => c.file === "article-jsonld.html")!)).sig;
    expect(readiness({ verified: true, fitVerdict: "strong", findings: [like(dated), person], now: READ_AT })).toMatchObject({ ready: true, timing: "strong" });
  });
  it("records where each date came from and that the page was cut", async () => {
    const long = (await run(DATED_PAGE_CASES.find((c) => c.file === "article-long.html")!)).sig;
    expect(long).toMatchObject({ dateSource: "page_published", datePrecision: "day", pageTruncated: true, dateIssue: null });
    // A statement on the page that carries a future date of its own: kept as a signal, its date not used.
    const r = await read("careers-undated.html", "/careers");
    const page = researchPage(r, 1, SIGNALS_PAGE_CHARS);
    const quote = "We are hiring a Paid Search Manager to lead campaigns for SaaS clients.";
    const p2 = { ...page, text: page.text.replace(quote, `${quote} Starting December 1, 2026.`), body: page.body!.replace(quote, `${quote} Starting December 1, 2026.`) };
    const raw = { findings: [{ kind: "signal", type: "HIRING", value: "Hiring", quote: `${quote} Starting December 1, 2026.`, page: 1 }] };
    expect(normalizeResearch(raw, [p2], SITE, { retrievedAt: READ_AT, icp: { roles: [] }, knownFactIds: [] }).signals[0]).toMatchObject({ observedAt: null, dateIssue: "future" });
  });
  it("the card's date is gone from what the article reader alone keeps (the shape the diagnostic saw)", async () => {
    const r = await read("blog-index-time.html", "/blog");
    expect(r.parts?.body).not.toMatch(/September 14, 2026|August 28, 2026/);
  });
});
