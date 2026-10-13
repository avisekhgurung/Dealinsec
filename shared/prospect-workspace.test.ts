import { describe, expect, it } from "vitest";
import {
  MAX_EXPORT_ROWS, NO_SELECTION, afterFiltersChange, compareRows, exportLimits, exportRequestSchema, exportScopeOf, filtersKey, isSelected, parseWorkspaceQuery,
  queryRows, rowMatches, selectAllMatching, selectionCount, toggleId, togglePage, workspaceParams, type WorkspaceQuery, type WorkspaceRow,
} from "./prospect-workspace";

const row = (id: number, over: Partial<WorkspaceRow> = {}): WorkspaceRow => ({
  id, name: `Company ${id}`, domain: `c${id}.com`, website: `https://c${id}.com`,
  country: "US", location: "Austin, Texas", industry: "Digital marketing", serves: "SaaS companies", companySize: "12 people", sizeBucket: "11-50",
  contact: null, contactLevel: "none", emailStatus: "none", emailSource: null, emailCheckedAt: null, companyEmail: null, companyPhone: null, phoneStatus: "none",
  icpFit: "match", icpMatch: [], icpUnmatched: [], readiness: "needs_evidence", readinessBlockers: [],
  latestEvidence: null, evidenceCount: 0, scoreTotal: null, scoreConfidence: null,
  status: "enriched", leadId: null, latestRunId: "r1", sources: ["brave"],
  createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z", ...over,
});
const ev = (at: string, precision: "day" | "month" | "year" = "day") => ({ at, date: at.slice(0, 10), precision, title: "Hiring", claim: "Hiring an SEO lead", url: "https://x.com/jobs", excerpt: "We are hiring", sourceType: "website", confidence: "high", freshness: "Last 30 days", status: "confirmed" });
const q = (over: Partial<WorkspaceQuery> = {}): WorkspaceQuery => ({ filters: {}, sort: "evidence", dir: "desc", page: 1, pageSize: 25, ...over });

