/**
 * Prospect exports: the columns, and the two file formats (CSV and XLSX), with no dependency beyond node:zlib.
 *
 * Every value is untrusted (it came from a company's website, a search result or a contact provider), so:
 *   CSV  — UTF-8 with a BOM (Excel reads the encoding), CRLF rows, every field quoted with quotes doubled, and a text
 *          cell that a spreadsheet could read as a formula is prefixed with an apostrophe (see `neutralize`). Quoting
 *          alone is not a defence: Excel and Sheets evaluate a quoted "=..." field.
 *   XLSX — every text value is an inline string cell (t="inlineStr"), which a spreadsheet never evaluates; only the
 *          integer columns are numbers. No formulas, no shared formulas, no external links, no macros.
 *
 * Dates: timestamps are ISO 8601 in UTC to the second ("2026-10-13T09:30:00Z"); an evidence date is written at the
 * precision the source gave it ("2026-09-14", "2026-09" or "2026"). Missing values are empty, never guessed.
 */
import { deflateRawSync } from "node:zlib";
import { CONTACT_LABEL, ICP_FIT_LABEL, READINESS_LABEL, type ExportPreset, type WorkspaceRow } from "@shared/prospect-workspace";

type Cell = string | number | null;
export interface ExportColumn { key: string; presets: readonly ExportPreset[]; number?: boolean; value: (r: WorkspaceRow, exportedAt: string) => Cell }

const BOTH: readonly ExportPreset[] = ["full", "companies"];
const FULL: readonly ExportPreset[] = ["full"];
const ts = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z") : null);
const list = (xs: string[]) => (xs.length ? xs.join("; ") : null);

/**
 * The specification's header order, limited to what the data model holds. Not exported because nothing stores them:
 * region / city (one free-text `location` instead), company and contact LinkedIn URLs, a person's phone and its check
 * time, owner, outreach eligibility, consent, suppression and deal status (prospects link to a lead: `in_leads`).
 */
export const EXPORT_COLUMNS: readonly ExportColumn[] = [
  { key: "prospect_id", presets: BOTH, number: true, value: (r) => r.id },
  { key: "company_name", presets: BOTH, value: (r) => r.name },
  { key: "company_domain", presets: BOTH, value: (r) => r.domain },
  { key: "company_website", presets: BOTH, value: (r) => r.website },
  { key: "country", presets: BOTH, value: (r) => r.country },
  { key: "location", presets: BOTH, value: (r) => r.location },
  { key: "industry", presets: BOTH, value: (r) => r.industry },
  { key: "company_size", presets: BOTH, value: (r) => r.companySize },
  { key: "primary_contact_name", presets: FULL, value: (r) => r.contact?.name ?? null },
  { key: "primary_contact_role", presets: FULL, value: (r) => r.contact?.title ?? null },
  { key: "contact_level", presets: FULL, value: (r) => CONTACT_LABEL[r.contactLevel] },
  { key: "primary_contact_email", presets: FULL, value: (r) => r.contact?.email ?? null },
  { key: "email_status", presets: FULL, value: (r) => r.emailStatus },
  { key: "email_verification_status", presets: FULL, value: (r) => (r.contact?.email ? r.contact.emailStatus : null) },
  { key: "email_source_type", presets: FULL, value: (r) => r.emailSource },
  { key: "email_last_checked_at", presets: FULL, value: (r) => ts(r.emailCheckedAt) },
  { key: "company_email", presets: BOTH, value: (r) => r.companyEmail },
  { key: "company_phone", presets: BOTH, value: (r) => r.companyPhone },
  { key: "phone_status", presets: BOTH, value: (r) => r.phoneStatus },
  { key: "icp_fit", presets: BOTH, value: (r) => ICP_FIT_LABEL[r.icpFit] },
  { key: "icp_match_reasons", presets: BOTH, value: (r) => list(r.icpMatch) },
  { key: "icp_unmatched_reasons", presets: BOTH, value: (r) => list(r.icpUnmatched) },
  { key: "research_readiness", presets: BOTH, value: (r) => READINESS_LABEL[r.readiness] },
  { key: "readiness_blockers", presets: BOTH, value: (r) => list(r.readinessBlockers) },
  { key: "latest_evidence_date", presets: BOTH, value: (r) => r.latestEvidence?.date ?? null },
  { key: "evidence_count", presets: BOTH, number: true, value: (r) => r.evidenceCount },
  { key: "latest_evidence_title", presets: BOTH, value: (r) => (r.latestEvidence ? `${r.latestEvidence.title}: ${r.latestEvidence.claim}` : null) },
  { key: "latest_evidence_url", presets: BOTH, value: (r) => r.latestEvidence?.url ?? null },
  { key: "latest_evidence_excerpt", presets: BOTH, value: (r) => r.latestEvidence?.excerpt ?? null },
  { key: "latest_evidence_source_type", presets: BOTH, value: (r) => r.latestEvidence?.sourceType ?? null },
  { key: "research_confidence", presets: BOTH, value: (r) => r.scoreConfidence },
  { key: "prospect_status", presets: BOTH, value: (r) => r.status },
  { key: "in_leads", presets: BOTH, value: (r) => (r.leadId !== null ? "yes" : "no") },
  { key: "created_at", presets: BOTH, value: (r) => ts(r.createdAt) },
  { key: "updated_at", presets: BOTH, value: (r) => ts(r.updatedAt) },
  { key: "exported_at", presets: BOTH, value: (_r, at) => ts(at) },
];

