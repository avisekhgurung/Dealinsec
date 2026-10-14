/**
 * The dates a company's HTML page states about itself, read from the whole document BEFORE the article reader and any
 * text limit drop them (shared/page-dates.ts holds the rules and the text layout).
 *
 *   published  the article's or job posting's own publication date, from sources that really mean "this post":
 *                - a specific structured type (JSON-LD BlogPosting, NewsArticle and its kinds, LiveBlogPosting
 *                  datePublished; JobPosting datePosted), on any page but the home page;
 *                - generic markup (JSON-LD Article, article:published_time, microdata, one visible byline) ONLY on a
 *                  blog or news post's own address (/blog/<post>, /news/<post>, /press/<post>...). A CMS stamps generic
 *                  Article markup on every page (careers, results, about): there it is the page's creation date.
 *              The home page and list pages are never one article. A modified date is kept apart. Sources that disagree,
 *              a date in the future, or only generic markup on an ordinary page give no publication date at all.
 *   items      a list's dated entries (blog index, news cards): each entry's own title with its own date.
 *   regions    for every date shown on the page, the part of the page it belongs to: the largest block around it (its card,
 *              its paragraph) that holds no other date, inside the page's chrome and no bigger than 1,500 characters. A
 *              date supports only a statement inside its own region (shared/prospect-intel.ts).
 *
 * Bounded and defensive: at most 10 JSON-LD scripts of 100 kB, 400 candidate elements, 25 entries. Never throws.
 */
import { calendarDate, dateOrderFromLang, isFuture, isoDay, type CalendarDate, type DateOrder, type PageDate, type PageDates } from "@shared/page-dates";
import { evidenceDate } from "@shared/prospect";
import { findDates } from "@shared/research-diagnostics";

/** Types that by themselves say "a post": their publication date is the post's. */
const POST_TYPES = new Set(["blogposting", "newsarticle", "liveblogposting", "analysisnewsarticle", "opinionnewsarticle", "reportagenewsarticle", "backgroundnewsarticle", "reviewnewsarticle", "askpublicnewsarticle"]);
/** Generic types a CMS puts on any page: their date counts only on a post's own address. */
const GENERIC_TYPES = new Set(["article", "report", "techarticle", "scholarlyarticle", "socialmediaposting", "creativework"]);
/** A blog or news post's own address: a post under a blog/news section, not the section's index, a page of it, or a tag/category/author listing. */
const POST_PATH = /\/(?:blog|blogs|insights|articles?|posts?|thought-leadership|news|newsroom|press|press-releases|media|announcements?|updates?|stories)\/(?!(?:page|category|categories|tag|tags|author|authors|topic|topics|archive)(?:\/|$))[^?#\s]+/i;
export const isPostPath = (path: string) => POST_PATH.test(path.replace(/\/+$/, ""));
/**
 * Places whose dates belong to something else: the page's navigation and footer, sidebars, related or recent posts,
 * events, comments. A card's own footer or header ("card-footer", "entry-header") is part of the card, not elsewhere.
 */
const ELSEWHERE_PART = /related|sidebar|widget|comment|event|calendar|webinar|newsletter|cookie|breadcrumb|share|recent-posts|popular-posts|archive/i;
const PAGE_CHROME = /^(?:(?:site|page|global|main|primary|top|bottom)[-_])?(?:nav|navbar|navigation|menu|footer|header)$/i;
// Page builders wrap everything in their own classes ("elementor-widget-posts"): those name the builder's block, not a sidebar.
const BUILDER = /^(elementor|wp-block|et_pb|vc_|fl-|brxe|sqs-|w-dyn)/i;
const isElsewhereClass = (cls: string) => cls.split(/\s+/).some((t) => t && ((ELSEWHERE_PART.test(t) && !(BUILDER.test(t) && !/related|sidebar|comment/i.test(t))) || PAGE_CHROME.test(t)));
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

function jsonLdDates(document: Document): { published: CalendarDate[]; generic: CalendarDate[]; modified: CalendarDate[] } {
  const published: CalendarDate[] = [], generic: CalendarDate[] = [], modified: CalendarDate[] = [];
  const walk = (node: unknown, depth: number) => {
    if (depth > 6 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.slice(0, 50).forEach((n) => walk(n, depth + 1)); return; }
    const o = node as Record<string, unknown>;
    const types = (Array.isArray(o["@type"]) ? o["@type"] : [o["@type"]]).map((t) => String(t ?? "").toLowerCase());
    if (types.some((t) => POST_TYPES.has(t))) { const d = calendarDate(o.datePublished); if (d) published.push(d); const m = calendarDate(o.dateModified); if (m) modified.push(m); }
    else if (types.some((t) => GENERIC_TYPES.has(t))) { const d = calendarDate(o.datePublished); if (d) generic.push(d); const m = calendarDate(o.dateModified); if (m) modified.push(m); }
    if (types.includes("jobposting")) { const d = calendarDate(o.datePosted); if (d) published.push(d); }
    if (o["@graph"]) walk(o["@graph"], depth + 1);
  };
  for (const s of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 10)) {
    const raw = String(s.textContent ?? "");
    if (raw.length > 100_000) continue;
    try { walk(JSON.parse(raw), 0); } catch { /* malformed structured data is ignored, never guessed at */ }
  }
  return { published, generic, modified };
}

