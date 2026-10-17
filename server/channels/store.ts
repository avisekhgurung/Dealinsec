/**
 * Where channel messages, WhatsApp connections and WhatsApp contacts are kept (shared/schema.ts; server/channels/ddl.ts).
 * Every read and write is scoped by organization, except the two lookups a webhook needs to find the organization
 * (a business number id, a provider message id), which return the organization with the row.
 *
 * Guarantees, each decided by the database rather than a check-then-write:
 *   - one unsent message per lead and channel (a partial unique index);
 *   - every status change is one UPDATE … WHERE status IN (expected) [AND body_hash = approved hash];
 *   - the plan's AI-draft and send allowances are counted and used under the same per-workspace advisory locks as email
 *     (DRAFT_ALLOWANCE_LOCK, PLAN_SEND_LOCK), across both tables, so email and channels can't pass a limit together;
 *   - an inbound message or a provider message id is stored once (unique), so a replayed webhook changes nothing;
 *   - delivery only moves forward (sent → delivered → read).
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { channelMessages, whatsappConnections, whatsappContacts, type ChannelMessageRow, type WhatsappConnectionRow, type WhatsappContactRow } from "@shared/schema";
import { tablesReadyCheck } from "../leads/ready";
import { CHANNEL_TABLES } from "./ddl";

export const channelTablesReady = tablesReadyCheck([...CHANNEL_TABLES]);

/** The same lock numbers as email (server/sales/message-store.ts, server/mail/send-store-pg.ts). */
export const DRAFT_ALLOWANCE_LOCK = 7_310_031;
export const PLAN_SEND_LOCK = 7_310_032;

export class ChannelDraftExists extends Error { constructor() { super("this lead already has an unsent message on this channel"); } }
export class ChannelAllowanceReached extends Error { constructor(readonly max: number) { super("allowance reached"); } }
export class ConnectionExists extends Error { constructor() { super("a live connection already exists"); } }

export interface NewChannelMessage {
  orgId: string; leadId: number; channel: string; kind: string; body: string; bodyHash: string; toAddress: string | null;
  templateName?: string | null; templateLang?: string | null; templateParams?: string[] | null;
  promptVersion: string | null; claimIds: number[]; by: "user" | "agent"; userId: string; now: Date;
  /** The plan's AI-draft allowance, counted across email and channel drafts under one lock. */
  allowance?: { since: Date; max: number; prefix: string };
}

export interface ChannelStore {
  create(m: NewChannelMessage): Promise<ChannelMessageRow>;
  get(orgId: string, id: number): Promise<ChannelMessageRow | null>;
  listForLead(orgId: string, leadId: number, limit?: number): Promise<ChannelMessageRow[]>;
  /** One atomic change: applies `set` only if the row is in one of `from` (and still has `hash`); null when it wasn't. */
  transition(o: { orgId: string; id: number; from: string[]; hash?: string; set: Partial<ChannelMessageRow> }): Promise<ChannelMessageRow | null>;
  /** approved → sending, only while the plan's sends allowance (email and channel API sends together) has room. */
  reserveSend(o: { orgId: string; id: number; hash: string; now: Date; allowance: { since: Date; max: number } }): Promise<{ ok: true; row: ChannelMessageRow } | { ok: false; code: "not_approved" | "plan_send_limit" }>;
  /** Channel messages sent through a provider's API since `since`, plus any in flight (the plan's send allowance). */
  countApiSends(orgId: string, since: Date): Promise<number>;
  countAiDrafts(orgId: string, since: Date, prefix: string): Promise<number>;
  /** A provider message id → its message and organization (webhooks). */
  byProviderId(channel: string, providerMessageId: string): Promise<ChannelMessageRow | null>;
  /** Records a provider's delivery report, forward only: delivered after sent, read after delivered; failed only before delivery. */
  applyStatus(o: { id: number; status: "sent" | "delivered" | "read" | "failed"; at: Date; errorCode: string | null }): Promise<boolean>;
  /** Stores an inbound message once; false when it was already stored (a replayed webhook). */
  insertInbound(o: { orgId: string; leadId: number; channel: string; from: string; providerMessageId: string; body: string | null; type: string; at: Date }): Promise<boolean>;
  /** The latest message sent to this address on this channel (for a reply to be matched to). */
  latestSentTo(orgId: string, channel: string, toAddress: string): Promise<ChannelMessageRow | null>;
  /** Unsent messages to this address (to discard when they opt out). */
  cancelUnsentTo(orgId: string, channel: string, toAddress: string, now: Date): Promise<number>;

