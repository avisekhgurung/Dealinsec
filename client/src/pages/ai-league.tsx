/**
 * AI League: Nibo, Mika and Zee, three AI coworkers inside DealInSec.
 *
 *   /ai-league           the team: each coworker's real state, what's waiting for you, recent activity; and the
 *                        Activity, Waiting, Schedules and Memory views
 *   /ai-league/:bot      a coworker's chat (the agent's own chat, narrowed to that coworker) with its tasks beside it
 *   ?run=<id>            opens one task's report (from a notification or a link)
 *
 * Everything on screen is read from the server: statuses from runs and approvals, progress from stored milestones,
 * reports from stored results. Nothing is sample data.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useRoute, useSearch } from "wouter";
import { ArrowLeft, ChevronRight, ListChecks, MessagesSquare, Play, Sparkles } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import { NotificationBell } from "@/components/notification-bell";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SegmentedTabs } from "@/components/outbound/segmented-tabs";
import { Thread } from "@/components/agent/thread";
import { Composer } from "@/components/agent/composer";
import { useAgent } from "@/hooks/use-agent";
import { cn } from "@/lib/utils";
import { BOTS, BOT_IDENTITY, BOT_STATUS_LABEL, isBot, isTerminal, type Bot } from "@shared/ai-league";
import { leagueCall, leagueEndpoints, refreshLeague, runUrl, useApprovals, useLeagueStatus, useRoster, useRuns, when, type BotCard, type RunView } from "@/lib/ai-league";
import { Mascot, MascotEmpty, mascotState } from "@/components/ai-league/mascot";
import { RunDetail, StatusPill } from "@/components/ai-league/run-report";
import { TaskDialog } from "@/components/ai-league/task-dialog";
import { ApprovalsPanel, MemoryPanel, SchedulesPanel } from "@/components/ai-league/panels";

type View = "team" | "activity" | "waiting" | "schedules" | "memory";
const VIEWS: View[] = ["team", "activity", "waiting", "schedules", "memory"];

export default function AiLeaguePage() {
  const [match, params] = useRoute("/ai-league/:bot");
  const bot = match && isBot(params?.bot) ? params!.bot : null;
  return bot ? <CoworkerChat key={bot} bot={bot} /> : <LeagueHome />;
}

/* ── the run sheet, shared ───────────────────────────────────────────────── */

function useRunParam(): [string | null, (id: string | null) => void] {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const id = new URLSearchParams(search).get("run");
  const set = (next: string | null) => {
    const q = new URLSearchParams(search);
    if (next) q.set("run", next); else q.delete("run");
    navigate(`${location}${q.toString() ? `?${q}` : ""}`, { replace: true });
  };
  return [id && /^lr_[a-f0-9]{8,32}$/.test(id) ? id : null, set];
}

function RunSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  useEffect(() => { if (id) void leagueCall("POST", `${runUrl(id)}/read`).then(() => refreshLeague()).catch(() => {}); }, [id]);
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="sr-only"><SheetTitle>Task report</SheetTitle></SheetHeader>
        {id && <div className="pt-6"><RunDetail id={id} /></div>}
      </SheetContent>
    </Sheet>
  );
}

/* ── the team ────────────────────────────────────────────────────────────── */

