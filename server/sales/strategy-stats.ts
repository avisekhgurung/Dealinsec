/**
 * The strategy performance report (shared/strategy-stats.ts): one SQL aggregation over lead_messages and
 * outreach_events, grouped by strategy and prompt version. Only real events are counted:
 *  - the window selects messages by created_at (when the message was written); outcomes count whenever they arrive;
 *  - outcomes join through the unique (organization, message, kind) index with bool_or, so a reply recorded by
 *    hand AND seen by the Gmail sync (same event row, the index allows one) counts once per message;
 *  - follow-ups and messages from before strategies existed have no strategy and are left out;
 *  - a reply lands on the FIRST message of its thread (reply-apply and recordOutcome both write it there), which
 *    is the strategy-tagged row, so attribution needs no join through follow-ups.
 * Without the outcome tables (outreach_safety not migrated) the outcome columns are zero, never an error.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { parseStrategyWindow, type StrategyStatRow, type StrategyWindow } from "@shared/strategy-stats";
import { readGate, type Result, type Who } from "../services/leads";
import { outreachSafetyReady } from "./message-store";

export async function strategyStats(user: Who, raw: { days?: unknown } = {}, deps: { now: () => Date } = { now: () => new Date() }): Promise<Result<{ days: StrategyWindow; rows: StrategyStatRow[] }>> {
  const gate = readGate(user);
  if (gate) return gate;
  const days = parseStrategyWindow(raw.days);
  const since = new Date(deps.now().getTime() - days * 86_400_000).toISOString();
  let outcomes = false;
  try { outcomes = await outreachSafetyReady(); } catch { outcomes = false; }
  const events = outcomes
    ? sql`LEFT JOIN LATERAL (
        SELECT bool_or(e.kind = 'replied') AS replied, bool_or(e.kind = 'bounced') AS bounced, bool_or(e.kind = 'opted_out') AS opted
          FROM outreach_events e WHERE e.organization_id = m.organization_id AND e.message_id = m.id
      ) o ON true`
    : sql`LEFT JOIN LATERAL (SELECT false AS replied, false AS bounced, false AS opted) o ON true`;
  const r = await db.execute(sql`
    SELECT m.strategy, m.prompt_version AS "promptVersion",
           count(*)::int AS generated,
           count(*) FILTER (WHERE m.variant_group IS NOT NULL)::int AS shown,
           count(*) FILTER (WHERE m.chosen_at IS NOT NULL)::int AS chosen,
           count(*) FILTER (WHERE m.approved_at IS NOT NULL)::int AS approved,
           count(*) FILTER (WHERE m.approved_at IS NOT NULL AND m.edited)::int AS edited,
           count(*) FILTER (WHERE m.sent_at IS NOT NULL)::int AS sent,
           count(*) FILTER (WHERE o.replied)::int AS replied,
           count(*) FILTER (WHERE o.bounced)::int AS bounced,
           count(*) FILTER (WHERE o.opted)::int AS "optedOut"
      FROM lead_messages m
      ${events}
     WHERE m.organization_id = ${user.organizationId!} AND m.direction = 'out' AND m.strategy IS NOT NULL
       AND m.created_at >= ${since}::timestamp
     GROUP BY 1, 2 ORDER BY 1, 2`);
  return { ok: true, days, rows: r.rows as unknown as StrategyStatRow[] };
}
