/**
 * The unsubscribe link in a campaign email: a public page, with no sign-in, where the person who received a message
 * says "stop". It does exactly what a reply asking to stop does, through the same stores:
 *   - the address goes on the workspace's do-not-contact list (reason "opt_out": never removable in the app). That
 *     list is checked at draft, approval and send, so this alone stops every later message to it;
 *   - "opted_out" is recorded once on the message (so it is counted, and its follow-ups are not drafted);
 *   - the lead is marked do-not-contact, its unsent messages are discarded and its follow-ups stopped.
 *
 * What makes a public, unauthenticated write safe:
 *   - the link carries "<message id>.<signature>". The signature is an HMAC over the workspace and the message id
 *     with a server secret, compared in constant time: a link can't be guessed, and can't be re-pointed at another
 *     message or workspace;
 *   - a GET only SHOWS the page. Mail scanners and link previews open links; the change happens on the POST the
 *     person's click makes. Nothing is written by looking;
 *   - the only thing a valid link can do is stop mail to the address that message went to. The page shows the
 *     sender's business name and a masked address, nothing else: no lead, no message text;
 *   - it is idempotent, rate-limited per network address, and never indexed or cached.
 * Without a secret (UNSUBSCRIBE_SECRET, else SESSION_SECRET) no link is put in any email and the page answers 404.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { TOKEN_SHAPE, UNSUBSCRIBE_PATH, maskEmail } from "@shared/unsubscribe";
import { normalEmail } from "@shared/outreach-safety";

const MIN_SECRET = 16;
export const unsubscribeSecret = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const s = (env.UNSUBSCRIBE_SECRET || env.SESSION_SECRET || "").trim();
  return s.length >= MIN_SECRET ? s : null;
};
/** Where the link points. In production always the canonical https host; elsewhere wherever the app says it lives. */
export const publicBase = (env: NodeJS.ProcessEnv = process.env): string =>
  (env.NODE_ENV === "production" ? `https://${env.CANONICAL_HOST || "www.dealinsec.com"}` : env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");

const sign = (secret: string, orgId: string, messageId: number) =>
  createHmac("sha256", secret).update(`unsubscribe:v1:${orgId}:${messageId}`).digest("base64url").slice(0, 32);
export const signToken = (secret: string, orgId: string, messageId: number): string => `${messageId}.${sign(secret, orgId, messageId)}`;
/** This message's own link, or null when the server has no secret to sign with (then no link is offered at all). */
export function unsubscribeUrl(orgId: string, messageId: number, env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = unsubscribeSecret(env);
  return secret && Number.isSafeInteger(messageId) && messageId > 0 ? `${publicBase(env)}${UNSUBSCRIBE_PATH}${signToken(secret, orgId, messageId)}` : null;
}

export interface UnsubMessage { id: number; orgId: string; leadId: number; toAddress: string | null }
export interface UnsubscribeDeps {
  secret(): string | null;
  ready(): Promise<boolean>;
  now(): Date;
  /** The outbound message with this id, whichever workspace it belongs to. The signature decides whether it may be used. */
  message(id: number): Promise<UnsubMessage | null>;
  orgName(orgId: string): Promise<string>;
  isListed(orgId: string, address: string): Promise<boolean>;
  addToList(orgId: string, address: string, messageId: number, now: Date): Promise<void>;
  recordOptOut(orgId: string, leadId: number, messageId: number, now: Date): Promise<boolean>;
  markLead(orgId: string, leadId: number, messageId: number, now: Date): Promise<void>;
  log(event: string, fields?: Record<string, string | number | boolean | null>): void;
}

export interface UnsubView { orgName: string; address: string; already: boolean }
type Found = { message: UnsubMessage; address: string | null };

async function find(token: unknown, deps: UnsubscribeDeps): Promise<Found | null> {
  const secret = deps.secret();
  const m = typeof token === "string" ? token.match(TOKEN_SHAPE) : null;
  if (!secret || !m) return null;
  const id = Number(m[1]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const message = await deps.message(id);
  if (!message) return null;
  const want = Buffer.from(sign(secret, message.orgId, message.id)), got = Buffer.from(m[2]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return { message, address: normalEmail(message.toAddress) };
}

/** What the page shows before anything is changed. null = no such link (bad, forged, or the feature is off). */
export async function lookupUnsubscribe(token: unknown, deps: UnsubscribeDeps): Promise<UnsubView | null> {
  if (!(await deps.ready().catch(() => false))) return null;
  const f = await find(token, deps);
  if (!f) return null;
  const already = f.address ? await deps.isListed(f.message.orgId, f.address).catch(() => false) : false;
  return { orgName: await deps.orgName(f.message.orgId).catch(() => "the sender"), address: maskEmail(f.address), already };
}

/** The person's click. Idempotent: a second click changes nothing and says so. */
export async function unsubscribe(token: unknown, deps: UnsubscribeDeps): Promise<{ ok: true; view: UnsubView } | { ok: false }> {
  if (!(await deps.ready().catch(() => false))) return { ok: false };
  const f = await find(token, deps);
  if (!f) return { ok: false };
  const { message: m, address } = f, now = deps.now();
  const already = address ? await deps.isListed(m.orgId, address) : false;
  // The list first: it is what every later draft, approval and send checks. If it can't be written, nothing is claimed.
  if (address && !already) await deps.addToList(m.orgId, address, m.id, now);
  const first = await deps.recordOptOut(m.orgId, m.leadId, m.id, now);
  if (first || !already) await deps.markLead(m.orgId, m.leadId, m.id, now);
  deps.log("unsubscribe_link_used", { messageId: m.id, first, listed: !!address }); // ids only: never the address
  return { ok: true, view: { orgName: await deps.orgName(m.orgId).catch(() => "the sender"), address: maskEmail(address), already: already && !first } };
}

/* ── the real stores ────────────────────────────────────────────────────── */

export function defaultUnsubscribeDeps(): UnsubscribeDeps {
  return {
    secret: () => unsubscribeSecret(), now: () => new Date(),
    async ready() { const { messagesTablesReady, outreachSafetyReady } = await import("./message-store"); return (await messagesTablesReady()) && (await outreachSafetyReady()); },
    async message(id) {
      const { db } = await import("../db"); const { sql } = await import("drizzle-orm");
      const r = await db.execute(sql`SELECT id, organization_id, lead_id, to_address FROM lead_messages WHERE id = ${id} AND direction = 'out' LIMIT 1`);
      const x = (((r as { rows?: unknown[] }).rows ?? []) as Record<string, unknown>[])[0];
      return x ? { id: Number(x.id), orgId: String(x.organization_id), leadId: Number(x.lead_id), toAddress: x.to_address ? String(x.to_address) : null } : null;
    },
    async orgName(orgId) { const { storage } = await import("../storage"); return (await storage.getOrganization(orgId))?.name?.trim() || "the sender"; },
    async isListed(orgId, address) {
      const { messageStore } = await import("./message-store"); const { suppressionKeys } = await import("@shared/outreach-safety");
      return !!(await messageStore.suppressedMatch(orgId, suppressionKeys(address)));
    },
    async addToList(orgId, address, messageId, now) {
      const { messageStore } = await import("./message-store");
      await messageStore.addSuppression(orgId, { kind: "email", value: address, reason: "opt_out", sourceMessageId: messageId, note: "Unsubscribe link", userId: null, now });
    },
    async recordOptOut(orgId, leadId, messageId, now) {
      const { messageStore } = await import("./message-store");
      return (await messageStore.recordEvent(orgId, { leadId, messageId, kind: "opted_out", source: "provider", provider: "unsubscribe_link", providerMessageId: null, userId: null, now })).created;
    },
    async markLead(orgId, leadId, messageId, now) {
      const { db } = await import("../db"); const { sql } = await import("drizzle-orm");
      const { messageStore } = await import("./message-store"); const { discardUnsentForLead } = await import("./outreach"); const { leadsStore } = await import("../leads/store");
      await db.execute(sql`UPDATE leads SET do_not_contact = true, updated_at = ${now.toISOString()}::timestamp WHERE organization_id = ${orgId} AND id = ${leadId} AND do_not_contact = false`);
      await discardUnsentForLead(orgId, leadId, null);
      await messageStore.stopLeadFollowups({ orgId, leadId, reason: "opted_out", now });
      await leadsStore.addEvent(orgId, leadId, { kind: "outreach_opted_out", data: { messageId, via: "unsubscribe_link" }, actor: "user", actorUserId: null });
    },
    log: (event, fields) => console.log(JSON.stringify({ ts: new Date().toISOString(), src: "unsubscribe", event, ...(fields ?? {}) })),
  };
}

/* ── the page ───────────────────────────────────────────────────────────── */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export function unsubscribePage(o: { title: string; body: string; action?: string | null }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(o.title)}</title>
<style>body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f6f7f6;color:#14201a}main{max-width:28rem;margin:12vh auto 0;padding:1.5rem;background:#fff;border:1px solid #e3e7e4;border-radius:14px}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:.5rem 0;color:#3d4a43}button{margin-top:1rem;font:inherit;font-weight:600;padding:.6rem 1.1rem;border:0;border-radius:10px;background:#0f766e;color:#fff;cursor:pointer}small{display:block;margin-top:1.25rem;color:#6b7770}@media(prefers-color-scheme:dark){body{background:#0e1512;color:#e7ece9}main{background:#151e1a;border-color:#26332d}p{color:#b6c2bb}small{color:#8a968f}}</style></head>
<body><main><h1>${esc(o.title)}</h1>${o.body}${o.action ? `<form method="post" action="${esc(o.action)}"><button type="submit">Stop these emails</button></form>` : ""}<small>Sent with DealInSec. This page only stops emails to this address from this sender.</small></main></body></html>`;
}

/**
 * Guessing is what gets limited, not unsubscribing. A link that verifies is never counted: a mail provider's one-click
 * requests (RFC 8058) arrive for many recipients from a handful of its own addresses, and refusing the 31st would
 * lose a real person's opt-out. Only links that did NOT verify count: 30 of those in 10 minutes from one network
 * address and it is refused until they age out. In this process only.
 */
export function linkGuard(max = 30, windowMs = 600_000, maxAddresses = 5_000) {
  const misses = new Map<string, number[]>();
  const recent = (ip: string, now: number) => (misses.get(ip) ?? []).filter((t) => now - t < windowMs);
  return {
    /** Whether this address has guessed too often lately. Counts nothing. */
    blocked(ip: string, now: number): boolean {
      const r = recent(ip, now);
      if (r.length) misses.set(ip, r); else misses.delete(ip);
      return r.length >= max;
    },
    /** A link from this address did not verify. */
    miss(ip: string, now: number): void {
      misses.set(ip, [...recent(ip, now), now].slice(-max));
      if (misses.size > maxAddresses) misses.delete(misses.keys().next().value as string);
    },
  };
}

export function registerUnsubscribeRoutes(app: Express, deps: UnsubscribeDeps = defaultUnsubscribeDeps()): void {
  const limiter = linkGuard();
  const ipOf = (req: Request) => String(req.ip ?? "unknown");
  const head = (res: Response) => { res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Robots-Tag", "noindex, nofollow"); res.setHeader("Referrer-Policy", "no-referrer"); res.type("html"); };
  const notFound = (req: Request, res: Response) => { limiter.miss(ipOf(req), Date.now()); head(res); res.status(404).send(unsubscribePage({ title: "This link isn't valid", body: "<p>It may have been copied incompletely. Open the link from the email again, or simply reply to the email and ask the sender to stop.</p>" })); };
  const guard = (req: Request, res: Response): boolean => {
    if (!limiter.blocked(ipOf(req), Date.now())) return true;
    head(res); res.status(429).send(unsubscribePage({ title: "Please try again in a few minutes", body: "<p>Too many requests came from your network just now.</p>" }));
    return false;
  };
  const path = `${UNSUBSCRIBE_PATH}:token`;
  app.get(path, async (req, res) => {
    if (!guard(req, res)) return;
    try {
      const v = await lookupUnsubscribe(req.params.token, deps);
      if (!v) return notFound(req, res);
      head(res);
      if (v.already) return res.send(unsubscribePage({ title: "You're already unsubscribed", body: `<p>${esc(v.orgName)} won't email ${esc(v.address)} again.</p>` }));
      res.send(unsubscribePage({ title: "Stop these emails?", body: `<p>${esc(v.orgName)} will not email ${esc(v.address)} again.</p>`, action: `${UNSUBSCRIBE_PATH}${encodeURIComponent(String(req.params.token))}` }));
    } catch { head(res); res.status(500).send(unsubscribePage({ title: "Something went wrong", body: "<p>Nothing was changed. Please try again, or reply to the email and ask the sender to stop.</p>" })); }
  });
  app.post(path, async (req, res) => {
    if (!guard(req, res)) return;
    try {
      const r = await unsubscribe(req.params.token, deps);
      if (!r.ok) return notFound(req, res);
      head(res);
      res.send(unsubscribePage({ title: r.view.already ? "You're already unsubscribed" : "You're unsubscribed", body: `<p>${esc(r.view.orgName)} won't email ${esc(r.view.address)} again.</p>` }));
    } catch {
      deps.log("unsubscribe_link_failed", {});
      head(res); res.status(500).send(unsubscribePage({ title: "Something went wrong", body: "<p>We couldn't record that just now. Please try again in a minute, or reply to the email and ask the sender to stop.</p>" }));
    }
  });
}
