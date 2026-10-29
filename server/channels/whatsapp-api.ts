/**
 * The WhatsApp Business Platform Cloud API (graph.facebook.com), with the workspace's own business number and access
 * token. Only what DealInSec uses: check a number, list its approved templates, send a text (inside the 24-hour customer
 * service window) or an approved template. The token travels only in the Authorization header and is never logged.
 *
 * A send that got no answer (a timeout, a dropped connection) is "uncertain", never "failed": the API has no idempotency
 * key, so retrying it could deliver the message twice. The caller keeps it uncertain until a person decides.
 */
export const WHATSAPP_GRAPH_VERSION = () => (/^v\d{1,2}\.\d$/.test(process.env.WHATSAPP_GRAPH_VERSION ?? "") ? process.env.WHATSAPP_GRAPH_VERSION! : "v23.0");
const BASE = () => `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION()}`;

export type WhatsappErrorCode =
  | "auth"            // the token is invalid or expired (Graph error 190)
  | "permission"      // the token lacks a permission, or the number isn't the app's (10, 200, 100 on the number)
  | "window_closed"   // more than 24 hours since they last wrote: only a template may be sent (131047)
  | "template"        // the template is missing, not approved, or its parameters don't match (132000–132016)
  | "recipient"       // the number can't receive this message (131026, 131021, 131030)
  | "rate_limited"    // too many messages, to this person or in total (130429, 131048, 131056, 80007, 4)
  | "rejected"        // any other refusal from the API
  | "uncertain";      // no answer: it may or may not have been sent

export class WhatsappError extends Error {
  /** `detail` is Meta's own explanation (error message + error_data.details): the error body never carries the token. */
  constructor(readonly code: WhatsappErrorCode, readonly providerCode: number | null, message: string, readonly detail: string | null = null) { super(message); }
}

export interface WhatsappTemplate { name: string; language: string; category: string; body: string; params: number }

export interface WhatsappClient {
  phoneInfo(token: string, phoneNumberId: string): Promise<{ displayPhone: string | null; verifiedName: string | null }>;
  templates(token: string, wabaId: string): Promise<WhatsappTemplate[]>;
  sendText(token: string, phoneNumberId: string, to: string, body: string): Promise<{ id: string }>;
  sendTemplate(token: string, phoneNumberId: string, to: string, t: { name: string; language: string; params: string[] }): Promise<{ id: string }>;
}

/** Graph's error codes, as the person should read them (codes from Meta's Cloud API error reference). */
export function mapGraphError(status: number, err: { code?: unknown; error_subcode?: unknown } | null | undefined): WhatsappErrorCode {
  const code = Number(err?.code);
  if (code === 190 || status === 401) return "auth";
  if (code === 131047) return "window_closed";
  if (code >= 132000 && code <= 132016) return "template";
  if ([131026, 131021, 131030, 131009].includes(code)) return "recipient";
  if ([130429, 131048, 131056, 80007, 4].includes(code) || status === 429) return "rate_limited";
  if ([10, 200, 131005].includes(code) || status === 403) return "permission";
  return "rejected";
}

const digits = (e164: string) => e164.replace(/^\+/, "");

export function whatsappClient(fetchImpl: typeof fetch = fetch, timeoutMs = 15_000): WhatsappClient {
  async function call(method: "GET" | "POST", path: string, token: string, body: unknown, isSend: boolean): Promise<any> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(`${BASE()}${path}`, {
        method, signal: ctrl.signal,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new WhatsappError(isSend ? "uncertain" : "rejected", null, isSend ? "WhatsApp didn't answer, so it isn't known whether the message was sent." : "WhatsApp couldn't be reached.");
    } finally { clearTimeout(timer); }
    let json: any = null;
    try { json = await res.json(); } catch { json = null; }
    if (!res.ok || json?.error) {
      const detail = [json?.error?.message, json?.error?.error_data?.details]
        .filter((s: unknown): s is string => typeof s === "string" && !!s.trim()).join(" — ").slice(0, 300) || null;
      // A 5xx on a send may still have gone out: uncertain, not failed.
      if (isSend && res.status >= 500) throw new WhatsappError("uncertain", Number(json?.error?.code) || null, "WhatsApp had a problem, so it isn't known whether the message was sent.", detail);
      throw new WhatsappError(mapGraphError(res.status, json?.error), Number(json?.error?.code) || null, "WhatsApp refused the request.", detail);
    }
    return json;
  }
  const sentId = (json: any): { id: string } => {
    const id = json?.messages?.[0]?.id;
    if (typeof id !== "string" || !id || id.length > 200) throw new WhatsappError("uncertain", null, "WhatsApp answered without a message id.");
    return { id };
  };
  return {
    async phoneInfo(token, phoneNumberId) {
      const j = await call("GET", `/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`, token, null, false);
      return { displayPhone: typeof j?.display_phone_number === "string" ? j.display_phone_number.slice(0, 32) : null, verifiedName: typeof j?.verified_name === "string" ? j.verified_name.slice(0, 120) : null };
    },
    async templates(token, wabaId) {
      const j = await call("GET", `/${encodeURIComponent(wabaId)}/message_templates?fields=name,language,status,category,components&limit=100`, token, null, false);
      const out: WhatsappTemplate[] = [];
      for (const t of Array.isArray(j?.data) ? j.data : []) {
        if (t?.status !== "APPROVED" || typeof t.name !== "string" || typeof t.language !== "string") continue;
        const comps = Array.isArray(t.components) ? t.components : [];
        // Only templates whose parameters are all in a plain-text body: a header image or buttons with variables need
        // values DealInSec doesn't collect, so those aren't offered.
        if (comps.some((c: any) => c?.type !== "BODY" && c?.type !== "FOOTER" && !(c?.type === "HEADER" && c?.format === "TEXT" && !/\{\{/.test(c?.text ?? "")) && !(c?.type === "BUTTONS" && !JSON.stringify(c).includes("{{")))) continue;
        const body = String(comps.find((c: any) => c?.type === "BODY")?.text ?? "");
        if (!body) continue;
        const params = new Set(Array.from(body.matchAll(/\{\{(\d{1,2})\}\}/g)).map((m) => m[1])).size;
        out.push({ name: t.name.slice(0, 120), language: t.language.slice(0, 15), category: String(t.category ?? "").toLowerCase().slice(0, 20), body: body.slice(0, 1024), params });
      }
      return out;
    },
    async sendText(token, phoneNumberId, to, body) {
      return sentId(await call("POST", `/${encodeURIComponent(phoneNumberId)}/messages`, token, { messaging_product: "whatsapp", recipient_type: "individual", to: digits(to), type: "text", text: { body, preview_url: false } }, true));
    },
    async sendTemplate(token, phoneNumberId, to, t) {
      return sentId(await call("POST", `/${encodeURIComponent(phoneNumberId)}/messages`, token, {
        messaging_product: "whatsapp", recipient_type: "individual", to: digits(to), type: "template",
        template: { name: t.name, language: { code: t.language }, ...(t.params.length ? { components: [{ type: "body", parameters: t.params.map((text) => ({ type: "text", text })) }] } : {}) },
      }, true));
    },
  };
}

/** A template's body with its parameters filled in: exactly the text the person approves and the recipient sees. */
export const fillTemplate = (body: string, params: string[]) => body.replace(/\{\{(\d{1,2})\}\}/g, (m, n) => params[Number(n) - 1] ?? m);
