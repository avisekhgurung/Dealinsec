/**
 * Nibo, "find potential clients": the same AI Outbound search the /outbound page runs (by "agent"), then the qualified
 * companies saved to Leads, at most LEAGUE_LIMITS.leadsPerRun.
 *
 *   start       read the request into a profile (parse_icp); the profile is checkpointed
 *   launch      start the search from the saved profile (AI Outbound's own allowances apply; a retry finds the same search)
 *   researching wait for the search: it is its own durable job; this run is parked between checks, not polling a worker
 *   saving      pick the qualified ones (ready, then qualified; never "not a fit" or "insufficient evidence"), skip those
 *               already in Leads, add the rest through AI Outbound's add-to-Leads (which de-duplicates on the domain)
 *
 * Evidence is AI Outbound's: every saved lead links to its company and its why-now source. Nothing is invented: a
 * company without a verified email stays without one.
 */
import { BOT_IDENTITY, LEAGUE_LIMITS, type LeagueReport, type TaskInput } from "@shared/ai-league";
import { failed, type StepOutcome, type TaskCtx, type TaskHandler } from "./types";
import type { ProspectCard, RunView } from "../../outbound/service";

type Result<T> = ({ ok: true } & T) | { ok: false; status: number; code: string; message: string };
export interface NiboDeps {
  parseIcp(user: unknown, request: string): Promise<Result<{ icp: unknown; searches: string[]; description: string }>>;
  startRun(user: unknown, raw: { request: string; icp: unknown; searches: string[] }, opts: { by: "agent" }): Promise<Result<{ run: RunView; existing: boolean }>>;
  getRun(user: unknown, id: string): Promise<Result<{ run: RunView; prospects: ProspectCard[] }>>;
  addToLeads(user: unknown, prospectId: number): Promise<Result<{ leadId: number; existing: boolean }>>;
}

const CHECK_EVERY_MS = 20_000;
const runLink = (id: string) => `/outbound?run=${encodeURIComponent(id)}`;
const LIMIT_CODES = new Set(["NO_CREDITS", "monthly_limit", "daily_limit", "global_limit", "workspace_budget"]);

/** Ready first, then qualified; by score. Not a fit and insufficient evidence are never saved. */
export function qualified(ps: ProspectCard[]): ProspectCard[] {
  return ps.filter((p) => !p.rejectReason && (p.classification === "ready" || p.classification === "qualified"))
    .sort((a, b) => Number(b.ready) - Number(a.ready) || (b.score?.total ?? 0) - (a.score?.total ?? 0));
}

