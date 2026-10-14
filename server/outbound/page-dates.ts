/**
 * The dates a company's HTML page states about itself, read from the whole document BEFORE the article reader and any
 * text limit drop them (shared/page-dates.ts holds the rules and the text layout).
 *
 *   published  the article's or job posting's own publication date: structured data (JSON-LD Article/BlogPosting/
 *              NewsArticle/... datePublished, JobPosting datePosted), article:published_time, microdata
 *              itemprop=datePublished, or exactly ONE visible byline date. The home page is never an article. A modified
 *              date is kept apart. Sources that disagree, or a date in the future, give no publication date at all.
 *   items      a list's dated entries (blog index, news cards): each entry's own title with its own date.
 *
 * Bounded and defensive: at most 10 JSON-LD scripts of 100 kB, 400 candidate elements, 25 entries. Never throws.
 */
import { calendarDate, dateOrderFromLang, isFuture, isoDay, type CalendarDate, type DateOrder, type PageDate, type PageDates } from "@shared/page-dates";
import { evidenceDate } from "@shared/prospect";

const ARTICLE_TYPES = new Set(["article", "blogposting", "newsarticle", "report", "techarticle", "scholarlyarticle", "socialmediaposting", "liveblogposting", "analysisnewsarticle", "opinionnewsarticle", "reportagenewsarticle", "backgroundnewsarticle", "pressrelease"]);
/**
 * Places whose dates belong to something else: the page's navigation and footer, sidebars, related or recent posts,
 * events, comments. A card's own footer or header ("card-footer", "entry-header") is part of the card, not elsewhere.
 */
const ELSEWHERE_PART = /related|sidebar|widget|comment|event|calendar|webinar|newsletter|cookie|breadcrumb|share|recent-posts|popular-posts|archive/i;
const PAGE_CHROME = /^(?:(?:site|page|global|main|primary|top|bottom)[-_])?(?:nav|navbar|navigation|menu|footer|header)$/i;
const isElsewhereClass = (cls: string) => cls.split(/\s+/).some((t) => t && (ELSEWHERE_PART.test(t) || PAGE_CHROME.test(t)));
const DATEISH = /(^|[\s_-])(date|dates|time|posted|published|pubdate|post-date|entry-date|byline|post-meta|entry-meta|article-meta|meta)([\s_-]|$)/i;
const CARD = /(^|[\s_-])(card|post|item|entry|teaser|tile|article|story|news)s?([\s_-]|$)/i;

const clean = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();
const classOf = (el: Element) => `${el.getAttribute("class") ?? ""} ${el.getAttribute("id") ?? ""}`;
function inside(el: Element, test: (a: Element) => boolean, levels = 12): boolean {
  for (let a = el.parentElement, n = 0; a && n < levels; a = a.parentElement, n++) if (test(a)) return true;
  return false;
}
const elsewhere = (el: Element) => inside(el, (a) => ["NAV", "FOOTER", "ASIDE", "FORM"].includes(a.tagName) || isElsewhereClass(classOf(a)));

/** The date an element states: its datetime/content attribute (exact), else its visible text read as evidenceDate reads it (update stamps excluded). */
function elementDate(el: Element, order: DateOrder | null, now: Date): CalendarDate | null {
  const attr = el.getAttribute("datetime") ?? el.getAttribute("content");
  const fromAttr = calendarDate(attr);
  if (fromAttr) return fromAttr;
  const text = clean(el.textContent);
  if (!text || text.length > 100) return null;
  const d = evidenceDate(text, now, { order });
  // A relative date ("3 days ago") counts from the moment of reading: never a publication date from markup.
  if (!d || d.precision === "year" || /\bago\b|today|yesterday/i.test(text)) return null;
  return { y: d.at.getUTCFullYear(), m: d.at.getUTCMonth() + 1, d: d.at.getUTCDate(), precision: d.precision, at: d.at };
}

