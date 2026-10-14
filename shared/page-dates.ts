/**
 * Dates a company's page states about itself, read before any text limit, and how a page's text is put together for a
 * model so that what the model sees is exactly what its quotes are checked against. Pure (no DOM): the reader in
 * server/outbound/page-dates.ts does the HTML side.
 *
 * Rules, all conservative:
 *   - A publication date comes from the page's own markup (an article's or job posting's structured data, its
 *     article:published_time, microdata) or from ONE visible byline date. A modified date is never a publication date.
 *   - A date in the future (beyond FUTURE_TOLERANCE_DAYS, which covers time zones) is not a publication date.
 *   - A numeric date is read only when its order is certain: ISO (2026-09-12), a part above 12 (25/09/2026), or the
 *     page's own language (en-US writes month first). 09/12/2026 on a page that doesn't say is NOT read.
 *   - The retrieval time is never a publication date. Nothing here invents one.
 */

export type DateOrder = "mdy" | "dmy";
export type CalendarPrecision = "day" | "month";
/** A calendar date as the page states it: its own day, not shifted by a time zone ("2026-09-30T23:30-07:00" is 30 Sep). */
export interface CalendarDate { y: number; m: number; d: number; precision: CalendarPrecision; at: Date }
export type PageDateSource = "json_ld" | "meta" | "microdata" | "byline";
export interface PageDate { date: string; at: string; precision: CalendarPrecision; source: PageDateSource }
/** What a page says about its own dates. `published` is null when there is none, or when the page contradicts itself. */
export interface PageDates {
  lang: string | null; order: DateOrder | null;
  published: PageDate | null; modified: string | null;
  /** Why a stated publication date was not used: two sources disagree, or it is in the future. */
  discarded: ("conflict" | "future" | "ambiguous")[];
  /** Dated entries of a list (a blog index, news cards): each entry's own title with its own date, as the page shows it. */
  items: { title: string; date: string }[];
  /** The page lists several dated entries of its own (an index), so it is not one article. */
  list?: boolean;
}

/** A page dated a day or so after the moment it was read is a time zone, not the future. */
export const FUTURE_TOLERANCE_DAYS = 2;
const DAY = 86_400_000;
export const isFuture = (at: Date, retrievedAt: Date) => at.getTime() > retrievedAt.getTime() + FUTURE_TOLERANCE_DAYS * DAY;

const utc = (y: number, m: number, d: number): Date | null => {
  if (y < 1990 || y > 2100 || m < 0 || m > 11 || d < 1 || d > 31) return null;
  const x = new Date(Date.UTC(y, m, d));
  return x.getUTCFullYear() === y && x.getUTCMonth() === m && x.getUTCDate() === d ? x : null;
};

/** The order a page writes numeric dates in, from its language tag: en-US month first; other English and other languages day first; plain "en" unknown. */
export function dateOrderFromLang(lang: string | null | undefined): DateOrder | null {
  const t = String(lang ?? "").trim().toLowerCase().replace("_", "-");
  if (!t) return null;
  const [base, region] = t.split("-");
  if (base === "en") return !region ? null : region === "us" ? "mdy" : ["gb", "uk", "au", "nz", "ie", "in", "za", "sg", "my", "hk", "ng", "ke", "pk"].includes(region) ? "dmy" : null;
  // Languages that write the day first (with any region).
  return ["de", "fr", "es", "it", "nl", "pt", "pl", "sv", "da", "nb", "nn", "no", "fi", "cs", "sk", "ru", "uk", "tr", "el", "ro", "hu", "id", "vi"].includes(base) ? "dmy" : null;
}

/**
 * A numeric day-month-year with a 4-digit year: "25/09/2026", "09/25/2026", "12.09.2026", "2026/09/12". Returns the
 * date, "ambiguous" when the order can't be known safely, or null when it is no valid date (31/02/2026, 13/13/2026).
 * A two-digit year is never read.
 */
export function numericDate(day1: string, sep: string, day2: string, year: string, order: DateOrder | null): Date | "ambiguous" | null {
  const a = +day1, b = +day2, y = +year;
  if (!a || !b) return null;
  // Dotted dates (12.09.2026) are day first wherever they are written, unless the page says it writes month first.
  const o: DateOrder | null = order ?? (sep === "." ? "dmy" : null);
  if (a > 12 && b > 12) return null;
  if (a > 12) return utc(y, b - 1, a); // only day first fits
  if (b > 12) return utc(y, a - 1, b); // only month first fits
  if (a === b) return utc(y, a - 1, b);
  if (!o) return "ambiguous";
  return o === "mdy" ? utc(y, a - 1, b) : utc(y, b - 1, a);
}