  liveConnection(orgId: string): Promise<WhatsappConnectionRow | null>;
  connectionByPhoneNumberId(phoneNumberId: string): Promise<WhatsappConnectionRow | null>;
  /** Inserts a live connection; `seal` gets the new row's id (the token is bound to it). Throws ConnectionExists. */
  createConnection(o: { orgId: string; userId: string; phoneNumberId: string; wabaId: string; displayPhone: string | null; verifiedName: string | null; now: Date }, seal: (id: number) => { envelope: string; keyVersion: number }): Promise<WhatsappConnectionRow>;
  setConnectionState(orgId: string, id: number, o: { status: "active" | "needs_attention"; errorCode: string | null; now: Date }): Promise<void>;
  disconnect(orgId: string, id: number, now: Date): Promise<boolean>;

  contact(orgId: string, phone: string): Promise<WhatsappContactRow | null>;
  contactsForLead(orgId: string, leadId: number): Promise<WhatsappContactRow[]>;
  recordOptIn(o: { orgId: string; phone: string; leadId: number; source: string; userId: string; now: Date }): Promise<WhatsappContactRow>;
  recordOptOut(o: { orgId: string; phone: string; leadId: number | null; now: Date }): Promise<void>;
  touchInbound(orgId: string, phone: string, at: Date): Promise<void>;
}

const at = (d: Date) => d.toISOString();

/** AI drafts on both tables (email and channels) since `since`: the plan's one AI-draft allowance. */
const aiDraftCount = (orgId: string, since: Date, prefix: string) => sql`SELECT
  (SELECT count(*) FROM lead_messages WHERE organization_id = ${orgId} AND direction = 'out' AND prompt_version LIKE ${prefix + "%"} AND created_at >= ${at(since)}::timestamp)
  + (SELECT count(*) FROM channel_messages WHERE organization_id = ${orgId} AND direction = 'out' AND prompt_version LIKE ${prefix + "%"} AND created_at >= ${at(since)}::timestamp) AS n`;
/** Channel messages handed to a provider's API: in flight, or sent in the window (a failed send frees its slot). */
export const channelApiSendCount = (orgId: string, since: Date) => sql`SELECT count(*)::int AS n FROM channel_messages WHERE organization_id = ${orgId}
  AND direction = 'out' AND (status IN ('sending', 'uncertain') OR (status = 'sent' AND sent_via = 'api' AND sent_at >= ${at(since)}::timestamp))`;
const mailSendCount = (orgId: string, since: Date) => sql`SELECT count(*)::int AS n FROM mail_send_jobs WHERE organization_id = ${orgId}
  AND (status IN ('sending', 'uncertain') OR (status = 'sent' AND sent_at >= ${at(since)}::timestamp))`;
/** Channel AI drafts or API sends, for the email paths that share these allowances: 0 until the channel tables exist. */
export async function channelCountFor(tx: { execute: typeof db.execute }, what: "ai_drafts" | "api_sends", orgId: string, since: Date, prefix = ""): Promise<number> {
  const present = (((await tx.execute(sql`SELECT to_regclass('channel_messages') IS NOT NULL AS present`)).rows[0]) as { present: boolean }).present;
  if (!present) return 0;
  return n(await tx.execute(what === "api_sends" ? channelApiSendCount(orgId, since)
    : sql`SELECT count(*)::int AS n FROM channel_messages WHERE organization_id = ${orgId} AND direction = 'out' AND prompt_version LIKE ${prefix + "%"} AND created_at >= ${at(since)}::timestamp`));
}
const n = (r: { rows: unknown[] }) => Number((r.rows[0] as { n: unknown } | undefined)?.n ?? 0);
const isUnique = (e: unknown) => (e as { code?: string })?.code === "23505";

