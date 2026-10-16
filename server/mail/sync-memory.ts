/**
 * The in-memory SyncStore, for tests: the same contract as sync-store-pg.ts (sync-store.contract.ts runs on both).
 * The outreach side (connections, outreach messages, DealInSec sends) is plain arrays a test fills in.
 */
import type { ConversationLink, OutreachCandidate } from "./reply-match";
import type { DueMailbox, PassOutcome, StoreMessageInput, SyncStateView, SyncStore } from "./sync-store";

export interface MemConnection { id: number; organizationId: string; userId: string; status: string; scopes: string[]; updatedAt: Date }
export interface MemOutreach { id: number; organizationId: string; leadId: number; toAddress: string; subject: string; status: string; approvedBy: string | null; at: Date }
export interface MemSendJob { organizationId: string; connectionId: number; messageId: number; leadId: number; toAddress: string; rfcMessageId: string; status: string; providerMessageId: string | null; providerThreadId: string | null }
export interface MemThread { id: number; organizationId: string; connectionId: number; providerThreadId: string; leadId: number; leadMessageId: number; source: string; lastMessageAt: Date | null; lastInboundAt: Date | null }
export interface MemStored extends Omit<StoreMessageInput, "link" | "adoptThread" | "linked" | "now" | "orgId"> {
  id: number; organizationId: string; threadId: number | null; leadId: number; leadMessageId: number; reviewState: string; appliedAt: Date | null; createdAt: Date;
}
interface MemState extends SyncStateView { leaseOwner: string | null; updatedAt: Date }

export class MemorySyncStore implements SyncStore {
  connections: MemConnection[] = [];
  outreach: MemOutreach[] = [];
  sendJobs: MemSendJob[] = [];
  threads: MemThread[] = [];
  messages: MemStored[] = [];
  states = new Map<number, MemState>();
  private seq = 0;

  private toLink(t: MemThread): ConversationLink {
    const o = this.outreach.find((x) => x.id === t.leadMessageId && x.organizationId === t.organizationId);
    return { leadId: t.leadId, leadMessageId: t.leadMessageId, toAddress: o?.toAddress ?? "" };
  }
  private view(s: MemState): SyncStateView {
    const { leaseOwner: _o, updatedAt: _a, ...v } = s;
    return { ...v };
  }

  async due({ now, readScope, limit, orgIds }: { now: Date; readScope: string; limit: number; orgIds: string[] | null }): Promise<DueMailbox[]> {
    return this.connections
      .filter((c) => c.status === "active" && c.scopes.includes(readScope) && (!orgIds || orgIds.includes(c.organizationId)))
      .filter((c) => {
        const s = this.states.get(c.id);
        if (!s) return true;
        if (s.state === "needs_reconnect" || s.state === "needs_scope") return c.updatedAt > s.updatedAt;
        return s.nextRunAt <= now;
      })
      .slice(0, limit)
      .map((c) => ({ organizationId: c.organizationId, connectionId: c.id, userId: c.userId }));
  }

  async claim({ orgId, connectionId, owner, now, leaseMs, force }: { orgId: string; connectionId: number; owner: string; now: Date; leaseMs: number; force: boolean }) {
    let s = this.states.get(connectionId);
    if (s && s.organizationId !== orgId) return null;
    if (!s) {
      s = { organizationId: orgId, connectionId, historyId: null, bootstrappedAt: null, state: "ok", nextRunAt: now, lastRunAt: null, lastSuccessAt: null, failures: 0, lastErrorCode: null, lastErrorAt: null, leaseOwner: null, leaseUntil: null, updatedAt: now };
      this.states.set(connectionId, s);
    }
    if (s.leaseUntil && s.leaseUntil > now) return null;
    const conn = this.connections.find((c) => c.id === connectionId);
    const woken = (s.state === "needs_reconnect" || s.state === "needs_scope") && !!conn && conn.updatedAt > s.updatedAt;
    if (!force && s.nextRunAt > now && !woken) return null;
    s.leaseOwner = owner; s.leaseUntil = new Date(now.getTime() + leaseMs); s.lastRunAt = now; s.updatedAt = now;
    return this.view(s);
  }

