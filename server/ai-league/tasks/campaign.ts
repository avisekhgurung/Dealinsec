/**
 * Nibo, "research campaign" (nibo.campaign): many Client Radar searches over hours, toward a target number of qualified
 * companies, reported at a requested time. Each stage is one durable step of the league runtime (checkpointed, retried,
 * resumable after a restart); waiting for the start, for a search, or for the delivery time parks the run.
 *
 *   start        wait until the scheduled start (parked; nothing polls)
 *   plan         read the request into a profile once (parse_icp) and save it: retries re-use it, never re-parse
 *   batch        stop starting searches at the execution deadline, the target, the search cap or the plan's
 *                allowance; otherwise start the next Client Radar search (one city per batch for a country-wide profile)
 *   researching  follow the search (it is its own durable job); at the execution deadline it is cancelled and what
 *                it found is kept
 *   collect      keep only qualified companies (ready, qualified), de-duplicated by domain across batches; save them
 *                to Leads through Client Radar's add-to-Leads (which de-duplicates against Leads too)
 *   report       write the report from what really happened and save it BEFORE delivery (report_ready)
 *   deliver      wait until the delivery time if the report is early, then finish: the runtime notifies once
 *
 * Evidence is Client Radar's own (each company's page, the dated reason, the source URL). A search that fails, a site
 * that can't be read or an allowance that runs out is reported as a limitation, never hidden; a company without
 * enough evidence is never counted as qualified.
 */
import { BOT_IDENTITY, type LeagueReport, type TaskInput } from "@shared/ai-league";
import { batchIcp, campaignTimes, domainKey, showTime } from "@shared/league-campaign";
import type { Icp } from "@shared/icp";
import { qualified, type NiboDeps } from "./nibo";
import type { StepOutcome, TaskCtx, TaskHandler } from "./types";

type Result<T> = ({ ok: true } & T) | { ok: false; status: number; code: string; message: string };
export interface CampaignDeps extends NiboDeps {
  cancelRun(user: unknown, id: string): Promise<Result<unknown>>;
}

/** How often a running search is checked. */
export const CAMPAIGN_CHECK_MS = 30_000;
const LIMIT_CODES = new Set(["NO_CREDITS", "monthly_limit", "daily_limit", "global_limit", "workspace_budget"]);
const runLink = (id: string) => `/outbound?run=${encodeURIComponent(id)}`;

/** One qualified company, kept compactly in the checkpoint (the evidence itself stays on the Client Radar prospect). */
export interface CampaignRow {
  name: string; domain: string; website: string | null; classification: string; score: number | null;
  whyNow: { label: string; value: string; url: string | null } | null; contact: string; leadId: number | null;
  saved: boolean; alreadyLead: boolean; runId: string; batch: number; place: string | null;
}
interface Checkpoint {
  icp?: Icp; searches?: string[]; description?: string;
  batch?: number; outboundRunId?: string | null; place?: string | null;
  seen?: Record<string, true>; rows?: CampaignRow[];
  found?: number; researched?: number; failedBatches?: number; setAside?: number;
  /** Why new research stopped (deadline, search cap, allowance): companies already found are still kept and saved. */
  stoppedBy?: string | null;
  /** Saving to Leads was refused (an allowance ran out): later companies are reported, not saved. */
  saveBlocked?: boolean;
  scheduledNoted?: boolean;
  report?: LeagueReport; reportReadyAt?: string;
}

