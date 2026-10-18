/**
 * The chat's Markdown, parsed into plain data (never HTML). The renderer (components/agent/rich-text.tsx) turns these
 * nodes into React elements, so model output can't inject markup, scripts or styles: there is no dangerouslySetInnerHTML
 * anywhere on this path, and a link is a link only when its URL passes `safeHref`.
 *
 * Supported, as models write it: headings, paragraphs (single newlines kept), bullet and numbered lists (nested by
 * indentation, loose or tight), fenced code with a language, inline code, **bold**, *italic*, links and bare URLs,
 * GitHub-style tables, blockquotes and rules. Anything else stays as its literal text.
 *
 * Incomplete input never throws and never swallows text: an unclosed code fence is a code block marked `open`, a table
 * whose separator row hasn't arrived is a paragraph, and a half-written link or `**bold` is plain text.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "br" }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; external: boolean; c: Inline[] };

export type Align = "left" | "center" | "right" | null;
export interface ListItem { c: Inline[]; children: Block[] }
export type Block =
  | { t: "heading"; level: 1 | 2 | 3 | 4; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { t: "code"; lang: string | null; v: string; open: boolean }
  | { t: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { t: "quote"; c: Block[] }
  | { t: "hr" };

/* ── links ───────────────────────────────────────────────────────────────── */

/**
 * A URL the chat may link to: http(s) to another site, or a path inside the app ("/leads/12"). Everything else
 * (javascript:, data:, protocol-relative "//", credentials in the URL, whitespace tricks) is refused and stays text.
 */
export function safeHref(raw: string): { href: string; external: boolean } | null {
  const url = raw.trim();
  if (!url || url.length > 2048 || /[\s<>"'`\\]/.test(url)) return null;
  if (url.startsWith("/")) return url.startsWith("//") ? null : { href: url, external: false };
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const u = new URL(url);
    if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password || !u.hostname.includes(".")) return null;
    return { href: u.toString(), external: true };
  } catch {
    return null;
  }
}

/* ── inline ──────────────────────────────────────────────────────────────── */