/**
 * A machine-readable date from markup (ISO 8601: "2026-09-14", "2026-09-14T23:30:00-07:00", "2026-09"). The calendar date
 * is the one written, whatever the offset: a post published at 23:30 in California on 30 Sep was published on 30 Sep.
 * A bare year is not enough to date anything and is refused.
 */
export function calendarDate(s: unknown): CalendarDate | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (m) { const at = utc(+m[1], +m[2] - 1, +m[3]); return at ? { y: +m[1], m: +m[2], d: +m[3], precision: "day", at } : null; }
  m = t.match(/^(\d{4})-(\d{2})$/);
  if (m) { const at = utc(+m[1], +m[2] - 1, 1); return at ? { y: +m[1], m: +m[2], d: 1, precision: "month", at } : null; }
  return null;
}
export const isoDay = (c: Pick<CalendarDate, "at" | "precision">) => (c.precision === "month" ? c.at.toISOString().slice(0, 7) : c.at.toISOString().slice(0, 10));

/* ── the text a model is given, and what its quotes are checked against ── */

/** Labels of the blocks a reader adds around a page's own text. A date in one block never dates a statement in another. */
export const PAGE_DATES_BLOCK = "[Page dates, from this page's markup]";
export const DATED_ITEMS_BLOCK = "[Dated entries on this page: each date belongs only to the entry on its line]";
export const ITEM_MARK = "[entry]";
export const CUT_MARK = "[The rest of this page's text was not read: text limit]";
/** Every label that starts a block, an entry, or the end of what was read (plus the people and footer blocks of shared/staff.ts and the reader). */
export const BOUNDARY_MARKS = [PAGE_DATES_BLOCK, DATED_ITEMS_BLOCK, ITEM_MARK, CUT_MARK, "[People on this page]", "[People quoted on this page", "[Footer and contact details]"];

export interface PageParts {
  /** The page's own dates, one line (empty when there are none). Always first: no limit can cut it. */
  head: string;
  /** The page's readable text (the article, or the body when there is no article). */
  body: string;
  /** Labelled blocks: people, footer and contact details, dated entries. Kept whole when the body is cut. */
  tail: string[];
}

/**
 * The page's text within `budget` characters: the dates line first, then as much of the body as fits (cut at a sentence
 * or word end, then marked as cut), then the labelled blocks whole. `body` is the body as included, for telling where a
 * quote sits. Nothing past the cut is claimed to have been read.
 */
export function composePageText(parts: PageParts, budget: number): { text: string; body: string; truncated: boolean } {
  const head = parts.head ? `${parts.head}\n\n` : "";
  // Blocks keep their place even on a tight budget, but never take more than half of it.
  let tail = parts.tail.filter(Boolean).join("\n\n");
  if (tail.length > budget / 2) tail = tail.slice(0, Math.floor(budget / 2)).replace(/\s+\S*$/, "");
  const room = Math.max(0, budget - head.length - (tail ? tail.length + 2 : 0));
  let body = parts.body, truncated = false;
  if (body.length > room) {
    truncated = true;
    const cut = body.slice(0, Math.max(0, room - CUT_MARK.length - 2));
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    body = `${end > cut.length * 0.6 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "")} ${CUT_MARK}`;
  }
  return { text: `${head}${body}${tail ? `\n\n${tail}` : ""}`, body, truncated };
}

/** The dates line: the publication date as ISO (which the date reader reads exactly), and where it came from. */
export function pageDatesLine(d: Pick<PageDates, "published" | "modified">): string {
  if (!d.published) return "";
  const from = { json_ld: "structured data", meta: "article metadata", microdata: "page markup", byline: "the visible byline" }[d.published.source];
  return `${PAGE_DATES_BLOCK} Published ${d.published.date} (${from}).${d.modified ? ` Last modified ${d.modified} (not a publication date).` : ""}`;
}

/** The dated-entries block, at most `max` characters: one line per entry, its title and its date as the page shows it. */
export function datedItemsBlock(items: PageDates["items"], max = 1500): string {
  if (!items.length) return "";
  const lines: string[] = [];
  let n = DATED_ITEMS_BLOCK.length;
  for (const it of items) {
    const line = `${ITEM_MARK} ${it.title} — ${it.date}`;
    if (n + line.length + 1 > max) break;
    lines.push(line); n += line.length + 1;
  }
  return lines.length ? `${DATED_ITEMS_BLOCK}\n${lines.join("\n")}` : "";
}
