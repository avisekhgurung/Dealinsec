/**
 * GET /api/outbound/results?days=30|90|365: what the workspace's searches found and how reachable it is, and what its
 * outreach campaigns sent and got back (shared/outreach-results.ts). Read-only; every statement is filtered by the
 * caller's organization. Costs are not here: they are the platform's (script/sales-engine-report.mts).
 *
 * Two queries, each allowed to be unavailable on its own: discovery needs only Client Radar's tables; campaigns need
 * theirs, and on a server without them that half is reported as "not set up" instead of failing the whole page.
 */
import { sql } from "drizzle-orm";
import { campaignResultsView, discoveryView, resultsDays, type CampaignResultCounts, type DiscoveryCounts, type ResultsView } from "@shared/outreach-results";
import { fail, readGate, type Result, type Who } from "../services/leads";
import { tablesReadyCheck } from "../leads/ready";
import { prospectsTablesReady } from "./store";

const DAY = 86_400_000;
const campaignsReady = tablesReadyCheck(["campaigns", "campaign_members", "lead_messages", "outreach_events", "lead_events"]);
const threadsReady = tablesReadyCheck(["mail_threads"]);
const rowsOf = <T,>(r: unknown) => (((r as { rows?: unknown[] }).rows ?? r) as T[]);
/** UTC text: the columns are timestamps without a zone holding UTC, and a bare Date would be written in the process's local zone. */
const ts = (d: Date) => sql`${d.toISOString()}::timestamp`;

export interface ResultsDeps {
  ready(): Promise<boolean>;
  now(): Date;
  discovery(orgId: string, since: Date): Promise<DiscoveryCounts>;
  /** null = the campaign tables aren't there. */
  campaigns(orgId: string, since: Date): Promise<CampaignResultCounts[] | null>;
  currency(orgId: string): Promise<string>;
}

export const queryDiscovery: ResultsDeps["discovery"] = async (orgId, since) => {
  const { db } = await import("../db");
  const has = (cond: ReturnType<typeof sql>) => sql`EXISTS (SELECT 1 FROM prospect_findings f WHERE f.organization_id = p.organization_id AND f.prospect_id = p.id AND ${cond})`;
  const real = sql`p.verified_at IS NOT NULL AND p.status <> 'rejected'`;
  const r = await db.execute(sql`
    SELECT count(*)::int AS discovered,
           count(*) FILTER (WHERE ${real})::int AS verified,
           count(*) FILTER (WHERE ${real} AND p.fit->>'verdict' IN ('strong', 'partial'))::int AS qualified,
           count(*) FILTER (WHERE ${real} AND p.ready)::int AS ready,
           count(*) FILTER (WHERE p.researched_at IS NOT NULL)::int AS researched,
           count(*) FILTER (WHERE p.lead_id IS NOT NULL)::int AS leads,
           count(*) FILTER (WHERE ${real} AND ${has(sql`f.kind = 'decision_maker'`)})::int AS person,
           count(*) FILTER (WHERE ${real} AND ${has(sql`f.kind = 'fact' AND f.status = 'confirmed' AND (f.type = 'business_email' OR (f.type = 'contact_form' AND (f.meta->>'formConfirmed' = 'true' OR f.meta->>'detectedBy' = 'form')))`)})::int AS public_route,
           count(*) FILTER (WHERE ${real} AND ${has(sql`f.kind = 'decision_maker' AND f.meta->>'emailStatus' = 'verified'`)})::int AS verified_email
    FROM prospects p WHERE p.organization_id = ${orgId} AND p.created_at >= ${ts(since)}`);
  const x = rowsOf<Record<string, unknown>>(r)[0] ?? {};
  const n = (k: string) => Number(x[k] ?? 0) || 0;
  return { discovered: n("discovered"), verified: n("verified"), qualified: n("qualified"), ready: n("ready"), researched: n("researched"), leads: n("leads"), person: n("person"), publicRoute: n("public_route"), verifiedEmail: n("verified_email") };
};