export const columnsFor = (preset: ExportPreset) => EXPORT_COLUMNS.filter((c) => c.presets.includes(preset));

// ── CSV ──────────────────────────────────────────────────────────────────

/**
 * Characters a spreadsheet may skip before reading a leading formula character: whitespace, C0/C1 controls and the
 * invisible format characters (zero-width, bidi marks, BOM).
 */
const LEADING_SKIPPABLE = /^[\s\u0000-\u001f\u007f-\u009f\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]*/;
const FORMULA_START = /^[=+\-@\uff1d\uff0b\uff0d\uff20]/;

/**
 * A text cell a spreadsheet could read as a formula or DDE payload gets a leading apostrophe (OWASP's CSV injection
 * advice): one that starts with = + - @ (or their full-width forms), tab or carriage return, or that reaches one of
 * them after leading whitespace, controls or invisible characters. Everything else is written as it is.
 */
export function neutralize(v: string): string {
  if (!v) return v;
  if (/^[\t\r]/.test(v) || FORMULA_START.test(v) || FORMULA_START.test(v.replace(LEADING_SKIPPABLE, ""))) return `'${v}`;
  return v;
}

const csvField = (v: Cell, number = false) => {
  if (v === null || v === undefined) return '""';
  const s = number && typeof v === "number" ? String(v) : neutralize(String(v));
  return `"${s.replace(/"/g, '""')}"`;
};

export function toCsv(rows: WorkspaceRow[], cols: readonly ExportColumn[], exportedAt: string): Buffer {
  const lines = [cols.map((c) => csvField(c.key)).join(",")];
  for (const r of rows) lines.push(cols.map((c) => csvField(c.value(r, exportedAt), c.number)).join(","));
  return Buffer.from(`\ufeff${lines.join("\r\n")}\r\n`, "utf8");
}

// ── XLSX ─────────────────────────────────────────────────────────────────

/** XML text: escaped, with the characters XML 1.0 forbids (most controls, lone surrogates, U+FFFE/F) removed. */
export function xmlText(v: string): string {
  return v
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
/** Excel's limit for one cell. */
const MAX_CELL = 32_767;
const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

function sheetXml(rows: WorkspaceRow[], cols: readonly ExportColumn[], exportedAt: string): string {
  const cell = (ref: string, v: Cell, number: boolean, style = 0) => {
    if (v === null || v === undefined || v === "") return "";
    const s = style ? ` s="${style}"` : "";
    if (number && typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${xmlText(String(v).slice(0, MAX_CELL))}</t></is></c>`;
  };
  const out: string[] = [];
  out.push(`<row r="1">${cols.map((c, i) => cell(`${colName(i)}1`, c.key, false, 1)).join("")}</row>`);
  rows.forEach((r, n) => { const rn = n + 2; out.push(`<row r="${rn}">${cols.map((c, i) => cell(`${colName(i)}${rn}`, c.value(r, exportedAt), !!c.number)).join("")}</row>`); });
  const last = `${colName(cols.length - 1)}${rows.length + 1}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `<sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="${cols.length}" width="22" customWidth="1"/></cols>`
    + `<sheetData>${out.join("")}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`;
}

const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
export function toXlsx(rows: WorkspaceRow[], cols: readonly ExportColumn[], exportedAt: string): Buffer {
  return zip([
    ["[Content_Types].xml", `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Prospects" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Prospects!$A$1:$${colName(cols.length - 1)}$${rows.length + 1}</definedName></definedNames></workbook>`],
    ["xl/_rels/workbook.xml.rels", `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ["xl/worksheets/sheet1.xml", sheetXml(rows, cols, exportedAt)],
  ]);
}

// ── a minimal ZIP (deflate, no encryption, no ZIP64: exports are capped far below 4 GB) ──

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Entries are stored deflated, with a fixed timestamp (1 Jan 1980) so the same rows give the same bytes. */
export function zip(entries: [name: string, content: string | Buffer][]): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const packed = deflateRawSync(data), nameBuf = Buffer.from(name, "utf8"), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(0, 12); dir.writeUInt16LE(0x21, 14); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(packed.length, 20); dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28); dir.writeUInt16LE(0, 30); dir.writeUInt16LE(0, 32); dir.writeUInt16LE(0, 34); dir.writeUInt16LE(0, 36);
    dir.writeUInt32LE(0, 38); dir.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, packed);
    central.push(dir, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cd, end]);
}
