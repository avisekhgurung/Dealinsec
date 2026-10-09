/**
 * Turning a PDF, a web page or plain text into clean text for the knowledge base.
 * Every function is bounded: bytes in, characters out, pages read, and time.
 * A file the parser cannot read is a refusal with words the person can act on,
 * never a crash and never an empty "success".
 */
import { LIMITS, cleanText } from "@shared/knowledge";

export type Extracted = { ok: true; title: string | null; text: string; truncated: boolean; pages?: number } | { ok: false; message: string };

const clip = (text: string): { text: string; truncated: boolean } =>
  text.length > LIMITS.charsPerSource ? { text: text.slice(0, LIMITS.charsPerSource), truncated: true } : { text, truncated: false };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([p, new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("timeout")), ms); })]).finally(() => clearTimeout(timer));
}

export async function extractPdf(bytes: Uint8Array): Promise<Extracted> {
  try {
    const { getDocumentProxy } = await import("unpdf");
    // A copy: the parser may take ownership of the buffer.
    const pdf = await withTimeout(getDocumentProxy(new Uint8Array(bytes)), 15_000);
    const pages = Math.min(pdf.numPages, LIMITS.pdfPages);
    const parts: string[] = [];
    let chars = 0;
    for (let n = 1; n <= pages && chars <= LIMITS.charsPerSource; n++) {
      const page = await withTimeout(pdf.getPage(n), 10_000);
      const content = await withTimeout(page.getTextContent(), 10_000);
      let line = "";
      for (const it of content.items as { str?: string; hasEOL?: boolean }[]) {
        if (typeof it.str !== "string") continue;
        line += it.str + (it.hasEOL ? "\n" : " ");
      }
      parts.push(line);
      chars += line.length;
    }
    const text = cleanText(parts.join("\n\n"));
    if (text.length < 20) return { ok: false, message: "I couldn't find any text in that PDF. If it's a scan, add a note that describes it, or upload a version with selectable text." };
    const c = clip(text);
    return { ok: true, title: null, text: c.text, truncated: c.truncated || pdf.numPages > LIMITS.pdfPages, pages: pdf.numPages };
  } catch (e) {
    const msg = String((e as Error)?.message ?? "");
    if (/password|encrypt/i.test(msg)) return { ok: false, message: "That PDF is password-protected. Remove the password and add it again." };
    if (msg === "timeout") return { ok: false, message: "That PDF took too long to read. Try a smaller one." };
    return { ok: false, message: "I couldn't read that PDF. It may be damaged." };
  }
}

const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: false }).decode(bytes);

export function extractPlainText(bytes: Uint8Array): Extracted {
  const text = cleanText(decode(bytes));
  if (text.length < 20) return { ok: false, message: "That file has almost no text in it." };
  const c = clip(text);
  return { ok: true, title: null, text: c.text, truncated: c.truncated };
}

export async function extractHtml(bytes: Uint8Array): Promise<Extracted> {
  try {
    const [{ parseHTML }, { Readability }] = await Promise.all([import("linkedom"), import("@mozilla/readability")]);
    // A bare fragment (no <html>) parses to a document with no body; give it one.
    const source = decode(bytes);
    const { document } = parseHTML(/<html[\s>]/i.test(source) ? source : `<!doctype html><html><body>${source}</body></html>`);
    for (const el of Array.from(document.querySelectorAll("script, style, noscript, template, svg, iframe, object, embed"))) el.remove();
    const pageTitle = cleanText(document.querySelector("title")?.textContent ?? "") || null;
    // Readability picks the article out of the navigation and footers; when it finds none, the whole body is used.
    let text = "";
    let title = pageTitle;
    try {
      const article = new Readability(document.cloneNode(true) as any).parse();
      if (article?.textContent) { text = cleanText(article.textContent); title = cleanText(article.title ?? "") || pageTitle; }
    } catch { /* fall through to the body */ }
    if (text.length < 200) text = cleanText(document.body?.textContent ?? document.documentElement?.textContent ?? "");
    if (text.length < 20) return { ok: false, message: "That page has no readable text. It may need JavaScript to show its content." };
    const c = clip(text);
    return { ok: true, title: title ? title.slice(0, 120) : null, text: c.text, truncated: c.truncated };
  } catch {
    return { ok: false, message: "I couldn't read that page." };
  }
}

