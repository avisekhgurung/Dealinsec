/** CSV for the admin exports. Pure. */

/** A CSV cell that a spreadsheet will not run as a formula (=, +, -, @, tab, CR lead the cell). */
export const csvCell = (v: unknown): string => {
  let s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (header: string[], rows: unknown[][]): string => [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
