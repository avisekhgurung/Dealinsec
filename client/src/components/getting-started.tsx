/**
 * Dashboard "Get started" checklist: the few steps from a new account to a first
 * real result, ordered by the goal the person picked in onboarding.
 *
 * Progress is never stored. Each step's done/undone comes from the account's
 * real records (the same queries the dashboard and nav already make), so it
 * resumes by itself on any device. Only the goal and the dismissal live in
 * this browser (lib/first-goal.ts). A count that couldn't be loaded is shown
 * as unknown, never as "not done", and keeps the list from calling itself
 * finished.
 *
 * Hidden once its core steps are all done (the last, "discovery" step is a
 * suggestion and doesn't keep the card up), when dismissed, and while the
 * counts are still loading, so a finished account never sees it flash.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CheckCircle2, ChevronRight, Circle, CircleDashed, ListChecks, X as XIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { trackEvent } from "@/lib/analytics";
import { dismissGettingStarted, getFirstGoal, isGettingStartedDismissed, setFirstGoal } from "@/lib/first-goal";
import { listUrl, type LeadList } from "@/lib/leads";
import { OUTBOUND_RUNS_URL } from "@/lib/outbound";
import { cn } from "@/lib/utils";
import { Mascot } from "@/components/ai-league/mascot";
import { canSeeModule } from "@shared/permissions";
import {
  FIRST_GOALS, FIRST_GOAL_META, checklistFor, checklistState, isFirstGoal,
  type ChecklistStep, type Facts, type FirstGoal,
} from "@shared/getting-started";
import type { BrandInvoice, Contract, Deal, Quote } from "@shared/schema";

/** Lead stages that mean a first message has gone out. */
const CONTACTED_STAGES = ["contacted", "replied", "meeting", "proposal", "won"];
const SIGNED_AGREEMENT = new Set(["Signed", "Active", "Completed"]);

/** "Not set up on this server" or "not for your role": the module isn't there,
 *  so its steps are left out rather than shown as unknown forever. */
const unavailable = (err: unknown) => {
  const m = String((err as Error | null)?.message ?? "");
  return m.startsWith("403:") || m.includes("LEADS_NOT_SETUP") || m.includes("PROSPECTS_NOT_SETUP");
};

const count = <T,>(q: { data?: T[]; isError: boolean }, pick?: (x: T) => boolean): number | null =>
  q.isError || !q.data ? null : pick ? q.data.filter(pick).length : q.data.length;

function StepIcon({ done }: { done: boolean | null }) {
  if (done === true) return <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden />;
  if (done === null) return <CircleDashed className="h-5 w-5 text-muted-foreground/60" aria-hidden />;
  return <Circle className="h-5 w-5 text-muted-foreground/50" aria-hidden />;
}

/** What the coworkers do for each focus: only work they really do (see shared/ai-league.ts). */
const LEAGUE_HINT: Record<FirstGoal, string> = {
  find_clients: "Nibo can run the search and save qualified companies; Mika drafts first messages for you to approve.",
  manage_deals: "Mika drafts first messages for your leads; Zee briefs you on follow-ups and what's due.",
  get_paid: "Zee briefs you on overdue invoices, follow-ups and what's due this week, from your own records.",
};