export const queryCampaigns: ResultsDeps["campaigns"] = async (orgId, since) => {
  if (!(await campaignsReady().catch(() => false))) return null;
  const { db } = await import("../db");
  const interested = (await threadsReady().catch(() => false))
    ? sql`EXISTS (SELECT 1 FROM mail_threads t WHERE t.organization_id = cm.organization_id AND t.lead_message_id = cm.message_id AND t.status = 'interested')`
    : sql`false`;
  const outcome = (kind: string) => sql`EXISTS (SELECT 1 FROM outreach_events e WHERE e.organization_id = cm.organization_id AND e.message_id = cm.message_id AND e.kind = ${kind})`;
  // A stage a lead is in now, or ever moved to (the funnel's own rule: server/outbound/funnel.ts).
  const reached = (stages: ReturnType<typeof sql>) => sql`(
    EXISTS (SELECT 1 FROM leads l WHERE l.organization_id = cm.organization_id AND l.id = cm.lead_id AND l.status IN (${stages}))
    OR EXISTS (SELECT 1 FROM lead_events le WHERE le.organization_id = cm.organization_id AND le.lead_id = cm.lead_id AND le.kind = 'status_changed' AND le.data->>'to' IN (${stages})))`;
  const r = await db.execute(sql`
    WITH m AS (
      SELECT cm.campaign_id, cm.lead_id, (lm.status = 'sent') AS sent,
             ${outcome("replied")} AS replied, ${outcome("bounced")} AS bounced, ${outcome("opted_out")} AS opted_out, ${interested} AS interested,
             ${reached(sql`'meeting', 'proposal', 'won'`)} AS meeting, ${reached(sql`'proposal', 'won'`)} AS proposal,
             EXISTS (SELECT 1 FROM leads l WHERE l.organization_id = cm.organization_id AND l.id = cm.lead_id AND l.status = 'won') AS won,
             COALESCE((SELECT d.deal_amount FROM leads l JOIN deals d ON d.id = l.converted_deal_id AND d.organization_id = l.organization_id
                       WHERE l.organization_id = cm.organization_id AND l.id = cm.lead_id AND l.status = 'won'), 0) AS won_value
      FROM campaign_members cm
      LEFT JOIN lead_messages lm ON lm.organization_id = cm.organization_id AND lm.id = cm.message_id
      WHERE cm.organization_id = ${orgId}
    )
    SELECT c.id, c.name, c.profile_name, c.status, to_char(c.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
           count(m.lead_id)::int AS members,
           count(*) FILTER (WHERE m.sent)::int AS sent,
           count(*) FILTER (WHERE m.sent AND m.replied)::int AS replied,
           count(*) FILTER (WHERE m.sent AND m.interested)::int AS interested,
           count(*) FILTER (WHERE m.sent AND m.bounced)::int AS bounced,
           count(*) FILTER (WHERE m.sent AND m.opted_out)::int AS opted_out,
           count(*) FILTER (WHERE m.sent AND m.meeting)::int AS meeting,
           count(*) FILTER (WHERE m.sent AND m.proposal)::int AS proposal,
           count(*) FILTER (WHERE m.sent AND m.won)::int AS won,
           COALESCE(sum(m.won_value) FILTER (WHERE m.sent AND m.won), 0)::bigint AS won_value
    FROM campaigns c LEFT JOIN m ON m.campaign_id = c.id
    WHERE c.organization_id = ${orgId} AND c.created_at >= ${ts(since)}
    GROUP BY c.id ORDER BY c.created_at DESC, c.id DESC LIMIT 100`);
  return rowsOf<Record<string, unknown>>(r).map((x) => {
    const n = (k: string) => Number(x[k] ?? 0) || 0;
    return {
      id: n("id"), name: String(x.name ?? ""), profileName: x.profile_name ? String(x.profile_name) : null, archived: x.status !== "active", createdAt: String(x.created_at ?? ""), // read as UTC text: the driver would parse a zone-less timestamp in the process's local zone
      members: n("members"), sent: n("sent"), replied: n("replied"), interested: n("interested"), bounced: n("bounced"), optedOut: n("opted_out"), meeting: n("meeting"), proposal: n("proposal"), won: n("won"), wonValueMinor: n("won_value"),
    };
  });
};

const defaults = (): ResultsDeps => ({
  ready: prospectsTablesReady, now: () => new Date(), discovery: queryDiscovery, campaigns: queryCampaigns,
  currency: async (id) => (await (await import("../storage")).storage.getOrganization(id))?.currency || "INR",
});

export async function getResults(user: Who, days: unknown, d: Partial<ResultsDeps> = {}): Promise<Result<{ results: ResultsView }>> {
  const deps = { ...defaults(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  let ready = false;
  try { ready = await deps.ready(); } catch { ready = false; }
  if (!ready) return fail(503, "OUTBOUND_NOT_SETUP", "Client Radar isn't set up on this server yet.");
  const window = resultsDays(days), orgId = user.organizationId!;
  const since = new Date(deps.now().getTime() - window * DAY);
  let discovery: DiscoveryCounts;
  try { discovery = await deps.discovery(orgId, since); }
  catch { return fail(503, "RESULTS_UNAVAILABLE", "The results couldn't be counted on this server."); }
  // Campaigns are the newer half: failing to count them leaves that half out, and says so by being null.
  const [campaigns, currency] = await Promise.all([deps.campaigns(orgId, since).catch(() => null), deps.currency(orgId).catch(() => "INR")]);
  return { ok: true, results: { days: window, currency, discovery: discoveryView(discovery), campaigns: campaigns ? campaignResultsView(campaigns) : null } };
}
