/**
 * Mika, "campaign drafts" (mika.campaign): get an outreach campaign's drafts written and report what is ready.
 *
 *   start      an existing campaign is checked; otherwise a new one is made from the leads the person named, or from
 *              the newest open leads that can be picked (never one marked do-not-contact or already in a campaign)
 *   prepare    "Prepare drafts" is pressed for the campaign, AS THE PERSON: the campaign's own background job writes
 *              one draft at a time through the ordinary drafting service (verified facts only, the do-not-contact
 *              list, the plan's AI drafts). Mika does not draft here herself — there is one piece of code that does.
 *   following  this run is parked between checks while the drafts are written; it reports progress as it changes
 *   report     what really happened: drafts ready to review, leads skipped (with the reason), and why drafting stopped
 *              if it did. After LEAGUE_LIMITS.campaignFollowMinutes it reports what is done so far; the campaign
 *              carries on by itself.
 *
 * Mika approves nothing and sends nothing. Every draft waits in the campaign for the person to read and approve.
 */
import { LEAGUE_LIMITS, type LeagueReport, type TaskInput } from "@shared/ai-league";
import { failed, type StepOutcome, type TaskCtx, type TaskHandler } from "./types";

type Result<T> = ({ ok: true } & T) | { ok: false; status: number; code: string; message: string };
interface Counts { members: number; queued: number; skipped: number; failed: number; draft: number; approved: number; sending: number; sent: number; discarded: number }
interface CampaignLike { id: number; name: string; status: string; preparing: boolean; prepareStop: string | null; prepareStopLabel: string | null; counts: Counts }
interface MemberLike { leadId: number; companyName: string; stage: string; stageLabel: string; note: string | null }
export interface MikaCampaignDeps {
  audience(user: unknown): Promise<Result<{ leads: { id: number; companyName: string; blocked: string | null }[] }>>;
  createCampaign(user: unknown, raw: { name: string; leadIds: number[] }): Promise<Result<{ campaign: CampaignLike; added: number; left: number }>>;
  getCampaign(user: unknown, id: number): Promise<Result<{ campaign: CampaignLike; members: MemberLike[] }>>;
  startPreparing(user: unknown, id: number): Promise<Result<{ campaign: CampaignLike; waiting: number }>>;
}

const CHECK_EVERY_MS = 20_000;
export const campaignLink = (id: number) => `/outbound?view=campaigns&campaign=${id}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A default name a person can tell apart later: "Mika's campaign, 10 Nov". */
export const defaultName = (now: Date) => `Mika's campaign, ${now.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`;

