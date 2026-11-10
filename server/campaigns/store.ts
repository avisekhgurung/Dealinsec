/**
 * Campaigns: the database. Every statement a person's request reaches is filtered by their organization, so a
 * campaign in another workspace is simply not found. The background job's two claims (a member to draft for, a
 * campaign to send from) cross organizations on purpose and return the organization with the row; everything it does
 * next is done as that organization's own member, through the ordinary outreach services.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { campaignMembers, campaigns, type CampaignMemberRow, type CampaignRow } from "@shared/schema";
import { tablesReadyCheck } from "../leads/ready";

/** Campaigns sit on top of outreach: without messages and the do-not-contact list there is nothing to group. */
export const campaignTablesReady = tablesReadyCheck(["campaigns", "campaign_members", "leads", "lead_messages", "outreach_events", "outreach_suppressions"]);
const threadsReady = tablesReadyCheck(["mail_threads"]);
const radarReady = tablesReadyCheck(["prospects", "prospect_run_items", "prospect_runs"]);

export interface MemberView {
  id: number; leadId: number; state: string; reason: string | null; attempts: number; holdReason: string | null; holdHash: string | null;
  lead: { companyName: string; domain: string | null; status: string; contactName: string | null; contactEmail: string | null; doNotContact: boolean; archived: boolean } | null;
  message: { id: number; status: string; subject: string | null; to: string | null; bodyHash: string; edited: boolean; approvedAt: Date | null; sentAt: Date | null } | null;
  outcomes: string[]; interested: boolean;
}
export interface AudienceLead {
  id: number; companyName: string; domain: string | null; industry: string | null; location: string | null; status: string; source: string;
  contactName: string | null; hasEmail: boolean; doNotContact: boolean; hasUnsent: boolean; inCampaign: string | null;
  /** From Client Radar: the saved client profile its search started from (when there was one), and whether the company was Ready. */
  profileName: string | null; ready: boolean;
}
export interface AudienceFilter { status?: string | null; source?: string | null; q?: string | null; /** Only leads found by a search started from this saved client profile. */ profileId?: number | null; /** Only leads whose company Client Radar marked Ready. */ ready?: boolean }
export interface NewCampaign { name: string; profileId: number | null; profileName: string | null; footerNote: string; dailyLimit: number; gapSeconds: number }
export type SettingsPatch = Partial<Pick<CampaignRow, "name" | "dailyLimit" | "gapSeconds" | "footerNote" | "status">>;
export interface SendPick { memberId: number; leadId: number; messageId: number; bodyHash: string; body: string }

export interface CampaignStore {
  list(orgId: string): Promise<CampaignRow[]>;
  get(orgId: string, id: number): Promise<CampaignRow | null>;
  /** Creates the campaign with its members in one transaction; null when the workspace already holds `max` active ones. */
  create(orgId: string, userId: string, c: NewCampaign, leadIds: number[], now: Date, max: number): Promise<CampaignRow | null>;
  update(orgId: string, id: number, patch: SettingsPatch, now: Date): Promise<CampaignRow | null>;
  /** Adds leads not already in it, up to `max` members in all. Returns how many were added. */
  addMembers(orgId: string, id: number, leadIds: number[], now: Date, max: number): Promise<number>;
  /** Removes a lead from the campaign unless its message was sent or is being sent. Its draft, if any, stays in Outreach. */
  removeMember(orgId: string, id: number, leadId: number): Promise<"removed" | "sent" | "missing">;
  members(orgId: string, id: number): Promise<MemberView[]>;
  /** Counts for every campaign of the workspace: one row per member, already joined to its message and outcomes. */
  memberFacts(orgId: string): Promise<{ campaignId: number; state: string; messageStatus: string | null; outcomes: string[]; interested: boolean }[]>;
  /** The workspace's leads that exist and are its own, of the given ids. */
  ownLeadIds(orgId: string, leadIds: number[]): Promise<number[]>;
  audience(orgId: string, f: AudienceFilter, limit: number): Promise<AudienceLead[]>;
  /** A discarded draft the person replaced: point the member at the newer message for the same lead. */
  relink(orgId: string, id: number): Promise<void>;

