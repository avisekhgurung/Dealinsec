/**
 * Scheduled Social Intent scans: a saved search set to daily or weekly is scanned with nobody watching.
 *
 * OFF unless SOCIAL_SCHEDULE_ENABLED=on. It is opt-in per deployment because it runs unattended: an operator should
 * decide to have it, not discover it. With it off, nothing here claims anything and a saved search's schedule is
 * stored as "off" (service.createProfile), so the page never promises a scan that won't happen.
 *
 * Two rules keep an unattended scan safe:
 *   - FREE SOURCES ONLY. A scheduled scan never uses the web-discussion source, which spends web-search credits from
 *     a daily cap every workspace shares. A handful of scheduled searches would otherwise spend other people's
 *     searches overnight. Paid sources are for a scan a person starts.
 *   - AT MOST ONCE PER PERIOD. The claim moves the search's next run forward in the same statement that picks it
 *     (store.claimDueProfile), so a crash mid-scan, or two workers, can't run one search twice.
 *
 * A scheduled scan uses the plan's scan allowance like any other; out of allowance, it is simply skipped.
 */
import { createRunner, type Workflow } from "../workflow/runner";
import type { SocialProfileRow } from "@shared/schema";
import { agentLog } from "../agent/log";
import { scan, socialScheduleEnabled } from "./service";
import { socialStore, socialTablesReady } from "./store";

export interface ScheduleDeps {
  enabled: () => boolean;
  ready: () => Promise<boolean>;
  claim: (now: Date) => Promise<SocialProfileRow | null>;
  nextDue: (now: Date) => Promise<Date | null>;
  loadUser: (id: string) => Promise<any | undefined>;
  scan: typeof scan;
  notify: (profile: SocialProfileRow, fresh: number) => Promise<void>;
}

const defaults = (): ScheduleDeps => ({
  enabled: socialScheduleEnabled,
  ready: socialTablesReady,
  claim: (now) => socialStore.claimDueProfile(now),
  nextDue: (now) => socialStore.nextDue(now),
  loadUser: async (id) => (await import("../storage")).storage.getUser(id),
  scan,
  notify: async (profile, fresh) => {
    const { storage } = await import("../storage");
    await storage.logActivity({
      organizationId: profile.organizationId, userId: profile.createdByUser, userName: "Client Radar",
      action: "found new opportunities", entityType: "social_profile", entityId: String(profile.id),
      detail: `${profile.name}: ${fresh} new ${fresh === 1 ? "ask" : "asks"} for your services`.slice(0, 250),
    });
  },
});

export function socialScheduleWorkflow(d: Partial<ScheduleDeps> = {}): Workflow<SocialProfileRow> {
  const deps = { ...defaults(), ...d };
  const on = async () => { try { return deps.enabled() && (await deps.ready()); } catch { return false; } };
  return {
    name: "social_schedule",
    async claim(now) { return (await on()) ? deps.claim(now) : null; },
    async step(profile) {
      const user = await deps.loadUser(profile.createdByUser).catch(() => undefined);
      // The person who saved it has left the workspace: nothing runs in their name. The search stays, for someone else to take over.
      if (!user || user.organizationId !== profile.organizationId) return "done";
      const r = await deps.scan(user, { profileId: profile.id }, { trigger: "scheduled", freeOnly: true });
      if (r.ok && r.scan.fresh > 0) await deps.notify(profile, r.scan.fresh).catch(() => {});
      if (!r.ok) console.log(JSON.stringify({ kind: "social_schedule_skipped", profileId: profile.id, code: r.code }));
      return "done";
    },
    async release() { /* the claim already moved the next run on; there is no lease to drop */ },
    async failed(profile, err) { agentLog("error", { where: "social_schedule", profileId: profile.id, errorType: (err as Error)?.name ?? "Error" }); },
    async nextWake(now) { return (await on()) ? deps.nextDue(now) : null; },
  };
}

export const socialScheduleRunner = createRunner(socialScheduleWorkflow());