function jsonLdDates(document: Document): { published: CalendarDate[]; modified: CalendarDate[] } {
  const published: CalendarDate[] = [], modified: CalendarDate[] = [];
  const walk = (node: unknown, depth: number) => {
    if (depth > 6 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.slice(0, 50).forEach((n) => walk(n, depth + 1)); return; }
    const o = node as Record<string, unknown>;
    const types = (Array.isArray(o["@type"]) ? o["@type"] : [o["@type"]]).map((t) => String(t ?? "").toLowerCase());
    if (types.some((t) => ARTICLE_TYPES.has(t))) { const d = calendarDate(o.datePublished); if (d) published.push(d); const m = calendarDate(o.dateModified); if (m) modified.push(m); }
    if (types.includes("jobposting")) { const d = calendarDate(o.datePosted); if (d) published.push(d); }
    if (o["@graph"]) walk(o["@graph"], depth + 1);
  };
  for (const s of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 10)) {
    const raw = String(s.textContent ?? "");
    if (raw.length > 100_000) continue;
    try { walk(JSON.parse(raw), 0); } catch { /* malformed structured data is ignored, never guessed at */ }
  }
  return { published, modified };
}

const sameDay = (a: CalendarDate, b: CalendarDate) => isoDay(a) === isoDay(b);
const distinct = (xs: CalendarDate[]) => xs.filter((x, i) => xs.findIndex((y) => sameDay(x, y)) === i);
/** Two statements of the same date: the same day, or a month and a day inside it. */
const agree = (a: CalendarDate, b: CalendarDate) => sameDay(a, b) || ((a.precision === "month" || b.precision === "month") && a.y === b.y && a.m === b.m);