  setPreparing(orgId: string, id: number, o: { on: boolean; userId?: string | null; stop?: string | null; requeueFailed?: boolean }, now: Date): Promise<CampaignRow | null>;
  setSending(orgId: string, id: number, o: { on: boolean; userId?: string | null; stop?: string | null; nextSendAt?: Date | null }, now: Date): Promise<CampaignRow | null>;

  /** The next member to draft for, of any campaign that is preparing, leased so two passes never take the same one. */
  claimDraft(now: Date, leaseMs: number): Promise<{ member: CampaignMemberRow; campaign: CampaignRow } | null>;
  settleMember(id: number, patch: Partial<Pick<CampaignMemberRow, "state" | "reason" | "messageId" | "attempts" | "holdReason" | "holdHash">>, now: Date): Promise<void>;
  /** Drafting is over for a campaign with nobody left waiting. */
  finishPreparing(now: Date): Promise<number>;
  /** A campaign whose queue is on and whose next send is due, leased. */
  claimSend(now: Date, leaseMs: number): Promise<CampaignRow | null>;
  releaseSend(id: number, o: { nextSendAt?: Date | null }, now: Date): Promise<void>;
  /** The oldest approved message of the campaign that isn't on hold for its current text. */
  nextApproved(orgId: string, id: number): Promise<SendPick | null>;
  /** How many of the campaign's messages were sent since `since`, and how many of all its sent ones bounced. */
  sendFacts(orgId: string, id: number, since: Date): Promise<{ sentSince: number; sent: number; bounced: number }>;
  unsentMessageId(orgId: string, leadId: number): Promise<number | null>;
  /** Replaces a DRAFT's text (the footer), only if it is still the draft that was read. */
  setDraftBody(orgId: string, messageId: number, fromHash: string, body: string, bodyHash: string, now: Date): Promise<boolean>;
  draftBody(orgId: string, messageId: number): Promise<{ subject: string | null; body: string; bodyHash: string; status: string } | null>;
}

const rowsOf = <T,>(r: { rows?: unknown[] }) => (r.rows ?? []) as T[];
/**
 * A moment as SQL. The columns are timestamps WITHOUT a zone holding UTC (what drizzle writes); a bare Date handed to
 * the driver in raw SQL is written in the process's LOCAL zone instead, which makes "is it due yet?" wrong by the
 * zone's offset on any machine not running in UTC. So raw SQL always says the UTC text.
 */
