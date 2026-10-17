/**
 * An in-memory ChannelStore for tests, with the same guarantees as the Postgres one (store.ts): one unsent message per
 * lead and channel, atomic status changes, forward-only delivery, provider ids and inbound messages stored once, the
 * allowances counted together with email's (injected counts) and checked with the write (no await in between).
 */
import type { ChannelMessageRow, WhatsappConnectionRow, WhatsappContactRow } from "@shared/schema";
import { ChannelAllowanceReached, ChannelDraftExists, ConnectionExists, type ChannelStore } from "./store";

const UNSENT = ["draft", "approved", "sending", "uncertain"];

export function memoryChannelStore(o: { emailAiDrafts?: (orgId: string) => number; emailSends?: (orgId: string) => number } = {}) {
  const messages: ChannelMessageRow[] = [], connections: WhatsappConnectionRow[] = [], contacts: WhatsappContactRow[] = [];
  let mid = 0, cid = 0, kid = 0;
  const copy = <T>(x: T): T => (x ? structuredClone(x) : x);
  const aiDrafts = (orgId: string, since: Date, prefix: string) =>
    messages.filter((m) => m.organizationId === orgId && m.direction === "out" && (m.promptVersion ?? "").startsWith(prefix) && m.createdAt >= since).length + (o.emailAiDrafts?.(orgId) ?? 0);
  const apiSends = (orgId: string, since: Date) =>
    messages.filter((m) => m.organizationId === orgId && m.direction === "out" && (m.status === "sending" || m.status === "uncertain" || (m.status === "sent" && m.sentVia === "api" && !!m.sentAt && m.sentAt >= since))).length;

  const store: ChannelStore = {
    async create(m) {
      if (m.allowance && aiDrafts(m.orgId, m.allowance.since, m.allowance.prefix) >= m.allowance.max) throw new ChannelAllowanceReached(m.allowance.max);
      if (messages.some((x) => x.leadId === m.leadId && x.channel === m.channel && x.direction === "out" && UNSENT.includes(x.status))) throw new ChannelDraftExists();
      const row: ChannelMessageRow = {
        id: ++mid, organizationId: m.orgId, leadId: m.leadId, channel: m.channel, kind: m.kind, direction: "out", body: m.body, bodyHash: m.bodyHash, toAddress: m.toAddress,
        templateName: m.templateName ?? null, templateLang: m.templateLang ?? null, templateParams: m.templateParams ?? null, status: "draft", sentVia: null, delivery: null,
        providerMessageId: null, errorCode: null, attempts: 0, promptVersion: m.promptVersion, claimIds: m.claimIds, edited: false, createdBy: m.by, createdByUser: m.userId,
        approvedBy: null, approvedAt: null, sentAt: null, deliveredAt: null, readAt: null, repliedAt: null, createdAt: m.now, updatedAt: m.now,
      };
      messages.push(row);
      return copy(row);
    },
    async get(orgId, id) { return copy(messages.find((m) => m.organizationId === orgId && m.id === id) ?? null); },
    async listForLead(orgId, leadId, limit = 100) { return messages.filter((m) => m.organizationId === orgId && m.leadId === leadId).sort((a, b) => +b.createdAt - +a.createdAt || b.id - a.id).slice(0, limit).map(copy); },
    async transition(t) {
      const m = messages.find((x) => x.organizationId === t.orgId && x.id === t.id && t.from.includes(x.status) && (!t.hash || x.bodyHash === t.hash));
      if (!m) return null;
      const next = { ...m, ...t.set } as ChannelMessageRow;
      if (UNSENT.includes(next.status) && !UNSENT.includes(m.status) && messages.some((x) => x !== m && x.leadId === m.leadId && x.channel === m.channel && x.direction === "out" && UNSENT.includes(x.status))) {
        const e = new Error("duplicate key value violates unique constraint") as Error & { code: string }; e.code = "23505"; throw e;
      }
      if (next.status === "sent" && (!next.sentAt || !next.sentVia)) throw new Error("violates check constraint channel_messages_sent_ck");
      Object.assign(m, t.set);
      return copy(m);
    },
    async reserveSend(r) {
      if (apiSends(r.orgId, r.allowance.since) + (o.emailSends?.(r.orgId) ?? 0) >= r.allowance.max) return { ok: false, code: "plan_send_limit" };
      const m = messages.find((x) => x.organizationId === r.orgId && x.id === r.id && x.status === "approved" && x.bodyHash === r.hash);
      if (!m) return { ok: false, code: "not_approved" };
      Object.assign(m, { status: "sending", attempts: m.attempts + 1, updatedAt: r.now });
      return { ok: true, row: copy(m) };
    },
    async countApiSends(orgId, since) { return apiSends(orgId, since); },
    async countAiDrafts(orgId, since, prefix) { return aiDrafts(orgId, since, prefix); },
    async byProviderId(channel, pid) { return copy(messages.find((m) => m.channel === channel && m.providerMessageId === pid) ?? null); },
    async applyStatus(s) {
      const m = messages.find((x) => x.id === s.id);
      if (!m) return false;
      if (s.status === "failed") {
        if (!["sent", "sending", "uncertain"].includes(m.status) || m.delivery) return false;
        Object.assign(m, { status: "failed", errorCode: s.errorCode ?? "failed" }); return true;
      }
      if (s.status === "sent") {
        if (!["sending", "uncertain"].includes(m.status)) return false;
        Object.assign(m, { status: "sent", sentVia: "api", sentAt: m.sentAt ?? s.at, errorCode: null }); return true;
      }
      if (!["sent", "sending", "uncertain", "failed"].includes(m.status)) return false;
      if (s.status === "delivered" && m.delivery) return false;
      if (s.status === "read" && m.delivery === "read") return false;
      Object.assign(m, { status: "sent", sentVia: "api", sentAt: m.sentAt ?? s.at, delivery: s.status, errorCode: null, ...(s.status === "delivered" ? { deliveredAt: s.at } : { readAt: s.at, deliveredAt: m.deliveredAt ?? s.at }) });
      return true;
    },
    async insertInbound(i) {
      if (messages.some((m) => m.channel === i.channel && m.providerMessageId === i.providerMessageId)) return false;
      messages.push({ id: ++mid, organizationId: i.orgId, leadId: i.leadId, channel: i.channel, kind: "inbound", direction: "in", body: i.body, bodyHash: null, toAddress: i.from,
        templateName: null, templateLang: null, templateParams: null, status: "received", sentVia: null, delivery: null, providerMessageId: i.providerMessageId, errorCode: i.type === "text" ? null : `type:${i.type}`,
        attempts: 0, promptVersion: null, claimIds: [], edited: false, createdBy: "user", createdByUser: null, approvedBy: null, approvedAt: null, sentAt: null, deliveredAt: null, readAt: null, repliedAt: null, createdAt: i.at, updatedAt: i.at } as ChannelMessageRow);
      return true;
    },
    async latestSentTo(orgId, channel, to) {
      return copy(messages.filter((m) => m.organizationId === orgId && m.channel === channel && m.toAddress === to && m.direction === "out" && m.status === "sent").sort((a, b) => +(b.sentAt ?? 0) - +(a.sentAt ?? 0))[0] ?? null);
    },
    async cancelUnsentTo(orgId, channel, to, now) {
      const hit = messages.filter((m) => m.organizationId === orgId && m.channel === channel && m.toAddress === to && m.direction === "out" && (m.status === "draft" || m.status === "approved"));
      for (const m of hit) Object.assign(m, { status: "cancelled", updatedAt: now });
      return hit.length;
    },

    async liveConnection(orgId) { return copy(connections.find((c) => c.organizationId === orgId && c.status !== "disconnected") ?? null); },
    async connectionByPhoneNumberId(pid) { return copy(connections.find((c) => c.phoneNumberId === pid && c.status !== "disconnected") ?? null); },
    async createConnection(c, seal) {
      if (connections.some((x) => x.status !== "disconnected" && (x.organizationId === c.orgId || x.phoneNumberId === c.phoneNumberId))) throw new ConnectionExists();
      const id = ++cid, sealed = seal(id);
      const row: WhatsappConnectionRow = { id, organizationId: c.orgId, status: "active", phoneNumberId: c.phoneNumberId, wabaId: c.wabaId, displayPhone: c.displayPhone, verifiedName: c.verifiedName,
        accessTokenEnc: sealed.envelope, tokenKeyVersion: sealed.keyVersion, lastErrorCode: null, lastErrorAt: null, connectedBy: c.userId, connectedAt: c.now, disconnectedAt: null, createdAt: c.now, updatedAt: c.now };
      connections.push(row);
      return copy(row);
    },
    async setConnectionState(orgId, id, s) { const c = connections.find((x) => x.organizationId === orgId && x.id === id && x.status !== "disconnected"); if (c) Object.assign(c, { status: s.status, lastErrorCode: s.errorCode, lastErrorAt: s.errorCode ? s.now : null }); },
    async disconnect(orgId, id, now) {
      const c = connections.find((x) => x.organizationId === orgId && x.id === id && x.status !== "disconnected");
      if (!c) return false;
      Object.assign(c, { status: "disconnected", accessTokenEnc: null, tokenKeyVersion: null, disconnectedAt: now });
      return true;
    },

    async contact(orgId, phone) { return copy(contacts.find((c) => c.organizationId === orgId && c.phone === phone) ?? null); },
    async contactsForLead(orgId, leadId) { return contacts.filter((c) => c.organizationId === orgId && c.leadId === leadId).map(copy); },
    async recordOptIn(r) {
      let c = contacts.find((x) => x.organizationId === r.orgId && x.phone === r.phone);
      if (!c) { c = { id: ++kid, organizationId: r.orgId, phone: r.phone, leadId: r.leadId, optedInAt: r.now, optInSource: r.source, optInRecordedBy: r.userId, optedOutAt: null, lastInboundAt: null, createdAt: r.now, updatedAt: r.now }; contacts.push(c); return copy(c); }
      if (!c.optedOutAt) Object.assign(c, { leadId: r.leadId, optedInAt: r.now, optInSource: r.source, optInRecordedBy: r.userId, updatedAt: r.now });
      return copy(c);
    },
    async recordOptOut(r) {
      const c = contacts.find((x) => x.organizationId === r.orgId && x.phone === r.phone);
      if (c) Object.assign(c, { optedOutAt: r.now, optedInAt: null, updatedAt: r.now });
      else contacts.push({ id: ++kid, organizationId: r.orgId, phone: r.phone, leadId: r.leadId, optedInAt: null, optInSource: null, optInRecordedBy: null, optedOutAt: r.now, lastInboundAt: null, createdAt: r.now, updatedAt: r.now });
    },
    async touchInbound(orgId, phone, at) { const c = contacts.find((x) => x.organizationId === orgId && x.phone === phone); if (c) c.lastInboundAt = !c.lastInboundAt || at > c.lastInboundAt ? at : c.lastInboundAt; },
  };
  return { store, messages, connections, contacts };
}
