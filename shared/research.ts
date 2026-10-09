/**
 * Researching a lead from its OWN website: what a model may claim, and how every claim is checked.
 * Pure: no model, no network, no database. The model reads pages and proposes findings; this module
 * decides what is believed.
 *
 *  - A finding is kept only if its quote really appears on the page it cites (after whitespace and
 *    typographic-quote normalisation, nothing fuzzier). A fabricated or paraphrased quote is dropped.
 *  - A STATED fact (an email, a phone number, a team size, a launch) can be "confirmed" when its quote
 *    verifies. A JUDGMENT (a pain point, an opportunity, a buying signal, timing) is at best "inferred"
 *    however well it is quoted: a quote proves the evidence exists, not that the conclusion is right.
 *  - Contact details are checked against what they claim to be: an email must be a role address
 *    (info@, sales@...) on the lead's own domain and appear in the quote; a phone number's digits must
 *    appear in the quote. Nothing about private individuals is collected beyond a stated name and role.
 *  - Text that reads like an instruction to an AI (page text the model echoed) is dropped, not stored.
 */
export type ClaimStatus = "confirmed" | "inferred";
export type FieldKind = "fact" | "judgment";

/** The only fields research may write. Scored fields are the ones in shared/lead-score.ts FIELD_FAMILIES; the rest describe the business. */
export const RESEARCH_FIELDS = {
  business_email: "fact", business_phone: "fact", contact_form: "fact", decision_maker: "fact", team_size: "fact",
  recent_news: "fact", hiring: "fact", launch: "fact",
  description: "fact", services: "fact", industry: "fact", location: "fact",
  pain_point: "judgment", opportunity: "judgment", buying_signal: "judgment", timing: "judgment",
} as const satisfies Record<string, FieldKind>;
export type ResearchField = keyof typeof RESEARCH_FIELDS;
export const isResearchField = (f: unknown): f is ResearchField => typeof f === "string" && Object.prototype.hasOwnProperty.call(RESEARCH_FIELDS, f);

/** Local parts accepted for a business email: a mailbox for the company, not a person. */
export const ROLE_LOCALS = ["info", "sales", "hello", "contact", "enquiries", "enquiry", "office", "mail", "general", "admin", "team", "support", "bookings", "booking", "reservations"] as const;

export const LIMITS = { findings: 40, value: 300, quoteMin: 8, quoteMax: 300 } as const;

export interface ResearchPage { /** 1-based, as the model cites it. */ index: number; url: string; text: string }
export interface ClaimDraft { field: ResearchField; value: string; status: ClaimStatus; evidenceUrl: string; evidenceSnippet: string }
export type RejectReason = "not_an_object" | "bad_field" | "bad_page" | "bad_value" | "bad_quote" | "quote_not_found" | "suspicious" | "invalid_contact" | "duplicate";
export interface Rejection { reason: RejectReason; field?: string }
export interface Normalized { claims: ClaimDraft[]; rejected: Rejection[] }

// ── text helpers ───────────────────────────────────────────────────────────

/** Whitespace collapsed and typographic quotes, dashes and non-breaking spaces straightened, so a verbatim quote survives how a page renders it. Nothing fuzzier. */
export function normalizeForQuote(s: string): string {
  return s.normalize("NFKC")
    .replace(/[‘’‛′]/g, "'").replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-").replace(/ /g, " ").replace(/\s+/g, " ").trim();
}
export const quoteInPage = (quote: string, pageText: string): boolean => {
  const q = normalizeForQuote(quote);
  return q.length >= LIMITS.quoteMin && normalizeForQuote(pageText).includes(q);
};
// eslint-disable-next-line no-control-regex
export const cleanLine = (s: string) => s.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim();

/** Phrases that read like an instruction to an AI. A page can contain them; a stored fact should not. */
const INJECTION = /(ignore|disregard|forget|override)\s+(all\s+|any\s+|the\s+|your\s+)?(previous|prior|above|earlier|system)|system\s+(prompt|override|message)|you\s+are\s+(now\s+)?(an?\s+)?(ai|assistant|language model|chatgpt)|as\s+an?\s+ai\b|new\s+instructions?\b|<\/?untrusted|reveal\s+(your|the)\s+(prompt|instructions)/i;
export const injectionLike = (s: string): boolean => INJECTION.test(s);

export const siteHost = (h: string): string => h.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
/** The same site: equal hosts, ignoring a leading www. */
export const sameSite = (a: string, b: string): boolean => siteHost(a) === siteHost(b);
export const onSite = (host: string, site: string) => siteHost(host) === siteHost(site) || siteHost(host).endsWith(`.${siteHost(site)}`);
const digits = (s: string) => s.replace(/\D/g, "");

// ── finding-specific checks ────────────────────────────────────────────────

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
/** Field-specific checks on a quoted contact detail (exported for the prospect validators, shared/prospect-intel.ts). */
export function checkContact(field: ResearchField, value: string, quote: string, site: string): boolean {
  const q = normalizeForQuote(quote).toLowerCase();
  switch (field) {
    case "business_email": {
      const v = value.trim().toLowerCase();
      if (!EMAIL.test(v)) return false;
      const [local, domain] = v.split("@");
      return (ROLE_LOCALS as readonly string[]).includes(local) && onSite(domain, site) && q.includes(v);
    }
    case "business_phone": { const d = digits(value); return d.length >= 7 && d.length <= 15 && digits(quote).includes(d); }
    case "contact_form": { try { const u = new URL(value); return u.protocol === "https:" && onSite(u.hostname, site); } catch { return false; } }
    case "decision_maker": {
      const name = value.split(",")[0].trim().split(/\s+/).filter((w) => w.length >= 2);
      return name.length >= 2 && name.every((w) => q.includes(w.toLowerCase()));
    }
    case "team_size": { const nums = value.match(/\d+/g); return !!nums && nums.some((n) => digits(quote).includes(n)); }
    default: return true;
  }
}