const BARE_URL = /^https?:\/\/[^\s<>()[\]]*[^\s<>()[\].,;:!?'"*_]/;

/** Inline Markdown in one paragraph or cell. `\n` inside becomes a line break. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => { if (text) { out.push({ t: "text", v: text }); text = ""; } };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\n") { flush(); out.push({ t: "br" }); i++; continue; }
    if (ch === "\\" && i + 1 < src.length && /[\\`*_[\]()#|>-]/.test(src[i + 1])) { text += src[i + 1]; i += 2; continue; }
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) { flush(); out.push({ t: "code", v: src.slice(i + 1, end) }); i = end + 1; continue; }
    }
    if (ch === "[") {
      const m = /^\[([^\]\n]{1,300})\]\(([^()\s]{1,2048})\)/.exec(src.slice(i));
      if (m) {
        const safe = safeHref(m[2]);
        flush();
        if (safe) out.push({ t: "link", ...safe, c: parseInline(m[1]) });
        else out.push(...parseInline(m[1])); // an unsafe target keeps its words, loses the link
        i += m[0].length;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && src[i + 1] === ch) {
      const end = src.indexOf(ch + ch, i + 2);
      if (end > i + 2 && src[i + 2] !== " ") { flush(); out.push({ t: "strong", c: parseInline(src.slice(i + 2, end)) }); i = end + 2; continue; }
    }
    if (ch === "*" || (ch === "_" && (i === 0 || /[\s(]/.test(src[i - 1])))) {
      const end = src.indexOf(ch, i + 1);
      const inner = end > i + 1 ? src.slice(i + 1, end) : "";
      const closesWord = ch === "*" || end + 1 >= src.length || /[\s).,;:!?]/.test(src[end + 1]);
      if (inner && !/^\s|\s$/.test(inner) && !inner.includes("\n") && closesWord) { flush(); out.push({ t: "em", c: parseInline(inner) }); i = end + 1; continue; }
    }
    if (ch === "h" && (i === 0 || !/[\w/]/.test(src[i - 1]))) {
      const m = BARE_URL.exec(src.slice(i, i + 2100));
      const safe = m && safeHref(m[0]);
      if (m && safe) { flush(); out.push({ t: "link", ...safe, c: [{ t: "text", v: m[0] }] }); i += m[0].length; continue; }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

/* ── blocks ──────────────────────────────────────────────────────────────── */

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)[^`]*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+•]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

const indentOf = (line: string) => { let n = 0; for (const c of line) { if (c === " ") n++; else if (c === "\t") n += 4; else break; } return n; };
const cells = (line: string) => {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
};
const isTableStart = (lines: string[], i: number) =>
  lines[i].includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-") && (lines[i + 1].includes("|") || lines[i].trim().startsWith("|"));

/** Parse a whole message. Never throws. */
export function parseMarkdown(src: string): Block[] {
  return parseBlocks(src.replace(/\r\n?/g, "\n").split("\n"));
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => { if (para.length) { blocks.push({ t: "p", c: parseInline(para.join("\n").trim()) }); para = []; } };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const fence = FENCE.exec(line);
    if (fence) {
      flushPara();
      const marker = fence[1];
      const body: string[] = [];
      let j = i + 1, closed = false;
      for (; j < lines.length; j++) {
        if (lines[j].trim().startsWith(marker[0].repeat(marker.length)) && lines[j].trim().replace(new RegExp(`^\\${marker[0]}+`), "").trim() === "") { closed = true; break; }
        body.push(lines[j]);
      }
      blocks.push({ t: "code", lang: fence[2] || null, v: body.join("\n"), open: !closed });
      i = closed ? j + 1 : j;
      continue;
    }

    if (!line.trim()) { flushPara(); i++; continue; }

    const h = HEADING.exec(line);
    if (h) { flushPara(); blocks.push({ t: "heading", level: Math.min(4, h[1].length) as 1 | 2 | 3 | 4, c: parseInline(h[2]) }); i++; continue; }

    if (RULE.test(line) && !para.length) { blocks.push({ t: "hr" }); i++; continue; }

    if (isTableStart(lines, i)) {
      flushPara();
      const head = cells(lines[i]);
      const align: Align[] = cells(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null));
      const rows: Inline[][][] = [];
      let j = i + 2;
      for (; j < lines.length && lines[j].trim() && lines[j].includes("|"); j++) {
        const r = cells(lines[j]);
        rows.push(head.map((_, k) => parseInline(r[k] ?? "")));
      }
      blocks.push({ t: "table", align: head.map((_, k) => align[k] ?? null), head: head.map(parseInline), rows });
      i = j;
      continue;
    }

    if (QUOTE.test(line)) {
      flushPara();
      const body: string[] = [];
      for (; i < lines.length && QUOTE.test(lines[i]); i++) body.push(QUOTE.exec(lines[i])![1]);
      blocks.push({ t: "quote", c: parseBlocks(body) });
      continue;
    }

    if (ITEM.test(line) && (!para.length || /^\s*([-*+•]|1[.)])\s/.test(line))) {
      flushPara();
      const [list, next] = parseList(lines, i);
      blocks.push(list);
      i = next;
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flushPara();
  return blocks;
}

/** A list starting at `start`: items at its indentation, deeper lines as each item's own blocks. */
function parseList(lines: string[], start: number): [Block, number] {
  const first = ITEM.exec(lines[start])!;
  const base = indentOf(first[1]);
  const ordered = /\d/.test(first[2]);
  const items: ListItem[] = [];
  let i = start;
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]);
    if (!m || indentOf(m[1]) !== base || /\d/.test(m[2]) !== ordered) break;
    const text: string[] = [m[3]];
    const inner: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim()) {
        // A blank line ends the item unless the list (or this item's deeper content) carries on after it.
        const k = lines.slice(j + 1).findIndex((x) => x.trim() !== "");
        const nextLine = k < 0 ? null : lines[j + 1 + k];
        if (nextLine !== null && indentOf(nextLine) > base) { inner.push(""); continue; }
        break;
      }
      const sub = ITEM.exec(l);
      if (sub && indentOf(sub[1]) <= base) break;
      if (indentOf(l) > base) { if (inner.length || sub) inner.push(l.slice(Math.min(indentOf(l), base + 2))); else text.push(l.trim()); continue; }
      if (sub) break;
      if (inner.length) break;
      text.push(l.trim()); // a lazy continuation line
    }
    items.push({ c: parseInline(text.join("\n")), children: inner.length ? parseBlocks(dedent(inner)) : [] });
    i = j;
    // A loose list: blank lines between items at the same level keep it one list.
    while (i < lines.length && !lines[i].trim()) {
      const k = lines.slice(i).findIndex((x) => x.trim() !== "");
      const next = k < 0 ? null : ITEM.exec(lines[i + k]);
      if (next && indentOf(next[1]) === base && /\d/.test(next[2]) === ordered) i += k; else break;
    }
  }
  return [{ t: "list", ordered, start: ordered ? Math.max(0, parseInt(first[2], 10) || 1) : 1, items }, i];
}

const dedent = (ls: string[]) => {
  const min = Math.min(...ls.filter((l) => l.trim()).map(indentOf));
  return ls.map((l) => (l.trim() ? l.slice(Math.min(min, indentOf(l))) : l));
};

/** The plain text of inline nodes (copy, labels). */
export const inlineText = (c: Inline[]): string => c.map((n) => (n.t === "text" || n.t === "code" ? n.v : n.t === "br" ? "\n" : "c" in n ? inlineText(n.c) : "")).join("");
