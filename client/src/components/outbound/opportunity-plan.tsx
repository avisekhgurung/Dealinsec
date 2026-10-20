/**
 * The opportunity in a prospect's brief: the angle, what the evidence it rests on actually says (with sources and dates),
 * what could be offered (the plan, a hypothesis), a small proof-of-value sample, how to confirm or disprove the idea,
 * and the opportunity score with its reasons (shared/opportunity-score.ts, worked out by fixed rules, not by the model).
 * Confirmed and inferred stay visibly apart; nothing here is presented as a fact about the company unless a page says it.
 */
import { ExternalLink } from "lucide-react";
import type { Brief, Evidence } from "@/lib/outbound";
import { cn } from "@/lib/utils";

const EFFORT: Record<string, string> = { small: "small", medium: "medium", large: "large" };
const DEMO_EFFORT: Record<string, string> = { small: "a few hours", medium: "a day or two" };
const CONF_TONE: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  low: "bg-muted text-muted-foreground",
};

function Cited({ e }: { e: Evidence }) {
  const confirmed = e.status === "confirmed" && !!e.url;
  return (
    <li className="rounded-lg border border-border/60 p-2 text-sm" data-testid="opp-cited">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", confirmed ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" : "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200")}>
          {confirmed ? "On their site" : "Inferred"}
        </span>
        <span className="text-xs font-medium">{e.label}</span>
        {e.date ? <span className="text-[11px] text-muted-foreground">· {e.date}</span> : e.kind === "signal" ? <span className="text-[11px] text-muted-foreground">· no date</span> : null}
      </div>
      <p className="mt-1 break-words">{e.value}</p>
      {e.quote && <p className="mt-1 text-[11px] italic text-muted-foreground">“{e.quote}”</p>}
      {e.url && (
        <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="mt-0.5 inline-flex max-w-full items-center gap-0.5 truncate text-[11px] text-muted-foreground underline-offset-2 hover:underline">
          {e.url.replace(/^https:\/\//, "")}<ExternalLink className="h-2.5 w-2.5 shrink-0" />
        </a>
      )}
    </li>
  );
}

const List = ({ title, items }: { title: string; items: string[] }) => items.length ? (
  <div><p className="text-[11px] font-semibold text-muted-foreground">{title}</p><ul className="ml-4 list-disc text-sm">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
) : null;

export function OpportunityPlan({ b }: { b: Brief }) {
  const a = b.angle;
  if (!a) return null;
  const all = [...b.facts, ...b.signals, ...b.inferences, ...b.opportunities, ...b.people];
  const cited = a.evidenceIds.map((id) => all.find((e) => e.id === id)).filter((e): e is Evidence => !!e);
  const plan = a.plan ?? null;
  const s = b.opportunityScore ?? null;
  return (
    <section className="space-y-3" data-testid="brief-opportunity">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-400">Opportunity</h3>
        {s && (
          <span className="flex items-center gap-1.5 text-[11px]" data-testid="opp-score-head">
            <span className="font-semibold tabular-nums">{s.total} / 100</span>
            <span className={cn("rounded px-1.5 py-0.5 font-medium", CONF_TONE[s.confidence])}>{s.confidence} confidence</span>
          </span>
        )}
      </div>

      <div className="space-y-1.5 rounded-xl border border-violet-200 bg-violet-50/60 p-3 text-sm dark:border-violet-900/60 dark:bg-violet-950/20" data-testid="brief-angle-text">
        <p><span className="font-medium">Possible problem (a hypothesis):</span> {a.problem}</p>
        <p><span className="font-medium">Opportunity:</span> {a.opportunity}</p>
        <p><span className="font-medium">Position it as:</span> {a.positioning}</p>
        {a.targetPerson && <p><span className="font-medium">Write to:</span> {a.targetPerson}</p>}
        <p className="text-xs text-muted-foreground">{a.reason}</p>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-muted-foreground">What the evidence says ({cited.length} finding{cited.length === 1 ? "" : "s"})</p>
        {cited.length ? <ul className="space-y-1.5">{cited.map((e) => <Cited key={e.id} e={e} />)}</ul>
          : <p className="text-sm text-muted-foreground">The findings this angle cited are no longer stored. Research again before relying on it.</p>}
      </div>

      {plan ? (
        <div className="space-y-2.5 rounded-xl border border-border/70 p-3" data-testid="opp-plan">
          <p className="text-[11px] text-muted-foreground">Everything below is a suggestion built on the findings above, not something the company said.</p>
          <p className="text-sm"><span className="font-medium">What you could do:</span> {plan.solution}</p>
          <p className="text-sm"><span className="font-medium">Why it could help:</span> {plan.value}</p>
          <p className="text-xs text-muted-foreground">Impact judged {plan.impact} · effort {EFFORT[plan.effort]} · {plan.serviceMatch === "direct" ? "what you sell" : plan.serviceMatch === "adjacent" ? "close to what you sell" : plan.serviceMatch === "unknown" ? "you haven't said what you sell" : "not what you sell"}</p>
          {plan.demo && (
            <div className="space-y-1.5 rounded-lg bg-muted/50 p-2.5" data-testid="opp-demo">
              <p className="text-sm font-medium">Proof-of-value sample: {plan.demo.title}</p>
              <p className="text-sm">{plan.demo.scope}</p>
              <p className="text-[11px] text-muted-foreground">About {DEMO_EFFORT[plan.demo.effort]} of your time. Made without access to their systems.</p>
              <List title="Assumes" items={plan.demo.assumptions} />
              <List title="Not included" items={plan.demo.exclusions} />
              <List title="They'd need to provide" items={plan.demo.needs} />
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <p className="text-sm"><span className="font-medium">Would confirm it:</span> {plan.confirmIf}</p>
            <p className="text-sm"><span className="font-medium">Would rule it out:</span> {plan.disproveIf}</p>
          </div>
          <p className="text-sm"><span className="font-medium">Next step:</span> {plan.nextAction}</p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground" data-testid="opp-no-plan">No plan with this angle yet (what to offer, a small sample, how to test the idea). Generate a new angle to get one.</p>
      )}

      {s && (
        <div className="space-y-1.5" data-testid="opp-score">
          <ul className="space-y-1.5">
            {s.components.map((c) => (
              <li key={c.key} className="flex items-start gap-3 text-sm">
                <span className="w-14 shrink-0 text-right font-semibold tabular-nums">{c.points}/{c.max}</span>
                <span className="min-w-0"><span className="font-medium">{c.label}</span><span className="block break-words text-xs text-muted-foreground">{c.reasons.join(" · ")}</span></span>
              </li>
            ))}
          </ul>
          {!!s.limits.length && <ul className="ml-4 list-disc text-xs text-muted-foreground" data-testid="opp-limits">{s.limits.map((l, i) => <li key={i}>{l}</li>)}</ul>}
          <p className="text-[11px] text-muted-foreground">Scored by fixed rules from the evidence (not by AI). Confidence is how sure the idea is; value is how much it could matter.</p>
        </div>
      )}
    </section>
  );
}