/**
 * Turn the model's raw JSON into the claims we are willing to store, and say what was thrown away and why.
 * `raw` is whatever the model returned ({findings:[{field,value,quote,page}]}); nothing in it is trusted.
 */
export function normalizeFindings(raw: unknown, pages: ResearchPage[], site: string): Normalized {
  const rejected: Rejection[] = [];
  const list = raw && typeof raw === "object" && Array.isArray((raw as any).findings) ? ((raw as any).findings as unknown[]) : [];
  const best = new Map<ResearchField, ClaimDraft>();

  for (const item of list.slice(0, LIMITS.findings)) {
    if (!item || typeof item !== "object") { rejected.push({ reason: "not_an_object" }); continue; }
    const f = item as Record<string, unknown>;
    if (!isResearchField(f.field)) { rejected.push({ reason: "bad_field", field: typeof f.field === "string" ? f.field.slice(0, 40) : undefined }); continue; }
    const field = f.field;
    const page = typeof f.page === "number" && Number.isInteger(f.page) ? pages.find((p) => p.index === f.page) : undefined;
    if (!page) { rejected.push({ reason: "bad_page", field }); continue; }
    if (typeof f.value !== "string") { rejected.push({ reason: "bad_value", field }); continue; }
    const value = cleanLine(f.value);
    if (!value || value.length > LIMITS.value) { rejected.push({ reason: "bad_value", field }); continue; }
    if (typeof f.quote !== "string") { rejected.push({ reason: "bad_quote", field }); continue; }
    const quote = cleanLine(f.quote);
    if (quote.length < LIMITS.quoteMin || quote.length > LIMITS.quoteMax) { rejected.push({ reason: "bad_quote", field }); continue; }
    if (injectionLike(value) || injectionLike(quote)) { rejected.push({ reason: "suspicious", field }); continue; }
    if (!quoteInPage(f.quote, page.text)) { rejected.push({ reason: "quote_not_found", field }); continue; }
    if (!checkContact(field, value, quote, site)) { rejected.push({ reason: "invalid_contact", field }); continue; }

    const status: ClaimStatus = RESEARCH_FIELDS[field] === "fact" ? "confirmed" : "inferred";
    const draft: ClaimDraft = { field, value, status, evidenceUrl: page.url, evidenceSnippet: quote };
    // One claim per field (the first verified one): a field's status is fixed by its kind, so there is nothing to rank.
    if (best.has(field)) rejected.push({ reason: "duplicate", field });
    else best.set(field, draft);
  }

  // At most one claim per field, and there are only so many fields: that is the bound on a run.
  const claims = Array.from(best.values());
  return { claims, rejected };
}

/** How many were thrown away, by reason: what a run reports. */
export function summarize(n: Normalized): { kept: number; confirmed: number; inferred: number; rejected: Record<string, number> } {
  const rejected: Record<string, number> = {};
  for (const r of n.rejected) rejected[r.reason] = (rejected[r.reason] ?? 0) + 1;
  return { kept: n.claims.length, confirmed: n.claims.filter((c) => c.status === "confirmed").length, inferred: n.claims.filter((c) => c.status === "inferred").length, rejected };
}

// ── choosing the other pages to read ───────────────────────────────────────

export interface PageLink { href: string; text: string }
/** In this order of usefulness: where an email lives, what the business is, what it does. */
const WANTED = [/contact/i, /about|who-we-are|our-story|company/i, /services|solutions|what-we-do|products|offer/i, /careers|jobs|hiring|news|press/i];
const SKIP_PATH = /\.(pdf|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|mp4|mp3)$|\/(login|signin|sign-in|cart|checkout|account|privacy|terms|cookies?|legal|wp-admin|wp-login)\b/i;

/** Up to `max` other pages of the SAME site worth reading, never the home page itself, never an asset, never off-site. */
export function pickLinks(links: PageLink[], home: URL, max = 2): string[] {
  const seen = new Set<string>([home.pathname.replace(/\/+$/, "") || "/"]);
  const usable: { url: URL; label: string }[] = [];
  for (const l of links) {
    let u: URL;
    try { u = new URL(l.href, home); } catch { continue; }
    if (u.protocol !== "https:" || !sameSite(u.hostname, home.hostname) || u.port) continue;
    if (SKIP_PATH.test(u.pathname)) continue;
    u.hash = "";
    usable.push({ url: u, label: `${u.pathname} ${l.text}` });
  }
  const out: string[] = [];
  for (const want of WANTED) {
    for (const c of usable) {
      const key = c.url.pathname.replace(/\/+$/, "") || "/";
      if (seen.has(key) || !want.test(c.label)) continue;
      seen.add(key); out.push(c.url.toString());
      break;
    }
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}
