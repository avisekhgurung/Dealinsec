import { describe, expect, it } from "vitest";
import { MAX_IMPORT_ROWS, buildImportPlan, chunk, mapHeaders, parseValue } from "./leads-import";

describe("header mapping", () => {
  it("finds columns by name, whatever the tool that exported them called them", () => {
    const m = mapHeaders(["Account Name", "URL", "Sector", "City", "Potential Value", "Contact Person", "Job Title", "Work Email", "Comments", "Random"]);
    expect(m).toEqual({
      "Account Name": "companyName", URL: "website", Sector: "industry", City: "location", "Potential Value": "estValueMajor",
      "Contact Person": "contactName", "Job Title": "contactRole", "Work Email": "contactEmail", Comments: "fitSummary", Random: null,
    });
  });
  it("a field is filled by the first header that names it, never two", () => {
    const m = mapHeaders(["Company", "Name", "Website", "URL"]);
    expect(m.Company).toBe("companyName");
    expect(m.Name).toBeNull();
    expect(m.Website).toBe("website");
    expect(m.URL).toBeNull();
  });
  it("ignores punctuation and case", () => {
    expect(mapHeaders(["COMPANY_NAME", "e-mail"])).toEqual({ COMPANY_NAME: "companyName", "e-mail": "contactEmail" });
  });
});

describe("values", () => {
  it("reads money the way people write it", () => {
    expect(parseValue("₹50,000")).toBe(50000);
    expect(parseValue("$ 12,500.50")).toBe(12500.5);
    expect(parseValue("")).toBeNull();
    expect(parseValue("TBD")).toBeNull();
    expect(parseValue("0")).toBeNull();
    expect(parseValue("-5")).toBeNull();
  });
});

describe("the plan", () => {
  const plan = (rows: Record<string, string>[]) => buildImportPlan(rows);

  it("good rows become leads with only what was filled in; nothing is invented for blanks", () => {
    const p = plan([{ Company: "Northwind", Website: "northwind.com", Email: "", Value: "₹50,000", Notes: "" }]);
    expect(p.rows[0]).toMatchObject({ row: 2, errors: [], lead: { companyName: "Northwind", website: "northwind.com", estValueMajor: 50000 } });
    expect(Object.keys(p.rows[0].lead!).sort()).toEqual(["companyName", "estValueMajor", "website"]);
  });
  it("row problems are reported against the sheet's row number, and the row is held back", () => {
    const blank = { Company: "", Website: "", Email: "", Value: "" };
    const p = plan([{ ...blank, Company: "A" }, { ...blank, Website: "x.com" }, { ...blank, Company: "B", Email: "not an email" }, { ...blank, Company: "C", Value: "soon" }]);
    expect(p.rows.map((r) => [r.row, r.lead !== null])).toEqual([[2, true], [3, false], [4, false], [5, false]]);
    expect(p.rows[1].errors).toEqual(["no company name"]);
    expect(p.rows[2].errors.join()).toMatch(/Contact email/);
    expect(p.rows[3].errors.join()).toMatch(/estimated value/);
  });
  it("says which columns it ignored and whether a company column exists at all", () => {
    const p = plan([{ Company: "A", "Favourite colour": "blue", Zodiac: "" }]);
    expect(p.ignored).toEqual(["Favourite colour", "Zodiac"]);
    expect(p.hasCompanyColumn).toBe(true);
    expect(plan([{ Foo: "x" }]).hasCompanyColumn).toBe(false);
  });
  it("caps the file and says so", () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 5 }, (_, i) => ({ Company: `Co ${i}` }));
    const p = plan(rows);
    expect(p.tooMany).toBe(true);
    expect(p.rows).toHaveLength(MAX_IMPORT_ROWS);
  });
  it("text that looks like a spreadsheet formula is kept as plain text, never evaluated", () => {
    const p = plan([{ Company: "=HYPERLINK(\"http://evil\")" }]);
    expect(p.rows[0].lead).toMatchObject({ companyName: "=HYPERLINK(\"http://evil\")" });
  });
});

describe("chunking", () => {
  it("splits into server-sized batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk(Array.from({ length: 45 }, (_, i) => i)).map((c) => c.length)).toEqual([20, 20, 5]);
    expect(chunk([])).toEqual([]);
  });
});
