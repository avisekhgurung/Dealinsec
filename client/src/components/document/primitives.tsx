/**
 * DealInSec document primitives — the shared visual vocabulary of the
 * quotation, agreement and invoice. One header system, one footer, one badge,
 * one table, one total block, one signature grid — so the three documents read
 * as one product. Styles live in doc.css.
 */
import type { ReactNode } from "react";
import type { LocaleSettings } from "@shared/schema";
import { formatDate, formatMoney, type MoneyOptions } from "@/lib/format";
import type { DocBlock } from "./paged";
import { useDocFormat } from "./locale";

/* ── Formatting — the document's locale, whatever it is ────────────────── */
//
// These replace `inr()` and the old India-only `docDate()`. The rename is the
// point: a function called `inr` that renders dollars is a lie the compiler
// cannot catch, and the old one-argument shape had nowhere to say which
// currency an amount was in. Every call site now states the locale it is
// printing in, the way every amount now states the unit it is counted in
// (`contractValueMinor`, not `contractValue`).
//
// `loc` comes from `documentLocaleSettings(org, user)` — the ORG's settings,
// so the document does not change currency depending on who opened it.
// Inside the document tree, prefer `useDocFormat()`: it is the same
// formatters, already bound.

/** MINOR units → the document's currency: `docMoney(6500000, loc)` is ₹65,000,
 *  not ₹65,00,000. Pass the stored `*Minor` value, never a rupee figure. */
export const docMoney = (
  minorUnits: number | string | null | undefined,
  loc: LocaleSettings,
  opts?: MoneyOptions,
): string => formatMoney(minorUnits, loc.currency, loc.locale, opts);

/** ISO date or timestamp → the document's date format, or "—". */
export const docDate = (
  d: string | Date | null | undefined,
  loc: LocaleSettings,
): string => formatDate(d, loc.locale, { timezone: loc.timezone });

export { useDocFormat };

/* ── Status badge ──────────────────────────────────────────────────────── */

const BADGE_TONE: Record<string, string> = {
  Paid: "doc-badge-green",
  Signed: "doc-badge-green",
  Active: "doc-badge-green",
  Unpaid: "doc-badge-amber",
  Revised: "doc-badge-amber",
  Pending: "doc-badge-slate",
  Draft: "doc-badge-slate",
};

export function DocBadge({ label }: { label: string }) {
  return <span className={`doc-badge ${BADGE_TONE[label] ?? "doc-badge-slate"}`}>{label}</span>;
}

/* ── Header band ───────────────────────────────────────────────────────── */

export interface HeaderMeta { label: string; value: ReactNode }

/**
 * The document identity strip. `formal` renders the agreement variant (white,
 * green rule); default is the brand band shared by quotation and invoice.
 */
