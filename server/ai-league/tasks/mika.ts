/**
 * Mika, "draft first messages": for the leads the person picked (or the newest researched leads with nothing sent),
 * a first email drafted by the existing outreach service (server/sales/outreach.ts draftOutreach, by "agent"). That
 * service is the gate: verified facts only, the do-not-contact list and the lead's own flag, one unsent message per
 * lead, an email address on record, the plan's AI-draft allowance. Mika SENDS NOTHING: every draft waits in the
 * outreach queue for the person to read, edit, approve and send (approval of the exact text, as always).
 */
import { BOT_IDENTITY, LEAGUE_LIMITS, type LeagueReport, type TaskInput } from "@shared/ai-league";
import type { StepOutcome, TaskCtx, TaskHandler } from "./types";

type Result<T> = ({ ok: true } & T) | { ok: false; status: number; code: string; message: string };
export interface MikaDeps {
  /** Candidate leads, newest first: id, company, stage, do-not-contact. */
  listLeads(user: unknown, limit: number): Promise<Result<{ rows: { id: number; companyName: string; status: string; doNotContact: boolean; archivedAt: Date | string | null }[] }>>;
  draftOutreach(user: unknown, leadId: number): Promise<Result<{ message: { id: number; to: string | null } }>>;
}

/** Stages where a first message makes sense (the outreach service checks again). */
const FIRST_CONTACT = new Set(["new", "researching", "qualified"]);
/** Stop drafting the moment an allowance says no: the rest would all fail the same way. */
const STOP = new Set(["NO_CREDITS", "draft_allowance", "workspace_budget", "global_limit", "daily_limit", "SALES_NOT_SETUP", "MESSAGES_NOT_SETUP", "model_unavailable"]);
const QUEUE = "/outbound?view=outreach";

export function mikaTask(deps: MikaDeps): TaskHandler {
  return {
    async step(ctx: TaskCtx): Promise<StepOutcome> {
      const input = ctx.run.input as TaskInput<"mika.first_messages">;
      const max = Math.min(input.max ?? 3, LEAGUE_LIMITS.draftsPerRun);
      const done = new Map<number, { ok: boolean; detail: string; company: string }>(Object.entries((ctx.checkpoint.done as Record<string, { ok: boolean; detail: string; company: string }>) ?? {}).map(([k, v]) => [Number(k), v]));

      let candidates: { id: number; companyName: string }[];
      const list = await deps.listLeads(ctx.user, 100);
      if (!list.ok) return { kind: "finish", status: "failed", errorCode: list.code.slice(0, 40), report: { headline: `I couldn't read your leads: ${list.message}`, counts: [], items: [], next: null } };
      if (input.leadIds?.length) {
        const byId = new Map(list.rows.map((l) => [l.id, l]));
        candidates = input.leadIds.map((id) => byId.get(id) ?? { id, companyName: `Lead ${id}` }).slice(0, max);
      } else {
        candidates = list.rows.filter((l) => FIRST_CONTACT.has(l.status) && !l.doNotContact && !l.archivedAt).slice(0, max * 3);
      }
      if (!candidates.length) {
        return { kind: "finish", status: "completed", report: { headline: "No leads are waiting for a first message", counts: [{ label: "Drafted", value: 0 }], items: [], next: { label: `Ask ${BOT_IDENTITY.nibo.name} to find new clients`, href: "/ai-league/nibo" }, notes: ["A first message needs a lead in New, Researching or Qualified that isn't marked do-not-contact."] } };
      }
      await ctx.event("drafting", `Drafting first messages for up to ${max} lead${max === 1 ? "" : "s"}`);

      let drafted = Array.from(done.values()).filter((d) => d.ok).length, stoppedBy: string | null = null;
      for (const l of candidates) {
        if (drafted >= max) break;
        if (done.has(l.id)) continue;
        const r = await deps.draftOutreach(ctx.user, l.id);
        if (r.ok) {
          drafted++;
          done.set(l.id, { ok: true, detail: `Draft to ${r.message.to ?? "their address"}, waiting for your approval`, company: l.companyName });
          await ctx.event("draft_ready", `Draft ready for ${l.companyName}`.slice(0, 300), { href: `/leads/${l.id}` });
        } else {
          done.set(l.id, { ok: false, detail: r.message, company: l.companyName });
          if (STOP.has(r.code)) { stoppedBy = r.message; break; }
        }
      }
      const items: LeagueReport["items"] = Array.from(done.entries()).map(([id, d]) => ({ title: d.company, detail: d.detail, href: `/leads/${id}`, status: d.ok ? "needs_you" as const : "skipped" as const }));
      const skipped = items.filter((i) => i.status === "skipped").length;
      const report: LeagueReport = {
        headline: drafted ? `${drafted} first message${drafted === 1 ? "" : "s"} ready for your approval` : "No drafts were written",
        counts: [{ label: "Drafted", value: drafted }, { label: "Skipped", value: skipped }],
        items,
        next: drafted ? { label: "Review and approve in Outreach", href: QUEUE } : null,
        notes: [
          "Nothing was sent. You read each draft, change anything, approve the exact text and send it yourself (or from your connected Gmail).",
          ...(stoppedBy ? [`Stopped early: ${stoppedBy}`] : []),
        ],
      };
      return { kind: "finish", status: stoppedBy ? (drafted ? "partial" : "failed") : "completed", report, errorCode: stoppedBy && !drafted ? "limit" : null };
    },
  };
}
