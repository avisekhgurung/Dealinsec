/**
 * Tiny CSV helpers for the data tables (export + import).
 *
 * Export is hardened against CSV/formula injection: a cell whose text starts
 * with = + - @ (or tab/CR) is prefixed with a single quote so spreadsheets
 * treat it as text, not a formula.
 */

export type CsvCell = string | number | null | undefined;

/** Reverse the export formula-guard: drop a single leading apostrophe. */
export function unguardCell(value: string): string {
  return value.startsWith("'") ? value.slice(1) : value;
}

function sanitizeForFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function escapeCell(value: CsvCell): string {
  const raw = value == null ? "" : String(value);
  const safe = sanitizeForFormula(raw);
  // Quote when the value contains a comma, quote, or newline.
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

/** Build a CSV string from headers + rows. */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) lines.push(row.map(escapeCell).join(","));
  return lines.join("\r\n");
}

/** Trigger a browser download of a CSV string. */
export function downloadCsv(filename: string, csv: string): void {
  // BOM so Excel opens UTF-8 correctly.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Parse a CSV string into rows of objects keyed by the header row.
 * Handles quoted fields, escaped quotes, and commas/newlines inside quotes.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  // Normalize newlines and strip a leading BOM.
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field.length === 0) {
      // A quote only opens a quoted field at the START of a field. A stray
      // quote mid-field (e.g. an inch mark: 27") is a literal, not a toggle —
      // otherwise it would swallow the rest of the file into one field.
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += c;
  }
  // Flush the last field/row (unless the file ended on a newline).
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((c) => c.trim() !== "")) // skip blank lines
    .map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, idx) => { obj[h] = (r[idx] ?? "").trim(); });
      return obj;
    });
}