export const channelStore: ChannelStore = {
  async create(m) {
    const values = {
      organizationId: m.orgId, leadId: m.leadId, channel: m.channel, kind: m.kind, direction: "out", body: m.body, bodyHash: m.bodyHash, toAddress: m.toAddress,
      templateName: m.templateName ?? null, templateLang: m.templateLang ?? null, templateParams: m.templateParams ?? null,
      status: "draft", promptVersion: m.promptVersion, claimIds: m.claimIds, createdBy: m.by, createdByUser: m.userId, createdAt: m.now, updatedAt: m.now,
    };
    try {
      if (!m.allowance) return (await db.insert(channelMessages).values(values).returning())[0];
      const a = m.allowance;
      return await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${DRAFT_ALLOWANCE_LOCK}, hashtext(${m.orgId}))`);
        if (n(await tx.execute(aiDraftCount(m.orgId, a.since, a.prefix))) >= a.max) throw new ChannelAllowanceReached(a.max);
        return (await tx.insert(channelMessages).values(values).returning())[0];
      });
    } catch (e) {
      if (isUnique(e)) throw new ChannelDraftExists();
      throw e;
    }
  },
  async get(orgId, id) {
    const [r] = await db.select().from(channelMessages).where(and(eq(channelMessages.organizationId, orgId), eq(channelMessages.id, id))).limit(1);
    return r ?? null;
  },
  async listForLead(orgId, leadId, limit = 100) {
    return db.select().from(channelMessages).where(and(eq(channelMessages.organizationId, orgId), eq(channelMessages.leadId, leadId)))
      .orderBy(desc(channelMessages.createdAt), desc(channelMessages.id)).limit(limit);
  },
  async transition(o) {
    const [r] = await db.update(channelMessages).set({ ...o.set, updatedAt: o.set.updatedAt ?? new Date() })
      .where(and(eq(channelMessages.organizationId, o.orgId), eq(channelMessages.id, o.id), inArray(channelMessages.status, o.from), o.hash ? eq(channelMessages.bodyHash, o.hash) : undefined))
      .returning();
    return r ?? null;
  },
  async reserveSend(o) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${PLAN_SEND_LOCK}, hashtext(${o.orgId}))`);
      // Email sends count too (one allowance), when the Gmail tables exist on this server.
      const mailPresent = (((await tx.execute(sql`SELECT to_regclass('mail_send_jobs') IS NOT NULL AS present`)).rows[0]) as { present: boolean }).present;
      const used = n(await tx.execute(channelApiSendCount(o.orgId, o.allowance.since))) + (mailPresent ? n(await tx.execute(mailSendCount(o.orgId, o.allowance.since))) : 0);
      if (used >= o.allowance.max) return { ok: false as const, code: "plan_send_limit" as const };
      const [row] = await tx.update(channelMessages).set({ status: "sending", attempts: sql`${channelMessages.attempts} + 1`, updatedAt: o.now })
        .where(and(eq(channelMessages.organizationId, o.orgId), eq(channelMessages.id, o.id), eq(channelMessages.status, "approved"), eq(channelMessages.bodyHash, o.hash))).returning();
      return row ? { ok: true as const, row } : { ok: false as const, code: "not_approved" as const };
    });
  },
  async countApiSends(orgId, since) { return n(await db.execute(channelApiSendCount(orgId, since))); },
  async countAiDrafts(orgId, since, prefix) { return n(await db.execute(aiDraftCount(orgId, since, prefix))); },
  async byProviderId(channel, providerMessageId) {
    const [r] = await db.select().from(channelMessages).where(and(eq(channelMessages.channel, channel), eq(channelMessages.providerMessageId, providerMessageId))).limit(1);
    return r ?? null;
  },
  async applyStatus(o) {
    const now = new Date();
    if (o.status === "failed") {
      const r = await db.update(channelMessages).set({ status: "failed", errorCode: o.errorCode ?? "failed", updatedAt: now })
        .where(and(eq(channelMessages.id, o.id), inArray(channelMessages.status, ["sent", "sending", "uncertain"]), sql`${channelMessages.delivery} IS NULL`)).returning({ id: channelMessages.id });
      return r.length > 0;
    }
    if (o.status === "sent") {
      // An uncertain send that Meta confirms: it did go out.
      const r = await db.update(channelMessages).set({ status: "sent", sentVia: "api", sentAt: sql`COALESCE(${channelMessages.sentAt}, ${at(o.at)}::timestamp)`, errorCode: null, updatedAt: now })
        .where(and(eq(channelMessages.id, o.id), inArray(channelMessages.status, ["sending", "uncertain"]))).returning({ id: channelMessages.id });
      return r.length > 0;
    }
    const set = o.status === "delivered"
      ? { delivery: "delivered", deliveredAt: o.at, status: "sent", sentVia: "api", sentAt: sql`COALESCE(${channelMessages.sentAt}, ${at(o.at)}::timestamp)` as any }
      : { delivery: "read", readAt: o.at, deliveredAt: sql`COALESCE(${channelMessages.deliveredAt}, ${at(o.at)}::timestamp)` as any, status: "sent", sentVia: "api", sentAt: sql`COALESCE(${channelMessages.sentAt}, ${at(o.at)}::timestamp)` as any };
    const allowed = o.status === "delivered" ? sql`${channelMessages.delivery} IS NULL` : sql`(${channelMessages.delivery} IS NULL OR ${channelMessages.delivery} = 'delivered')`;
    const r = await db.update(channelMessages).set({ ...set, errorCode: null, updatedAt: now } as any)
      .where(and(eq(channelMessages.id, o.id), inArray(channelMessages.status, ["sent", "sending", "uncertain", "failed"]), allowed)).returning({ id: channelMessages.id });
    return r.length > 0;
  },
  async insertInbound(o) {
    const r = await db.insert(channelMessages).values({
      organizationId: o.orgId, leadId: o.leadId, channel: o.channel, kind: "inbound", direction: "in", body: o.body, toAddress: o.from,
      status: "received", providerMessageId: o.providerMessageId, errorCode: o.type === "text" ? null : `type:${o.type}`.slice(0, 40), createdAt: o.at, updatedAt: o.at,
    }).onConflictDoNothing().returning({ id: channelMessages.id });
    return r.length > 0;
  },
  async latestSentTo(orgId, channel, toAddress) {
    const [r] = await db.select().from(channelMessages).where(and(eq(channelMessages.organizationId, orgId), eq(channelMessages.channel, channel), eq(channelMessages.toAddress, toAddress), eq(channelMessages.direction, "out"), eq(channelMessages.status, "sent")))
      .orderBy(desc(channelMessages.sentAt)).limit(1);
    return r ?? null;
  },
  async cancelUnsentTo(orgId, channel, toAddress, now) {
    const r = await db.update(channelMessages).set({ status: "cancelled", updatedAt: now })
      .where(and(eq(channelMessages.organizationId, orgId), eq(channelMessages.channel, channel), eq(channelMessages.toAddress, toAddress), eq(channelMessages.direction, "out"), inArray(channelMessages.status, ["draft", "approved"]))).returning({ id: channelMessages.id });
    return r.length;
  },

  async liveConnection(orgId) {
    const [r] = await db.select().from(whatsappConnections).where(and(eq(whatsappConnections.organizationId, orgId), sql`${whatsappConnections.status} <> 'disconnected'`)).limit(1);
    return r ?? null;
  },
  async connectionByPhoneNumberId(phoneNumberId) {
    const [r] = await db.select().from(whatsappConnections).where(and(eq(whatsappConnections.phoneNumberId, phoneNumberId), sql`${whatsappConnections.status} <> 'disconnected'`)).limit(1);
    return r ?? null;
  },
  async createConnection(o, seal) {
    try {
      return await db.transaction(async (tx) => {
        const id = Number(((await tx.execute(sql`SELECT nextval(pg_get_serial_sequence('whatsapp_connections', 'id')) AS id`)).rows[0] as { id: unknown }).id);
        const sealed = seal(id);
        const [row] = await tx.insert(whatsappConnections).values({
          id, organizationId: o.orgId, status: "active", phoneNumberId: o.phoneNumberId, wabaId: o.wabaId, displayPhone: o.displayPhone, verifiedName: o.verifiedName,
          accessTokenEnc: sealed.envelope, tokenKeyVersion: sealed.keyVersion, connectedBy: o.userId, connectedAt: o.now, createdAt: o.now, updatedAt: o.now,
        }).returning();
        return row;
      });
    } catch (e) {
      if (isUnique(e)) throw new ConnectionExists();
      throw e;
    }
  },
  async setConnectionState(orgId, id, o) {
    await db.update(whatsappConnections).set({ status: o.status, lastErrorCode: o.errorCode, lastErrorAt: o.errorCode ? o.now : null, updatedAt: o.now })
      .where(and(eq(whatsappConnections.organizationId, orgId), eq(whatsappConnections.id, id), sql`${whatsappConnections.status} <> 'disconnected'`));
  },
  async disconnect(orgId, id, now) {
    const r = await db.update(whatsappConnections).set({ status: "disconnected", accessTokenEnc: null, tokenKeyVersion: null, disconnectedAt: now, updatedAt: now })
      .where(and(eq(whatsappConnections.organizationId, orgId), eq(whatsappConnections.id, id), sql`${whatsappConnections.status} <> 'disconnected'`)).returning({ id: whatsappConnections.id });
    return r.length > 0;
  },

  async contact(orgId, phone) {
    const [r] = await db.select().from(whatsappContacts).where(and(eq(whatsappContacts.organizationId, orgId), eq(whatsappContacts.phone, phone))).limit(1);
    return r ?? null;
  },
  async contactsForLead(orgId, leadId) {
    return db.select().from(whatsappContacts).where(and(eq(whatsappContacts.organizationId, orgId), eq(whatsappContacts.leadId, leadId))).orderBy(desc(whatsappContacts.updatedAt));
  },
  async recordOptIn(o) {
    // A number that asked to stop stays stopped (like an email opt-out, it is also on the do-not-contact list for good).
    const [r] = await db.insert(whatsappContacts).values({ organizationId: o.orgId, phone: o.phone, leadId: o.leadId, optedInAt: o.now, optInSource: o.source, optInRecordedBy: o.userId, createdAt: o.now, updatedAt: o.now })
      .onConflictDoUpdate({
        target: [whatsappContacts.organizationId, whatsappContacts.phone],
        set: { leadId: o.leadId, optedInAt: o.now, optInSource: o.source, optInRecordedBy: o.userId, updatedAt: o.now },
        setWhere: sql`${whatsappContacts.optedOutAt} IS NULL`,
      }).returning();
    return r ?? (await channelStore.contact(o.orgId, o.phone))!;
  },
  async recordOptOut(o) {
    await db.insert(whatsappContacts).values({ organizationId: o.orgId, phone: o.phone, leadId: o.leadId, optedOutAt: o.now, createdAt: o.now, updatedAt: o.now })
      .onConflictDoUpdate({ target: [whatsappContacts.organizationId, whatsappContacts.phone], set: { optedOutAt: o.now, optedInAt: null, updatedAt: o.now } });
  },
  async touchInbound(orgId, phone, when) {
    await db.update(whatsappContacts).set({ lastInboundAt: sql`GREATEST(COALESCE(${whatsappContacts.lastInboundAt}, ${at(when)}::timestamp), ${at(when)}::timestamp)`, updatedAt: new Date() })
      .where(and(eq(whatsappContacts.organizationId, orgId), eq(whatsappContacts.phone, phone)));
  },
};