  async checkpoint({ connectionId, owner, historyId, now, leaseMs }: { connectionId: number; owner: string; historyId: string; now: Date; leaseMs: number }) {
    const s = this.states.get(connectionId);
    if (!s || s.leaseOwner !== owner) return false;
    s.historyId = historyId; s.leaseUntil = new Date(now.getTime() + leaseMs); s.updatedAt = now;
    return true;
  }

  async finish({ connectionId, owner, now, outcome }: { connectionId: number; owner: string; now: Date; outcome: PassOutcome }) {
    const s = this.states.get(connectionId);
    if (!s || s.leaseOwner !== owner) return;
    s.leaseOwner = null; s.leaseUntil = null; s.updatedAt = now; s.nextRunAt = outcome.nextRunAt;
    if (outcome.ok) {
      s.historyId = outcome.historyId; s.state = "ok"; s.failures = 0; s.lastSuccessAt = now; s.lastErrorCode = null; s.lastErrorAt = null;
      if (outcome.bootstrapped) s.bootstrappedAt = now;
    } else {
      s.state = outcome.state; s.lastErrorCode = outcome.code; s.lastErrorAt = now;
      if (outcome.countFailure) s.failures += 1;
      if (outcome.resetCursor) { s.historyId = null; s.bootstrappedAt = null; } else if (outcome.historyId) s.historyId = outcome.historyId;
    }
  }

  async state(orgId: string, connectionId: number) {
    const s = this.states.get(connectionId);
    return s && s.organizationId === orgId ? this.view(s) : null;
  }

  async adoptSendThreads({ orgId, connectionId, now }: { orgId: string; connectionId: number; now: Date }) {
    let n = 0;
    for (const j of this.sendJobs) {
      if (j.organizationId !== orgId || j.connectionId !== connectionId || !j.providerThreadId || !["sent", "uncertain"].includes(j.status)) continue;
      if (this.threads.some((t) => t.connectionId === connectionId && t.providerThreadId === j.providerThreadId)) continue;
      this.threads.push({ id: ++this.seq, organizationId: orgId, connectionId, providerThreadId: j.providerThreadId, leadId: j.leadId, leadMessageId: j.messageId, source: "send", lastMessageAt: now, lastInboundAt: null });
      n++;
    }
    return n;
  }

  async threadLink(orgId: string, connectionId: number, providerThreadId: string) {
    const t = this.threads.find((x) => x.organizationId === orgId && x.connectionId === connectionId && x.providerThreadId === providerThreadId);
    return t ? this.toLink(t) : null;
  }

  async referenceLink(orgId: string, connectionId: number, rfcIds: string[]) {
    const ids = new Set(rfcIds.map((x) => x.toLowerCase()));
    const job = this.sendJobs.find((j) => j.organizationId === orgId && j.connectionId === connectionId && ids.has(j.rfcMessageId.toLowerCase()));
    if (job) return { leadId: job.leadId, leadMessageId: job.messageId, toAddress: job.toAddress };
    const m = this.messages.find((x) => x.organizationId === orgId && x.connectionId === connectionId && x.threadId !== null && !!x.rfcMessageId && ids.has(x.rfcMessageId));
    const t = m ? this.threads.find((x) => x.id === m.threadId) : null;
    return t ? this.toLink(t) : null;
  }

  async outreachTo(orgId: string, addresses: string[], since: Date): Promise<OutreachCandidate[]> {
    const want = new Set(addresses.map((a) => a.toLowerCase()));
    return this.outreach
      .filter((o) => o.organizationId === orgId && want.has(o.toAddress.toLowerCase()) && ["approved", "sending", "sent"].includes(o.status) && o.at >= since)
      .map((o) => ({ leadId: o.leadId, leadMessageId: o.id, toAddress: o.toAddress.toLowerCase(), subject: o.subject, at: o.at }));
  }

  async recentOutreachAddresses({ orgId, userId, since, limit }: { orgId: string; userId: string; since: Date; limit: number }) {
    const xs = this.outreach.filter((o) => o.organizationId === orgId && o.approvedBy === userId && ["approved", "sending", "sent"].includes(o.status) && o.at >= since)
      .sort((a, b) => b.at.getTime() - a.at.getTime()).map((o) => o.toAddress.toLowerCase());
    return Array.from(new Set(xs)).slice(0, limit);
  }

