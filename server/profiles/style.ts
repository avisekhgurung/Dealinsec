/**
 * How a saved client profile wants its messages to sound: the tone and the note the person saved under "How you like
 * to reach out" (shared/acquisition-profile.ts). Read when a first message is drafted (an email, or a short message
 * for WhatsApp, LinkedIn or X), and to tell the person on the lead's page which style its drafts follow.
 *
 * Which profile applies to a lead:
 *   1. the one a campaign was built for, when the draft is written for a campaign that has one;
 *   2. otherwise the one the newest search that found this lead's company was started from.
 * A lead added by hand, or found by a search that started from no profile, has no style, and its draft is written
 * exactly as before. A profile that has since been deleted is the same as none.
 *
 * Reading this never fails a draft: any error here answers "no style".
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { outreachPrefsSchema, type ProfileStyle } from "@shared/acquisition-profile";
import { tablesReadyCheck } from "../leads/ready";
import { acquisitionProfileStore, profilesTableReady } from "./store";

export type DraftStyle = ProfileStyle;

const radarReady = tablesReadyCheck(["prospects", "prospect_run_items", "prospect_runs"]);

/** The style a saved profile carries, or null when the profile isn't in this workspace (or the saved value is unreadable). */
export async function styleFromProfile(orgId: string, profileId: number | null | undefined): Promise<DraftStyle | null> {
  try {
    if (!profileId || !Number.isInteger(profileId) || profileId <= 0 || !(await profilesTableReady())) return null;
    const row = await acquisitionProfileStore.get(orgId, profileId);
    if (!row) return null;
    const prefs = outreachPrefsSchema.safeParse(row.outreach ?? {});
    return prefs.success ? { profileId: row.id, profileName: row.name, tone: prefs.data.tone, note: prefs.data.note, channels: prefs.data.channels } : null;
  } catch { return null; }
}

/** The id of the saved profile the newest search that found this lead's company was started from, or null. */
export async function profileIdForLead(orgId: string, leadId: number): Promise<number | null> {
  try {
    if (!(await radarReady())) return null;
    const r = await db.execute(sql`
      SELECT r.icp->'profile'->>'id' AS id FROM prospects p
      JOIN prospect_run_items i ON i.organization_id = p.organization_id AND i.prospect_id = p.id
      JOIN prospect_runs r ON r.organization_id = p.organization_id AND r.id = i.run_id
      WHERE p.organization_id = ${orgId} AND p.lead_id = ${leadId} AND r.icp->'profile'->>'id' IS NOT NULL
      ORDER BY r.created_at DESC, r.id DESC LIMIT 1`);
    const id = Number(((r.rows ?? [])[0] as { id?: unknown } | undefined)?.id);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch { return null; }
}

/** The style for a draft to this lead: the campaign's profile when one is named and still exists, else the lead's own. */
export async function styleForDraft(orgId: string, leadId: number, campaignProfileId?: number | null): Promise<DraftStyle | null> {
  return (await styleFromProfile(orgId, campaignProfileId)) ?? (await styleFromProfile(orgId, await profileIdForLead(orgId, leadId)));
}