const sameDay = (a: CalendarDate, b: CalendarDate) => isoDay(a) === isoDay(b);
const distinct = (xs: CalendarDate[]) => xs.filter((x, i) => xs.findIndex((y) => sameDay(x, y)) === i);
/** Two statements of the same date: the same day, or a month and a day inside it. */
const agree = (a: CalendarDate, b: CalendarDate) => sameDay(a, b) || ((a.precision === "month" || b.precision === "month") && a.y === b.y && a.m === b.m);

/** The page's dates. `url` is the page's address (the home page is never an article); `now` is when it was read. */
export function readPageDates(document: Document, url: string, now: Date): PageDates {
  const out: PageDates = { lang: null, order: null, published: null, modified: null, discarded: [], items: [], regions: [] };
  try {
    out.lang = clean(document.documentElement?.getAttribute("lang")) || clean(document.querySelector('meta[http-equiv="content-language"], meta[http-equiv="Content-Language"]')?.getAttribute("content")) || null;
    out.order = dateOrderFromLang(out.lang);
    let path = "/"; try { path = new URL(url).pathname; } catch { /* keep "/" */ }
    const home = path === "/" || path === "";
    const post = !home && isPostPath(path);

    // 1. Machine-readable dates. A specific post type counts anywhere but the home page; generic markup only on a post's address.
    const ld = jsonLdDates(document);
    const sources: { d: CalendarDate; source: PageDate["source"] }[] = ld.published.map((d) => ({ d, source: "json_ld" as const }));
    const genericSeen: CalendarDate[] = [...ld.generic];
    const generic = (d: CalendarDate, source: PageDate["source"]) => { genericSeen.push(d); if (post) sources.push({ d, source }); };
    if (post) for (const d of ld.generic) sources.push({ d, source: "json_ld" });
    const ogType = clean(document.querySelector('meta[property="og:type"]')?.getAttribute("content")).toLowerCase();
    if (!ogType || ogType === "article") {
      for (const m of Array.from(document.querySelectorAll('meta[property="article:published_time"], meta[name="article:published_time"], meta[name="parsely-pub-date"]'))) {
        const d = calendarDate(m.getAttribute("content")); if (d) generic(d, "meta");
      }
    }
    for (const el of Array.from(document.querySelectorAll('[itemprop="datePublished"]')).slice(0, 20)) {
      if (elsewhere(el)) continue;
      const d = elementDate(el, out.order, now); if (d) generic(d, "microdata");
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

    // 4. A visible byline date: exactly one distinct date in the article area (not in a list entry or elsewhere), on a post's address.
    if (!home && !isList) {
      const byline = distinct(dated.filter(({ el }) => !elsewhere(el)).map((x) => x.d));
      if (byline.length === 1) generic(byline[0], "byline");
      else if (byline.length > 1 && post) out.discarded.push("ambiguous");
    }
    // Generic markup on an ordinary page (careers, results, about...): the page's creation date, not a publication date.
    if (!post && !home && genericSeen.length && !sources.length) out.discarded.push("not_article");

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
    // 6. Where each date shown on the page belongs.
    out.regions = dateRegions(document, out.order, now);
  } catch { /* a page we can't read dates from simply has none */ }
  return out;
}

const CHROME_TAGS = new Set(["NAV", "FOOTER", "ASIDE", "HEADER", "FORM"]);
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "HEAD", "TITLE"]);
const REGION_MAX = 1500;
export interface DateRegion { leaf: string; text: string; multi: boolean }

