/**
 * Where a person's verdict on a prospect is kept (shared/prospect-feedback.ts): its own small table, created by
 * script/migrate-prospect-feedback.ts. Until that runs, feedback is simply unavailable (503) and nothing else changes:
 * no existing query reads this table.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { tablesReadyCheck } from "../leads/ready";
import type { ProspectFeedback } from "@shared/prospect-feedback";

export const prospectFeedbackReady = tablesReadyCheck(["prospect_feedback"]);

export interface FeedbackStore {
  /** Sets (or with null clears) the verdict on a prospect of this workspace. */
  set(o: { orgId: string; prospectId: number; value: ProspectFeedback | null; userId: string; now: Date }): Promise<void>;
  /** The verdicts on these prospects of this workspace. */
  forProspects(orgId: string, prospectIds: number[]): Promise<Map<number, ProspectFeedback>>;
}

export const feedbackStore: FeedbackStore = {
  async set({ orgId, prospectId, value, userId, now }) {
    if (value === null) {
      await db.execute(sql`DELETE FROM prospect_feedback WHERE organization_id = ${orgId} AND prospect_id = ${prospectId}`);
      return;
    }
    await db.execute(sql`INSERT INTO prospect_feedback (organization_id, prospect_id, value, user_id, updated_at)
      VALUES (${orgId}, ${prospectId}, ${value}, ${userId}, ${now.toISOString()}::timestamp)
      ON CONFLICT (organization_id, prospect_id) DO UPDATE SET value = EXCLUDED.value, user_id = EXCLUDED.user_id, updated_at = EXCLUDED.updated_at`);
  },
  async forProspects(orgId, prospectIds) {
    const out = new Map<number, ProspectFeedback>();
    if (!prospectIds.length) return out;
    const r = await db.execute(sql`SELECT prospect_id, value FROM prospect_feedback WHERE organization_id = ${orgId}
      AND prospect_id IN (${sql.join(prospectIds.map((id) => sql`${id}`), sql`, `)})`);
    for (const row of r.rows as { prospect_id: number; value: ProspectFeedback }[]) out.set(Number(row.prospect_id), row.value);
    return out;
  },
};
