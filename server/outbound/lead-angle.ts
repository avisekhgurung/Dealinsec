/**
 * The outreach angle stored for the prospect a lead came from, for the first-message draft. Imported lazily by
 * server/sales/outreach.ts so that drafting never depends on AI Outbound being set up: null whenever there is none.
 */
import { REJECT_LABEL, domainOf, type RejectReason } from "@shared/prospect";
import { outboundStore, prospectsTablesReady } from "./store";

export interface LeadAngle { problem: string; opportunity: string; positioning: string; targetPerson: string | null }

export async function angleForLead(orgId: string, leadId: number): Promise<LeadAngle | null> {
  try {
    if (!(await prospectsTablesReady())) return null;
    const a = (await outboundStore.prospectByLead(orgId, leadId))?.angle as Partial<LeadAngle> | null | undefined;
    return a && typeof a.problem === "string" && typeof a.opportunity === "string" && typeof a.positioning === "string"
      ? { problem: a.problem, opportunity: a.opportunity, positioning: a.positioning, targetPerson: typeof a.targetPerson === "string" ? a.targetPerson : null }
      : null;
  } catch { return null; }
}

export interface ProspectMatch { id: number; name: string; leadId: number | null; rejectLabel: string | null }

/**
 * Is this company already one of the prospects AI Outbound found? Used by the older create_lead tool, so a company that
 * has a prospect (with its evidence, or the reason it was set aside) is never created again from just its name.
 * null whenever AI Outbound isn't set up.
 */
export async function prospectMatch(orgId: string, c: { companyName: string; website?: string | null }): Promise<ProspectMatch | null> {
  try {
    if (!(await prospectsTablesReady())) return null;
    const domain = c.website ? domainOf(String(c.website).includes("://") ? String(c.website) : `https://${c.website}`) : null;
    const p = await outboundStore.prospectMatching(orgId, { domain, name: c.companyName.trim() });
    if (!p) return null;
    const reason = p.status === "rejected" ? ((p.rejectReason ?? "failed") as RejectReason) : null;
    return { id: p.id, name: p.name, leadId: p.leadId, rejectLabel: reason ? REJECT_LABEL[reason] ?? reason : null };
  } catch { return null; }
}

/** Prospects whose name or domain contains what the user typed, for pointing from a failed lead search to them. [] when AI Outbound isn't set up. */
export async function prospectsNamed(orgId: string, text: string): Promise<{ id: number; name: string; domain: string; leadId: number | null; aside: string | null }[]> {
  try {
    const t = text.trim();
    if (t.length < 2 || !(await prospectsTablesReady())) return [];
    return (await outboundStore.prospectsLike(orgId, t, 5)).map((p) => ({ id: p.id, name: p.name, domain: p.domain, leadId: p.leadId, aside: p.status === "rejected" ? REJECT_LABEL[(p.rejectReason ?? "failed") as RejectReason] ?? "set aside" : null }));
  } catch { return []; }
}