/**
 * Every date shown on the page (day or month, as the date reader reads it, update stamps excluded) and the region it belongs
 * to. The region grows from the element that shows the date, a level at a time, while the block stays under REGION_MAX
 * characters, holds no OTHER date, and stays on its side of the page's chrome: a date in a footer, a sidebar or navigation
 * keeps its region inside it, and a date in the content never grows into them. A card's date thus covers its own card and
 * stops before the next card's date. An element that itself shows two different dates is ambiguous (`multi`).
 */
function dateRegions(document: Document, order: DateOrder | null, now: Date): DateRegion[] {
  const body = document.body;
  if (!body) return [];
  const keyOf = (d: { precision: string; date: Date }) => `${d.precision}:${d.date.toISOString().slice(0, 10)}`;
  // Where each date is shown: the element whose own text holds it (every date in it), or a short element whose text, split
  // over child tags ("<b>Sep</b> 14, 2026"), reads as one.
  const shown = new Map<Element, Map<string, string>>(); // element -> date key -> the date as written
  const add = (el: Element, key: string, written: string) => { const m = shown.get(el) ?? new Map(); if (!m.has(key)) m.set(key, written); shown.set(el, m); };
  const els = Array.from(body.querySelectorAll("*")).slice(0, 10_000).filter((el) => !SKIP_TAGS.has(el.tagName));
  // 1. Dates in an element's own text.
  for (const el of els) {
    if (shown.size >= 300) break;
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
    if (own.length >= 4) for (const d of findDates(own, now, order)) if (d.precision !== "year") add(el, keyOf(d), own.slice(d.at, d.end));
  }
  // 2. A date split over child tags: the SMALLEST short element that reads as one date, when no element inside it shows it.
  for (const el of els) {
    if (shown.size >= 300) break;
    const text = clean(el.textContent);
    if (!text || text.length > 160 || shown.get(el)?.size) continue;
    const d = findDates(text, now, order).filter((x) => x.precision !== "year");
    if (d.length !== 1) continue;
    const key = keyOf(d[0]);
    const inner = Array.from(el.querySelectorAll("*")).some((c) => shown.get(c)?.has(key) || findDates(clean(c.textContent), now, order).some((x) => keyOf(x) === key));
    if (!inner) add(el, key, text.slice(d[0].at, d[0].end));
  }
  // An edit stamp whose label sits in another element ("<span>Updated:</span> <time>…</time>") dates nothing: read each date
  // with the words before it in its parent, as validation reads a quote.
  const stamped = (el: Element, written: string) => {
    const ctx = clean(el.parentElement?.textContent), i = ctx.indexOf(written);
    // (a space between: the page's text may run words together, "clientsSep 3, 2026", which would hide the date itself)
    return i > 0 && !evidenceDate(`${ctx.slice(Math.max(0, i - 30), i).replace(/\d/g, " ")} ${written}`, now, { order });
  };
  const leaves = Array.from(shown.entries()).flatMap(([el, m]) => Array.from(m.entries()).filter(([, written]) => !stamped(el, written)).map(([key, written]) => ({ el, key, written, multi: m.size > 1 })));
  const chromeOf = (el: Element): Element | null => {
    for (let a: Element | null = el; a && a !== body; a = a.parentElement) if (CHROME_TAGS.has(a.tagName) || isElsewhereClass(classOf(a))) return a;
    return null;
  };
  const out: DateRegion[] = [];
  for (const leaf of leaves.slice(0, 300)) {
    const fence = chromeOf(leaf.el);
    let region: Element = leaf.el;
    if (!leaf.multi) {
      for (let a = leaf.el.parentElement, n = 0; a && n < 12 && a !== body && a.tagName !== "MAIN" && a.tagName !== "HTML"; a = a.parentElement, n++) {
        if (fence && !fence.contains(a)) break; // never leave the date's own chrome
        if (!fence && chromeOf(a)) break; // and never grow into chrome from the page's own content
        if (clean(a.textContent).length > REGION_MAX) break;
        if (leaves.some((o) => o.key !== leaf.key && a!.contains(o.el))) break; // another date: that part is its own
        region = a;
      }
    }
    out.push({ leaf: leaf.written, text: clean(region.textContent).slice(0, REGION_MAX * 2), multi: leaf.multi });
  }
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
    return { lang: null, order: null, published: null, modified: null, discarded: [], items: [], regions: [] };
  }
}
