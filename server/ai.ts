/**
 * AI helpers for the free tools — "describe → invoice" via DeepSeek.
 *
 * The DeepSeek API key lives ONLY here (server-side, from env). The public
 * free-tool pages call our own /api/ai/* endpoint, never DeepSeek directly, so
 * the key is never shipped to the browser. Rate limits (per-IP + a global daily
 * cap) and input caps protect the owner's API credits from abuse.
 */
import { CURRENCIES, fromMinor, getCurrency, toMinor, type CurrencyMeta } from "@shared/schema";

const DEEPSEEK_URL = process.env.DEEPSEEK_URL || "https://api.deepseek.com/chat/completions";
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const IP_LIMIT = Number(process.env.DEEPSEEK_IP_LIMIT || 12); // per IP per day
const DAILY_LIMIT = Number(process.env.DEEPSEEK_DAILY_LIMIT || 3000); // global per day (credit safety valve)
const MAX_INPUT = 600;

export function aiEnabled(): boolean {
  return !!process.env.DEEPSEEK_API_KEY;
}

// ── In-memory rate limiter (resets on server restart; fine for this scale) ──
const ipHits = new Map<string, { n: number; day: string }>();
let daily = { n: 0, day: "" };
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Atomically RESERVE a generation slot BEFORE the (awaited) DeepSeek call, so a
// concurrent burst can't all pass the check while the counters are still low.
// The increment happens synchronously (Node is single-threaded), so it is atomic
// with the check — no time-of-check/time-of-use gap across the await.
export function reserve(ip: string): { ok: boolean; reason?: "ip" | "daily" } {
  const d = today();
  if (daily.day !== d) daily = { n: 0, day: d };
  if (daily.n >= DAILY_LIMIT) return { ok: false, reason: "daily" };
  if (ipHits.size > 5000) ipHits.forEach((v, k) => { if (v.day !== d) ipHits.delete(k); });
  let rec = ipHits.get(ip);
  if (!rec || rec.day !== d) { rec = { n: 0, day: d }; ipHits.set(ip, rec); }
  if (rec.n >= IP_LIMIT) return { ok: false, reason: "ip" };
  rec.n++;
  daily.n++;
  return { ok: true };
}

// Give the slot back — ONLY for failures where DeepSeek did not bill us (network
// error / non-2xx). A billed 2xx that later fails to parse KEEPS its slot, so it
// still counts against the owner's credits and can't be retried for free.
export function refund(ip: string): void {
  const d = today();
  const rec = ipHits.get(ip);
  if (rec && rec.day === d && rec.n > 0) rec.n--;
  if (daily.day === d && daily.n > 0) daily.n--;
}

/**
 * Which kind of invoice a description is being turned into.
 *
 * The tax fields are the whole difference, and getting them wrong is silent.
 * The GST tool's form has a slab select (0/5/18/40) and a CGST+SGST / IGST
 * switch, so coercing the model onto those is right THERE — that page is an
 * Indian GST invoice by URL, whoever opens it. Applied to anyone else it
 * invents tax: "£1,200 logo for Acme" would come back as 18% CGST+SGST, and a
 * "Tax: 18%" line implies a registration the freelancer does not have.
 *
 * So the Indian rules are one named profile rather than the prompt itself,
 * and the generic profile knows no tax system at all. It reports a rate only
 * when the text states one and never supplies a default: where we don't know a
 * country's tax treatment, the rate is the user's to enter, not ours to guess.
 */
export type InvoiceProfile =
  | { kind: "gst_in" }
  | { kind: "generic"; currency: string };

/** The Indian GST slab form — the profile /tools/gst-invoice-generator has
 *  always had, and the default so that caller is unchanged. */
export const GST_INDIA_PROFILE = { kind: "gst_in" } as const satisfies InvoiceProfile;

const ALLOWED_RATES = [0, 5, 18, 40];