export function DocHeader({
  docType, docNo, status, meta = [], formal = false, brand,
}: {
  docType: string;
  docNo: string;
  status?: string;
  meta?: HeaderMeta[];
  formal?: boolean;
  /** The document owner's business name — these are the USER'S papers, so the
   *  masthead carries THEIR identity, never DealInSec's. */
  brand?: string;
}) {
  return (
    <div className={formal ? "doc-band-formal" : "doc-band"}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8mm" }}>
        <div>
          {brand && <div className="doc-band-brand">{brand}</div>}
          <div className="doc-title" style={{ marginTop: "1.5mm" }}>{docType}</div>
          <div className="doc-mono doc-num" style={{ fontSize: "9pt", marginTop: "1mm", opacity: formal ? 0.75 : 0.9 }}>
            {docNo}
          </div>
        </div>
        <div style={{ textAlign: "right", flex: "none" }}>
          {status && <div style={{ marginBottom: "2mm" }}><DocBadge label={status} /></div>}
          <div className="doc-kv" style={{ gap: "1.2mm" }}>
            {meta.map((m) => (
              <div key={m.label}>
                <span className="doc-label">{m.label}</span>{" "}
                <span className="doc-value doc-num" style={{ fontSize: "8.5pt" }}>{m.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Footer line (fed to PagedDocument) ────────────────────────────────── */

export function docFooter(ref: string, extra?: string) {
  const tail = extra && extra.length > 44 ? `${extra.slice(0, 43)}…` : extra;
  return (page: number, total: number) => (
    <>
      <span>
        <span style={{ fontWeight: 700, color: "var(--doc-muted)" }}>{ref}</span>
        {tail ? <> {" · "}{tail}</> : null}
      </span>
      <span className="doc-num">{page} / {total}</span>
    </>
  );
}

/* ── Section title ─────────────────────────────────────────────────────── */

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="doc-h2" style={{ paddingBottom: "1.5mm", borderBottom: "1px solid var(--doc-border-soft)", marginBottom: "2.5mm" }}>
      {children}
    </div>
  );
}

/* ── Key/value + party columns ─────────────────────────────────────────── */

export function KV({ label, children, strong = false }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div>
      <div className="doc-label" style={{ marginBottom: "0.6mm" }}>{label}</div>
      <div className={strong ? "doc-value" : "doc-body"} style={{ overflowWrap: "anywhere" }}>{children}</div>
    </div>
  );
}

/** Two labelled columns (From/Bill To, Prepared By/For, Party A/B). */
export function TwoParties({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8mm" }}>
      <div>{left}</div>
      <div style={{ borderLeft: "1px solid var(--doc-border-soft)", paddingLeft: "6mm" }}>{right}</div>
    </div>
  );
}

export function Party({ heading, name, lines = [] }: { heading: string; name: string; lines?: (string | null | undefined | false)[] }) {
  return (
    <div>
      <div className="doc-label" style={{ color: "var(--doc-brand)", marginBottom: "1.5mm" }}>{heading}</div>
      <div className="doc-h3" style={{ overflowWrap: "anywhere" }}>{name}</div>
      <div className="doc-small doc-muted-t" style={{ marginTop: "0.8mm", display: "grid", gap: "0.5mm" }}>
        {lines.filter(Boolean).map((l, i) => (
          <div key={i} style={{ overflowWrap: "anywhere" }}>{l}</div>
        ))}
      </div>
    </div>
  );
}

/* ── Tables, chunked into flowable blocks ──────────────────────────────── */

export interface DocCol { label: string; align?: "left" | "right" | "center"; width?: string }

/**
 * Emits a table as DocBlocks: rows are chunked so a long table flows across
 * pages, and every chunk repeats the header row so no page shows naked rows.
 */
export function tableBlocks<T>({
  keyPrefix, cols, rows, renderCell, chunk = 6,
}: {
  keyPrefix: string;
  cols: DocCol[];
  rows: T[];
  renderCell: (row: T, colIndex: number, rowIndex: number) => ReactNode;
  chunk?: number;
}): DocBlock[] {
  const groups: T[][] = [];
  for (let i = 0; i < rows.length; i += chunk) groups.push(rows.slice(i, i + chunk));
  if (groups.length === 0) groups.push([]);
  return groups.map((g, gi) => ({
    key: `${keyPrefix}-${gi}`,
    className: [
      gi < groups.length - 1 ? "doc-tbl-mid" : "",
      gi > 0 ? "doc-tbl-cont" : "",
    ].join(" ").trim() || undefined,
    node: (
      <table className="doc-table" style={{ tableLayout: "fixed" }}>
        <colgroup>
          {cols.map((c, i) => (
            <col key={i} style={c.width ? { width: c.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th
                key={i}
                className={c.align === "right" ? "doc-th-r" : c.align === "center" ? "doc-th-c" : undefined}
                style={c.width ? { width: c.width } : undefined}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {g.map((row, ri) => (
            <tr key={ri}>
              {cols.map((c, ci) => (
                <td
                  key={ci}
                  className={c.align === "right" ? "doc-td-r doc-num" : c.align === "center" ? "doc-td-c" : undefined}
                >
                  {renderCell(row, ci, gi * chunk + ri)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    ),
  }));
}

/* ── Ledger + prominent total ──────────────────────────────────────────── */

export function TotalBlock({
  label, amountMinor, note, ledger = [],
}: {
  label: string;
  /** The headline figure in MINOR units. Formatted here, in the document's own
   *  currency — the caller must not pre-format it, or the biggest number on
   *  the page becomes the one place the locale can drift. */
  amountMinor: number;
  note?: string;
  /** Pre-formatted rows above the total (subtotal, and the tax lines to come).
   *  Format them with `useDocFormat().money()` so they match. */
  ledger?: { label: string; value: string }[];
}) {
  const fmt = useDocFormat();
  return (
    <div>
      {ledger.length > 0 && (
        <div className="doc-ledger" style={{ marginBottom: "2.5mm" }}>
          {ledger.map((r) => (
            <div key={r.label} className="doc-ledger-row">
              <span className="doc-muted-t">{r.label}</span>
              <span className="doc-num" style={{ fontWeight: 600 }}>{r.value}</span>
            </div>
          ))}
        </div>
      )}
      <div className="doc-total">
        <div>
          <div className="doc-label" style={{ color: "var(--doc-brand)" }}>{label}</div>
          {note && <div className="doc-small doc-muted-t" style={{ marginTop: "0.6mm" }}>{note}</div>}
        </div>
        <div className="doc-total-amount doc-num">{fmt.money(amountMinor)}</div>
      </div>
    </div>
  );
}

/* ── Numbered clauses ─────────────────────────────────────────────────── */

export function Clause({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "2.5mm", marginBottom: "1.5mm" }}>
        <span className="doc-clause-no">{n}</span>
        <span className="doc-h3">{title}</span>
      </div>
      <div className="doc-body doc-muted-t" style={{ paddingLeft: "8mm" }}>{children}</div>
    </div>
  );
}

/** Renders a clause body from shared/agreementClauses.ts, whose `**text**`
 *  spans are the only formatting it can carry (it's plain data, read by two
 *  different pages — see that file's header for why). */
export function renderClauseBody(body: string): ReactNode {
  const parts = body.split(/\*\*(.+?)\*\*/g);
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : p));
}

/* ── Signatures ────────────────────────────────────────────────────────── */

export function SignatureCell({
  heading, name, date, signatureUrl, sealUrl, note,
}: {
  heading: string;
  name?: string | null;
  date?: string | null;
  signatureUrl?: string | null;
  sealUrl?: string | null;
  /** Statement rendered IN the box when there is nothing left to pen-sign
   *  (e.g. "Accepted electronically — signed copy on record"). Without a
   *  note, an unsigned box prints EMPTY: the printed page is the artifact the
   *  counterparty signs, so the pen space must hold no text. The awaiting
   *  state shows on screen only. */
  note?: string;
}) {
  return (
    <div>
      <div className="doc-label" style={{ color: "var(--doc-brand)", marginBottom: "2mm" }}>{heading}</div>
      <div className="doc-sig-box">
        {signatureUrl
          ? <img src={signatureUrl} alt={`${heading} signature`} />
          : note
          ? <span className="doc-sig-awaiting">{note}</span>
          : <span className="doc-sig-awaiting print:hidden">Awaiting signature — sign above the line</span>}
      </div>
      {sealUrl && <img className="doc-seal" src={sealUrl} alt="Company stamp" />}
      <div style={{ marginTop: "1.5mm", display: "grid", gap: "0.5mm" }}>
        {name && <div className="doc-value" style={{ fontSize: "9pt" }}>{name}</div>}
        <div className="doc-small doc-muted-t">Date: {date ?? "____________"}</div>
      </div>
    </div>
  );
}

/* ── Screen-only warnings banner (never printed) ───────────────────────── */

import type { DocWarning } from "./checks";

export function DocWarnings({ warnings }: { warnings: DocWarning[] }) {
  if (!warnings.length) return null;
  return (
    <div className="print:hidden mb-4 rounded-xl border border-amber-300/70 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-1.5">
      <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
        Check before sending — these won't print, but the document may mislead:
      </p>
      {warnings.map((w, i) => (
        <p key={i} className="text-xs text-amber-700 dark:text-amber-400">
          {w.severity === "error" ? "⛔" : "⚠️"} {w.message}
        </p>
      ))}
    </div>
  );
}
