import { describe, expect, it } from "vitest";
import { appendLines, dealEditSchema, isEmptyEdit, normalizeDeliverables, removeLines, summarizeDeliverables } from "./revisions";

describe("terms", () => {
  it("appendLines keeps what is there and skips repeats, ignoring case and spacing", () => {
    expect(appendLines("50% advance\nTwo revisions", "two  REVISIONS\nPayment within 7 days")).toBe("50% advance\nTwo revisions\nPayment within 7 days");
    expect(appendLines(null, "A\nB")).toBe("A\nB");
    expect(appendLines("A", "")).toBe("A");
  });
  it("removeLines removes only whole matching lines and reports what it could not find", () => {
    const r = removeLines("50% advance\nTwo revisions\nHosting excluded", "two revisions\nSource files included");
    expect(r.text).toBe("50% advance\nHosting excluded");
    expect(r.removed).toEqual(["Two revisions"]);
    expect(r.missing).toEqual(["Source files included"]);
  });
  it("a partial phrase is not a match (so a vague instruction cannot delete the wrong line)", () => {
    const r = removeLines("Payment within 7 days of delivery", "payment");
    expect(r.removed).toEqual([]);
    expect(r.text).toBe("Payment within 7 days of delivery");
  });
});

describe("deliverables", () => {
  let n = 0;
  const id = () => `id${++n}`;
  it("shapes a list the way the creation path does: clamped, defaulted, capped", () => {
    const d = normalizeDeliverables([{ contentType: "Home page", quantity: 1 }, { platform: "Design", contentType: "Logo", quantity: 5000 }, { quantity: -3 }, {}], id);
    expect(d.map((x) => [x.platform, x.contentType, x.quantity, x.frequency])).toEqual([
      ["Service", "Home page", 1, "One-time"], ["Design", "Logo", 999, "One-time"], ["Service", "Deliverable", 1, "One-time"], ["Service", "Deliverable", 1, "One-time"],
    ]);
    expect(new Set(d.map((x) => x.id)).size).toBe(4);
    expect(normalizeDeliverables(Array.from({ length: 30 }, () => ({})), id)).toHaveLength(12);
    expect(normalizeDeliverables("nope", id)).toEqual([]);
  });
  it("summarises for a preview", () => {
    const d = normalizeDeliverables([{ contentType: "Home page" }, { contentType: "Inner page", quantity: 4 }, { contentType: "Blog" }, { contentType: "SEO" }, { contentType: "Logo" }], id);
    expect(summarizeDeliverables(d)).toBe("5 items: 1 × Home page, 4 × Inner page, 1 × Blog, 1 × SEO, and 1 more");
  });
});

describe("the edit schema", () => {
  it("accepts a partial edit and refuses bad dates, empty lists and non-positive amounts", () => {
    expect(dealEditSchema.safeParse({ dealAmount: 60000, endDate: "2026-12-01" }).success).toBe(true);
    expect(dealEditSchema.safeParse({ startDate: "1 Dec" }).success).toBe(false);
    expect(dealEditSchema.safeParse({ deliverables: [] }).success).toBe(false);
    expect(dealEditSchema.safeParse({ dealAmount: 0 }).success).toBe(false);
    expect(dealEditSchema.safeParse({ dealAmount: -5 }).success).toBe(false);
  });
  it("knows when nothing was asked for", () => {
    expect(isEmptyEdit({})).toBe(true);
    expect(isEmptyEdit({ addTerms: "x" })).toBe(false);
  });
});