function clampNum(x: unknown, fallback: number): number {
  const v = Number(x);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

type AiItem = { desc: string; qty: number; rate: number };

export interface AiInvoice {
  bizName: string;
  cliName: string;
  items: AiItem[];
  gstRate: string;
  taxType: "cgst_sgst" | "igst";
  notes: string;
}

export interface AiGenericInvoice {
  bizName: string;
  cliName: string;
  /** `rate` is MAJOR units of `currency`, as a person types it into the form —
   *  the caller converts at its own toMinor() boundary if it stores anything. */
  items: AiItem[];
  currency: string;
  /** A percentage the text itself stated, else null. Never 0 by default: a
   *  "Tax: 0%" row reads as a registration, and the no-tax invoice must render
   *  with no tax row at all. */
  taxRate: number | null;
  /** The tax's name as the text wrote it ("VAT", "sales tax"), else "". */
  taxLabel: string;
  /** ISO code when the text priced the work in some OTHER currency. The
   *  numbers are copied as written, never converted — the caller must warn. */
  statedCurrency: string;
  notes: string;
}

function normalizeItems(p: any, rate: (major: number) => number = (r) => r): AiItem[] {
  return Array.isArray(p?.items)
    ? p.items.slice(0, 20).map((it: any) => ({
        desc: String(it?.desc ?? "").slice(0, 200),
        qty: clampNum(it?.qty, 1),
        rate: rate(clampNum(it?.rate, 0)),
      }))
    : [];
}

function normalize(p: any): AiInvoice {
  let gstRate = Number(p?.gstRate);
  if (!ALLOWED_RATES.includes(gstRate)) gstRate = 18;
  const items = normalizeItems(p);
  return {
    bizName: String(p?.bizName ?? "").slice(0, 120),
    cliName: String(p?.cliName ?? "").slice(0, 120),
    items,
    gstRate: String(gstRate),
    taxType: p?.taxType === "igst" ? "igst" : "cgst_sgst",
    notes: String(p?.notes ?? "").slice(0, 500),
  };
}

function normalizeGeneric(p: any, currency: CurrencyMeta): AiGenericInvoice {
  // `Number(null)` is 0, which would turn "no tax stated" into a 0% tax row —
  // so absence is tested before conversion, not after.
  const rawTax = p?.taxRate;
  const tax = typeof rawTax === "number" || (typeof rawTax === "string" && rawTax.trim() !== "") ? Number(rawTax) : NaN;
  const stated = String(p?.statedCurrency ?? "").trim().toUpperCase();
  return {
    bizName: String(p?.bizName ?? "").slice(0, 120),
    cliName: String(p?.cliName ?? "").slice(0, 120),
    // Snap each rate to the currency's real precision (none for JPY), so the
    // form never holds a fraction of a cent that toMinor() would round later.
    items: normalizeItems(p, (r) => fromMinor(toMinor(r, currency.code), currency.code)),
    currency: currency.code,
    taxRate: Number.isFinite(tax) && tax >= 0 && tax <= 100 ? tax : null,
    taxLabel: String(p?.taxLabel ?? "").trim().slice(0, 40),
    statedCurrency: /^[A-Z]{3}$/.test(stated) && stated !== currency.code ? stated : "",
    notes: String(p?.notes ?? "").slice(0, 500),
  };
}

// Shared by both profiles: who is being billed has nothing to do with tax.
const PARTY_RULES = `- The party being billed — phrased as "bill X", "invoice X", "for X", "to X", "charge X" — is the CLIENT: put that name in "cliName". Put a name in "bizName" ONLY when the text explicitly names the sender's own business (e.g. "from Sunrise Studios", "my company X"). When unsure, prefer "cliName".
- Set "bizName", "cliName" and "notes" only from the text; if absent use "". NEVER invent business or client names that are not in the text.
- No commentary, no markdown, JSON only.`;

const GST_IN_PROMPT = `You convert a short natural-language description of an Indian invoice into structured JSON. Output ONLY a JSON object with exactly this shape and nothing else:
{"bizName": string, "cliName": string, "items": [{"desc": string, "qty": number, "rate": number}], "gstRate": number, "taxType": "cgst_sgst" | "igst", "notes": string}
Rules:
- "rate" is the per-unit amount in Indian Rupees as a plain number (no symbols, no commas). If a line gives a total for a quantity, divide to get the per-unit rate.
- "qty" defaults to 1 when not stated.
- "gstRate" MUST be one of 0, 5, 18, or 40 (the Indian GST slabs). Default to 18. Use 0 only if the text says no GST / 0% / exempt.
- "taxType" is "igst" ONLY if the text clearly indicates an inter-state / different-state sale or says IGST; otherwise "cgst_sgst".
${PARTY_RULES}`;

function genericPrompt({ code, name, exponent }: CurrencyMeta): string {
  const precision = exponent === 0 ? "whole numbers only" : `at most ${exponent} decimal places`;
  return `You convert a short natural-language description of an invoice into structured JSON. Output ONLY a JSON object with exactly this shape and nothing else:
{"bizName": string, "cliName": string, "items": [{"desc": string, "qty": number, "rate": number}], "taxRate": number | null, "taxLabel": string, "statedCurrency": string, "notes": string}
Rules:
- "rate" is the per-unit amount in ${name} (${code}) as a plain number: no symbols, no thousands separators, "." as the decimal point, ${precision}. Read European grouping like "1.250,50" as 1250.50. If a line gives a total for a quantity, divide to get the per-unit rate.
- NEVER convert between currencies. If the text prices the work in a currency other than ${code}, copy the numbers exactly as written and put that currency's ISO 4217 code in "statedCurrency"; otherwise "statedCurrency" is "".
- "qty" defaults to 1 when not stated.
- "taxRate" is a percentage ONLY when the text explicitly states one (e.g. "plus 20% VAT" gives 20); otherwise null. NEVER assume, default or look up a tax rate, and never infer one from a country, city or type of work.
- "taxLabel" is the tax's name exactly as the text writes it (e.g. "VAT", "sales tax"); "" if the text names none.
${PARTY_RULES}`;
}

/** Extract a structured invoice from a free-text description via DeepSeek.
 *
 *  With no profile this is the GST tool's extraction, byte-for-byte what it
 *  has always sent. Any other surface must pass its profile explicitly. */
export function extractInvoice(text: string, profile?: typeof GST_INDIA_PROFILE): Promise<AiInvoice>;
export function extractInvoice(text: string, profile: { kind: "generic"; currency: string }): Promise<AiGenericInvoice>;
export async function extractInvoice(
  text: string,
  profile: InvoiceProfile = GST_INDIA_PROFILE,
): Promise<AiInvoice | AiGenericInvoice> {
  let currency: CurrencyMeta | null = null;
  if (profile.kind === "generic") {
    // getCurrency() quietly falls back to INR for an unknown code — right for
    // rendering stored data, wrong here, where it would ask the model for
    // rupees on someone's dollar invoice. An unsupported code is a caller bug,
    // so refuse it before spending a credit.
    const code = profile.currency?.trim().toUpperCase();
    if (!code || !(code in CURRENCIES)) {
      throw Object.assign(new Error(`Unsupported invoice currency: ${profile.currency}`), { billed: false });
    }
    currency = getCurrency(code);
  }
  const parsed = await completeJson(currency ? genericPrompt(currency) : GST_IN_PROMPT, text);
  return currency ? normalizeGeneric(parsed, currency) : normalize(parsed);
}

/** One DeepSeek JSON completion. Throws with `billed` so the route knows
 *  whether to refund the caller's rate-limit slot. */
async function completeJson(systemPrompt: string, text: string): Promise<any> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw Object.assign(new Error("AI not configured"), { billed: false });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  let res: Response;
  try {
    res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text.slice(0, MAX_INPUT) },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 900,
      }),
      signal: controller.signal,
    });
  } catch {
    throw Object.assign(new Error("DeepSeek network error"), { billed: false });
  } finally {
    clearTimeout(timer);
  }
  // Non-2xx = not billed for a completion.
  if (!res.ok) throw Object.assign(new Error("DeepSeek upstream " + res.status), { billed: false });
  // From here we got a 2xx — the call IS billed regardless of what happens next.
  let data: any;
  try {
    data = await res.json();
  } catch {
    throw Object.assign(new Error("DeepSeek bad body"), { billed: true });
  }
  const content = data?.choices?.[0]?.message?.content || "{}";
  try {
    return JSON.parse(content);
  } catch {
    throw Object.assign(new Error("AI returned invalid JSON"), { billed: true });
  }
}

