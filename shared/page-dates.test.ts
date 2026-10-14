import { describe, expect, it } from "vitest";
import { CUT_MARK, DATED_ITEMS_BLOCK, ITEM_MARK, calendarDate, composePageText, dateOrderFromLang, datedItemsBlock, isFuture, numericDate, pageDatesLine } from "./page-dates";
import { evidenceDate } from "./prospect";
import { dateBesideClaim } from "./prospect-intel";
import { findDates } from "./research-diagnostics";

const READ = new Date("2026-10-13T12:00:00Z");
const day = (d: Date | "ambiguous" | null | undefined) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ?? null);

describe("numeric dates", () => {
  it.each([
    ["25", "/", "09", "2026", null, "2026-09-25"], ["09", "/", "25", "2026", null, "2026-09-25"], // only one order fits
    ["09", "/", "12", "2026", "mdy", "2026-09-12"], ["09", "/", "12", "2026", "dmy", "2026-12-09"],
    ["09", "/", "12", "2026", null, "ambiguous"], // 12 Sep or 9 Dec: not guessed
    ["12", ".", "09", "2026", null, "2026-09-12"], // dotted dates are day first
    ["07", "/", "07", "2026", null, "2026-07-07"], // both orders agree
    ["31", "/", "02", "2026", null, null], ["13", "/", "13", "2026", null, null], ["00", "/", "10", "2026", "dmy", null], ["29", "/", "02", "2027", null, null], ["29", "/", "02", "2028", null, "2028-02-29"],
  ] as const)("%s%s%s%s%s (%s) → %s", (a, sep, b, y, order, out) => {
    expect(day(numericDate(a, sep, b, y, order))).toBe(out);
  });
  it.each([
    ["en-US", "mdy"], ["en_us", "mdy"], ["en-GB", "dmy"], ["en-IN", "dmy"], ["en-AU", "dmy"], ["de-DE", "dmy"], ["fr", "dmy"], ["en", null], ["", null], [null, null], ["ja-JP", null],
  ] as const)("language %s → %s", (lang, order) => expect(dateOrderFromLang(lang)).toBe(order));
  it("evidenceDate reads numeric dates only when their order is certain", () => {
    expect(evidenceDate("Posted 09/12/2026", READ)).toBeNull();
    expect(evidenceDate("Posted 09/12/2026", READ, { order: "mdy" })).toMatchObject({ precision: "day", at: new Date("2026-09-12T00:00:00Z") });
    expect(evidenceDate("Posted 09/12/2026", READ, { order: "dmy" })?.at.toISOString().slice(0, 10)).toBe("2026-12-09");
    expect(evidenceDate("Published 25/09/2026", READ)?.at.toISOString().slice(0, 10)).toBe("2026-09-25");
    expect(evidenceDate("2026/09/12 news", READ)?.at.toISOString().slice(0, 10)).toBe("2026-09-12");
    expect(evidenceDate("12.09.2026", READ)?.at.toISOString().slice(0, 10)).toBe("2026-09-12");
    expect(evidenceDate("Posted 09/12/26", READ, { order: "mdy" })).toBeNull(); // two-digit years are never read
    expect(evidenceDate("31/02/2026", READ)).toBeNull();
    expect(evidenceDate("Updated 25/09/2026", READ)).toBeNull(); // an update stamp, numeric or not
    expect(evidenceDate("Call 512/555/2026", READ)).toBeNull();
  });
  it("the diagnostics count the numeric dates validation accepts, and only those", () => {
    expect(findDates("a 25/09/2026 b 09/12/2026 c", READ).length).toBe(1);
    expect(findDates("a 25/09/2026 b 09/12/2026 c", READ, "mdy").length).toBe(2);
  });
});