function LeagueHome() {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const viewParam = new URLSearchParams(search).get("view") as View | null;
  const view: View = viewParam && VIEWS.includes(viewParam) ? viewParam : "team";
  const setView = (v: View) => navigate(v === "team" ? "/ai-league" : `/ai-league?view=${v}`, { replace: true });
  const [runId, setRunId] = useRunParam();
  const status = useLeagueStatus();
  const roster = useRoster();
  const approvals = useApprovals();
  const [dialog, setDialog] = useState<Bot | null>(null);
  const [huddle, setHuddle] = useState(false);
  const waiting = approvals.data?.items.length ?? 0;

  return (
    <div className="min-h-screen bg-background pb-24 lg:pb-12">
      <header className="glass-header sticky top-0 z-40 lg:border-b lg:border-neutral-200/60 dark:lg:border-neutral-800/60">
        <div className="flex items-center justify-between gap-4 px-4 py-4 lg:mx-auto lg:max-w-[1400px] lg:px-8">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight lg:text-2xl">AI League</h1>
            <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">Three AI coworkers who find clients, prepare first messages and keep you on top of your business. They work in the background and ask before anything that matters. Need a quick answer instead? <Link href="/agent" className="font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400" data-testid="league-ask-agent">Ask DealInSec</Link>.</p>
          </div>
          <NotificationBell className="lg:hidden" />
        </div>
      </header>

      <main className="space-y-5 px-4 py-5 lg:mx-auto lg:max-w-[1400px] lg:px-8 lg:py-6">
        {status.data && !status.data.ready ? (
          <div className="rounded-2xl border px-6 py-12 text-center" data-testid="league-not-setup"><p className="font-semibold">AI League isn't switched on yet</p><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">This workspace's server hasn't been set up for it. Everything else in DealInSec works as usual.</p></div>
        ) : (
          <>
            <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            <SegmentedTabs label="AI League views" value={view} onChange={setView} className="w-max min-w-full max-w-none sm:min-w-0 [&>button]:flex-auto [&>button]:shrink-0"
              tabs={[
                { value: "team", label: <span className="whitespace-nowrap">Team</span>, testId: "league-view-team" },
                { value: "activity", label: <span className="whitespace-nowrap">Activity</span>, testId: "league-view-activity" },
                { value: "waiting", label: <span className="inline-flex items-center gap-1.5 whitespace-nowrap">Waiting{waiting > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold text-white tabular-nums">{waiting}</span>}</span>, testId: "league-view-waiting" },
                { value: "schedules", label: <span className="whitespace-nowrap">Schedules</span>, testId: "league-view-schedules" },
                { value: "memory", label: <span className="whitespace-nowrap"><span className="sm:hidden">Memory</span><span className="hidden sm:inline">Memory &amp; usage</span></span>, testId: "league-view-memory" },
              ]} />
            </div>

            {view === "team" && (
              <>
                <section className="grid gap-4 md:grid-cols-3" aria-label="Your coworkers" data-testid="league-roster">
                  {roster.isLoading
                    ? BOTS.map((b) => <div key={b} className="h-56 animate-pulse rounded-2xl border bg-muted/40" />)
                    : (roster.data?.bots ?? BOTS.map((b) => ({ bot: b, status: "available", activeRun: null, lastRun: null, unread: 0, nextSchedule: null, waiting: 0 }) as BotCard)).map((c) => (
                      <CoworkerCard key={c.bot} card={c} onTask={() => setDialog(c.bot)} onOpenRun={setRunId} />
                    ))}
                </section>
                <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center" aria-labelledby="huddle-h" data-testid="league-huddle">
                  <span className="flex shrink-0 items-center -space-x-2" aria-hidden>{BOTS.map((b) => <Mascot key={b} bot={b} size={40} className="ring-2 ring-card" />)}</span>
                  <div className="min-w-0 flex-1">
                    <h2 id="huddle-h" className="text-sm font-semibold">Team huddle</h2>
                    <p className="text-sm text-muted-foreground">Give the team a question. Nibo, Mika and Zee talk it over from their own records and come back with next steps. They also ask each other for help in their chats.</p>
                  </div>
                  <Button variant="outline" className="h-10 shrink-0" onClick={() => setHuddle(true)} data-testid="start-huddle"><MessagesSquare className="mr-1.5 h-4 w-4" />Start a huddle</Button>
                </section>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                  <section className="rounded-2xl border bg-card p-4" aria-labelledby="recent-h">
                    <div className="mb-2 flex items-center justify-between"><h2 id="recent-h" className="text-sm font-semibold">Recent activity</h2><Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setView("activity")}>See all<ChevronRight className="ml-0.5 h-3.5 w-3.5" /></Button></div>
                    <RunList limit={6} onOpen={setRunId} empty="Nothing yet. Start a task with any coworker above, or open a chat and ask in your own words." />
                  </section>
                  <section className="rounded-2xl border bg-card p-4" aria-labelledby="waiting-h">
                    <div className="mb-2 flex items-center justify-between"><h2 id="waiting-h" className="text-sm font-semibold">Waiting for you</h2>{waiting > 0 && <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setView("waiting")}>Review<ChevronRight className="ml-0.5 h-3.5 w-3.5" /></Button>}</div>
                    {approvals.isLoading ? <div className="h-14 animate-pulse rounded bg-muted" /> : waiting === 0
                      ? <p className="text-sm text-muted-foreground">Nothing needs your go-ahead right now.</p>
                      : <ul className="space-y-2">{approvals.data!.items.slice(0, 4).map((a) => <li key={`${a.kind}${a.id}`} className="flex items-center gap-2.5 text-sm"><Mascot bot={a.bot} size={24} /><span className="min-w-0 flex-1 truncate">{a.title}</span></li>)}</ul>}
                  </section>
                </div>
              </>
            )}
            {view === "activity" && <ActivityView onOpen={setRunId} />}
            {view === "waiting" && <ApprovalsPanel />}
            {view === "schedules" && <SchedulesPanel />}
            {view === "memory" && <MemoryPanel />}
          </>
        )}
      </main>
      {dialog && <TaskDialog bot={dialog} open={!!dialog} onOpenChange={(o) => !o && setDialog(null)} onStarted={(r) => setRunId(r.id)} />}
      {huddle && <TaskDialog bot="zee" huddle open={huddle} onOpenChange={setHuddle} onStarted={(r) => setRunId(r.id)} />}
      <RunSheet id={runId} onClose={() => setRunId(null)} />
      <BottomNav />
    </div>
  );
}