export const AI_MAX_INPUT = MAX_INPUT;

/* ── Public "try it" demo: client message → structured deal draft ──
 * Same completeJson() plumbing as the invoice extractor above, same
 * reserve()/refund() rate limiter (one shared public-AI budget). NEVER
 * writes anything — the route calling this has no database access to a
 * deal, and the caller has no session. */

export interface AnonDealDraft {
  client: string;
  project: string;
  /** MAJOR units, as the text stated them — never converted. */
  amount: number;
  /** ISO 4217 if the text named one; "" if not stated (the demo shows no $/₹
   *  symbol in that case rather than guess). */
  currency: string;
  timeline: string;
  deliverables: string[];
  revisions: number | null;
  advancePercent: number | null;
  /** One line per payment/scope condition actually stated — this is what
   *  Protection Check reads, so it must be text, not a summary of the text. */
  terms: string[];
}

const DEMO_DEAL_PROMPT = `You convert a short freelancer/client conversation into a structured JSON deal draft. Output ONLY a JSON object with exactly this shape and nothing else:
{"client": string, "project": string, "amount": number, "currency": string, "timeline": string, "deliverables": string[], "revisions": number | null, "advancePercent": number | null, "terms": string[]}
Rules:
- "client": the client's name if stated, else "".
- "project": a short 2-6 word title for the work.
- "amount": the total budget/fee as a plain number, expanding shorthand ("1.5k"->1500, "2 lakh"->200000). 0 if no amount is stated. NEVER invent a number that is not in the text.
- "currency": the ISO 4217 code the amount is actually in ($ -> USD, £ -> GBP, € -> EUR, ₹ -> INR) if a symbol or code is given; "" if the text gives no currency signal at all.
- "timeline": the stated duration or deadline in the text's own words (e.g. "2 weeks", "by Friday"); "" if not stated.
- "deliverables": short phrases for each concrete thing being delivered, max 6.
- "revisions": the stated revision/round limit as a number, else null. Never invent one.
- "advancePercent": the stated advance/upfront percentage, else null. Never invent one.
- "terms": one short line per payment or scope condition ACTUALLY STATED in the text (e.g. "50% advance", "2 revisions included", "payment after launch") — this is quoted for a risk check, so never add a condition that was not said, and never restate the whole message as one term.
No commentary, no markdown, JSON only.`;

