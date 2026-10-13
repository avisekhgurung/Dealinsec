/**
 * Research date diagnostics for AI Outbound: for each signal the model proposed, whether the page text the model was
 * given held a date near the claim, whether the model quoted one (date_quote), and what precision the kept signal ended
 * with. Pure and read-only: it looks at the model's output, the pages and the finished result, and changes none of them.
 *
 * Privacy-safe by construction: numbers, booleans and short codes only. Never page text, a quotation, a date as written,
 * a URL path, an email, a phone number or a name. Bounded: at most 40 signals and 5 pages per record.
 *
 * What "visible" means here: present in the text the page reader gave the model (Readability text plus the people and
 * footer blocks, at most PAGE_TEXT_CHARS per page). A date that exists only in markup (a datetime attribute), in an image,
 * in script-rendered content or past the text limit is invisible to the model too, so it is (correctly) not counted.
 */
import { DATE_NEAR_CHARS, dateBesideClaim, type ResearchResult } from "./prospect-intel";
import { MONTH_PATTERN, evidenceDate, type DatePrecision } from "./prospect";
import { normalizeForQuote, quoteInPage, type ResearchPage } from "./research";

export type PageKind = "home" | "blog" | "news" | "careers" | "work" | "about" | "team" | "other";
export type DateOutcome =
  | "dated"                    // the kept signal has a day or month date
  | "year_only"                // the kept signal has a year alone (never used for timing)
  | "date_nearby_not_quoted"   // a day/month date sat within the window of the claim, but the model gave no usable date_quote
  | "date_quote_not_used"      // the model gave a date_quote that wasn't on the page, wasn't beside the claim, or wasn't a date
  | "no_date_nearby"           // nothing dated to the day or month within the window of the claim
  | "signal_rejected";         // the signal itself was not kept (quote not found, bad type, ...)
export interface SignalDateTrace {
  n: number; type: string; page: number | null; pageKind: PageKind | null; kept: boolean;
  quoteOnPage: boolean; quoteDate: DatePrecision | "none";
  dateQuote: "absent" | "given"; dateQuoteOnPage: boolean | null; dateQuoteBeside: boolean | null; dateQuoteDate: DatePrecision | "none" | null;
  /** The two dates disagree: the quote's own date and the date_quote name different months, or the date_quote is in the future. */
  contradictory: boolean | null;
  nearestDate: { chars: number; precision: DatePrecision } | null; datesInWindow: number;
  keptPrecision: DatePrecision | "none" | null; outcome: DateOutcome;
}
export interface PageDateTrace { page: number; kind: PageKind; textKChars: number; dayOrMonthDates: number; yearOnlyDates: number }
export interface ResearchDateRecord { type: "research_dates"; window: number; signals: SignalDateTrace[]; pages: PageDateTrace[]; summary: Record<string, number> }

const MAX_SIGNALS = 40, MAX_PAGES = 5, MAX_DATES = 200;
const KINDS: [PageKind, RegExp][] = [["blog", /\/(blog|blogs|insights|articles?|resources|posts?|thought-leadership)(\/|$)/], ["news", /\/(news|press|media|announcements?|updates?)(\/|$)/], ["careers", /\/(careers?|jobs|join|hiring|work-with-us)(\/|$)/], ["work", /\/(case-stud(y|ies)|work|our-work|portfolio|results|clients?|success)(\/|$)/], ["team", /\/(team|our-team|leadership|people)(\/|$)/], ["about", /\/(about|about-us|company|who-we-are)(\/|$)/]];
export function pageKind(url: string): PageKind {
  let path = ""; try { path = new URL(url).pathname.toLowerCase(); } catch { return "other"; }
  if (path === "/" || path === "") return "home";
  return KINDS.find(([, re]) => re.test(path))?.[0] ?? "other";
}