describe("reading a query", () => {
  it("defaults to latest evidence first, 25 a page", () => {
    expect(parseWorkspaceQuery({})).toEqual({ ok: true, query: { filters: {}, sort: "evidence", dir: "desc", page: 1, pageSize: 25 } });
  });
  it("reads lists, text and dates", () => {
    const r = parseWorkspaceQuery({ readiness: "ready,stale,ready", country: "US,GB", q: " acme ", evidenceFrom: "2026-01-01", sort: "name", dir: "asc", page: "3", pageSize: "50" });
    expect(r).toEqual({ ok: true, query: { filters: { readiness: ["ready", "stale"], country: ["US", "GB"], q: "acme", evidenceFrom: "2026-01-01" }, sort: "name", dir: "asc", page: 3, pageSize: 50 } });
  });
  it.each([
    [{ sort: "password" }, "sort field"], [{ dir: "sideways" }, "sort direction"], [{ pageSize: "1000" }, "page size"], [{ page: "0" }, "page"], [{ page: "1.5" }, "page"],
    [{ readiness: "ready,approved" }, "filter"], [{ country: "usa" }, "filter"], [{ evidenceFrom: "yesterday" }, "filter"], [{ source: "Brave Search!" }, "filter"],
    [{ organizationId: "org-2" }, "Unknown parameter"], [{ q: "x".repeat(101) }, "filter"],
  ])("strict (the server) refuses %j", (params, what) => {
    const r = parseWorkspaceQuery(params as Record<string, unknown>, true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(what);
  });
  it("lenient (the browser's own address) keeps what is valid and drops the rest", () => {
    const r = parseWorkspaceQuery({ readiness: "ready", country: "nope", sort: "password", pageSize: "7", view: "prospects" }, false);
    expect(r).toEqual({ ok: true, query: { filters: { readiness: ["ready"] }, sort: "evidence", dir: "desc", page: 1, pageSize: 25 } });
  });
  it("round-trips through URL parameters, leaving defaults out", () => {
    const query = q({ filters: { readiness: ["ready"], q: "acme", inLeads: "no" }, sort: "name", dir: "asc", page: 2, pageSize: 100 });
    const params = workspaceParams(query);
    expect(params).toEqual({ readiness: "ready", q: "acme", inLeads: "no", sort: "name", dir: "asc", page: "2", pageSize: "100" });
    expect(parseWorkspaceQuery(params)).toEqual({ ok: true, query });
    expect(workspaceParams(q())).toEqual({});
  });
  it("a filter set's identity ignores key and value order", () => {
    expect(filtersKey({ readiness: ["ready", "stale"], q: "a" })).toBe(filtersKey({ q: "a", readiness: ["stale", "ready"] }));
    expect(filtersKey({ readiness: [] })).toBe("{}");
  });
});

describe("filters", () => {
  const r = row(1, {
    name: "Ünïcode Agentur GmbH", domain: "agentur.de", country: "DE", location: "Berlin", industry: "Marketing", serves: "SaaS", sizeBucket: "1-10",
    contactLevel: "decision_maker", emailStatus: "verified", phoneStatus: "company_phone", icpFit: "partial", readiness: "ready", sources: ["tavily"],
    latestEvidence: ev("2026-09-14T00:00:00.000Z"), leadId: 7, createdAt: "2026-10-05T08:00:00.000Z",
  });
  it.each([
    [{ q: "agentur" }, true], [{ q: "ÜNÏCODE" }, true], [{ q: "acme" }, false],
    [{ country: ["DE", "US"] }, true], [{ country: ["US"] }, false],
    [{ location: "berl" }, true], [{ industry: "saas" }, true], [{ industry: "bakery" }, false],
    [{ size: ["1-10"] }, true], [{ size: ["201+"] }, false],
    [{ icpFit: ["partial"] }, true], [{ icpFit: ["match"] }, false],
    [{ readiness: ["ready"] }, true], [{ readiness: ["stale", "rejected"] }, false],
    [{ contact: ["decision_maker"] }, true], [{ contact: ["none"] }, false],
    [{ email: ["verified"] }, true], [{ email: ["company_email"] }, false],
    [{ phone: ["company_phone"] }, true], [{ phone: ["none"] }, false],
    [{ source: ["tavily"] }, true], [{ source: ["brave"] }, false],
    [{ evidenceFrom: "2026-09-14", evidenceTo: "2026-09-14" }, true], [{ evidenceFrom: "2026-09-15" }, false], [{ evidenceTo: "2026-09-13" }, false],
    [{ createdFrom: "2026-10-05" }, true], [{ createdTo: "2026-10-04" }, false],
    [{ inLeads: "yes" }, true], [{ inLeads: "no" }, false],
  ] as const)("%j → %s", (f, expected) => {
    expect(rowMatches(r, f as never)).toBe(expected);
  });
  it("an evidence date range never matches a prospect with no dated evidence", () => {
    expect(rowMatches(row(2), { evidenceTo: "2030-01-01" })).toBe(false);
  });
});

describe("ordering", () => {
  const rows = [
    row(1, { name: "Beta", latestEvidence: ev("2026-09-01T00:00:00.000Z") }),
    row(2, { name: "alpha", latestEvidence: ev("2026-09-01T00:00:00.000Z") }),
    row(3, { name: "Gamma", latestEvidence: null }),
    row(4, { name: "Delta", latestEvidence: ev("2026-10-01T00:00:00.000Z") }),
    row(5, { name: "alpha", latestEvidence: ev("2026-09-01T00:00:00.000Z") }),
  ];
  it("default: latest evidence first, then name A→Z, then id; undated last", () => {
    expect(queryRows(rows, q()).matched.map((r) => r.id)).toEqual([4, 2, 5, 1, 3]);
  });
  it("missing values sort last in either direction", () => {
    expect(queryRows(rows, q({ dir: "asc" })).matched.map((r) => r.id)).toEqual([2, 5, 1, 4, 3]);
  });
  it("is deterministic whatever order the rows arrive in", () => {
    const shuffled = [rows[3], rows[0], rows[4], rows[2], rows[1]];
    for (const sort of ["evidence", "name", "domain", "country", "icpFit", "readiness", "evidenceCount", "score", "created", "updated"] as const) {
      for (const dir of ["asc", "desc"] as const) expect(queryRows(shuffled, q({ sort, dir })).matched.map((r) => r.id)).toEqual(queryRows(rows, q({ sort, dir })).matched.map((r) => r.id));
    }
  });
  it("names sort in one fixed collation: accents and case don't push a name to the end", () => {
    const names = ["Zephyr", "ünïcode", "Acme", "Úmbra", "acme 10", "acme 9"].map((name, i) => row(i + 1, { name }));
    expect(queryRows(names, q({ sort: "name", dir: "asc" })).matched.map((r) => r.name)).toEqual(["Acme", "acme 9", "acme 10", "Úmbra", "ünïcode", "Zephyr"]);
  });
  it("equal names fall back to the id", () => {
    expect(compareRows(rows[1], rows[4], "name", "asc")).toBeLessThan(0);
    expect(compareRows(rows[4], rows[1], "name", "desc")).toBeGreaterThan(0);
  });
});

describe("paging, counts and the as-of cut", () => {
  const rows = Array.from({ length: 60 }, (_, i) => row(i + 1, { readiness: i % 3 === 0 ? "ready" : "needs_evidence", contactLevel: i % 2 ? "decision_maker" : "none", createdAt: `2026-10-${String(1 + (i % 9)).padStart(2, "0")}T00:00:00.000Z` }));
  it("pages without overlap or gaps", () => {
    const seen = [1, 2, 3].flatMap((page) => queryRows(rows, q({ sort: "name", dir: "asc", page })).rows.map((r) => r.id));
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60);
  });
  it("a page past the end shows the last page", () => {
    const r = queryRows(rows, q({ page: 99 }));
    expect(r.page).toBe(3); expect(r.pageCount).toBe(3); expect(r.rows).toHaveLength(10);
  });
  it("counts follow the filters; `all` is the whole workspace", () => {
    const r = queryRows(rows, q({ filters: { readiness: ["ready"] } }));
    expect(r.summary).toEqual({ all: 60, filtered: 20, ready: 20, needsReview: 0, withDecisionMaker: 10, verifiedEmail: 0 });
  });
  it("asOf leaves out prospects created later", () => {
    expect(queryRows(rows, q(), "2026-10-03T00:00:00.000Z").matched.every((r) => r.createdAt <= "2026-10-03T00:00:00.000Z")).toBe(true);
    expect(queryRows(rows, q(), "2026-10-03T00:00:00.000Z").matched).toHaveLength(21);
  });
  it("an empty workspace has one empty page", () => {
    expect(queryRows([], q())).toMatchObject({ rows: [], page: 1, pageCount: 1, summary: { all: 0, filtered: 0 } });
  });
});