export function niboTask(deps: NiboDeps): TaskHandler {
  return {
    async step(ctx: TaskCtx, stage: string): Promise<StepOutcome> {
      const input = ctx.run.input as TaskInput<"nibo.find_clients">;
      const cp = ctx.checkpoint;

      if (stage === "start") {
        const parsed = await deps.parseIcp(ctx.user, input.request);
        if (!parsed.ok) return failed(`I couldn't start the research: ${parsed.message}`, LIMIT_CODES.has(parsed.code) ? "limit" : parsed.code.slice(0, 40));
        await ctx.event("understood", `Looking for: ${parsed.description}`.slice(0, 300));
        // The profile is saved before the search starts: a retried launch sends the SAME profile, which AI Outbound
        // recognizes as the search already running (its idempotency key), instead of a re-parse starting a second search.
        return { kind: "continue", stage: "launch", checkpoint: { ...cp, icp: parsed.icp, searches: parsed.searches } };
      }

      if (stage === "launch") {
        const searches = Array.isArray(cp.searches) ? (cp.searches as string[]) : [];
        const started = await deps.startRun(ctx.user, { request: input.request, icp: cp.icp, searches }, { by: "agent" });
        if (!started.ok) return failed(`I couldn't start the research: ${started.message}`, LIMIT_CODES.has(started.code) ? "limit" : started.code.slice(0, 40));
        await ctx.event("research_started", started.existing ? "That search was already running; following it" : "Research started in AI Outbound", { href: runLink(started.run.id) });
        return { kind: "wait", stage: "researching", until: new Date(ctx.now().getTime() + CHECK_EVERY_MS), checkpoint: { ...cp, outboundRunId: started.run.id, lastCounters: "" } };
      }

      if (stage === "researching") {
        const id = String(cp.outboundRunId ?? "");
        const r = await deps.getRun(ctx.user, id);
        if (!r.ok) return failed(`I lost track of the search: ${r.message}`, r.code.slice(0, 40));
        const c = r.run.counters;
        const summary = `${c.discovered ?? 0} found · ${c.verified ?? 0} checked · ${c.icpMatch ?? 0} match`;
        if (summary !== cp.lastCounters && (c.discovered ?? 0) > 0) await ctx.event("progress", `Sources reviewed: ${summary}`);
        if (r.run.status === "running") return { kind: "wait", stage: "researching", until: new Date(ctx.now().getTime() + CHECK_EVERY_MS), checkpoint: { ...cp, lastCounters: summary } };
        await ctx.event("research_done", r.run.status === "done" ? "Research finished; evaluating the companies" : `The search ended (${r.run.status}); evaluating what it found`);
        return { kind: "continue", stage: "saving", checkpoint: { ...cp, lastCounters: summary } };
      }

      // saving
      const id = String(cp.outboundRunId ?? "");
      const r = await deps.getRun(ctx.user, id);
      if (!r.ok) return failed(`I lost track of the search: ${r.message}`, r.code.slice(0, 40));
      const good = qualified(r.prospects);
      const already = good.filter((p) => p.leadId);
      const fresh = good.filter((p) => !p.leadId);
      const max = Math.min(input.maxLeads ?? 3, LEAGUE_LIMITS.leadsPerRun);
      const saved = new Map<number, number>(Object.entries((cp.saved as Record<string, number>) ?? {}).map(([k, v]) => [Number(k), v]));
      const items: LeagueReport["items"] = [];
      let stoppedBy: string | null = null;
      if (input.saveLeads !== false) {
        for (const p of fresh) {
          if (saved.size >= max) break;
          if (saved.has(p.id)) continue;
          const add = await deps.addToLeads(ctx.user, p.id);
          if (add.ok) {
            saved.set(p.id, add.leadId);
            await ctx.event("lead_saved", `Saved to Leads: ${p.name}`.slice(0, 300), { href: `/leads/${add.leadId}` });
          } else {
            items.push({ title: p.name, detail: `Not saved: ${add.message}`, status: "failed", href: runLink(id) });
            if (LIMIT_CODES.has(add.code)) { stoppedBy = add.message; break; }
          }
        }
      }
      for (const p of good) {
        const leadId = saved.get(p.id) ?? p.leadId;
        const sources = [p.whyNow?.url, p.website].filter((u): u is string => !!u);
        if (saved.has(p.id)) items.unshift({ title: `${p.name} (${p.domain})`, detail: [p.classificationLabel, p.whyNow ? `${p.whyNow.label}: ${p.whyNow.value}` : null, p.contact === "none" ? "No contact found yet" : p.contact === "verified" ? "Verified email" : "Public contact found"].filter(Boolean).join(" · "), href: `/leads/${leadId}`, status: "done", sources });
        else if (p.leadId) items.push({ title: `${p.name} (${p.domain})`, detail: "Already in your Leads", href: `/leads/${p.leadId}`, status: "skipped", sources });
        else items.push({ title: `${p.name} (${p.domain})`, detail: input.saveLeads === false ? `${p.classificationLabel}: left in AI Outbound for you to pick` : `${p.classificationLabel}: not saved (this task saves up to ${max})`, href: runLink(id), status: "info", sources });
      }
      const c = r.run.counters;
      const rejected = Object.values(c.rejectedBy ?? {}).reduce((a: number, b) => a + Number(b || 0), 0);
      const report: LeagueReport = {
        headline: saved.size ? `Saved ${saved.size} qualified ${saved.size === 1 ? "company" : "companies"} to Leads` : good.length ? (input.saveLeads === false ? `Found ${good.length} qualified ${good.length === 1 ? "company" : "companies"}` : already.length === good.length ? "Every qualified company is already in your Leads" : "No new companies were saved") : "No company passed the checks this time",
        counts: [
          { label: "Found", value: c.discovered ?? 0 }, { label: "Checked", value: c.verified ?? 0 }, { label: "Qualified", value: good.length },
          { label: "Saved to Leads", value: saved.size }, { label: "Already in Leads", value: already.length }, { label: "Set aside", value: rejected },
        ],
        items,
        next: saved.size ? { label: `Ask ${BOT_IDENTITY.mika.name} to draft first messages`, href: "/ai-league/mika" } : { label: "Open the search in AI Outbound", href: runLink(id) },
        notes: [
          ...(stoppedBy ? [`Stopped saving: ${stoppedBy}`] : []),
          ...(r.run.status !== "done" ? [`The search ended as "${r.run.status}"${r.run.errorCode ? ` (${r.run.errorCode})` : ""}, so this covers what it found before then.`] : []),
          "Contact details are only what a company publishes or a provider verifies; none are guessed.",
        ],
      };
      const status = r.run.status !== "done" || stoppedBy ? (good.length || saved.size ? "partial" : "failed") : "completed";
      return { kind: "finish", status, report, errorCode: status === "failed" ? (r.run.errorCode ?? "search_failed").slice(0, 40) : null };
    },
  };
}
