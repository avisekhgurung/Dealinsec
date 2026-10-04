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