export interface HtmlLink { href: string; text: string }

/** The links on a page (address and visible text), for choosing which other pages of a site to read. Bounded: 200 links, 80 characters of text each. Never throws. */
export async function extractLinks(bytes: Uint8Array): Promise<HtmlLink[]> {
  try {
    const { parseHTML } = await import("linkedom");
    const source = decode(bytes);
    const { document } = parseHTML(/<html[\s>]/i.test(source) ? source : `<!doctype html><html><body>${source}</body></html>`);
    const out: HtmlLink[] = [];
    for (const a of Array.from(document.querySelectorAll("a[href]"))) {
      const href = String(a.getAttribute("href") ?? "").trim();
      if (!href || href.startsWith("#")) continue;
      out.push({ href: href.slice(0, 500), text: cleanText(a.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80) });
      if (out.length >= 200) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * What a company's page says about WHERE and HOW to reach it: footer and address text, mailto:/tel: links, and the
 * address fields of its schema.org structured data. extractHtml's article reader drops footers on purpose (right for
 * articles, wrong for a company site, whose address and contact details live there). Plain text only, bounded
 * (about 2,000 characters), nothing executed. It is page text like any other: still untrusted, still needs a quote.
 */
export async function extractContactBlock(bytes: Uint8Array): Promise<string> {
  try {
    const { parseHTML } = await import("linkedom");
    const source = decode(bytes);
    const { document } = parseHTML(/<html[\s>]/i.test(source) ? source : `<!doctype html><html><body>${source}</body></html>`);
    const lines: string[] = [];
    const add = (l: string) => { const t = cleanText(l).replace(/\s+/g, " ").trim(); if (t && !lines.includes(t)) lines.push(t); };
    // Structured data: only a few plain string fields, found by name, never executed or followed.
    const address = (o: any, depth = 0): void => {
      if (!o || typeof o !== "object" || depth > 4) return;
      if (Array.isArray(o)) { for (const x of o.slice(0, 20)) address(x, depth + 1); return; }
      const str = (v: unknown) => (typeof v === "string" ? v : v && typeof v === "object" && typeof (v as any).name === "string" ? (v as any).name : "");
      const a = o.address && typeof o.address === "object" ? o.address : null;
      if (a) { const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry].map(str).filter(Boolean); if (parts.length) add(`Address (structured data): ${parts.join(", ")}`); }
      if (typeof o.telephone === "string") add(`Phone (structured data): ${o.telephone}`);
      if (typeof o.email === "string") add(`Email (structured data): ${o.email}`);
      for (const k of ["@graph", "mainEntity", "publisher", "provider", "organization"]) if (o[k]) address(o[k], depth + 1);
    };
    for (const sc of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 5)) {
      try { address(JSON.parse(String(sc.textContent ?? "").slice(0, 60_000))); } catch { /* not JSON */ }
    }
    for (const el of Array.from(document.querySelectorAll("footer, address, [role=contentinfo]")).slice(0, 6)) add(String(el.textContent ?? "").slice(0, 800));
    for (const a of Array.from(document.querySelectorAll('a[href^="mailto:" i], a[href^="tel:" i]')).slice(0, 8)) {
      const href = String(a.getAttribute("href") ?? "").trim();
      const v = decodeURIComponent(href.replace(/^(mailto|tel):/i, "").split("?")[0]).slice(0, 120);
      if (v) add(`${/^mailto/i.test(href) ? "Email" : "Phone"}: ${v}`);
    }
    return lines.join("\n").slice(0, 2000);
  } catch {
    return "";
  }
}