const ts = (d: Date) => sql`${d.toISOString()}::timestamp`;
const lockOrg = (tx: any, orgId: string) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`campaigns|${orgId}`}))`);

export const campaignStore: CampaignStore = {
  async list(orgId) {
    return db.select().from(campaigns).where(eq(campaigns.organizationId, orgId)).orderBy(desc(campaigns.createdAt), desc(campaigns.id));
  },
  async get(orgId, id) {
    const [r] = await db.select().from(campaigns).where(and(eq(campaigns.organizationId, orgId), eq(campaigns.id, id))).limit(1);
    return r ?? null;
  },
  async create(orgId, userId, c, leadIds, now, max) {
    return db.transaction(async (tx) => {
      await lockOrg(tx, orgId);
      const n = await tx.execute(sql`SELECT count(*)::int AS n FROM campaigns WHERE organization_id = ${orgId} AND status = 'active'`);
      if (Number(rowsOf<{ n: number }>(n)[0]?.n) >= max) return null;
      const [row] = await tx.insert(campaigns).values({ organizationId: orgId, createdByUser: userId, ...c, createdAt: now, updatedAt: now }).returning();
      if (leadIds.length) await tx.insert(campaignMembers).values(leadIds.map((leadId) => ({ campaignId: row.id, organizationId: orgId, leadId, createdAt: now, updatedAt: now }))).onConflictDoNothing();
      return row;
    });
  },
  async update(orgId, id, patch, now) {
    const [r] = await db.update(campaigns).set({ ...patch, updatedAt: now }).where(and(eq(campaigns.organizationId, orgId), eq(campaigns.id, id))).returning();
    return r ?? null;
  },
  async addMembers(orgId, id, leadIds, now, max) {
    if (!leadIds.length) return 0;
    return db.transaction(async (tx) => {
      await lockOrg(tx, orgId);
      const [c] = await tx.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.organizationId, orgId), eq(campaigns.id, id))).limit(1);
      if (!c) return 0;
      const have = await tx.select({ leadId: campaignMembers.leadId }).from(campaignMembers).where(eq(campaignMembers.campaignId, id));
      const taken = new Set(have.map((h) => h.leadId));
      const fresh = leadIds.filter((l) => !taken.has(l)).slice(0, Math.max(0, max - have.length));
      if (!fresh.length) return 0;
      const added = await tx.insert(campaignMembers).values(fresh.map((leadId) => ({ campaignId: id, organizationId: orgId, leadId, createdAt: now, updatedAt: now }))).onConflictDoNothing().returning({ id: campaignMembers.id });
      return added.length;
    });
  },
  async removeMember(orgId, id, leadId) {
    const r = await db.execute(sql`
      DELETE FROM campaign_members m WHERE m.organization_id = ${orgId} AND m.campaign_id = ${id} AND m.lead_id = ${leadId}
        AND NOT EXISTS (SELECT 1 FROM lead_messages lm WHERE lm.organization_id = m.organization_id AND lm.id = m.message_id AND lm.status IN ('sent', 'sending'))
      RETURNING m.id`);
    if (rowsOf(r).length) return "removed";
    const [still] = await db.select({ id: campaignMembers.id }).from(campaignMembers).where(and(eq(campaignMembers.organizationId, orgId), eq(campaignMembers.campaignId, id), eq(campaignMembers.leadId, leadId))).limit(1);
    return still ? "sent" : "missing";
  },
  async members(orgId, id) {
    const interested = (await threadsReady().catch(() => false))
      ? sql`EXISTS (SELECT 1 FROM mail_threads t WHERE t.organization_id = m.organization_id AND t.lead_message_id = m.message_id AND t.status = 'interested')`
      : sql`false`;
    const r = await db.execute(sql`
      SELECT m.id, m.lead_id, m.state, m.reason, m.attempts, m.hold_reason, m.hold_hash,
             l.id AS l_id, l.company_name, l.domain, l.status AS lead_status, l.contact_name, l.contact_email, l.do_not_contact, l.archived_at,
             lm.id AS msg_id, lm.status AS msg_status, lm.subject, lm.to_address, lm.body_hash, lm.edited,
             to_char(lm.approved_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS approved_at, to_char(lm.sent_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS sent_at,
             COALESCE((SELECT array_agg(DISTINCT e.kind) FROM outreach_events e WHERE e.organization_id = m.organization_id AND e.message_id = m.message_id AND e.kind IN ('replied', 'bounced', 'opted_out')), '{}') AS outcomes,
             ${interested} AS interested
      FROM campaign_members m
      LEFT JOIN leads l ON l.organization_id = m.organization_id AND l.id = m.lead_id
      LEFT JOIN lead_messages lm ON lm.organization_id = m.organization_id AND lm.id = m.message_id
      WHERE m.organization_id = ${orgId} AND m.campaign_id = ${id}
      ORDER BY m.id`);
    return rowsOf<any>(r).map((x) => ({
      id: Number(x.id), leadId: Number(x.lead_id), state: x.state, reason: x.reason, attempts: Number(x.attempts), holdReason: x.hold_reason, holdHash: x.hold_hash,
      lead: x.l_id ? { companyName: x.company_name, domain: x.domain, status: x.lead_status, contactName: x.contact_name, contactEmail: x.contact_email, doNotContact: !!x.do_not_contact, archived: !!x.archived_at } : null,
      message: x.msg_id ? { id: Number(x.msg_id), status: x.msg_status, subject: x.subject, to: x.to_address, bodyHash: x.body_hash, edited: !!x.edited, approvedAt: x.approved_at ? new Date(x.approved_at) : null, sentAt: x.sent_at ? new Date(x.sent_at) : null } : null,
      outcomes: (x.outcomes ?? []) as string[], interested: !!x.interested,
    }));
  },
  async memberFacts(orgId) {
    const interested = (await threadsReady().catch(() => false))
      ? sql`EXISTS (SELECT 1 FROM mail_threads t WHERE t.organization_id = m.organization_id AND t.lead_message_id = m.message_id AND t.status = 'interested')`
      : sql`false`;
    const r = await db.execute(sql`
      SELECT m.campaign_id, m.state, lm.status AS msg_status,
             COALESCE((SELECT array_agg(DISTINCT e.kind) FROM outreach_events e WHERE e.organization_id = m.organization_id AND e.message_id = m.message_id AND e.kind IN ('replied', 'bounced', 'opted_out')), '{}') AS outcomes,
             ${interested} AS interested
      FROM campaign_members m LEFT JOIN lead_messages lm ON lm.organization_id = m.organization_id AND lm.id = m.message_id
      WHERE m.organization_id = ${orgId}`);
    return rowsOf<any>(r).map((x) => ({ campaignId: Number(x.campaign_id), state: x.state, messageStatus: x.msg_status ?? null, outcomes: (x.outcomes ?? []) as string[], interested: !!x.interested }));
  },
  async ownLeadIds(orgId, leadIds) {
    if (!leadIds.length) return [];
    const r = await db.execute(sql`SELECT id FROM leads WHERE organization_id = ${orgId} AND archived_at IS NULL AND id IN (${sql.join(leadIds.map((i) => sql`${i}`), sql`, `)})`);
    return rowsOf<{ id: number }>(r).map((x) => Number(x.id));
  },
  async audience(orgId, f, limit) {
    const q = f.q ? `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
    // Where a lead came from, read from Client Radar's own rows: the lead's company, the searches that found it, and the
    // profile a search carried (prospect_runs.icp.profile). On a database without Client Radar these are simply absent,
    // and a filter that needs them matches nothing rather than everything.
    const radar = await radarReady().catch(() => false);
    const fromProfile = (cond: ReturnType<typeof sql>) => sql`
      SELECT r.icp->'profile'->>'name' FROM prospects p
      JOIN prospect_run_items i ON i.organization_id = p.organization_id AND i.prospect_id = p.id
      JOIN prospect_runs r ON r.organization_id = p.organization_id AND r.id = i.run_id
      WHERE p.organization_id = l.organization_id AND p.lead_id = l.id AND r.icp->'profile'->>'id' IS NOT NULL AND ${cond}
      ORDER BY r.created_at DESC LIMIT 1`;
    const profileName = radar ? sql`(${fromProfile(sql`true`)})` : sql`NULL`;
    const isReady = radar ? sql`EXISTS (SELECT 1 FROM prospects p WHERE p.organization_id = l.organization_id AND p.lead_id = l.id AND p.ready)` : sql`false`;
    const wantProfile = f.profileId ? (radar ? sql`AND EXISTS (${fromProfile(sql`r.icp->'profile'->>'id' = ${String(f.profileId)}`)})` : sql`AND false`) : sql``;
    const wantReady = f.ready ? sql`AND ${isReady}` : sql``;
    const r = await db.execute(sql`
      SELECT l.id, l.company_name, l.domain, l.industry, l.location, l.status, l.source, l.contact_name, l.do_not_contact,
             (l.contact_email IS NOT NULL AND l.contact_email <> '') AS has_email,
             EXISTS (SELECT 1 FROM lead_messages lm WHERE lm.organization_id = l.organization_id AND lm.lead_id = l.id AND lm.direction = 'out' AND lm.status IN ('draft', 'approved', 'sending', 'variant')) AS has_unsent,
             (SELECT c.name FROM campaign_members m JOIN campaigns c ON c.id = m.campaign_id WHERE m.organization_id = l.organization_id AND m.lead_id = l.id AND c.status = 'active' ORDER BY c.id DESC LIMIT 1) AS in_campaign,
             ${profileName} AS profile_name, ${isReady} AS ready
      FROM leads l
      WHERE l.organization_id = ${orgId} AND l.archived_at IS NULL AND l.converted_deal_id IS NULL
        AND l.status IN ('new', 'researching', 'qualified')
        AND (${f.status ?? null}::text IS NULL OR l.status = ${f.status ?? null})
        AND (${f.source ?? null}::text IS NULL OR l.source = ${f.source ?? null})
        AND (${q}::text IS NULL OR l.company_name ILIKE ${q} OR l.industry ILIKE ${q} OR l.location ILIKE ${q} OR l.domain ILIKE ${q})
        ${wantProfile} ${wantReady}
      ORDER BY l.updated_at DESC, l.id DESC LIMIT ${limit}`);
    return rowsOf<any>(r).map((x) => ({
      id: Number(x.id), companyName: x.company_name, domain: x.domain, industry: x.industry, location: x.location, status: x.status, source: x.source,
      contactName: x.contact_name, hasEmail: !!x.has_email, doNotContact: !!x.do_not_contact, hasUnsent: !!x.has_unsent, inCampaign: x.in_campaign ?? null,
      profileName: x.profile_name ? String(x.profile_name) : null, ready: !!x.ready,
    }));
  },
  async relink(orgId, id) {
    const newer = sql`SELECT x.id FROM lead_messages x WHERE x.organization_id = m.organization_id AND x.lead_id = m.lead_id AND x.direction = 'out'
                        AND x.status IN ('draft', 'approved', 'sending', 'sent') AND x.id > m.message_id ORDER BY x.id LIMIT 1`;
    await db.execute(sql`
      UPDATE campaign_members m SET message_id = (${newer}), hold_reason = NULL, hold_hash = NULL
      WHERE m.organization_id = ${orgId} AND m.campaign_id = ${id}
        AND EXISTS (SELECT 1 FROM lead_messages old WHERE old.organization_id = m.organization_id AND old.id = m.message_id AND old.status = 'cancelled')
        AND EXISTS (${newer})`);
  },

  async setPreparing(orgId, id, o, now) {
    return db.transaction(async (tx) => {
      const [r] = await tx.update(campaigns).set({ preparing: o.on, ...(o.userId !== undefined ? { prepareUserId: o.userId } : {}), prepareStop: o.stop ?? null, updatedAt: now })
        .where(and(eq(campaigns.organizationId, orgId), eq(campaigns.id, id), eq(campaigns.status, "active"))).returning();
      if (r && o.requeueFailed) await tx.update(campaignMembers).set({ state: "queued", reason: null, attempts: 0, leaseUntil: null, updatedAt: now }).where(and(eq(campaignMembers.campaignId, id), eq(campaignMembers.state, "failed")));
      return r ?? null;
    });
  },
  async setSending(orgId, id, o, now) {
    const [r] = await db.update(campaigns).set({ sending: o.on, ...(o.userId !== undefined ? { senderUserId: o.userId } : {}), sendStop: o.stop ?? null, ...(o.nextSendAt !== undefined ? { nextSendAt: o.nextSendAt } : {}), leaseUntil: null, updatedAt: now })
      .where(and(eq(campaigns.organizationId, orgId), eq(campaigns.id, id), eq(campaigns.status, "active"))).returning();
    return r ?? null;
  },

  async claimDraft(now, leaseMs) {
    const until = new Date(now.getTime() + leaseMs);
    const r = await db.execute(sql`
      UPDATE campaign_members SET lease_until = ${ts(until)}, attempts = attempts + 1, updated_at = ${ts(now)}
      WHERE id = (
        SELECT m.id FROM campaign_members m JOIN campaigns c ON c.id = m.campaign_id
        WHERE c.preparing AND c.status = 'active' AND m.state = 'queued' AND (m.lease_until IS NULL OR m.lease_until < ${ts(now)})
        ORDER BY m.updated_at, m.id LIMIT 1 FOR UPDATE OF m SKIP LOCKED)
      RETURNING id`);
    const id = Number(rowsOf<{ id: number }>(r)[0]?.id);
    if (!id) return null;
    const [member] = await db.select().from(campaignMembers).where(eq(campaignMembers.id, id)).limit(1);
    const [campaign] = member ? await db.select().from(campaigns).where(eq(campaigns.id, member.campaignId)).limit(1) : [];
    return member && campaign ? { member, campaign } : null;
  },
  async settleMember(id, patch, now) {
    await db.update(campaignMembers).set({ ...patch, leaseUntil: null, updatedAt: now }).where(eq(campaignMembers.id, id));
  },
  async finishPreparing(now) {
    const r = await db.execute(sql`
      UPDATE campaigns c SET preparing = false, prepare_stop = NULL, updated_at = ${ts(now)}
      WHERE c.preparing AND NOT EXISTS (SELECT 1 FROM campaign_members m WHERE m.campaign_id = c.id AND m.state = 'queued')
      RETURNING c.id`);
    return rowsOf(r).length;
  },
  async claimSend(now, leaseMs) {
    const until = new Date(now.getTime() + leaseMs);
    const r = await db.execute(sql`
      UPDATE campaigns SET lease_until = ${ts(until)}
      WHERE id = (
        SELECT c.id FROM campaigns c
        WHERE c.sending AND c.status = 'active' AND (c.next_send_at IS NULL OR c.next_send_at <= ${ts(now)}) AND (c.lease_until IS NULL OR c.lease_until < ${ts(now)})
        ORDER BY c.next_send_at NULLS FIRST, c.id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id`);
    const id = Number(rowsOf<{ id: number }>(r)[0]?.id);
    if (!id) return null;
    const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
    return c ?? null;
  },
  async releaseSend(id, o, now) {
    await db.update(campaigns).set({ leaseUntil: null, ...(o.nextSendAt !== undefined ? { nextSendAt: o.nextSendAt } : {}), updatedAt: now }).where(eq(campaigns.id, id));
  },
  async nextApproved(orgId, id) {
    const r = await db.execute(sql`
      SELECT m.id AS member_id, m.lead_id, lm.id AS message_id, lm.body_hash, lm.body
      FROM campaign_members m JOIN lead_messages lm ON lm.organization_id = m.organization_id AND lm.id = m.message_id
      WHERE m.organization_id = ${orgId} AND m.campaign_id = ${id} AND m.state = 'drafted' AND lm.status = 'approved' AND lm.direction = 'out'
        AND (m.hold_hash IS NULL OR m.hold_hash <> lm.body_hash)
      ORDER BY lm.approved_at NULLS LAST, m.id LIMIT 1`);
    const x = rowsOf<any>(r)[0];
    return x ? { memberId: Number(x.member_id), leadId: Number(x.lead_id), messageId: Number(x.message_id), bodyHash: x.body_hash, body: x.body } : null;
  },
  async sendFacts(orgId, id, since) {
    const r = await db.execute(sql`
      SELECT count(*) FILTER (WHERE lm.sent_at >= ${ts(since)})::int AS sent_since, count(*)::int AS sent,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM outreach_events e WHERE e.organization_id = m.organization_id AND e.message_id = m.message_id AND e.kind = 'bounced'))::int AS bounced
      FROM campaign_members m JOIN lead_messages lm ON lm.organization_id = m.organization_id AND lm.id = m.message_id
      WHERE m.organization_id = ${orgId} AND m.campaign_id = ${id} AND lm.status = 'sent'`);
    const x = rowsOf<any>(r)[0] ?? {};
    return { sentSince: Number(x.sent_since ?? 0), sent: Number(x.sent ?? 0), bounced: Number(x.bounced ?? 0) };
  },
  async unsentMessageId(orgId, leadId) {
    const r = await db.execute(sql`SELECT id FROM lead_messages WHERE organization_id = ${orgId} AND lead_id = ${leadId} AND direction = 'out' AND status IN ('draft', 'approved', 'sending') ORDER BY id DESC LIMIT 1`);
    const id = Number(rowsOf<{ id: number }>(r)[0]?.id);
    return id || null;
  },
  async setDraftBody(orgId, messageId, fromHash, body, bodyHash, now) {
    const r = await db.execute(sql`UPDATE lead_messages SET body = ${body}, body_hash = ${bodyHash}, updated_at = ${ts(now)} WHERE organization_id = ${orgId} AND id = ${messageId} AND status = 'draft' AND body_hash = ${fromHash} RETURNING id`);
    return rowsOf(r).length > 0;
  },
  async draftBody(orgId, messageId) {
    const r = await db.execute(sql`SELECT subject, body, body_hash, status FROM lead_messages WHERE organization_id = ${orgId} AND id = ${messageId} LIMIT 1`);
    const x = rowsOf<any>(r)[0];
    return x ? { subject: x.subject, body: x.body, bodyHash: x.body_hash, status: x.status } : null;
  },
};
