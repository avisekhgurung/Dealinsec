import { describe, expect, it } from "vitest";
import { normalizeResearch } from "./prospect-intel";
import { findDates, pageKind, researchDateDiagnostics } from "./research-diagnostics";
import type { ResearchPage } from "./research";

const NOW = new Date("2026-10-12T00:00:00Z");
const icp = { roles: ["Founder"] };
const filler = "We help B2B SaaS companies grow pipeline with content, paid media and SEO programs built around revenue. ";
const page = (index: number, path: string, text: string): ResearchPage => ({ index, url: `https://northwind.com${path}`, text });
const signal = (quote: string, pageNo: number, extra: Record<string, unknown> = {}) => ({ kind: "signal", type: "CONTENT_ACTIVITY", value: "Published a post", quote, page: pageNo, ...extra });
/** The real validator first (what a run keeps), then the diagnostics on the same input. */
function run(findings: unknown[], pages: ResearchPage[]) {
  const raw = { findings, opportunities: [] };
  const result = normalizeResearch(raw, pages, "northwind.com", { retrievedAt: NOW, icp, knownFactIds: [] });
  return { result, d: researchDateDiagnostics(raw, pages, result, NOW) };
}

describe("research date diagnostics: why a signal is or isn't dated", () => {
  const BLOG = page(2, "/blog", `Blog. ${filler.repeat(3)} ChatGPT Ads Management: What B2B Marketers Need to Know. Sep 12, 2026 · 5 min read. A short excerpt for SaaS teams. ${filler}`);
  it("a visible date beside a post title, quoted by the model: dated, with the date a few characters away", () => {
    const { result, d } = run([signal("ChatGPT Ads Management: What B2B Marketers Need to Know", 2, { date_quote: "Sep 12, 2026" })], [page(1, "/", filler), BLOG]);
    expect(result.signals[0]).toMatchObject({ datePrecision: "day" });
    expect(d.signals[0]).toMatchObject({ kept: true, pageKind: "blog", quoteOnPage: true, dateQuote: "given", dateQuoteOnPage: true, dateQuoteBeside: true, dateQuoteDate: "day", contradictory: false, keptPrecision: "day", outcome: "dated" });
    expect(d.signals[0].nearestDate).toEqual({ chars: 0, precision: "day" }); // ". " between them: rounded to the nearest 10
    expect(d.summary).toMatchObject({ signals: 1, kept: 1, dated: 1, pagesWithDayOrMonthDate: 1 });
  });
  it("a date in the surrounding text that the model did not quote: kept undated, and the diagnostic says a date was right there", () => {
    const { result, d } = run([signal("ChatGPT Ads Management: What B2B Marketers Need to Know", 2)], [BLOG]);
    expect(result.signals[0].observedAt).toBeNull(); // validation is unchanged: no date_quote, no date
    expect(d.signals[0]).toMatchObject({ dateQuote: "absent", dateQuoteOnPage: null, quoteDate: "none", keptPrecision: "none", outcome: "date_nearby_not_quoted", datesInWindow: 1 });
    expect(d.signals[0].nearestDate?.precision).toBe("day");
  });
  it("a year alone: kept with its year, never as a date", () => {
    const { result, d } = run([signal("Top SaaS marketing agencies in 2026", 1)], [page(1, "/blog/top-agencies", `${filler} Top SaaS marketing agencies in 2026 and how to pick one. ${filler}`)]);
    expect(result.signals[0]).toMatchObject({ datePrecision: "year", observedAt: null });
    expect(d.signals[0]).toMatchObject({ quoteDate: "year", keptPrecision: "year", outcome: "year_only", nearestDate: null });
    expect(d.pages[0]).toMatchObject({ dayOrMonthDates: 0, yearOnlyDates: 1 });
  });
  it("no date anywhere on the page: no date nearby, and the page has none either", () => {
    const { d } = run([signal("Strategic Marketing Operations Explained", 1)], [page(1, "/blog", `${filler} Strategic Marketing Operations Explained. ${filler}`)]);
    expect(d.signals[0]).toMatchObject({ outcome: "no_date_nearby", nearestDate: null, datesInWindow: 0 });
    expect(d.summary.pagesWithDayOrMonthDate).toBe(0);
  });
  it("a date far from the claim (another post's): not 'nearby', but its distance is recorded", () => {
    const far = page(1, "/blog", `Posted March 3, 2026. ${filler.repeat(6)} Strategic Marketing Operations Explained. ${filler}`);
    const { d } = run([signal("Strategic Marketing Operations Explained", 1)], [far]);
    expect(d.signals[0].outcome).toBe("no_date_nearby");
    expect(d.signals[0].nearestDate!.chars).toBeGreaterThan(d.window);
  });
  it("a date_quote that is not a date, is not on the page, or is not beside the claim: recorded as given but not used", () => {
    const pages = [page(1, "/blog", `Posted March 3, 2026. ${filler.repeat(6)} Strategic Marketing Operations Explained. ${filler}`)];
    const notADate = run([signal("Strategic Marketing Operations Explained", 1, { date_quote: "sometime soon" })], pages).d.signals[0];
    expect(notADate).toMatchObject({ dateQuote: "given", dateQuoteDate: "none", dateQuoteOnPage: false, outcome: "date_quote_not_used" });
    const invented = run([signal("Strategic Marketing Operations Explained", 1, { date_quote: "Posted October 1, 2026" })], pages).d.signals[0];
    expect(invented).toMatchObject({ dateQuoteDate: "day", dateQuoteOnPage: false, dateQuoteBeside: false, outcome: "date_quote_not_used" });
    const tooFar = run([signal("Strategic Marketing Operations Explained", 1, { date_quote: "Posted March 3, 2026" })], pages);
    expect(tooFar.result.signals[0].observedAt).toBeNull();
    expect(tooFar.d.signals[0]).toMatchObject({ dateQuoteOnPage: true, dateQuoteBeside: false, outcome: "date_quote_not_used" });
  });
  it("contradictory evidence is flagged: the claim's own month and the date_quote disagree, or the date_quote is in the future", () => {
    const text = `${filler} In March 2026 we launched our PPC practice for SaaS brands. Posted September 30, 2026. Next event: Posted November 30, 2026. ${filler}`;
    const disagree = run([{ ...signal("In March 2026 we launched our PPC practice for SaaS brands", 1, { date_quote: "Posted September 30, 2026" }), type: "NEW_SERVICE" }], [page(1, "/news", text)]).d.signals[0];
    expect(disagree.contradictory).toBe(true);
    const future = run([signal("In March 2026 we launched our PPC practice for SaaS brands", 1, { date_quote: "Posted November 30, 2026" })], [page(1, "/news", text)]).d.signals[0];
    expect(future.contradictory).toBe(true);
    const fine = run([signal("Strategic Marketing Operations Explained", 1, { date_quote: "Sep 12, 2026" })], [page(1, "/blog", `Strategic Marketing Operations Explained. Sep 12, 2026. ${filler}`)]).d.signals[0];
    expect(fine.contradictory).toBe(false);
  });
  it("an update stamp is not a date (the same rule as validation), and a rejected signal is recorded as rejected", () => {
    expect(findDates("Updated: September 12, 2026", NOW)).toEqual([]);
    expect(findDates("Published September 12, 2026 · Updated October 1, 2026", NOW).map((x) => x.precision)).toEqual(["day"]);
    const { d } = run([signal("A sentence that is not on the page at all", 1)], [page(1, "/", filler)]);
    expect(d.signals[0]).toMatchObject({ kept: false, quoteOnPage: false, outcome: "signal_rejected", nearestDate: null });
  });
  it("privacy and bounds: no page text, quotation, date as written, path, email or phone number; at most 40 signals and 5 pages", () => {
    const text = `Jane Roe, jane.roe@example.com, +1 512 555 0142. ${filler} Our founder Jane Roe launched the Secret Project. Sep 12, 2026. ${filler}`;
    const pages = Array.from({ length: 7 }, (_, i) => page(i + 1, `/blog/jane-roe-post-${i}`, text));
    const findings = Array.from({ length: 50 }, () => signal("Our founder Jane Roe launched the Secret Project", 1, { date_quote: "Sep 12, 2026" }));
    const out = JSON.stringify(run(findings, pages).d);
    for (const bad of ["Jane", "Roe", "@", "555", "0142", "Secret", "Sep 12", "2026", "/blog", "jane-roe", "northwind", "launched"]) expect(out).not.toContain(bad);
    const d = run(findings, pages).d;
    expect(d.signals.length).toBeLessThanOrEqual(40);
    expect(d.pages).toHaveLength(5);
  });
  it("reads without changing: the model output, the pages and the kept result are identical afterwards", () => {
    const findings = [signal("ChatGPT Ads Management: What B2B Marketers Need to Know", 2, { date_quote: "Sep 12, 2026" }), signal("ChatGPT Ads Management: What B2B Marketers Need to Know", 2)];
    const raw = { findings, opportunities: [] }, pages = [page(1, "/", filler), BLOG];
    const result = normalizeResearch(raw, pages, "northwind.com", { retrievedAt: NOW, icp, knownFactIds: [] });
    const before = JSON.stringify({ raw, pages, result });
    researchDateDiagnostics(raw, pages, result, NOW);
    expect(JSON.stringify({ raw, pages, result })).toBe(before);
    expect(() => researchDateDiagnostics("garbage", pages, result, NOW)).not.toThrow();
    expect(researchDateDiagnostics({ findings: [null, 7, { kind: "signal" }] }, pages, { signals: [] }, NOW).signals).toHaveLength(1);
  });
  it("page kinds come from the address alone", () => {
    expect(["/", "/blog/post-1", "/news", "/careers/open-roles", "/case-studies/acme", "/about-us", "/team", "/pricing"].map((p) => pageKind(`https://x.com${p}`))).toEqual(["home", "blog", "news", "careers", "work", "about", "team", "other"]);
  });
});
