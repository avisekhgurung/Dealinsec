/**
 * The sales agent's judgement about a lead: its score and its next best action. Both are pure rules
 * over what is recorded (shared/lead-score.ts, shared/next-action.ts), so nothing here calls a model
 * and nothing is written. The REST routes and the agent's tools both call these functions.
 *
 * Reads follow the lead pipeline (whoever may read deals may read this). A lead in another workspace
 * answers "not found", like one that does not exist.
 */
import { isoDateInZone } from "@shared/invoice-numbering";
import { assessFit, type FitResult } from "@shared/fit";
import { scoreLead, type LeadScore, type ScoreClaim } from "@shared/lead-score";
import { nextAction, type NextAction } from "@shared/next-action";
import { resolveLocaleSettings, type LeadClaim, type LeadEvent } from "@shared/schema";
import { profileTableReady } from "../leads/profile-store";
import { storage } from "../storage";
import { assessLeadFit } from "./ideal-client";
import { getLead } from "./leads";
import type { Result, Who } from "./leads";

const DAY_MS = 86_400_000;

/** A research run has produced findings for this lead (an agent-written claim with its evidence). Increment 3 refines this with the run's own record. */
export const hasResearch = (claims: Pick<LeadClaim, "source" | "evidenceUrl">[]): boolean => claims.some((c) => c.source === "agent" && !!c.evidenceUrl);

/** When the lead was last moved to "contacted", from its timeline; the stage's own timestamp if the timeline has no entry. */
export function lastContactedAt(events: Pick<LeadEvent, "kind" | "data" | "createdAt">[], status: string, statusChangedAt?: Date | string | null): Date | null {
  let best: number | null = null;
  for (const e of events) {
    if (e.kind !== "status_changed" || (e.data as { to?: string } | null)?.to !== "contacted") continue;
    const t = new Date(e.createdAt as any).getTime();
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  if (best === null && status === "contacted" && statusChangedAt) { const t = new Date(statusChangedAt as any).getTime(); if (Number.isFinite(t)) best = t; }
  return best === null ? null : new Date(best);
}

export interface Assessment { score: LeadScore; next: NextAction; fit: FitResult | null; researched: boolean }

export async function assessLead(user: Who, leadId: number, opts: { now?: () => Date; pendingDrafts?: number } = {}): Promise<Result<Assessment>> {
  const got = await getLead(user, leadId);
  if (!got.ok) return got;
  const { lead, events, tickets, claims } = got.detail;
  const now = (opts.now ?? (() => new Date()))();

  // Fit: the rule-based verdict. Where the ideal-client feature is not set up, the score simply has no fit.
  let fit: FitResult | null = null;
  try {
    if (await profileTableReady()) {
      const f = await assessLeadFit(user, leadId);
      fit = f.ok ? f.fit : null;
    }
  } catch { fit = null; }
  if (!fit) fit = assessFit(null, lead as any);

  const scoreClaims: ScoreClaim[] = claims.map((c) => ({ id: c.id, field: c.field, value: c.value, status: c.status, evidenceUrl: c.evidenceUrl, createdAt: c.createdAt }));
  const score = scoreLead(fit, lead, scoreClaims);

  const org = await storage.getOrganization(user.organizationId!);
  const today = isoDateInZone(resolveLocaleSettings(org, user as any).timezone, now);
  const overdueTicket = tickets.some((t) => t.status === "open" && t.dueAt && new Date(t.dueAt).toISOString().slice(0, 10) < today);
  const contacted = lastContactedAt(events, lead.status, lead.statusChangedAt);
  const researched = hasResearch(claims);

  const next = nextAction({
    status: lead.status, archived: !!lead.archivedAt, doNotContact: !!lead.doNotContact, hasContactEmail: !!lead.contactEmail,
    researched, fit: fit?.verdict ?? null, score: { total: score.total, knownMax: score.knownMax, confidence: score.confidence },
    hasPendingDraft: (opts.pendingDrafts ?? 0) > 0,
    daysSinceContact: contacted ? Math.max(0, Math.floor((now.getTime() - contacted.getTime()) / DAY_MS)) : null,
    overdueTicket, canConvert: got.canConvert,
  });
  return { ok: true, score, next, fit, researched };
}
