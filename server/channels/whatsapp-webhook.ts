/**
 * The WhatsApp webhook (Meta Graph webhooks): the subscription handshake and the signed event notifications.
 *
 *   GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…   answer the challenge only for our verify token
 *   POST X-Hub-Signature-256: sha256=<HMAC-SHA256 of the raw body with the app secret>
 *
 * Pure: no database. The signature is checked on the exact bytes received (never on re-serialized JSON), in constant
 * time; without an app secret configured, nothing is accepted. Parsing keeps only what DealInSec uses: the business
 * number an event is for, message status changes, and inbound messages (text bodies are kept; other types are noted
 * by type only).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyChallenge(q: Record<string, unknown>, verifyToken: string | undefined): string | null {
  if (!verifyToken || q["hub.mode"] !== "subscribe" || typeof q["hub.verify_token"] !== "string") return null;
  const a = Buffer.from(q["hub.verify_token"]), b = Buffer.from(verifyToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const challenge = q["hub.challenge"];
  return typeof challenge === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(challenge) ? challenge : null;
}

export function verifySignature(raw: Buffer | undefined, header: unknown, appSecret: string | undefined): boolean {
  if (!appSecret || !raw || typeof header !== "string" || !header.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(raw).digest("hex");
  const got = header.slice(7);
  if (!/^[a-f0-9]{64}$/i.test(got)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(got.toLowerCase(), "hex"));
}

export type StatusValue = "sent" | "delivered" | "read" | "failed";
export interface StatusEvent { phoneNumberId: string; wamid: string; status: StatusValue; at: Date; errorCode: number | null }
export interface InboundEvent { phoneNumberId: string; wamid: string; from: string; at: Date; type: string; text: string | null }

const at = (ts: unknown) => { const n = Number(ts); return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date(); };
const id = (v: unknown, max = 200) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);

/** The events in one notification. Anything malformed is skipped, never thrown. */
export function parseNotification(body: unknown): { statuses: StatusEvent[]; inbound: InboundEvent[] } {
  const statuses: StatusEvent[] = [], inbound: InboundEvent[] = [];
  const b = body as any;
  if (b?.object !== "whatsapp_business_account" || !Array.isArray(b.entry)) return { statuses, inbound };
  for (const entry of b.entry.slice(0, 50)) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes.slice(0, 50) : []) {
      if (change?.field !== "messages") continue;
      const v = change.value, phoneNumberId = id(v?.metadata?.phone_number_id, 40);
      if (!phoneNumberId) continue;
      for (const s of Array.isArray(v.statuses) ? v.statuses.slice(0, 200) : []) {
        const wamid = id(s?.id);
        if (!wamid || !["sent", "delivered", "read", "failed"].includes(s?.status)) continue;
        const code = Number(s?.errors?.[0]?.code);
        statuses.push({ phoneNumberId, wamid, status: s.status, at: at(s.timestamp), errorCode: Number.isFinite(code) ? code : null });
      }
      for (const m of Array.isArray(v.messages) ? v.messages.slice(0, 200) : []) {
        const wamid = id(m?.id), from = typeof m?.from === "string" && /^\d{8,15}$/.test(m.from) ? `+${m.from}` : null;
        if (!wamid || !from) continue;
        const type = typeof m.type === "string" ? m.type.slice(0, 20) : "unknown";
        // A quick-reply button ("Stop promotions") arrives as a button or interactive reply: its title is its text.
        const text = type === "text" ? m.text?.body : type === "button" ? m.button?.text : type === "interactive" ? (m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title) : null;
        inbound.push({ phoneNumberId, wamid, from, at: at(m.timestamp), type, text: typeof text === "string" ? text.slice(0, 4096) : null });
      }
    }
  }
  return { statuses, inbound };
}