export function campaignTask(deps: CampaignDeps): TaskHandler {
  return {
    async step(ctx: TaskCtx, stage: string): Promise<StepOutcome> {
      const input = ctx.run.input as TaskInput<"nibo.campaign">;
      const cp = ctx.checkpoint as Checkpoint;
      const now = ctx.now();
      const times = campaignTimes(input, new Date(ctx.run.createdAt));
      const tz = input.timezone;
      const keep = (patch: Partial<Checkpoint>): Record<string, unknown> => ({ ...cp, ...patch });
      const savedCount = () => (cp.rows ?? []).filter((r) => r.saved).length;
      const qualifiedCount = () => (cp.rows ?? []).length;
      const reached = () => (input.saveLeads ? savedCount() : qualifiedCount()) >= input.target;

      // Past the hard stop, whatever the stage: report what there is (the runtime never lets a campaign run on).
      if (now >= times.hardStop && stage !== "report" && stage !== "deliver") {
        return { kind: "continue", stage: "report", checkpoint: keep({ stoppedBy: cp.stoppedBy ?? "it reached the longest a campaign may run" }) };
      }

      if (stage === "start") {
        if (now < times.startAt) {
          if (!cp.scheduledNoted) await ctx.event("scheduled", `Scheduled to start ${showTime(times.startAt, tz)}${times.deliverAt ? `; report due ${showTime(times.deliverAt, tz)}` : ""}`);
          return { kind: "wait", stage: "start", until: times.startAt, checkpoint: keep({ scheduledNoted: true }) };
        }
        return { kind: "continue", stage: "plan" };
      }

      if (stage === "plan") {
        const parsed = await deps.parseIcp(ctx.user, input.request);
        if (!parsed.ok) return finishFailed(`I couldn't plan the research: ${parsed.message}`, LIMIT_CODES.has(parsed.code) ? "limit" : parsed.code);
        await ctx.event("planned", `Looking for ${parsed.description}: ${input.target} qualified ${input.target === 1 ? "company" : "companies"}, at most ${input.maxSearches} ${input.maxSearches === 1 ? "search" : "searches"}, working until ${showTime(times.workUntil, tz)}`.slice(0, 300));
        return { kind: "continue", stage: "batch", checkpoint: keep({ icp: parsed.icp as Icp, searches: parsed.searches, description: parsed.description, batch: 0, seen: {}, rows: [], researched: 0, failedBatches: 0, setAside: 0 }) };
      }

      if (stage === "batch") {
        const batch = cp.batch ?? 0;
        if (reached()) return { kind: "continue", stage: "report" };
        if (cp.stoppedBy) return { kind: "continue", stage: "report" };
        if (now >= times.workUntil) return { kind: "continue", stage: "report", checkpoint: keep({ stoppedBy: `the research time ended at ${showTime(times.workUntil, tz)}` }) };
        if (batch >= input.maxSearches) return { kind: "continue", stage: "report", checkpoint: keep({ stoppedBy: `it used the ${input.maxSearches} searches allowed for this campaign` }) };
        const { icp, place } = batchIcp(cp.icp!, batch);
        let started: Awaited<ReturnType<NiboDeps["startRun"]>>;
        try { started = await deps.startRun(ctx.user, { request: input.request, icp, searches: batch === 0 ? (cp.searches ?? []) : [] }, { by: "agent" }); }
        catch { started = { ok: false, status: 503, code: "search_unavailable", message: "the search couldn't be started" }; }
        if (!started.ok) {
          if (LIMIT_CODES.has(started.code) || batch > 0) return { kind: "continue", stage: "report", checkpoint: keep({ stoppedBy: started.message }) };
          return finishFailed(`I couldn't start the research: ${started.message}`, started.code);
        }
        await ctx.event("batch_started", `Search ${batch + 1} of up to ${input.maxSearches}${place ? `: ${place}` : ""}`, { href: runLink(started.run.id) });
        return { kind: "wait", stage: "researching", until: new Date(now.getTime() + CAMPAIGN_CHECK_MS), checkpoint: keep({ outboundRunId: started.run.id, place }) };
      }

      if (stage === "researching") {
        const id = cp.outboundRunId ?? "";
        let r: Awaited<ReturnType<NiboDeps["getRun"]>>;
        try { r = await deps.getRun(ctx.user, id); } catch { r = { ok: false, status: 503, code: "unavailable", message: "the search couldn't be read" }; }
        if (!r.ok) {
          await ctx.event("batch_failed", `Search ${(cp.batch ?? 0) + 1} couldn't be read: ${r.message}`.slice(0, 300));
          return { kind: "continue", stage: "batch", checkpoint: keep({ batch: (cp.batch ?? 0) + 1, failedBatches: (cp.failedBatches ?? 0) + 1, outboundRunId: null }) };
        }
        if (r.run.status === "running") {
          if (now >= times.workUntil) {
            await deps.cancelRun(ctx.user, id).catch(() => null);
            await ctx.event("deadline", `The research time ended; keeping what search ${(cp.batch ?? 0) + 1} found so far`);
            return { kind: "continue", stage: "collect", checkpoint: keep({ stoppedBy: `the research time ended at ${showTime(times.workUntil, tz)}` }) };
          }
          return { kind: "wait", stage: "researching", until: new Date(now.getTime() + CAMPAIGN_CHECK_MS) };
        }
        return { kind: "continue", stage: "collect" };
      }

      if (stage === "collect") {
        const id = cp.outboundRunId ?? "";
        const batch = cp.batch ?? 0;
        let r: Awaited<ReturnType<NiboDeps["getRun"]>>;
        try { r = await deps.getRun(ctx.user, id); } catch { r = { ok: false, status: 503, code: "unavailable", message: "the search couldn't be read" }; }
        if (!r.ok) return { kind: "continue", stage: "batch", checkpoint: keep({ batch: batch + 1, failedBatches: (cp.failedBatches ?? 0) + 1, outboundRunId: null }) };
        const seen = { ...(cp.seen ?? {}) };
        const rows = [...(cp.rows ?? [])];
        const fresh = r.run.status === "failed" ? [] : r.prospects.filter((p) => { const d = domainKey(p.domain); return d && !seen[d]; });
        const good = qualified(fresh);
        let stoppedBy = cp.stoppedBy ?? null;
        let saveBlocked = !!cp.saveBlocked;
        let added = 0;
        for (const p of good) {
          const d = domainKey(p.domain)!;
          seen[d] = true;
          let leadId = p.leadId ?? null, saved = false;
          const alreadyLead = !!p.leadId;
          const want = input.saveLeads && !alreadyLead && !saveBlocked && rows.filter((x) => x.saved).length < input.target;
          if (want) {
            const add = await deps.addToLeads(ctx.user, p.id).catch(() => ({ ok: false as const, status: 503, code: "unavailable", message: "saving failed" }));
            if (add.ok) { leadId = add.leadId; saved = true; added++; }
            else if (LIMIT_CODES.has(add.code)) { saveBlocked = true; stoppedBy = stoppedBy ?? add.message; }
          }
          rows.push({
            name: p.name, domain: d, website: p.website ?? null, classification: p.classificationLabel ?? p.classification, score: p.score?.total ?? null,
            whyNow: p.whyNow ? { label: p.whyNow.label, value: p.whyNow.value, url: p.whyNow.url ?? null } : null,
            contact: p.contact, leadId, saved, alreadyLead, runId: id, batch, place: cp.place ?? null,
          });
        }
        for (const p of fresh) { const d = domainKey(p.domain); if (d) seen[d] = true; }
        const setAside = (cp.setAside ?? 0) + Math.max(0, fresh.length - good.length);
        // Found = new companies this batch (de-duplicated); researched = what Client Radar itself says it researched.
        const found = (cp.found ?? 0) + fresh.length;
        const runResearched = Number((r.run.counters as { researched?: unknown }).researched);
        const researched = (cp.researched ?? 0) + (Number.isFinite(runResearched) ? Math.min(runResearched, fresh.length) : fresh.length);
        await ctx.event("batch_done", `Search ${batch + 1}: ${fresh.length} new ${fresh.length === 1 ? "company" : "companies"} found, ${good.length} qualified${input.saveLeads ? `, ${added} saved` : ""} (${input.saveLeads ? rows.filter((x) => x.saved).length : rows.length} of ${input.target})`.slice(0, 300), { href: runLink(id) });
        return { kind: "continue", stage: "batch", checkpoint: keep({ seen, rows, found, researched, setAside, stoppedBy, saveBlocked, batch: batch + 1, outboundRunId: null }) };
      }

      if (stage === "report") {
        const report = cp.report ?? campaignReport(input, cp, times.deliverAt, now);
        const readyAt = cp.reportReadyAt ?? now.toISOString();
        if (!cp.report) await ctx.event("report_ready", `Report ready: ${report.headline}`.slice(0, 300));
        if (times.deliverAt && now < times.deliverAt) {
          return { kind: "wait", stage: "deliver", until: times.deliverAt, checkpoint: keep({ report, reportReadyAt: readyAt }) };
        }
        return { kind: "continue", stage: "deliver", checkpoint: keep({ report, reportReadyAt: readyAt }) };
      }

      // deliver
      if (times.deliverAt && now < times.deliverAt) return { kind: "wait", stage: "deliver", until: times.deliverAt };
      const report = cp.report ?? campaignReport(input, cp, times.deliverAt, now);
      const complete = reached() && !cp.stoppedBy;
      const status = complete ? "completed" : qualifiedCount() > 0 ? "partial" : cp.stoppedBy ? "failed" : "completed";
      return { kind: "finish", status, report, errorCode: status === "failed" ? "no_results" : null };
    },
  };
}