describe("dates from markup", () => {
  it.each([
    ["2026-09-30T23:30:00-07:00", "2026-09-30"], // 06:30 UTC on 1 Oct, published on 30 Sep where it was written
    ["2026-10-01T01:00:00+09:00", "2026-10-01"], // 16:00 UTC on 30 Sep, published on 1 Oct where it was written
    ["2026-09-14", "2026-09-14"], ["2026-09-14T08:00:00Z", "2026-09-14"], ["2026-09-14 08:00", "2026-09-14"],
  ])("%s → the calendar day %s", (s, out) => expect(calendarDate(s)?.at.toISOString().slice(0, 10)).toBe(out));
  it("a month is a month; a bare year, junk and impossible dates are nothing", () => {
    expect(calendarDate("2026-09")).toMatchObject({ precision: "month" });
    for (const s of ["2026", "2026-13-45", "2026-02-30", "yesterday", "", null, 20260914, "14/09/2026"]) expect(calendarDate(s)).toBeNull();
  });
  it("a day or two ahead is a time zone; beyond that it's the future", () => {
    expect(isFuture(new Date("2026-10-14T00:00:00Z"), READ)).toBe(false);
    expect(isFuture(new Date("2026-10-15T11:00:00Z"), READ)).toBe(false);
    expect(isFuture(new Date("2026-10-16T00:00:00Z"), READ)).toBe(true);
  });
});

describe("the text a model is given", () => {
  const tail = ["[Footer and contact details]\nhello@northwind.example", `${DATED_ITEMS_BLOCK}\n${ITEM_MARK} A post — Sep 14, 2026`];
  it("fits: everything, unchanged, nothing marked as cut", () => {
    const r = composePageText({ head: "", body: "Short page text.", tail }, 5000);
    expect(r).toMatchObject({ truncated: false, body: "Short page text." });
    expect(r.text).toBe(`Short page text.\n\n${tail.join("\n\n")}`);
  });
  it("too long: the dates line first, the body cut at a sentence and marked, the blocks whole", () => {
    const body = "First sentence here. ".repeat(400);
    const r = composePageText({ head: "[Page dates, from this page's markup] Published 2026-09-14 (structured data).", body, tail }, 2000);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(2000);
    expect(r.text.startsWith("[Page dates")).toBe(true);
    expect(r.body.endsWith(`here. ${CUT_MARK}`)).toBe(true);
    expect(r.text.endsWith(tail[1].split("\n")[1])).toBe(true);
  });
  it("labelled blocks never take more than half the budget", () => {
    const r = composePageText({ head: "", body: "x ".repeat(3000), tail: ["[Footer and contact details]\n" + "y ".repeat(3000)] }, 1000);
    expect(r.text.length).toBeLessThanOrEqual(1000);
    expect(r.body.length).toBeGreaterThan(300);
  });
  it("the dates line names its source and keeps a modified date apart; no publication date, no line", () => {
    expect(pageDatesLine({ published: { date: "2026-09-14", at: "2026-09-14T00:00:00.000Z", precision: "day", source: "byline" }, modified: null })).toBe("[Page dates, from this page's markup] Published 2026-09-14 (the visible byline).");
    expect(pageDatesLine({ published: null, modified: "2026-10-01" })).toBe("");
  });
  it("dated entries: one line each, bounded", () => {
    const b = datedItemsBlock(Array.from({ length: 100 }, (_, i) => ({ title: `Post number ${i}`, date: "Sep 14, 2026" })), 300);
    expect(b.length).toBeLessThanOrEqual(300);
    expect(b.split("\n").slice(1).every((l) => l.startsWith(ITEM_MARK))).toBe(true);
    expect(datedItemsBlock([])).toBe("");
  });
});

describe("a date beside a claim never crosses a block or an entry", () => {
  it("the same distance, with and without a boundary between", () => {
    expect(dateBesideClaim("We opened an office in Austin. Posted May 1, 2026", "We opened an office in Austin.", "Posted May 1, 2026")).toBe(true);
    expect(dateBesideClaim("We opened an office in Austin.\n\n[Footer and contact details]\n© May 1, 2026", "We opened an office in Austin.", "May 1, 2026")).toBe(false);
    expect(dateBesideClaim(`${ITEM_MARK} Post A — May 1, 2026\n${ITEM_MARK} Post B — Apr 2, 2026`, "Post B", "May 1, 2026")).toBe(false);
    expect(dateBesideClaim(`${ITEM_MARK} Post A — May 1, 2026\n${ITEM_MARK} Post B — Apr 2, 2026`, "Post B", "Apr 2, 2026")).toBe(true);
  });
});
