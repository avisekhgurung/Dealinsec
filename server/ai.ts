/**
 * AI helpers for the free tools — "describe → invoice" via DeepSeek.
 *
 * The DeepSeek API key lives ONLY here (server-side, from env). The public
 * free-tool pages call our own /api/ai/* endpoint, never DeepSeek directly, so
 * the key is never shipped to the browser. Rate limits (per-IP + a global daily
 * cap) and input caps protect the owner's API credits from abuse.
 */

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

const ALLOWED_RATES = [0, 5, 18, 40];

function clampNum(x: unknown, fallback: number): number {
  const v = Number(x);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

export interface AiInvoice {
  bizName: string;
  cliName: string;
  items: { desc: string; qty: number; rate: number }[];
  gstRate: string;
  taxType: "cgst_sgst" | "igst";
  notes: string;
}

function normalize(p: any): AiInvoice {
  let gstRate = Number(p?.gstRate);
  if (!ALLOWED_RATES.includes(gstRate)) gstRate = 18;
  const items = Array.isArray(p?.items)
    ? p.items.slice(0, 20).map((it: any) => ({
        desc: String(it?.desc ?? "").slice(0, 200),
        qty: clampNum(it?.qty, 1),
        rate: clampNum(it?.rate, 0),
      }))
    : [];
  return {
    bizName: String(p?.bizName ?? "").slice(0, 120),
    cliName: String(p?.cliName ?? "").slice(0, 120),
    items,
    gstRate: String(gstRate),
    taxType: p?.taxType === "igst" ? "igst" : "cgst_sgst",
    notes: String(p?.notes ?? "").slice(0, 500),
  };
}

const SYSTEM_PROMPT = `You convert a short natural-language description of an Indian invoice into structured JSON. Output ONLY a JSON object with exactly this shape and nothing else:
{"bizName": string, "cliName": string, "items": [{"desc": string, "qty": number, "rate": number}], "gstRate": number, "taxType": "cgst_sgst" | "igst", "notes": string}
Rules:
- "rate" is the per-unit amount in Indian Rupees as a plain number (no symbols, no commas). If a line gives a total for a quantity, divide to get the per-unit rate.
- "qty" defaults to 1 when not stated.
- "gstRate" MUST be one of 0, 5, 18, or 40 (the Indian GST slabs). Default to 18. Use 0 only if the text says no GST / 0% / exempt.
- "taxType" is "igst" ONLY if the text clearly indicates an inter-state / different-state sale or says IGST; otherwise "cgst_sgst".
- The party being billed — phrased as "bill X", "invoice X", "for X", "to X", "charge X" — is the CLIENT: put that name in "cliName". Put a name in "bizName" ONLY when the text explicitly names the sender's own business (e.g. "from Sunrise Studios", "my company X"). When unsure, prefer "cliName".
- Set "bizName", "cliName" and "notes" only from the text; if absent use "". NEVER invent business or client names that are not in the text.
- No commentary, no markdown, JSON only.`;

/** Extract a structured invoice from a free-text description via DeepSeek. */
export async function extractInvoice(text: string): Promise<AiInvoice> {
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
          { role: "system", content: SYSTEM_PROMPT },
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
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw Object.assign(new Error("AI returned invalid JSON"), { billed: true });
  }
  return normalize(parsed);
}

export const AI_MAX_INPUT = MAX_INPUT;