/** The page's dates. `url` is the page's address (the home page is never an article); `now` is when it was read. */
export function readPageDates(document: Document, url: string, now: Date): PageDates {
  const out: PageDates = { lang: null, order: null, published: null, modified: null, discarded: [], items: [] };
  try {
    out.lang = clean(document.documentElement?.getAttribute("lang")) || clean(document.querySelector('meta[http-equiv="content-language"], meta[http-equiv="Content-Language"]')?.getAttribute("content")) || null;
    out.order = dateOrderFromLang(out.lang);
    let path = "/"; try { path = new URL(url).pathname; } catch { /* keep "/" */ }
    const home = path === "/" || path === "";

    // 1. Machine-readable dates.
    const ld = jsonLdDates(document);
    const sources: { d: CalendarDate; source: PageDate["source"] }[] = ld.published.map((d) => ({ d, source: "json_ld" as const }));
    const ogType = clean(document.querySelector('meta[property="og:type"]')?.getAttribute("content")).toLowerCase();
    if (!ogType || ogType === "article") {
      for (const m of Array.from(document.querySelectorAll('meta[property="article:published_time"], meta[name="article:published_time"], meta[name="parsely-pub-date"]'))) {
        const d = calendarDate(m.getAttribute("content")); if (d) sources.push({ d, source: "meta" });
      }
    }
    for (const el of Array.from(document.querySelectorAll('[itemprop="datePublished"]')).slice(0, 20)) {
      if (elsewhere(el)) continue;
      const d = elementDate(el, out.order, now); if (d) sources.push({ d, source: "microdata" });
    }
    const modified = [...ld.modified, ...Array.from(document.querySelectorAll('meta[property="article:modified_time"]')).map((m) => calendarDate(m.getAttribute("content"))).filter((x): x is CalendarDate => !!x)];
    out.modified = modified.length ? isoDay(modified[0]) : null;

    // 2. Visible dates: time elements and date-classed elements, outside navigation, footers, sidebars and other lists.
    const candidates = Array.from(document.querySelectorAll("time, [class], [id]")).filter((el) => el.tagName === "TIME" || DATEISH.test(classOf(el))).slice(0, 400);
    const dated = candidates.map((el) => ({ el, d: elementDate(el, out.order, now) })).filter((x): x is { el: Element; d: CalendarDate } => !!x.d)
      // a date-classed wrapper around a <time> is the same date once
      .filter((x, _i, all) => !all.some((y) => y !== x && x.el.contains(y.el)));

    // 3. Dated entries: a date inside a card or list item that has its own title.
    const seen = new Set<string>();
    let ownEntries = 0;
    const pageTitle = clean(document.querySelector("h1")?.textContent).toLowerCase();
    const titleOf = (card: Element) => clean((card.querySelector("h1, h2, h3, h4, h5") ?? Array.from(card.querySelectorAll("a")).find((a) => clean(a.textContent).length >= 12) ?? null)?.textContent).slice(0, 160);
    for (const { el, d } of dated) {
      if (out.items.length >= 25 || isFuture(d.at, now)) continue;
      // The nearest card or list item around the date that has a title of its own (a card's footer has none: go up).
      let card: Element | null = null;
      for (let a = el.parentElement, n = 0; a && n < 6 && a.tagName !== "BODY" && a.tagName !== "MAIN"; a = a.parentElement, n++) {
        if ((a.tagName === "ARTICLE" || a.tagName === "LI" || CARD.test(classOf(a))) && titleOf(a).length >= 6) { card = a; break; }
      }
      if (!card || clean(card.textContent).length > 1200) continue;
      const title = titleOf(card);
      // The article's own byline is the article, not an entry of a list.
      if (title.toLowerCase() === pageTitle && !elsewhere(el)) continue;
      if (seen.has(title.toLowerCase())) continue;
      seen.add(title.toLowerCase());
      if (!elsewhere(el)) ownEntries++;
      const written = clean(el.textContent);
      out.items.push({ title, date: written && evidenceDate(written, now, { order: out.order }) ? written.slice(0, 40) : isoDay(d) });
    }
    // A page that lists several dated entries of its own is a list, not one article: its entries carry their own dates.
    // (Related or recent posts in a sidebar are entries too, but they don't make an article a list.)
    const isList = ownEntries >= 2;
    out.list = isList;

    // 4. A visible byline date: exactly one distinct date in the article area (not in a list entry or elsewhere).
    if (!home && !isList) {
      const byline = distinct(dated.filter(({ el }) => !elsewhere(el)).map((x) => x.d));
      if (byline.length === 1) sources.push({ d: byline[0], source: "byline" });
      else if (byline.length > 1) out.discarded.push("ambiguous");
    }

    // 5. One publication date, or none: sources must agree (to the day), the page must be an article, and it can't be in the future.
    if (!home && !isList && sources.length) {
      const all = sources.map((s) => s.d);
      if (all.some((a) => all.some((b) => !agree(a, b)))) out.discarded.push("conflict");
      else if (all.some((d) => isFuture(d.at, now))) out.discarded.push("future");
      else {
        // The most exact statement: a day before a month; markup before the byline.
        const best = [...sources].sort((a, b) => Number(a.d.precision === "month") - Number(b.d.precision === "month") || Number(a.source === "byline") - Number(b.source === "byline"))[0];
        out.published = { date: isoDay(best.d), at: best.d.at.toISOString(), precision: best.d.precision, source: best.source };
      }
    }
  } catch { /* a page we can't read dates from simply has none */ }
  return out;
}

/** The dates of an HTML page from its bytes (parsed once more: the article reader removes the scripts and markup they live in). */
export async function pageDatesFromHtml(bytes: Uint8Array, url: string, now: Date): Promise<PageDates> {
  try {
    const { parseHTML } = await import("linkedom");
    const source = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const { document } = parseHTML(/<html[\s>]/i.test(source) ? source : `<!doctype html><html><body>${source}</body></html>`);
    return readPageDates(document as unknown as Document, url, now);
  } catch {
    return { lang: null, order: null, published: null, modified: null, discarded: [], items: [] };
  }
}