/** Every date in `text` that evidenceDate itself accepts (update stamps excluded), with its place and precision. Bounded. */
export function findDates(text: string, retrievedAt: Date): { at: number; end: number; precision: DatePrecision; date: Date }[] {
  const t = String(text ?? "").slice(0, 20_000);
  const lower = t.toLowerCase();
  const res = [
    /\b20\d\d-\d{1,2}-\d{1,2}\b/g,
    new RegExp(`\\b${MONTH_PATTERN}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+20\\d\\d\\b`, "g"),
    new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_PATTERN},?\\s+20\\d\\d\\b`, "g"),
    new RegExp(`\\b${MONTH_PATTERN}\\s+20\\d\\d\\b`, "g"),
    /\b\d{1,3}\s+(?:day|week|month|year)s?\s+ago\b/g,
    /\b(?:posted|published|announced)\s+(?:today|yesterday)\b|\bjust posted\b/g,
    /\b(?:in|since|from|during|of)\s+20\d\d\b/g,
  ];
  const found: { at: number; end: number; precision: DatePrecision; date: Date }[] = [];
  for (const re of res) {
    for (let m = re.exec(lower); m && found.length < MAX_DATES; m = re.exec(lower)) {
      const at = m.index, end = at + m[0].length;
      if (found.some((f) => at < f.end && end > f.at)) continue; // already covered by a more precise form
      // The same reading as validation: the 30 characters before it decide whether it is an update stamp. Their digits are
      // blanked so another date in them ("Published Sep 12, 2026 · Updated …") can't be read in place of this one.
      const before = lower.slice(Math.max(0, at - 30), at).replace(/\d/g, " ");
      const d = evidenceDate(before + lower.slice(at, end), retrievedAt);
      if (d) found.push({ at, end, precision: d.precision, date: d.at });
    }
  }
  return found.sort((a, b) => a.at - b.at);
}

const precisionOf = (s: string, retrievedAt: Date): DatePrecision | "none" => evidenceDate(s, retrievedAt)?.precision ?? "none";
const sameMonth = (a: Date, b: Date) => a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();

/**
 * The record for one company's research. `raw` is the model's output as given to normalizeResearch, `result` what
 * normalizeResearch kept. Never throws on odd input (malformed findings are counted, not trusted).
 */
export function researchDateDiagnostics(raw: unknown, pages: ResearchPage[], result: Pick<ResearchResult, "signals">, retrievedAt: Date): ResearchDateRecord {
  const list = raw && typeof raw === "object" && Array.isArray((raw as any).findings) ? ((raw as any).findings as unknown[]).slice(0, MAX_SIGNALS) : [];
  const keptByIndex = new Map(result.signals.map((s) => [s.index, s]));
  const datesOf = new Map<number, ReturnType<typeof findDates>>();
  const textOf = (p: ResearchPage) => normalizeForQuote(p.text);
  const dated = (p: ResearchPage) => { if (!datesOf.has(p.index)) datesOf.set(p.index, findDates(textOf(p), retrievedAt)); return datesOf.get(p.index)!; };
  const signals: SignalDateTrace[] = [];
  list.forEach((item, idx) => {
    const f = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    if (!f || f.kind !== "signal") return;
    const page = typeof f.page === "number" ? pages.find((p) => p.index === f.page) ?? null : null;
    const quote = typeof f.quote === "string" ? f.quote : "";
    const dq = typeof f.date_quote === "string" && f.date_quote.trim() ? f.date_quote : null;
    const kept = keptByIndex.get(idx);
    const quoteOnPage = !!page && quoteInPage(quote, page.text);
    // Where the claim sits in the page text (same normalisation as validation), and the dates around it.
    let nearest: SignalDateTrace["nearestDate"] = null, inWindow = 0;
    if (page && quoteOnPage) {
      const text = textOf(page), q = normalizeForQuote(quote);
      const c = text.indexOf(q);
      if (c >= 0) {
        for (const d of dated(page)) {
          if (d.precision === "year") continue;
          const gap = d.end <= c ? c - d.end : d.at >= c + q.length ? d.at - (c + q.length) : 0;
          if (gap <= DATE_NEAR_CHARS) inWindow++;
          if (!nearest || gap < nearest.chars) nearest = { chars: Math.min(gap, 20_000), precision: d.precision };
        }
      }
    }
    const quoteDate = precisionOf(quote, retrievedAt);
    const dqDate = dq ? precisionOf(dq.slice(0, 120), retrievedAt) : null;
    const dqOnPage = dq && page ? quoteInPage(dq, page.text) : dq ? false : null;
    const dqBeside = dq && page && quoteOnPage ? dateBesideClaim(page.text, quote, dq) : dq ? false : null;
    let contradictory: boolean | null = null;
    if (dq) {
      const a = evidenceDate(quote, retrievedAt), b = evidenceDate(dq.slice(0, 120), retrievedAt);
      contradictory = !!b && (b.at.getTime() > retrievedAt.getTime() || (!!a && a.precision !== "year" && b.precision !== "year" && !sameMonth(a.at, b.at)));
    }
    const keptPrecision = kept ? kept.datePrecision ?? "none" : null;
    const outcome: DateOutcome = !kept ? "signal_rejected"
      : keptPrecision === "day" || keptPrecision === "month" ? "dated"
      : keptPrecision === "year" ? "year_only"
      : dq ? "date_quote_not_used"
      : inWindow > 0 ? "date_nearby_not_quoted"
      : "no_date_nearby";
    signals.push({
      n: signals.length + 1, type: typeof f.type === "string" ? String(f.type).replace(/[^A-Z_]/g, "").slice(0, 24) || "UNKNOWN" : "UNKNOWN",
      page: page?.index ?? null, pageKind: page ? pageKind(page.url) : null, kept: !!kept, quoteOnPage, quoteDate,
      dateQuote: dq ? "given" : "absent", dateQuoteOnPage: dqOnPage, dateQuoteBeside: dqBeside, dateQuoteDate: dqDate, contradictory,
      nearestDate: nearest ? { chars: Math.round(nearest.chars / 10) * 10, precision: nearest.precision } : null, datesInWindow: Math.min(inWindow, 50),
      keptPrecision, outcome,
    });
  });
  const pageTraces: PageDateTrace[] = pages.slice(0, MAX_PAGES).map((p) => {
    const ds = dated(p);
    return { page: p.index, kind: pageKind(p.url), textKChars: Math.round(textOf(p).length / 1000), dayOrMonthDates: Math.min(ds.filter((d) => d.precision !== "year").length, 50), yearOnlyDates: Math.min(ds.filter((d) => d.precision === "year").length, 50) };
  });
  const summary: Record<string, number> = { signals: signals.length, kept: signals.filter((s) => s.kept).length };
  for (const s of signals) summary[s.outcome] = (summary[s.outcome] ?? 0) + 1;
  summary.pagesWithDayOrMonthDate = pageTraces.filter((p) => p.dayOrMonthDates > 0).length;
  return { type: "research_dates", window: DATE_NEAR_CHARS, signals, pages: pageTraces, summary };
}
