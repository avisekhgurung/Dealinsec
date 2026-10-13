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
/** A known form embed (HubSpot, Typeform, JotForm, Gravity, WPForms, Marketo, Calendly, Pipedrive): its fields are drawn by script, so it is taken as a form a visitor can send. */
const FORM_EMBED = /hbspt\.forms|hsforms\.(net|com)|js\.hsforms|typeform\.com\/to\/|embed\.typeform|jotform\.com|gform_wrapper|wpforms-form|mktoForm|calendly\.com\/|webforms\.pipedrive/i;
/** Words that make a form a newsletter sign-up, not a way to write to the company. */
const NEWSLETTER = /subscri|newsletter|mailchimp|list-manage\.com|mailing list|sign up for (our )?(updates|emails|news)|join (our )?(list|community)|get (our )?(updates|insights) in your inbox/i;
/** A field a visitor fills in (not hidden, a button, a checkbox, a password or a search box). */
const FIELD = /<(?:input\b(?![^>]*\btype\s*=\s*["']?(?:hidden|submit|button|image|reset|checkbox|radio|password|search)\b)[^>]*|select\b[^>]*)>/gi;
/**
 * True when the page holds a form a visitor can use to write to the company: a known form embed, or an HTML form with a
 * message box, or with at least two fields to fill in. Not a contact form: a newsletter sign-up, a site search, a login,
 * a blog comment box, or a lone email box (which can't be told apart from a newsletter). A link that says "Contact Us" is not a form at all.
 */
export function hasContactForm(bytes: Uint8Array): boolean {
  try {
    const html = decode(bytes).slice(0, 1_500_000);
    if (FORM_EMBED.test(html)) return true;
    const forms = html.match(/<form\b[\s\S]{0,50000}?(?:<\/form>|$)/gi) ?? [];
    return forms.slice(0, 20).some((f) => {
      const open = f.match(/^<form\b[^>]*>/i)?.[0] ?? "";
      if (/\brole\s*=\s*["']?search|\bsearch\b/i.test(open) || /type\s*=\s*["']?(password|search)\b|\bname\s*=\s*["']?(q|s|search)["'\s>]/i.test(f)) return false;
      if (/commentform|comment-form|wp-comments-post/i.test(open)) return false; // a blog's "leave a reply" box is not a way to reach the company
      if (/<textarea\b/i.test(f)) return true; // a message box is what a contact form is for
      if (NEWSLETTER.test(f)) return false;
      return (f.match(FIELD) ?? []).length >= 2;
    });
  } catch { return false; }
}

/**
 * The people a team page names, as "Name, Role" lines in the page's own words. The article reader keeps a page's prose
 * and drops its card grids, which is where a team page lists people ("<h3>Dana Ortiz</h3><p>Founder</p>"). A name and a
 * role are joined only when they sit in the same card (the smallest container holding both), in the order the card
 * uses. Navigation, header, footer and forms are skipped. A card's employer is kept when the card splits it off
 * ("CEO" "at" "Orchard Labs"). People in a testimonial, review, quote or case-study context go to `quoted`, not `staff`
 * (on one live team page, client testimonials filled the whole list before the real leaders). Whether a person works
 * HERE is still decided later, from these lines, by shared/staff.ts. Plain text only, bounded (staff 20 lines / about
 * 1,500 characters, quoted 10 / 600), never throws.
 */
const QUOTE_ATTR = /testimonial|review|quot(?:e|ation)|case[-_ ]?stud|success[-_ ]?stor|client|customer|endorse|kudos/i;
const QUOTE_HEADING = /testimonial|review|what (?:our )?(?:clients|customers)|clients? (?:say|love|stories)|customers? (?:say|love|stories)|case stud|success stor|trusted by|kind words|hear from/i;
const LOGO = /logo/i;
const SOCIAL = /linkedin|twitter|facebook|instagram|github|youtube|tiktok|threads|e-?mail|\bx\b/i;
const TEAM_HEADING = /\b(team|leadership|our people|founders?|who we are)\b/i;
const BLOCK_TAGS = new Set(["DIV", "P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "UL", "OL", "SECTION", "ARTICLE", "MAIN", "ASIDE", "FIGURE", "FIGCAPTION", "BLOCKQUOTE", "DL", "DT", "DD", "TABLE", "TBODY", "TR", "TD", "TH", "HEADER", "FOOTER"]);
const BLOCK_SELECTOR = Array.from(BLOCK_TAGS).map((t) => t.toLowerCase()).join(",");
const ROLE_WORD = /\b(founder|co-?founder|owner|ceo|cto|coo|cmo|cfo|cro|cso|cpo|cio|president|partner|principal|director|head|vp|vice president|manager|lead|chief|officer|strategist|specialist|consultant|designer|developer|engineer|marketer|executive|coordinator|analyst|associate|editor|writer|producer|architect|advisor|chair(?:man|woman)?)\b/i;
const NOT_A_NAME = /\b(our|the|and|for|with|meet|team|about|contact|services?|marketing|agency|digital|business|growth|sales|careers?|clients?|work|blog|home|learn|more|read|view|book|call|get|free|new|all|news|company|studio|group|solutions|media|partners?)\b/i;
/** 2 to 4 capitalised words, letters in any script ("Inês Duarte", "Seán Doyle"). */
const PERSON_NAME = new RegExp("^\\p{Lu}[\\p{L}'’.-]+(?:\\s+\\p{Lu}[\\p{L}'’.-]+){1,3}$", "u");
export async function extractPeople(bytes: Uint8Array): Promise<{ staff: string[]; quoted: string[] }> {
  try {
    if (!bytes.length) return { staff: [], quoted: [] };
    const { parseHTML } = await import("linkedom");
    const source = decode(bytes).slice(0, 1_500_000);
    const { document } = parseHTML(/<html[\s>]/i.test(source) ? source : `<!doctype html><html><body>${source}</body></html>`);
    for (const el of Array.from(document.querySelectorAll("script, style, noscript, template, svg, iframe, nav, header, footer, form, select, button, [role=navigation]"))) el.remove();
    const text = (el: Element) => cleanText(el.textContent ?? "").replace(/\s+/g, " ").trim();
    // Leaves: elements with text and no block-level child (inline markup inside a name is fine), outermost only.
    const all = Array.from(document.querySelectorAll("body *")) as Element[];
    const isLeaf = (el: Element) => BLOCK_TAGS.has(el.tagName) || el.tagName === "SPAN" || el.tagName === "STRONG" || el.tagName === "B" || el.tagName === "A";
    const leaves: Element[] = [];
    const leafSet = new Set<Element>();
    for (const el of all) {
      // Any block inside, not only a direct child: a card wrapped in a link (<li><a><div>Name</div><div>Role</div></a></li>) is not one leaf.
      if (!isLeaf(el) || el.querySelector(BLOCK_SELECTOR)) continue;
      // A card built from inline pieces (<div><a>Dana Ortiz</a><span>Founder</span></div>): the pieces are the leaves, not the run-together whole.
      const own = Array.from(el.childNodes).filter((n: any) => n.nodeType === 3).map((n: any) => String(n.textContent ?? "")).join("").trim();
      if (BLOCK_TAGS.has(el.tagName) && !own && Array.from(el.children).filter((c) => text(c as Element)).length >= 2) continue;
      let up = el.parentElement, inside = false;
      while (up) { if (leafSet.has(up)) { inside = true; break; } up = up.parentElement; }
      const t = text(el);
      if (inside || !t || t.length > 120) continue;
      leaves.push(el); leafSet.add(el);
      if (leaves.length >= 3000) break;
    }
    const isName = (t: string) => t.length <= 40 && PERSON_NAME.test(t) && !NOT_A_NAME.test(t) && !ROLE_WORD.test(t);
    const isRole = (t: string) => t.length <= 80 && t.split(" ").length <= 8 && ROLE_WORD.test(t) && !/[.!?]$/.test(t);
    const staff: string[] = [], quoted: string[] = [];
    const add = (l: string, inQuote: boolean) => {
      const [list, max, chars] = inQuote ? [quoted, 10, 600] : [staff, 20, 1500];
      if (!staff.includes(l) && !quoted.includes(l) && list.length < max && list.join("\n").length + l.length + 1 <= chars) list.push(l);
    };
    // A testimonial, review or case-study card is not a staff card. Its signs: a quote, a testimonial/review/client
    // marker on the card or on what holds it, or a heading above it such as "What our clients say".
    // An employer after "at" ("at" "Harbor Logistics") reads like a name but is a company: it doesn't end a person's card.
    const nameLeaves = leaves.filter((x, i) => isName(text(x)) && !/^(?:at|@)$/i.test(i ? text(leaves[i - 1]) : ""));
    const headingBefore: string[] = [];
    leaves.forEach((x, i) => { headingBefore[i] = /^H[1-4]$/.test(x.tagName) ? text(x) : i ? headingBefore[i - 1] : ""; });
    const marked = (x: Element) => QUOTE_ATTR.test(["class", "id", "aria-label", "title", "alt", "role"].map((a) => x.getAttribute?.(a) ?? "").join(" "));
    const inQuote = (el: Element, i: number): boolean => {
      // The person's own card: the largest container around the name that names nobody else.
      let own: Element = el;
      for (let k = 0; k < 8 && own.parentElement && own.parentElement.tagName !== "BODY"; k++) {
        const up = own.parentElement;
        if (nameLeaves.some((x) => x !== el && up.contains(x) && text(x) !== text(el))) break;
        own = up;
      }
      if (own.querySelector("blockquote, q") || [own, ...Array.from(own.querySelectorAll("*"))].some(marked)) return true;
      if (leaves.some((x) => own.contains(x) && /^["“‘]/.test(text(x)) && text(x).length > 20)) return true;
      // A company's logo on the person's card (a client's, beside their quote). A social icon or the person's own photo is not one.
      if (Array.from(own.querySelectorAll("img")).some((img) => {
        const alt = String(img.getAttribute("alt") ?? "").trim();
        return LOGO.test(["class", "id", "src"].map((a) => img.getAttribute(a) ?? "").join(" ")) && !!alt && alt !== text(el) && !SOCIAL.test(alt);
      })) return true;
      for (let up = own.parentElement; up && up.tagName !== "BODY"; up = up.parentElement) if (marked(up)) return true;
      const heading = headingBefore[i - 1] ?? "";
      return QUOTE_HEADING.test(heading) && !TEAM_HEADING.test(heading);
    };
    leaves.forEach((el, i) => {
      const t = text(el);
      // Already one line: "Tess Harlow, Head of Marketing, Brightline" / "Dana Ortiz – Founder".
      const one = t.match(/^(.{3,40}?)\s*(?:,|\s[–—|-]\s)\s*(.{2,80})$/);
      if (one && isName(one[1].trim()) && isRole(one[2].split(/,|\s[–—|-]\s/)[0].trim())) { add(`${one[1].trim()}, ${one[2].trim()}`, inQuote(el, i)); return; }
      if (!isName(t)) return;
      // The card: the nearest ancestor holding more than this one leaf (at most 3 levels up).
      let card: Element | null = el.parentElement;
      for (let k = 0; card && k < 3 && leaves.filter((x) => x !== el && card!.contains(x)).length === 0; k++) card = card.parentElement;
      if (!card) return;
      const inCard = leaves.filter((x) => card!.contains(x));
      const at = inCard.indexOf(el);
      // Which way the card reads (name then role, or role then name) is set by its first name-or-role leaf.
      const first = inCard.find((x) => isName(text(x)) || isRole(text(x)));
      const roleFirst = !!first && isRole(text(first));
      const role = roleFirst ? inCard[at - 1] : inCard[at + 1];
      if (role && isRole(text(role)) && leaves.indexOf(role) === (roleFirst ? i - 1 : i + 1)) {
        // The employer, when the card splits it off: "CEO" "at" "Orchard Labs" is one role, at another company.
        const r = inCard.indexOf(role), next = inCard[r + 1] ? text(inCard[r + 1]) : "", after = inCard[r + 2] ? text(inCard[r + 2]) : "";
        const employer = /^(?:at|@)$/i.test(next) && after && after.length <= 60 ? ` at ${after}` : /^(?:at|@)\s+\S/i.test(next) && next.length <= 64 ? ` ${next}` : "";
        add(`${t}, ${text(role)}${employer}`, inQuote(el, i));
      }
    });
    return { staff, quoted };
  } catch {
    return { staff: [], quoted: [] };
  }
}

/** The staff lines only, one per line (what extractPeople calls `staff`). */
export async function extractPeopleBlock(bytes: Uint8Array): Promise<string> {
  return (await extractPeople(bytes)).staff.join("\n");
}

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
      let target = ""; try { target = decodeURIComponent(href.replace(/^(mailto|tel):/i, "").split("?")[0]); } catch { target = href.replace(/^(mailto|tel):/i, "").split("?")[0]; }
      const shown = cleanText(a.textContent ?? "").trim();
      // When the link shows an address, that is the address (a mailto target can be broken, e.g. "info@www.example.com").
      const v = (/^mailto/i.test(href) && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(shown) ? shown : target).slice(0, 120);
      if (v) add(`${/^mailto/i.test(href) ? "Email" : "Phone"}: ${v}`);
    }
    return lines.join("\n").slice(0, 2000);
  } catch {
    return "";
  }
}