function normalizeAnonDeal(p: any): AnonDealDraft {
  const currency = String(p?.currency ?? "").trim().toUpperCase();
  return {
    client: String(p?.client ?? "").slice(0, 120),
    project: String(p?.project ?? "").slice(0, 160) || "Untitled project",
    amount: clampNum(p?.amount, 0),
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "",
    timeline: String(p?.timeline ?? "").slice(0, 80),
    deliverables: Array.isArray(p?.deliverables) ? p.deliverables.slice(0, 6).map((d: any) => String(d).slice(0, 120)) : [],
    // A model quirk: it returns 0 for "not stated" despite the prompt saying
    // null — accepting 0 here would show a false "Revisions: 0" on the card, so
    // only a POSITIVE count counts as a real, stated limit.
    revisions: Number.isFinite(Number(p?.revisions)) && Number(p?.revisions) > 0 ? Number(p.revisions) : null,
    advancePercent: Number.isFinite(Number(p?.advancePercent)) && Number(p?.advancePercent) > 0 && Number(p?.advancePercent) <= 100 ? Number(p.advancePercent) : null,
    terms: Array.isArray(p?.terms) ? p.terms.slice(0, 8).map((t: any) => String(t).slice(0, 200)) : [],
  };
}

export async function extractDealDraft(text: string): Promise<AnonDealDraft> {
  const parsed = await completeJson(DEMO_DEAL_PROMPT, text);
  return normalizeAnonDeal(parsed);
}

