/**
 * Turning a spreadsheet of companies into leads. Pure: no DOM, no network, so
 * the rules are tested once and the dialog only shows the result.
 *
 * Columns are found by NAME, not position, because people export from many
 * tools ("Company", "Account", "Organisation"). Every row is checked with the
 * same schema the server uses (leadFieldsSchema), so a row that passes here is
 * one the server will accept; the server still re-checks and skips duplicates.
 * Nothing is filled in for a blank cell: a missing contact stays missing.
 */
import { leadFieldsSchema, MAX_BATCH } from "./leads";

export const MAX_IMPORT_ROWS = 500;
export { MAX_BATCH };

export const IMPORT_FIELDS = [
  "companyName", "website", "industry", "location", "sizeHint", "fitSummary", "estValueMajor",
  "contactName", "contactRole", "contactEmail", "contactSource",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const FIELD_LABEL: Record<ImportField, string> = {
  companyName: "Company", website: "Website", industry: "Industry", location: "Location", sizeHint: "Size", fitSummary: "Notes",
  estValueMajor: "Estimated value", contactName: "Contact name", contactRole: "Contact role", contactEmail: "Contact email", contactSource: "Contact source",
};

const ALIASES: Record<ImportField, string[]> = {
  companyName: ["company", "company name", "business", "business name", "organization", "organisation", "account", "account name", "client", "prospect", "name"],
  website: ["website", "web site", "url", "domain", "site", "web", "company website", "company url"],
  industry: ["industry", "sector", "vertical", "category"],
  location: ["location", "city", "country", "region", "hq", "headquarters", "address"],
  sizeHint: ["size", "company size", "employees", "number of employees", "headcount", "team size"],
  fitSummary: ["notes", "note", "why", "fit", "why a fit", "summary", "description", "comments", "comment"],
  estValueMajor: ["value", "est value", "estimated value", "deal value", "potential value", "budget", "amount", "revenue potential"],
  contactName: ["contact", "contact name", "contact person", "person", "full name", "first name"],
  contactRole: ["role", "contact role", "job title", "title", "position", "designation"],
  contactEmail: ["email", "e mail", "contact email", "email address", "work email"],
  contactSource: ["source", "contact source", "lead source", "found via"],
};

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Header → the field it fills, or null. A field is filled by the FIRST header that names it. */
export function mapHeaders(headers: string[]): Record<string, ImportField | null> {
  const out: Record<string, ImportField | null> = {};
  const taken = new Set<ImportField>();
  for (const h of headers) {
    const n = norm(h);
    let hit: ImportField | null = null;
    for (const f of IMPORT_FIELDS) {
      if (!taken.has(f) && ALIASES[f].includes(n)) { hit = f; break; }
    }
    if (hit) taken.add(hit);
    out[h] = hit;
  }
  return out;
}

export interface ImportRow {
  /** 1-based row number as the person sees it in their sheet (header is row 1). */
  row: number;
  lead: Record<string, unknown> | null;
  /** What to show for the row in a preview. */
  label: string;
  errors: string[];
}

export interface ImportPlan {
  mapping: Record<string, ImportField | null>;
  /** Headers we could not use, so the person knows what was ignored. */
  ignored: string[];
  hasCompanyColumn: boolean;
  rows: ImportRow[];
  tooMany: boolean;
}

/** "₹50,000", "$ 12 000", "50000.5" → 50000 … ; null when it is not a number. */
export function parseValue(raw: string): number | null {
  const t = raw.replace(/[^\d.,-]/g, "").replace(/,/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function buildImportPlan(records: Record<string, string>[]): ImportPlan {
  const headers = records.length ? Object.keys(records[0]) : [];
  const mapping = mapHeaders(headers);
  const hasCompanyColumn = Object.values(mapping).includes("companyName");
  const ignored = headers.filter((h) => !mapping[h] && h.trim());
  const tooMany = records.length > MAX_IMPORT_ROWS;

  const rows: ImportRow[] = records.slice(0, MAX_IMPORT_ROWS).map((rec, i) => {
    const raw: Record<string, unknown> = {};
    const errors: string[] = [];
    for (const h of headers) {
      const f = mapping[h];
      const v = (rec[h] ?? "").trim();
      if (!f || !v) continue;
      if (f === "estValueMajor") {
        const n = parseValue(v);
        if (n === null) errors.push(`"${v}" isn't a usable estimated value`); else raw[f] = n;
      } else raw[f] = v;
    }
    const label = String(raw.companyName ?? "") || "(no company name)";
    if (!raw.companyName) errors.push("no company name");
    else {
      const parsed = leadFieldsSchema.safeParse(raw);
      if (!parsed.success) for (const issue of parsed.error.issues) errors.push(`${issue.path[0] ? (FIELD_LABEL[issue.path[0] as ImportField] ?? String(issue.path[0])) + ": " : ""}${issue.message}`);
    }
    return { row: i + 2, lead: errors.length ? null : raw, label, errors };
  });
  return { mapping, ignored, hasCompanyColumn, rows, tooMany };
}

/** Rows to send, in server-sized chunks. */
export function chunk<T>(xs: T[], size = MAX_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

export const TEMPLATE_HEADERS = ["Company", "Website", "Industry", "Location", "Estimated value", "Contact name", "Contact role", "Contact email", "Notes"];
export const TEMPLATE_ROWS: string[][] = [
  ["Northwind Logistics", "northwind.com", "Logistics", "Pune", "50000", "Ravi Menon", "Head of Operations", "", "Runs a fleet and an old booking site"],
  ["Orchid Labs", "", "Biotech", "Bengaluru", "", "", "", "", ""],
];