const finishFailed = (headline: string, code: string): StepOutcome => ({ kind: "finish", status: "failed", errorCode: code.slice(0, 40), report: { headline, counts: [], items: [], next: null } });

/** The report: only what happened. Coverage and every limitation are stated, so a partial report reads as partial. */
export function campaignReport(input: TaskInput<"nibo.campaign">, cp: Checkpoint, deliverAt: Date | null, now: Date): LeagueReport {
  const rows = cp.rows ?? [];
  const saved = rows.filter((r) => r.saved).length;
  const already = rows.filter((r) => r.alreadyLead).length;
  const searches = cp.batch ?? 0;
  const tz = input.timezone;
  const got = input.saveLeads ? saved : rows.length;
  const headline = got >= input.target
    ? `${input.saveLeads ? "Saved" : "Found"} ${got} qualified ${got === 1 ? "company" : "companies"}, as asked`
    : rows.length
      ? `${input.saveLeads ? "Saved" : "Found"} ${got} of the ${input.target} qualified companies asked for`
      : "No company passed the checks in this campaign";
  const items: LeagueReport["items"] = rows
    .slice()
    .sort((a, b) => Number(b.saved) - Number(a.saved) || (b.score ?? 0) - (a.score ?? 0))
    .map((r) => ({
      title: `${r.name} (${r.domain})`,
      detail: [r.classification, r.whyNow ? `${r.whyNow.label}: ${r.whyNow.value}` : null, r.contact === "none" ? "No contact found yet" : r.contact === "verified" ? "Verified email" : "Public contact found", r.alreadyLead ? "Already in your Leads" : r.saved ? "Saved to Leads" : null, r.place ? `Searched in ${r.place}` : null].filter(Boolean).join(" · "),
      href: r.leadId ? `/leads/${r.leadId}` : runLink(r.runId),
      status: r.saved ? "done" : r.alreadyLead ? "skipped" : "info",
      sources: [r.whyNow?.url, r.website].filter((u): u is string => !!u),
    }));
  const notes = [
    `Found ${cp.found ?? cp.researched ?? 0} new ${(cp.found ?? cp.researched) === 1 ? "company" : "companies"} across ${searches} ${searches === 1 ? "search" : "searches"} (${cp.researched ?? 0} researched in depth by Client Radar); ${cp.setAside ?? 0} didn't qualify or lacked evidence and were set aside.`,
    ...(cp.stoppedBy ? [`Coverage is partial: research stopped because ${cp.stoppedBy}.`] : []),
    ...(cp.failedBatches ? [`${cp.failedBatches} ${cp.failedBatches === 1 ? "search" : "searches"} failed and were skipped; the rest is unaffected.`] : []),
    ...(deliverAt ? [`Delivered ${showTime(now < deliverAt ? deliverAt : now, tz)} (report due ${showTime(deliverAt, tz)}).`] : []),
    "Each company's evidence and source are on its Client Radar prospect. Contact details are only what a company publishes or a provider verifies; none are guessed.",
  ];
  return {
    headline,
    summary: `${got} of ${input.target} ${input.saveLeads ? "saved to Leads" : "qualified"} from ${cp.found ?? cp.researched ?? 0} companies found.${cp.stoppedBy ? " Partial: see the notes." : ""}`,
    counts: [
      { label: "Searches", value: searches }, { label: "Found", value: cp.found ?? cp.researched ?? 0 }, { label: "Researched", value: cp.researched ?? 0 }, { label: "Qualified", value: rows.length },
      { label: "Saved to Leads", value: saved }, { label: "Already in Leads", value: already }, { label: "Set aside", value: cp.setAside ?? 0 },
    ],
    items,
    next: saved ? { label: `Ask ${BOT_IDENTITY.mika.name} to draft first messages`, href: "/ai-league/mika" } : null,
    notes,
  };
}