  async linkedThreadIds(orgId: string, connectionId: number, limit: number) {
    return this.threads.filter((t) => t.organizationId === orgId && t.connectionId === connectionId).map((t) => t.providerThreadId).slice(0, limit);
  }

  async known(orgId: string, connectionId: number, ids: string[]) {
    const out = new Set<string>();
    for (const id of ids) {
      if (this.messages.some((m) => m.organizationId === orgId && m.connectionId === connectionId && m.providerMessageId === id)) out.add(id);
      else if (this.sendJobs.some((j) => j.organizationId === orgId && j.connectionId === connectionId && j.providerMessageId === id)) out.add(id);
    }
    return out;
  }

  async storeMessage(i: StoreMessageInput) {
    let thread = this.threads.find((t) => t.organizationId === i.orgId && t.connectionId === i.connectionId && t.providerThreadId === i.providerThreadId) ?? null;
    if (!thread && i.adoptThread) {
      thread = { id: ++this.seq, organizationId: i.orgId, connectionId: i.connectionId, providerThreadId: i.providerThreadId, leadId: i.link.leadId, leadMessageId: i.link.leadMessageId, source: i.adoptThread.source, lastMessageAt: null, lastInboundAt: null };
      this.threads.push(thread);
      const to = this.toLink(thread).toAddress;
      for (const m of this.messages) {
        if (m.organizationId !== i.orgId || m.connectionId !== i.connectionId || m.providerThreadId !== i.providerThreadId || m.threadId !== null || m.reviewState !== "pending" || m.review !== "address_only") continue;
        const same = m.fromAddress === to || m.kind === "bounce";
        Object.assign(m, { threadId: thread.id, leadId: thread.leadId, leadMessageId: thread.leadMessageId, match: "thread", review: same ? null : "other_sender", reviewState: same ? "none" : "pending" });
      }
    }
    if (this.messages.some((m) => m.connectionId === i.connectionId && m.providerMessageId === i.providerMessageId)) return { created: false, id: null };
    const linked = i.linked && !!thread;
    const link = linked && thread ? this.toLink(thread) : i.link;
    const { link: _l, adoptThread: _a, linked: _k, now: _n, orgId: _o, ...rest } = i;
    const row: MemStored = { ...rest, id: ++this.seq, organizationId: i.orgId, threadId: linked ? thread!.id : null, leadId: link.leadId, leadMessageId: link.leadMessageId, reviewState: i.review ? "pending" : "none", appliedAt: null, createdAt: i.now };
    this.messages.push(row);
    if (linked && thread) {
      if (!thread.lastMessageAt || thread.lastMessageAt < i.sentAt) thread.lastMessageAt = i.sentAt;
      if (i.direction === "in" && (!thread.lastInboundAt || thread.lastInboundAt < i.sentAt)) thread.lastInboundAt = i.sentAt;
    }
    return { created: true, id: row.id };
  }

  async purge(orgId: string, connectionId: number) {
    const before = this.messages.length;
    this.messages = this.messages.filter((m) => !(m.organizationId === orgId && m.connectionId === connectionId));
    this.threads = this.threads.filter((t) => !(t.organizationId === orgId && t.connectionId === connectionId));
    const s = this.states.get(connectionId);
    if (s && s.organizationId === orgId) this.states.delete(connectionId);
    return before - this.messages.length;
  }

  async purgeDisconnected(limit: number) {
    const gone = new Set<number>();
    for (const id of [...Array.from(this.states.keys()), ...this.threads.map((t) => t.connectionId), ...this.messages.map((m) => m.connectionId)]) {
      const c = this.connections.find((x) => x.id === id);
      if (c && (c.status === "disconnected" || c.status === "revoked")) gone.add(id);
    }
    const ids = Array.from(gone).slice(0, limit);
    for (const id of ids) await this.purge(this.connections.find((c) => c.id === id)!.organizationId, id);
    return ids.length;
  }
}