export function GettingStarted() {
  const { user } = useAuth();
  const userId = user?.id;
  const [goal, setGoal] = useState<FirstGoal | null>(() => getFirstGoal(userId));
  const [dismissed, setDismissed] = useState(() => isGettingStartedDismissed(userId));
  const visible = !!userId && !dismissed;

  const seeDeals = canSeeModule(user as any, "deals");
  const deals = useQuery<Deal[]>({ queryKey: ["/api/deals"] });
  const quotes = useQuery<Quote[]>({ queryKey: ["/api/quotes"] });
  const contracts = useQuery<Contract[]>({ queryKey: ["/api/contracts"] });
  // /api/invoices is the retired invoice table and always empty: invoices live here.
  const invoices = useQuery<BrandInvoice[]>({ queryKey: ["/api/brand-invoices"] });
  // Same keys as the Leads strip and the AI Outbound page, so these share their cache.
  const leads = useQuery<LeadList>({ queryKey: [listUrl({})], enabled: visible && seeDeals });
  const runs = useQuery<{ runs: unknown[] }>({ queryKey: [OUTBOUND_RUNS_URL], enabled: visible && seeDeals, retry: false });

  if (!visible) return null;
  if ([deals, quotes, contracts, invoices, leads, runs].some((q) => q.isLoading)) return null;

  const can = {
    outbound: seeDeals && !unavailable(runs.error),
    leads: seeDeals && !unavailable(leads.error),
    deals: seeDeals,
    quotations: canSeeModule(user as any, "quotations"),
    agreements: canSeeModule(user as any, "agreements"),
    invoices: canSeeModule(user as any, "invoices"),
  };
  const c = leads.data?.counts;
  const facts: Facts = {
    outboundRuns: runs.isError || !runs.data ? null : runs.data.runs.length,
    leads: leads.isError || !leads.data ? null : leads.data.total,
    contactedLeads: leads.isError || !c ? null : CONTACTED_STAGES.reduce((n, s) => n + (c[s] ?? 0), 0),
    deals: count(deals),
    quotations: count(quotes),
    agreements: count(contracts, (x) => SIGNED_AGREEMENT.has(x.status)),
    invoices: count(invoices),
    paidInvoices: count(invoices, (x) => x.status === "Paid"),
  };

  const steps = checklistFor(goal, facts, can);
  const core = steps.filter((s) => !s.discovery);
  const extra = steps.filter((s) => s.discovery);
  const state = checklistState(core);
  if (state.complete) return null;

  const goalParam = goal ?? "none";
  const changeGoal = (v: string) => {
    if (!isFirstGoal(v)) return;
    setGoal(v);
    setFirstGoal(userId, v);
  };
  const dismiss = () => {
    dismissGettingStarted(userId);
    setDismissed(true);
    trackEvent("checklist_dismissed", { goal: goalParam, done: state.done });
  };
  const pct = state.total ? Math.round((state.done / state.total) * 100) : 0;

  const row = (s: ChecklistStep) => {
    const status = s.done === true ? "Done" : s.done === null ? "Status unknown" : "Not done";
    const body = (
      <>
        <span className="mt-0.5 shrink-0"><StepIcon done={s.done} /></span>
        <span className="min-w-0 flex-1">
          <span className={cn("block text-sm font-semibold leading-tight", s.done === true && "text-muted-foreground line-through decoration-muted-foreground/40")}>
            {s.title}
            {s.discovery && <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Optional</span>}
          </span>
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{s.detail}</span>
          <span className="sr-only">{status}</span>
        </span>
      </>
    );
    return (
      <li key={s.id}>
        {s.done === true ? (
          <div className="flex items-start gap-3 rounded-xl px-3 py-2.5" data-testid={`getting-started-step-${s.id}`}>{body}</div>
        ) : (
          <Link
            href={s.href}
            onClick={() => trackEvent("checklist_step_clicked", { step: s.id, goal: goalParam })}
            className="flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            data-testid={`getting-started-step-${s.id}`}
          >
            {body}
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        )}
      </li>
    );
  };

  return (
    <Card className="glass-card" data-testid="getting-started">
      <CardContent className="p-4 lg:p-5">
        <section aria-labelledby="getting-started-title">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 lg:h-10 lg:w-10">
              <ListChecks className="h-4 w-4 text-primary lg:h-5 lg:w-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id="getting-started-title" className="text-sm font-bold lg:text-base">Get started</h2>
              <p className="text-xs text-muted-foreground lg:text-sm">
                <span className="tabular-nums">{state.done} of {state.total}</span> done
              </p>
            </div>
            <button
              type="button"
              onClick={dismiss}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              aria-label="Dismiss the Get started checklist"
              data-testid="dismiss-getting-started"
            >
              <XIcon className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <div
            className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-primary/10"
            role="progressbar"
            aria-label="Get started progress"
            aria-valuemin={0}
            aria-valuemax={state.total}
            aria-valuenow={state.done}
            aria-valuetext={`${state.done} of ${state.total} done`}
          >
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-700" style={{ width: `${pct}%` }} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span id="getting-started-focus" className="text-xs font-medium text-muted-foreground">Your focus:</span>
            <Select value={goal ?? undefined} onValueChange={changeGoal}>
              <SelectTrigger className="h-8 w-auto min-w-[12rem] text-xs" id="getting-started-goal" aria-labelledby="getting-started-focus getting-started-goal" data-testid="getting-started-goal">
                <SelectValue placeholder="Choose a focus" />
              </SelectTrigger>
              <SelectContent>
                {FIRST_GOALS.map((g) => (
                  <SelectItem key={g} value={g} className="text-xs">{FIRST_GOAL_META[g].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ol className="mt-2 -mx-3 space-y-0.5">{core.map(row)}</ol>
          {extra.length > 0 && <ol className="mt-1 -mx-3 border-t border-border/60 pt-1">{extra.map(row)}</ol>}
          {/* The AI coworkers, introduced where they help with the chosen focus. A pointer, not a step: it never counts. */}
          {can.deals && (
            <Link
              href="/ai-league"
              onClick={() => trackEvent("checklist_league_clicked", { goal: goalParam })}
              className="-mx-3 mt-1 flex items-center gap-3 rounded-xl border-t border-border/60 px-3 pb-1 pt-3 transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              data-testid="getting-started-league"
            >
              <span className="flex shrink-0 -space-x-2" aria-hidden>{(["nibo", "mika", "zee"] as const).map((b) => <Mascot key={b} bot={b} size={28} className="ring-2 ring-card" />)}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold leading-tight">Meet your AI team</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{LEAGUE_HINT[goal ?? "get_paid"]}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
