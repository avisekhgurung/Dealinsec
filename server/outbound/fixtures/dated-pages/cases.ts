/**
 * Deterministic cases for evidence dating (server/outbound/page-dates.test.ts). Each case is one synthetic page shaped
 * like a failure seen in the bounded diagnostic of Oct 2026 (no real company, page or person), the statement a model
 * would quote from it, the date words it would give (date_quote, exactly as the page shows them, or null), and what the
 * validated signal must end up with: a day ("YYYY-MM-DD") or null (undated, so readiness stays blocked).
 */
export interface DatedPageCase {
  name: string; file: string; path: string; type: string; quote: string; dateQuote: string | null;
  expect: { observed: string | null; source: "quote" | "date_quote" | "page_published" | null };
  /** What the diagnostic saw on pages of this shape. */
  shape: string;
}

export const READ_AT = new Date("2026-10-13T12:00:00Z");

export const DATED_PAGE_CASES: DatedPageCase[] = [
  { name: "blog index: card date dropped by the reader", file: "blog-index-time.html", path: "/blog", type: "NEW_SERVICE", quote: "Northwind launches a LinkedIn Ads practice for SaaS", dateQuote: "September 14, 2026", expect: { observed: "2026-09-14", source: "date_quote" }, shape: "dates in <time> elements dropped by the reader" },
  { name: "blog index: second card", file: "blog-index-time.html", path: "/blog", type: "HIRING", quote: "We are hiring a Senior SEO Strategist", dateQuote: "August 28, 2026", expect: { observed: "2026-08-28", source: "date_quote" }, shape: "dates in <time> elements dropped by the reader" },
  { name: "blog index: another card's date", file: "blog-index-time.html", path: "/blog", type: "EXPANSION", quote: "Northwind opens a second office in Denver", dateQuote: "September 14, 2026", expect: { observed: null, source: null }, shape: "a date that belongs to a different entry" },
  { name: "news index: date spans", file: "blog-index-spans.html", path: "/news", type: "PARTNERSHIP", quote: "Northwind partners with a CRM platform for B2B clients", dateQuote: "Sep 3, 2026", expect: { observed: "2026-09-03", source: "date_quote" }, shape: "card dates kept in the text, cards close together" },
  { name: "news index (dates kept in the text): another entry's date", file: "blog-index-spans.html", path: "/news", type: "EXPANSION", quote: "Northwind expands its paid media team", dateQuote: "Aug 12, 2026", expect: { observed: null, source: null }, shape: "a neighbouring card's date within 400 characters" },
  { name: "article: structured data only", file: "article-jsonld.html", path: "/blog/linkedin-ads", type: "NEW_SERVICE", quote: "We are excited to launch our new LinkedIn Ads practice for B2B SaaS teams.", dateQuote: null, expect: { observed: "2026-09-22", source: "page_published" }, shape: "publication date only in structured data" },
  { name: "article: visible byline", file: "article-byline.html", path: "/blog/growing-seo-team", type: "HIRING", quote: "We are hiring a Senior SEO Strategist to join our SaaS team in Austin.", dateQuote: null, expect: { observed: "2026-09-30", source: "page_published" }, shape: "byline date dropped by the reader; related posts in a sidebar" },
  { name: "article: date past the text limit", file: "article-long.html", path: "/blog/uk-expansion", type: "EXPANSION", quote: "Northwind Digital is expanding into the UK market with a new London team.", dateQuote: null, expect: { observed: "2026-10-02", source: "page_published" }, shape: "the article's date cut off by the 8,000-character limit" },
  { name: "numeric date, en-US page", file: "numeric-us.html", path: "/press/partner-program", type: "PARTNERSHIP", quote: "Northwind Digital has joined a SaaS partner program for agencies.", dateQuote: "09/12/2026", expect: { observed: "2026-09-12", source: "date_quote" }, shape: "numeric date the validator rejected" },
  { name: "numeric date, page language unknown", file: "numeric-ambiguous.html", path: "/press/partner-program", type: "PARTNERSHIP", quote: "Northwind Digital has joined a SaaS partner program for agencies.", dateQuote: "09/12/2026", expect: { observed: null, source: null }, shape: "09/12/2026 with no way to tell 12 Sep from 9 Dec" },
  { name: "dotted date, en-GB page", file: "numeric-dotted.html", path: "/press/berlin", type: "NEW_LOCATION", quote: "Northwind Digital has opened a new office in Berlin for European clients.", dateQuote: "12.09.2026", expect: { observed: "2026-09-12", source: "date_quote" }, shape: "numeric date the validator rejected" },
  { name: "careers page with no date", file: "careers-undated.html", path: "/careers", type: "HIRING", quote: "We are hiring a Paid Search Manager to lead campaigns for SaaS clients.", dateQuote: "© 2026", expect: { observed: null, source: null }, shape: "genuinely undated; only the footer's year" },
  { name: "update stamp, comments, events", file: "misleading-dates.html", path: "/blog/austin-office", type: "NEW_LOCATION", quote: "We opened a new office in Austin for our growing team.", dateQuote: "Updated: October 1, 2026", expect: { observed: null, source: null }, shape: "dates elsewhere on the page that date something else" },
  { name: "events widget date", file: "misleading-dates.html", path: "/blog/austin-office", type: "NEW_LOCATION", quote: "We opened a new office in Austin for our growing team.", dateQuote: "Webinar on October 30, 2026", expect: { observed: null, source: null }, shape: "a future event in a sidebar" },
  { name: "markup and byline disagree", file: "conflict.html", path: "/news/funding", type: "FUNDING", quote: "Northwind Digital has raised growth funding to expand its services.", dateQuote: null, expect: { observed: null, source: null }, shape: "two publication dates that contradict each other" },
  { name: "publication date in the future", file: "future.html", path: "/blog/analytics", type: "NEW_SERVICE", quote: "Northwind Digital launches a new analytics service for SaaS brands.", dateQuote: null, expect: { observed: null, source: null }, shape: "a date after the page was read" },
  { name: "home page with article metadata", file: "home-with-meta.html", path: "/", type: "NEW_SERVICE", quote: "Northwind Digital launched a new website for SaaS founders.", dateQuote: null, expect: { observed: null, source: null }, shape: "a home page is never one article" },
  { name: "impossible dates", file: "malformed.html", path: "/blog/cro", type: "NEW_SERVICE", quote: "Northwind Digital adds a conversion optimisation service for SaaS teams.", dateQuote: "31/02/2026", expect: { observed: null, source: null }, shape: "31/02/2026 and a structured date of 2026-13-45" },
  { name: "time zone boundary", file: "timezone.html", path: "/news/head-of-growth", type: "NEW_LEADERSHIP", quote: "Northwind Digital has appointed a new Head of Growth to lead client strategy.", dateQuote: null, expect: { observed: "2026-09-30", source: "page_published" }, shape: "23:30 on 30 Sep in UTC-7 is 1 Oct in UTC" },
];
