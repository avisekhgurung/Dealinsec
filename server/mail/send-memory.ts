/**
 * An in-memory SendStore for tests, with the world it checks against (messages, leads, the do-not-contact list, members,
 * mailboxes). The same rules as the Postgres store; each call runs to completion before another starts, which is what
 * the database's locks give the real one. The job table's checks are asserted on every write.
 */
import { hashDraft } from "@shared/outreach-hash";
import { normalEmail, suppressionKeys } from "@shared/outreach-safety";
import { mayConnect } from "./connect-service";
import type { MemoryMailboxStore } from "./memory-store";
import { capabilitiesOf, contentProblem } from "./provider";
import type { Reservation, ReserveInput, SendJobView, SendStore } from "./send-store";

export interface MemMessage { id: number; organizationId: string; leadId: number; direction: "out" | "in"; status: string; subject: string | null; body: string; bodyHash: string; toAddress: string | null; sentAt: Date | null; updatedAt: Date }
export interface MemLead { id: number; organizationId: string; doNotContact: boolean }
export interface MemUser { id: string; organizationId: string | null; memberStatus: string; orgRole: string; customPermissions?: string[] | null }
export interface MemEvent { organizationId: string; leadId: number; messageId: number; kind: string; source: string; provider: string | null; providerMessageId: string | null; actorUserId: string | null }

const DAY_MS = 86_400_000;

export class MemorySendWorld implements SendStore {
  messages = new Map<number, MemMessage>();
  leads = new Map<number, MemLead>();
  suppressions: { organizationId: string; kind: string; value: string; reason: string }[] = [];
  users = new Map<string, MemUser>();
  jobs: SendJobView[] = [];
  events: MemEvent[] = [];
  private seq = 0;

  constructor(readonly mailbox: MemoryMailboxStore) {}

  /** mail_send_jobs' checks and unique indexes. */
  private assertJobs() {
    const ids = new Set<number>(), rfc = new Set<string>();
    for (const j of this.jobs) {
      if (ids.has(j.messageId)) throw new Error("mail_send_jobs_message_uq");
      if (rfc.has(j.rfcMessageId)) throw new Error("mail_send_jobs_rfc_uq");
      ids.add(j.messageId); rfc.add(j.rfcMessageId);
      if (j.status === "sent" && !(j.sentAt && (j.providerMessageId || j.resolvedBy))) throw new Error("mail_send_jobs_sent_ck");
      if (j.attempts < 0) throw new Error("mail_send_jobs_attempts_ck");
    }
  }
  private event(e: MemEvent) {
    if (!this.events.some((x) => x.organizationId === e.organizationId && x.messageId === e.messageId && x.kind === e.kind)) this.events.push(e);
  }
  private back(orgId: string, msg: MemMessage, now: Date): string {
    if (msg.status !== "sending") return msg.status;
    const lead = this.leads.get(msg.leadId);
    msg.status = !lead || lead.organizationId !== orgId || lead.doNotContact ? "cancelled" : "approved";
    msg.updatedAt = now;
    return msg.status;
  }
  private job(orgId: string, jobId: number) {
    return this.jobs.find((j) => j.id === jobId && j.organizationId === orgId) ?? null;
  }

  async reserve(i: ReserveInput): Promise<Reservation> {
    const msg = this.messages.get(i.messageId);
    if (!msg || msg.organizationId !== i.orgId || msg.direction !== "out") return { ok: false, code: "not_found" };
    const job = this.jobs.find((j) => j.messageId === i.messageId && j.organizationId === i.orgId) ?? null;
    if (msg.status === "sent" || job?.status === "sent") return { ok: false, code: "already_sent", job: job && { ...job } };
    if (msg.status === "sending" || job?.status === "sending" || job?.status === "uncertain") return { ok: false, code: "in_flight", job: job && { ...job } };
    if (msg.status !== "approved") return { ok: false, code: "not_approved", status: msg.status };
    if (msg.bodyHash !== i.expectedHash) return { ok: false, code: "changed" };
    const subject = (msg.subject ?? "").trim(), body = msg.body.trim();
    if (contentProblem(subject, body) || hashDraft(subject, body) !== msg.bodyHash) return { ok: false, code: "invalid_content" };
    const to = normalEmail(msg.toAddress);
    if (!to) return { ok: false, code: "no_address" };
    const lead = this.leads.get(msg.leadId);
    if (!lead || lead.organizationId !== i.orgId || lead.doNotContact) return { ok: false, code: "do_not_contact" };
    if (i.checkList) {
      const hit = this.suppressions.find((s) => s.organizationId === i.orgId && suppressionKeys(to).some((k) => k.kind === s.kind && k.value === s.value));
      if (hit) return { ok: false, code: "suppressed", entry: { kind: hit.kind, value: hit.value, reason: hit.reason } };
    }
    const u = this.users.get(i.userId);
    if (!u || u.organizationId !== i.orgId || u.memberStatus === "removed") return { ok: false, code: "not_member" };
    if (!mayConnect({ ...u })) return { ok: false, code: "not_allowed" };
    const conn = this.mailbox.rows.find((r) => r.id === i.connectionId && r.organizationId === i.orgId && r.userId === i.userId && r.provider === i.provider);
    if (!conn || conn.status !== "active" || !conn.refreshTokenEnc) return { ok: false, code: "mailbox_unavailable" };
    if (!capabilitiesOf(conn.scopes).send) return { ok: false, code: "missing_send_scope" };
    const accountConns = new Set(this.mailbox.rows.filter((r) => r.provider === conn.provider && r.accountSub === conn.accountSub).map((r) => r.id));
    const used = this.jobs.filter((j) => accountConns.has(j.connectionId) && j.messageId !== i.messageId
      && (j.status === "sending" || j.status === "uncertain" || (j.status === "sent" && j.sentAt && j.sentAt.getTime() > i.now.getTime() - DAY_MS))).length;
    if (used >= i.dailyCap) return { ok: false, code: "daily_cap" };
    if (i.hold) await i.hold();
    const fields = { status: "sending" as const, connectionId: conn.id, requestedBy: i.userId, bodyHash: msg.bodyHash, toAddress: to, leaseUntil: new Date(i.now.getTime() + i.leaseMs), errorCode: null, resolvedBy: null, resolvedAt: null, updatedAt: i.now };
    let row: SendJobView;
    if (job) {
      if (job.status !== "failed" && job.status !== "blocked") return { ok: false, code: "in_flight", job: { ...job } };
      Object.assign(job, fields, { attempts: job.attempts + 1 });
      row = job;
    } else {
      row = { id: ++this.seq, organizationId: i.orgId, leadId: msg.leadId, messageId: msg.id, rfcMessageId: i.newRfcMessageId, attempts: 1, providerMessageId: null, providerThreadId: null, sentAt: null, createdAt: i.now, ...fields };
      this.jobs.push(row);
    }
    msg.status = "sending";
    msg.updatedAt = i.now;
    this.assertJobs();
    return { ok: true, job: { ...row }, mail: { subject, body, to } };
  }