describe("selection", () => {
  it("ticks rows one by one and across pages", () => {
    let s = toggleId(NO_SELECTION, 1);
    s = togglePage(s, [11, 12, 13]);
    expect(s).toEqual({ mode: "ids", ids: [1, 11, 12, 13] });
    expect(selectionCount(s)).toBe(4);
    s = togglePage(s, [11, 12, 13]); // the whole page was ticked: unticks just that page
    expect(s).toEqual({ mode: "ids", ids: [1] });
    expect(toggleId(s, 1)).toEqual(NO_SELECTION);
  });
  it("a partly ticked page is completed, not cleared", () => {
    expect(togglePage({ mode: "ids", ids: [2] }, [1, 2, 3])).toEqual({ mode: "ids", ids: [2, 1, 3] });
  });
  it("select-all-matching is frozen: its filters, time and count", () => {
    const s = selectAllMatching({ readiness: ["ready"] }, "2026-10-13T09:00:00.000Z", 42);
    expect(selectionCount(s)).toBe(42);
    expect(isSelected(s, 999)).toBe(true);
    expect(exportScopeOf(s)).toEqual({ mode: "filter", filters: { readiness: ["ready"] }, asOf: "2026-10-13T09:00:00.000Z", expectedCount: 42 });
  });
  it("changing the filters clears any selection; the same filters keep it", () => {
    const ids = { mode: "ids" as const, ids: [1, 2] };
    expect(afterFiltersChange(ids, {}, { q: "acme" })).toEqual(NO_SELECTION);
    const all = selectAllMatching({ readiness: ["ready"] }, "2026-10-13T09:00:00.000Z", 5);
    expect(afterFiltersChange(all, { readiness: ["ready"] }, { readiness: ["ready", "stale"] })).toEqual(NO_SELECTION);
    expect(afterFiltersChange(all, { readiness: ["ready"] }, { readiness: ["ready"] })).toBe(all);
  });
  it("ticked rows export as sorted ids; nothing selected exports nothing", () => {
    expect(exportScopeOf({ mode: "ids", ids: [9, 2, 5] })).toEqual({ mode: "ids", ids: [2, 5, 9] });
    expect(exportScopeOf(NO_SELECTION)).toBeNull();
  });
  it("export limits", () => {
    expect(exportLimits(0).allowed).toBe(false);
    expect(exportLimits(MAX_EXPORT_ROWS)).toEqual({ allowed: true, large: true });
    expect(exportLimits(MAX_EXPORT_ROWS + 1).allowed).toBe(false);
    expect(exportLimits(10).large).toBe(false);
  });
});

describe("the export request", () => {
  const ok = { format: "csv", scope: { mode: "ids", ids: [1, 2] } };
  it("accepts a valid request and defaults the preset", () => {
    expect(exportRequestSchema.parse(ok)).toEqual({ ...ok, preset: "full" });
  });
  it.each([
    [{ ...ok, format: "pdf" }], [{ ...ok, organizationId: "org-2" }], [{ ...ok, scope: { mode: "ids", ids: [] } }], [{ ...ok, scope: { mode: "ids", ids: [-1] } }],
    [{ ...ok, scope: { mode: "ids", ids: Array.from({ length: MAX_EXPORT_ROWS + 1 }, (_, i) => i + 1) } }], [{ ...ok, sort: "password" }],
    [{ ...ok, scope: { mode: "filter", filters: { readiness: ["approved"] }, asOf: "2026-10-13T09:00:00.000Z", expectedCount: 3 } }],
    [{ ...ok, scope: { mode: "filter", filters: {}, asOf: "yesterday", expectedCount: 3 } }],
    [{ ...ok, scope: { mode: "filter", filters: {}, asOf: "2026-10-13T09:00:00.000Z" } }],
    [{ ...ok, scope: { mode: "ids", ids: [1], rows: [{ id: 1, name: "forged" }] } }],
  ])("refuses %#", (body) => {
    expect(exportRequestSchema.safeParse(body).success).toBe(false);
  });
});
