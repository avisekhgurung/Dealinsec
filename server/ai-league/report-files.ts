/**
 * A coworker's report as files to download: CSV (one row per company or item) and Markdown. Built from the stored
 * report, never re-researched. Text that came from the web is untrusted: CSV cells that a spreadsheet would run as a
 * formula (= + - @, tab, CR) are neutralised, and Markdown special characters in titles are escaped.
 */
import type { LeagueReport } from "@shared/ai-league";

/** One CSV cell: quoted, inner quotes doubled, formula triggers prefixed with an apostrophe. */
export function csvCell(v: unknown): string {
  let t = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return `"${t.replace(/"/g, '""')}"`;
}

export function reportCsv(report: LeagueReport): string {
  const rows: unknown[][] = [["Item", "Status", "Details", "Link", "Sources"]];
  for (const it of report.items) rows.push([it.title, it.status, it.detail ?? "", it.href ?? "", (it.sources ?? []).join(" ")]);
  // Excel opens UTF-8 CSV correctly with a byte-order mark; CRLF line ends are the CSV standard.
  return `﻿${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

const md = (t: string) => t.replace(/([\\`*_[\]<>#|])/g, "\\$1");

export function reportMarkdown(report: LeagueReport, meta: { title: string; coworker: string; finishedAt: string | null }): string {
  const out: string[] = [`# ${md(meta.title)}`, "", `${md(meta.coworker)}${meta.finishedAt ? ` · ${meta.finishedAt}` : ""}`, "", `**${md(report.headline)}**`, ""];
  if (report.summary) out.push(md(report.summary), "");
  if (report.counts.length) {
    out.push("| Measure | Count |", "| --- | ---: |", ...report.counts.map((c) => `| ${md(c.label)} | ${c.value} |`), "");
  }
  if (report.items.length) {
    out.push("## Results", "");
    for (const it of report.items) {
      out.push(`- **${md(it.title)}** (${it.status})${it.detail ? `: ${md(it.detail)}` : ""}`);
      for (const s of it.sources ?? []) if (/^https?:\/\//.test(s)) out.push(`  - Source: <${s.replace(/[<>\s]/g, "")}>`);
    }
    out.push("");
  }
  if (report.notes?.length) out.push("## Notes", "", ...report.notes.map((n) => `- ${md(n)}`), "");
  return out.join("\n");
}