  async finishSent(i: { orgId: string; jobId: number; attempt: number; providerMessageId: string; providerThreadId: string | null; now: Date; recordEvent: boolean }) {
    const j = this.job(i.orgId, i.jobId);
    if (!j || j.attempts !== i.attempt || (j.status !== "sending" && j.status !== "uncertain")) return { won: false, job: j && { ...j } };
    Object.assign(j, { status: "sent", providerMessageId: i.providerMessageId, providerThreadId: i.providerThreadId, sentAt: i.now, leaseUntil: null, errorCode: null, updatedAt: i.now });
    const msg = this.messages.get(j.messageId)!;
    if (msg.status === "sending") Object.assign(msg, { status: "sent", sentAt: i.now, updatedAt: i.now });
    if (i.recordEvent) {
      this.event({ organizationId: i.orgId, leadId: j.leadId, messageId: j.messageId, kind: "sent", source: "provider", provider: "gmail", providerMessageId: i.providerMessageId, actorUserId: j.requestedBy });
      this.event({ organizationId: i.orgId, leadId: j.leadId, messageId: j.messageId, kind: "follow_due", source: "provider", provider: "gmail", providerMessageId: null, actorUserId: j.requestedBy });
    }
    this.assertJobs();
    return { won: true, job: { ...j } };
  }

  async finishNotSent(i: { orgId: string; jobId: number; attempt: number; status: "failed" | "blocked"; code: string; now: Date }) {
    const j = this.job(i.orgId, i.jobId);
    if (!j || j.attempts !== i.attempt || j.status !== "sending") return false;
    Object.assign(j, { status: i.status, errorCode: i.code, leaseUntil: null, updatedAt: i.now });
    this.back(i.orgId, this.messages.get(j.messageId)!, i.now);
    return true;
  }

  async finishUncertain(i: { orgId: string; jobId: number; attempt: number; code: string; now: Date }) {
    const j = this.job(i.orgId, i.jobId);
    if (!j || j.attempts !== i.attempt || j.status !== "sending") return false;
    Object.assign(j, { status: "uncertain", errorCode: i.code, leaseUntil: null, updatedAt: i.now });
    return true;
  }

  async recoverExpired(i: { orgId?: string; now: Date }) {
    let n = 0;
    for (const j of this.jobs) {
      if (j.status === "sending" && j.leaseUntil && j.leaseUntil < i.now && (!i.orgId || j.organizationId === i.orgId)) {
        Object.assign(j, { status: "uncertain", errorCode: "lease_expired", leaseUntil: null, updatedAt: i.now });
        n++;
      }
    }
    return n;
  }

  async jobFor(orgId: string, messageId: number) {
    const j = this.jobs.find((x) => x.organizationId === orgId && x.messageId === messageId);
    return j ? { ...j } : null;
  }

  async resolve(i: { orgId: string; jobId: number; decision: "sent" | "not_sent"; userId: string; now: Date; recordEvent: boolean }) {
    const j = this.job(i.orgId, i.jobId);
    if (!j || j.status !== "uncertain") return { won: false, job: j && { ...j } };
    const msg = this.messages.get(j.messageId)!;
    if (i.decision === "sent") {
      Object.assign(j, { status: "sent", sentAt: i.now, resolvedBy: i.userId, resolvedAt: i.now, leaseUntil: null, updatedAt: i.now });
      if (msg.status === "sending") Object.assign(msg, { status: "sent", sentAt: i.now, updatedAt: i.now });
      if (i.recordEvent) {
        this.event({ organizationId: i.orgId, leadId: j.leadId, messageId: j.messageId, kind: "sent", source: "manual", provider: "gmail", providerMessageId: null, actorUserId: i.userId });
        this.event({ organizationId: i.orgId, leadId: j.leadId, messageId: j.messageId, kind: "follow_due", source: "manual", provider: "gmail", providerMessageId: null, actorUserId: i.userId });
      }
      this.assertJobs();
      return { won: true, job: { ...j }, messageStatus: "sent" };
    }
    Object.assign(j, { status: "failed", errorCode: "resolved_not_sent", resolvedBy: i.userId, resolvedAt: i.now, leaseUntil: null, updatedAt: i.now });
    const messageStatus = this.back(i.orgId, msg, i.now);
    return { won: true, job: { ...j }, messageStatus };
  }
}