function CoworkerCard({ card, onTask, onOpenRun }: { card: BotCard; onTask: () => void; onOpenRun: (id: string) => void }) {
  const id = BOT_IDENTITY[card.bot];
  const state = card.lastRun && !card.activeRun && card.status === "available" && card.unread > 0 && card.lastRun.status === "completed" ? "done" : mascotState(card.status);
  return (
    <article className={cn("group relative flex flex-col gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-foreground/20 focus-within:ring-2", id.accent.ring)} data-testid={`coworker-${card.bot}`}>
      <div className={cn("pointer-events-none absolute inset-x-0 top-0 h-1 rounded-t-2xl", id.accent.bg)} aria-hidden />
      <div className="flex items-start gap-3">
        <Mascot bot={card.bot} state={state} size={72} label={`${id.name}, ${id.role}`} eager />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">{id.name}</h2>
            <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium", card.status === "attention" ? "text-red-700 dark:text-red-400" : card.status === "needs_you" ? "text-amber-700 dark:text-amber-400" : card.status === "working" ? id.accent.fg : "text-muted-foreground")} data-testid="coworker-status">
              <span className={cn("h-1.5 w-1.5 rounded-full", card.status === "attention" ? "bg-red-500" : card.status === "needs_you" ? "bg-amber-500" : card.status === "working" ? `${id.accent.bg} motion-safe:animate-pulse` : "bg-emerald-500")} aria-hidden />
              {BOT_STATUS_LABEL[card.status]}{card.waiting > 0 ? ` · ${card.waiting}` : ""}
            </span>
          </div>
          <p className={cn("text-xs font-medium", id.accent.fg)}>{id.role}</p>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{id.pitch}</p>
      <div className="min-h-[2.5rem] text-xs">
        {card.activeRun ? (
          <button type="button" onClick={() => onOpenRun(card.activeRun!.id)} className="flex w-full items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-2 text-left hover:bg-muted" data-testid="coworker-active">
            <StatusPill run={card.activeRun} /><span className="min-w-0 flex-1 truncate">{card.activeRun.taskLabel}</span><ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        ) : card.lastRun ? (
          <button type="button" onClick={() => onOpenRun(card.lastRun!.id)} className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-muted/60">
            {card.unread > 0 && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-sky-500" aria-label="New report" />}
            <span className="min-w-0 flex-1"><span className="line-clamp-2">{card.lastRun.report?.headline ?? card.lastRun.statusLabel}</span><span className="text-muted-foreground"> · {when(card.lastRun.finishedAt ?? card.lastRun.createdAt)}</span></span>
          </button>
        ) : <p className="px-2.5 py-2 text-muted-foreground">No tasks yet.</p>}
        {card.nextSchedule && <p className="px-2.5 text-muted-foreground">Next scheduled: {when(card.nextSchedule)}</p>}
      </div>
      <div className="mt-auto flex gap-2">
        <Button asChild className={cn("h-10 flex-1 text-white hover:opacity-90", id.accent.bg)}><Link href={`/ai-league/${card.bot}`} data-testid={`open-chat-${card.bot}`}>Open chat</Link></Button>
        <Button variant="outline" className="h-10" onClick={onTask} data-testid={`quick-task-${card.bot}`}><Play className="mr-1.5 h-3.5 w-3.5" />{card.bot === "zee" ? "Brief me" : "Start a task"}</Button>
      </div>
    </article>
  );
}

function RunList({ bot, limit = 50, onOpen, empty, filter = {} }: { bot?: Bot; limit?: number; onOpen: (id: string) => void; empty: string; filter?: { status?: string; days?: number } }) {
  const q = useRuns({ bot, ...filter });
  if (q.isLoading) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/60" />)}</div>;
  const runs = (q.data?.runs ?? []).slice(0, limit);
  if (!runs.length) return Object.keys(filter).some((k) => (filter as Record<string, unknown>)[k]) ? <p className="py-4 text-sm text-muted-foreground">{empty}</p> : <MascotEmpty bots={bot ? [bot] : undefined} bordered={false}>{empty}</MascotEmpty>;
  return (
    <ul className="divide-y" data-testid="run-list">
      {runs.map((r) => (
        <li key={r.id}>
          <button type="button" onClick={() => onOpen(r.id)} className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-muted/40 focus-visible:bg-muted/40" data-testid="run-row">
            <Mascot bot={r.bot} size={28} state={!isTerminal(r.status) ? "working" : "idle"} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">{r.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" aria-label="New" />}<span className="truncate text-sm font-medium">{r.report?.headline ?? r.taskLabel}</span></span>
              <span className="block truncate text-xs text-muted-foreground">{BOT_IDENTITY[r.bot].name} · {r.taskLabel}{r.request ? ` · “${r.request}”` : ""} · {when(r.createdAt)}</span>
            </span>
            <StatusPill run={r} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function ActivityView({ onOpen }: { onOpen: (id: string) => void }) {
  const [bot, setBot] = useState<Bot | "">("");
  const [status, setStatus] = useState("");
  const [days, setDays] = useState(30);
  const field = "h-9 rounded-md border bg-background px-2 text-sm";
  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4" data-testid="league-activity">
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="f-bot">Coworker</label>
        <select id="f-bot" className={field} value={bot} onChange={(e) => setBot(e.target.value as Bot | "")}><option value="">All coworkers</option>{BOTS.map((b) => <option key={b} value={b}>{BOT_IDENTITY[b].name}</option>)}</select>
        <label className="sr-only" htmlFor="f-status">Status</label>
        <select id="f-status" className={field} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option><option value="queued,running,waiting">Working</option><option value="completed">Done</option><option value="partial">Partly done</option><option value="failed">Didn't finish</option><option value="cancelled">Cancelled</option>
        </select>
        <label className="sr-only" htmlFor="f-days">Period</label>
        <select id="f-days" className={field} value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select>
      </div>
      <RunList bot={bot || undefined} filter={{ status: status || undefined, days }} onOpen={onOpen} empty="No tasks match these filters." />
    </section>
  );
}

/* ── a coworker's chat ───────────────────────────────────────────────────── */

function CoworkerChat({ bot }: { bot: Bot }) {
  const id = BOT_IDENTITY[bot];
  const endpoints = useMemo(() => leagueEndpoints(bot), [bot]);
  const agent = useAgent({ sessionId: bot, endpoints });
  const roster = useRoster();
  const runs = useRuns({ bot });
  const [runId, setRunId] = useRunParam();
  const [dialog, setDialog] = useState(false);
  const [huddle, setHuddle] = useState(false);
  const [seed, setSeed] = useState({ text: "", n: 0 });
  const assistant = useMemo(() => ({ name: id.name, avatar: <Mascot bot={bot} size={28} /> }), [bot, id.name]);
  const [tasksOpen, setTasksOpen] = useState(false);
  const card = roster.data?.bots.find((b) => b.bot === bot);
  // A reply may have started a task: show it in the task panel.
  useEffect(() => { if (!agent.running) void refreshLeague(); }, [agent.running, agent.messages.length]);
  // An approval decided in the chat changes what's waiting (the roster, the Waiting view).
  const approvalKey = Object.entries(agent.approvals).map(([k, v]) => `${k}:${v.status}`).join(",");
  useEffect(() => { void refreshLeague(); }, [approvalKey]);
  const active = runs.data?.runs.find((r) => !isTerminal(r.status)) ?? null;
  const empty = !agent.loading && agent.messages.length === 0;

  const tasksPanel = (
    <div className="space-y-4">
      {active && <div className="rounded-xl border p-3"><RunDetail id={active.id} /></div>}
      <div>
        <div className="mb-1 flex items-center justify-between"><h2 className="text-sm font-semibold">{id.name}'s tasks</h2><Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setDialog(true)}><Play className="mr-1 h-3 w-3" />New</Button></div>
        <RunList bot={bot} limit={8} onOpen={setRunId} empty="No tasks yet. Ask in the chat, or start one." />
      </div>
    </div>
  );

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col bg-background lg:h-[calc(100dvh-var(--dis-topnav-h))]" data-testid={`league-chat-${bot}`}>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_22rem]">
        {/* Roster: a compact column on desktop */}
        <nav className="hidden border-r p-3 lg:block" aria-label="Coworkers">
          <Link href="/ai-league" className="mb-3 flex items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />AI League</Link>
          <ul className="space-y-1">
            {BOTS.map((b) => {
              const c = roster.data?.bots.find((x) => x.bot === b);
              const on = b === bot;
              return (
                <li key={b}>
                  <Link href={`/ai-league/${b}`} aria-current={on ? "page" : undefined} className={cn("flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors", on ? BOT_IDENTITY[b].accent.soft : "hover:bg-muted/60")}>
                    <Mascot bot={b} size={36} state={b === bot && agent.running ? "thinking" : mascotState(c?.status)} eager />
                    <span className="min-w-0"><span className="block font-medium">{BOT_IDENTITY[b].name}</span><span className="block truncate text-[11px] text-muted-foreground">{c ? BOT_STATUS_LABEL[c.status] : BOT_IDENTITY[b].role}</span></span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* The conversation */}
        <section className="flex min-h-0 min-w-0 flex-col" aria-label={`Chat with ${id.name}`}>
          <header className="flex items-center gap-3 border-b px-4 py-3">
            <Link href="/ai-league" className="lg:hidden" aria-label="Back to AI League"><ArrowLeft className="h-5 w-5" /></Link>
            <Mascot bot={bot} size={44} state={agent.running ? "thinking" : mascotState(card?.status)} eager />
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-semibold leading-tight">{id.name}</h1>
              <p className={cn("truncate text-xs", id.accent.fg)}>{id.role}{card && card.status !== "available" ? ` · ${BOT_STATUS_LABEL[card.status]}` : ""}</p>
            </div>
            <Button size="sm" variant="outline" className="h-9 xl:hidden" onClick={() => setTasksOpen(true)} data-testid="open-tasks"><ListChecks className="mr-1.5 h-4 w-4" />Tasks{active ? " ·1" : ""}</Button>
            <Button size="sm" variant="outline" className="hidden h-9 sm:inline-flex" onClick={() => setHuddle(true)} data-testid="chat-start-huddle"><MessagesSquare className="mr-1.5 h-4 w-4" />Huddle</Button>
            <Button size="sm" className={cn("hidden h-9 text-white sm:inline-flex", id.accent.bg)} onClick={() => setDialog(true)} data-testid="chat-start-task"><Play className="mr-1.5 h-3.5 w-3.5" />{bot === "zee" ? "Brief me" : "Start a task"}</Button>
          </header>
          <div className="relative flex min-h-0 flex-1 flex-col">
            {empty ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center" data-testid="chat-empty">
                <Mascot bot={bot} size={112} label={`${id.name}, ${id.role}`} eager />
                <div className="max-w-md space-y-1">
                  <p className="font-semibold">Hi, I'm {id.name}.</p>
                  <p className="text-sm text-muted-foreground">{id.pitch}</p>
                </div>
                <div className="flex max-w-xl flex-wrap justify-center gap-2">
                  {id.suggestions.map((s) => <button key={s} type="button" onClick={() => void agent.send(s)} className={cn("rounded-full border px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted", id.accent.fg)} data-testid="chat-suggestion"><Sparkles className="mr-1 inline h-3 w-3" aria-hidden />{s}</button>)}
                </div>
              </div>
            ) : (
              <Thread messages={agent.messages} approvals={agent.approvals} running={agent.running} steps={agent.steps} assistant={assistant}
                onEditLast={(t) => setSeed((x) => ({ text: t, n: x.n + 1 }))}
                onStop={agent.stop} onRetry={agent.retry} onApprove={(a, t) => void agent.approve(a, t)} onDecline={(a, t) => void agent.reject(a, t)} />
            )}
          </div>
          <div className="border-t px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 sm:px-4">
            {/* A background task keeps going after the chat answers: its real status, where the side panel isn't shown. */}
            {active && (
              <button type="button" onClick={() => setRunId(active.id)} className="mb-2 flex w-full items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-left text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 xl:hidden" data-testid="chat-active-task">
                <StatusPill run={active} />
                <span className="min-w-0 flex-1 truncate"><span className="font-medium">{active.taskLabel}</span>{active.request ? <span className="text-muted-foreground"> · {active.request}</span> : null}</span>
                <span className="shrink-0 font-semibold text-foreground/80">View</span>
              </button>
            )}
            <Composer onSend={(t, accepted) => agent.send(t, accepted)} onStop={agent.stop} running={agent.running} placeholder={`Ask ${id.name}…`} label={`Message ${id.name}`} draftFor={`league-${bot}`} seed={seed} />
          </div>
        </section>

        {/* Tasks beside the chat on wide screens */}
        <aside className="hidden min-h-0 overflow-y-auto border-l p-4 xl:block" aria-label={`${id.name}'s tasks`}>{tasksPanel}</aside>
      </div>

      <Sheet open={tasksOpen} onOpenChange={setTasksOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl">
          <SheetHeader><SheetTitle>{id.name}'s tasks</SheetTitle></SheetHeader>
          <div className="pt-3">{tasksPanel}</div>
        </SheetContent>
      </Sheet>
      {dialog && <TaskDialog bot={bot} open={dialog} onOpenChange={setDialog} onStarted={(r: RunView) => setRunId(r.id)} />}
      {huddle && <TaskDialog bot={bot} huddle open={huddle} onOpenChange={setHuddle} onStarted={(r: RunView) => setRunId(r.id)} />}
      <RunSheet id={runId} onClose={() => setRunId(null)} />
    </div>
  );
}