export function mikaCampaignTask(deps: MikaCampaignDeps): TaskHandler {
  return {
    async step(ctx: TaskCtx, stage: string): Promise<StepOutcome> {
      const input = ctx.run.input as TaskInput<"mika.campaign">;
      const cp = ctx.checkpoint;

      if (stage === "start") {
        if (input.campaignId) {
          const got = await deps.getCampaign(ctx.user, input.campaignId);
          if (!got.ok) return failed(`I couldn't open that campaign: ${got.message}`, got.code.slice(0, 40));
          if (got.campaign.status !== "active") return failed(`"${got.campaign.name}" is archived, so I can't prepare drafts for it.`, "archived");
          await ctx.event("campaign_found", `Working on the campaign "${got.campaign.name}"`.slice(0, 300), { href: campaignLink(got.campaign.id) });
          return { kind: "continue", stage: "prepare", checkpoint: { ...cp, campaignId: got.campaign.id, name: got.campaign.name, created: false } };
        }
        let leadIds = (input.leadIds ?? []).slice(0, LEAGUE_LIMITS.campaignLeads);
        if (!leadIds.length) {
          const a = await deps.audience(ctx.user);
          if (!a.ok) return failed(`I couldn't read your leads: ${a.message}`, a.code.slice(0, 40));
          leadIds = a.leads.filter((l) => !l.blocked).slice(0, Math.min(input.max ?? 10, LEAGUE_LIMITS.campaignLeads)).map((l) => l.id);
          if (!leadIds.length) {
            return { kind: "finish", status: "completed", report: { headline: "No open leads are free for a campaign", counts: [{ label: "Drafts to review", value: 0 }], items: [], next: { label: "Find companies in Client Radar", href: "/outbound" }, notes: ["A campaign groups leads that are new, being researched or qualified, not marked do-not-contact, and not already in another campaign."] } };
          }
        }
        const name = (input.name ?? "").trim() || defaultName(ctx.now());
        const made = await deps.createCampaign(ctx.user, { name, leadIds });
        if (!made.ok) return failed(`I couldn't create the campaign: ${made.message}`, made.code.slice(0, 40));
        await ctx.event("campaign_created", `Created "${made.campaign.name}" with ${plural(made.added, "lead")}`.slice(0, 300), { href: campaignLink(made.campaign.id) });
        // Saved before drafting starts: a retried step finds the campaign it already made instead of making a second one.
        return { kind: "continue", stage: "prepare", checkpoint: { ...cp, campaignId: made.campaign.id, name: made.campaign.name, created: true, leftOut: made.left } };
      }

      const id = Number(cp.campaignId);
      if (!Number.isInteger(id) || id <= 0) return failed("I lost track of the campaign.", "no_campaign");

      if (stage === "prepare") {
        const started = await deps.startPreparing(ctx.user, id);
        // Nothing waiting is not a failure: every lead already has a draft or was skipped. Report what is there.
        if (!started.ok && started.code !== "nothing_to_prepare") return failed(`I couldn't start the drafts: ${started.message}`, started.code.slice(0, 40));
        if (started.ok) await ctx.event("drafting", `Writing drafts for ${plural(started.waiting, "lead")}, one at a time`);
        return started.ok
          ? { kind: "wait", stage: "following", until: new Date(ctx.now().getTime() + CHECK_EVERY_MS), checkpoint: { ...cp, since: ctx.now().toISOString(), last: "" } }
          : { kind: "continue", stage: "report", checkpoint: { ...cp, nothingWaiting: true } };
      }

      if (stage === "following") {
        const got = await deps.getCampaign(ctx.user, id);
        if (!got.ok) return failed(`I lost track of the campaign: ${got.message}`, got.code.slice(0, 40));
        const c = got.campaign.counts;
        const line = `${c.draft + c.approved} ready · ${c.skipped + c.failed} set aside · ${c.queued} waiting`;
        if (line !== cp.last) await ctx.event("progress", `Drafts: ${line}`);
        const since = new Date(String(cp.since ?? ctx.now().toISOString())).getTime();
        const tooLong = ctx.now().getTime() - since > LEAGUE_LIMITS.campaignFollowMinutes * 60_000;
        if (got.campaign.preparing && !tooLong) return { kind: "wait", stage: "following", until: new Date(ctx.now().getTime() + CHECK_EVERY_MS), checkpoint: { ...cp, last: line } };
        return { kind: "continue", stage: "report", checkpoint: { ...cp, last: line, stillGoing: got.campaign.preparing } };
      }

      // report
      const got = await deps.getCampaign(ctx.user, id);
      if (!got.ok) return failed(`I couldn't read the campaign's result: ${got.message}`, got.code.slice(0, 40));
      const { campaign: c, members } = got;
      const n = c.counts, ready = n.draft, aside = n.skipped + n.failed;
      const stopped = !c.preparing && c.prepareStop && c.prepareStop !== "stopped" ? c.prepareStopLabel ?? "Drafting stopped" : null;
      const items: LeagueReport["items"] = members.slice(0, 40).map((m) => ({
        title: m.companyName,
        detail: m.note ? `${m.stageLabel}: ${m.note}` : m.stageLabel,
        href: campaignLink(c.id),
        status: m.stage === "draft" ? "needs_you" as const : m.stage === "skipped" || m.stage === "failed" ? "skipped" as const : m.stage === "queued" ? "info" as const : "done" as const,
      }));
      const report: LeagueReport = {
        headline: ready ? `${plural(ready, "draft")} ready for your approval in "${c.name}"` : cp.nothingWaiting ? `Nothing was waiting for a draft in "${c.name}"` : `No drafts were written for "${c.name}"`,
        counts: [{ label: "Drafts to review", value: ready }, { label: "Already approved", value: n.approved }, { label: "Set aside", value: aside }, { label: "Still waiting", value: n.queued }],
        items,
        next: ready || n.approved ? { label: "Review and approve in Campaigns", href: campaignLink(c.id) } : { label: "Open the campaign", href: campaignLink(c.id) },
        notes: [
          "Nothing was approved or sent. You read each draft, change anything, and approve the exact text yourself.",
          ...(stopped ? [`Drafting stopped early: ${stopped}. Press Prepare drafts in the campaign to carry on when you can.`] : []),
          ...(cp.stillGoing ? [`Drafts are still being written: ${plural(n.queued, "lead")} waiting. The campaign carries on by itself; open it to see progress.`] : []),
          ...(Number(cp.leftOut) > 0 ? [`${plural(Number(cp.leftOut), "lead")} you named ${Number(cp.leftOut) === 1 ? "isn't" : "aren't"} in your workspace and ${Number(cp.leftOut) === 1 ? "was" : "were"} left out.`] : []),
          ...(members.length > 40 ? [`Showing the first 40 of ${members.length} leads. The campaign page has all of them.`] : []),
        ],
      };
      const partial = !!stopped || !!cp.stillGoing;
      return { kind: "finish", status: partial ? (ready + n.approved > 0 || cp.stillGoing ? "partial" : "failed") : "completed", report, errorCode: stopped && ready + n.approved === 0 ? "limit" : null };
    },
  };
}
