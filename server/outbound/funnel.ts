/**
 * GET /api/outbound/funnel?days=30|90|365: the research → revenue funnel for the companies this workspace researched in
 * the window (shared/sales-funnel.ts). Read-only; every table is filtered by the caller's organization, and leads,
 * messages and deals are reached only through this workspace's own prospects. Costs are not shown here: they are the
 * platform's, reported to the operator by script/sales-engine-report.ts.
 */
import { sql } from "drizzle-orm";
import { funnelDays, funnelView, type FunnelCounts, type FunnelView } from "@shared/sales-funnel";
import { fail, readGate, type Result, type Who } from "../services/leads";
import { prospectsTablesReady } from "./store";

const DAY = 86_400_000;

export type FunnelQuery = (orgId: string, since: Date) => Promise<{ counts: FunnelCounts; revenueMinor: number }>;

/** One query: the cohort of researched prospects, then each stage as a count of distinct companies. Times are stored as
 *  UTC in timestamp-without-time-zone columns, so the window start is passed as UTC text (a JS Date would be sent in the
 *  process's local zone and shift the window by its offset). */
export const queryFunnel: FunnelQuery = async (orgId, since) => {
  const { db } = await import("../db");   // lazily, so the gate and the shaping are testable without a database
  const r = await db.execute(sql`
    WITH cohort AS (
      SELECT p.id, p.lead_id, p.angle IS NOT NULL AS has_angle
      FROM prospects p
      WHERE p.organization_id = ${orgId} AND p.researched_at IS NOT NULL AND p.researched_at >= ${since.toISOString()}::timestamptz AT TIME ZONE 'UTC'
    ),
    l AS (
      SELECT ld.id, ld.status, ld.converted_deal_id
      FROM leads ld JOIN cohort c ON c.lead_id = ld.id
      WHERE ld.organization_id = ${orgId}
    ),
    msg AS (
      SELECT m.lead_id, m.status, m.direction FROM lead_messages m JOIN l ON l.id = m.lead_id WHERE m.organization_id = ${orgId}
      UNION ALL
      SELECT cm.lead_id, CASE WHEN cm.status IN ('sent') OR cm.sent_at IS NOT NULL THEN 'sent' ELSE cm.status END, cm.direction
      FROM channel_messages cm JOIN l ON l.id = cm.lead_id WHERE cm.organization_id = ${orgId}
    ),
    ev AS (
      SELECT e.lead_id, e.kind FROM outreach_events e JOIN l ON l.id = e.lead_id WHERE e.organization_id = ${orgId}
    ),
    -- Every stage a lead has ever been in: its current one, and each stage it moved to (lead_events status_changed, written
    -- by every stage writer: the lead service, sends, Gmail and WhatsApp replies; "converted" means won).
    reached AS (
      SELECT l.id AS lead_id, l.status AS stage FROM l
      UNION
      SELECT le.lead_id, le.data->>'to' FROM lead_events le JOIN l ON l.id = le.lead_id
      WHERE le.organization_id = ${orgId} AND le.kind = 'status_changed' AND le.data->>'to' IS NOT NULL
      UNION
      SELECT le.lead_id, 'won' FROM lead_events le JOIN l ON l.id = le.lead_id WHERE le.organization_id = ${orgId} AND le.kind = 'converted'
    )
    SELECT
      (SELECT count(*) FROM cohort)::int AS researched,
      (SELECT count(*) FROM cohort WHERE has_angle)::int AS opportunity,
      (SELECT count(*) FROM l)::int AS lead,
      (SELECT count(DISTINCT lead_id) FROM msg WHERE direction = 'out')::int AS drafted,
      (SELECT count(DISTINCT lead_id) FROM msg WHERE direction = 'out' AND status IN ('approved', 'sending', 'sent'))::int AS approved,
      (SELECT count(DISTINCT lead_id) FROM msg WHERE direction = 'out' AND status = 'sent')::int AS sent,
      (SELECT count(*) FROM l WHERE l.id IN (SELECT lead_id FROM ev WHERE kind = 'replied') OR l.id IN (SELECT lead_id FROM msg WHERE direction = 'in') OR l.id IN (SELECT lead_id FROM reached WHERE stage IN ('replied', 'meeting', 'proposal', 'won')))::int AS replied,
      (SELECT count(DISTINCT lead_id) FROM reached WHERE stage IN ('meeting', 'proposal', 'won'))::int AS meeting,
      (SELECT count(DISTINCT lead_id) FROM reached WHERE stage IN ('proposal', 'won'))::int AS proposal,
      (SELECT count(*) FROM l WHERE status = 'won')::int AS won,
      (SELECT count(*) FROM l WHERE status = 'lost')::int AS lost,
      (SELECT count(DISTINCT lead_id) FROM ev WHERE kind = 'opted_out')::int AS opted_out,
      (SELECT coalesce(sum(d.deal_amount), 0) FROM deals d JOIN l ON l.converted_deal_id = d.id WHERE l.status = 'won' AND d.organization_id = ${orgId})::bigint AS revenue
  `);
  const row = ((r as any).rows ?? r)[0] ?? {};
  const n = (k: string) => Number(row[k] ?? 0) || 0;
  return {
    counts: {
      researched: n("researched"), opportunity: n("opportunity"), lead: n("lead"), drafted: n("drafted"), approved: n("approved"), sent: n("sent"),
      replied: n("replied"), meeting: n("meeting"), proposal: n("proposal"), won: n("won"), lost: n("lost"), optedOut: n("opted_out"),
    },
    revenueMinor: n("revenue"),
  };
};

export async function getFunnel(user: Who, days: unknown, d: { query?: FunnelQuery; ready?: () => Promise<boolean>; now?: () => Date; currency?: (orgId: string) => Promise<string> } = {}): Promise<Result<{ funnel: FunnelView }>> {
  const gate = readGate(user);
  if (gate) return gate;
  if (!(await (d.ready ?? prospectsTablesReady)())) return fail(503, "OUTBOUND_NOT_SETUP", "Client Radar isn't set up on this server yet.");
  const window = funnelDays(days);
  const since = new Date((d.now ?? (() => new Date()))().getTime() - window * DAY);
  try {
    const orgId = user.organizationId!;
    const [{ counts, revenueMinor }, currency] = await Promise.all([
      (d.query ?? queryFunnel)(orgId, since),
      (d.currency ?? (async (id: string) => (await (await import("../storage")).storage.getOrganization(id))?.currency || "INR"))(orgId).catch(() => "INR"),
    ]);
    return { ok: true, funnel: funnelView(counts, revenueMinor, window, currency) };
  } catch {
    // Older databases may miss a table this reads (channel messages, outreach events): say so, don't guess numbers.
    return fail(503, "FUNNEL_UNAVAILABLE", "The results couldn't be counted on this server.");
  }
}
