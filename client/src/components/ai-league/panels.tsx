/**
 * AI League's secondary views: what's waiting for you (approvals), recurring tasks (schedules), what your coworkers
 * remember (memory), and the plan's allowance (usage). Every button does what the server does; nothing is simulated.
 */
import { trackEvent } from "@/lib/analytics";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { CalendarClock, Check, Loader2, Pause, Play, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { postStream } from "@/lib/agent-stream";
import { leadCall, leadError } from "@/lib/leads";
import { cn } from "@/lib/utils";
import { BOTS, BOT_IDENTITY, FREQUENCY_LABEL, SCHEDULABLE, TASK_BOT, TASK_LABEL, type Frequency, type LeagueTask } from "@shared/ai-league";
import { APPROVALS_URL, LEAGUE, MEMORY_URL, SCHEDULES_URL, leagueCall, refreshLeague, useApprovals, useLeagueUsage, useMemory, useSchedules, when, type ApprovalItem } from "@/lib/ai-league";
import { Mascot, MascotEmpty } from "./mascot";

const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;
const fmtNext = (iso: string | null, tz: string) => { if (!iso) return "—"; try { return new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: tz }); } catch { return when(iso); } };
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* ── approvals ───────────────────────────────────────────────────────────── */

export function ApprovalsPanel() {
  const q = useApprovals();
  if (q.isLoading) return <div className="h-24 animate-pulse rounded-xl bg-muted" aria-busy="true" />;
  if (q.isError) return <Empty>{leadError(q.error, "What's waiting couldn't be loaded.")}</Empty>;
  const items = q.data?.items ?? [];
  if (!items.length) return <MascotEmpty>Nothing is waiting for you. When a coworker needs your go-ahead (a search that uses your allowance, a draft to approve), it shows here.</MascotEmpty>;
  return <ul className="space-y-3" data-testid="approvals-list">{items.map((i) => <ApprovalRow key={`${i.kind}-${i.id}`} item={i} />)}</ul>;
}

function ApprovalRow({ item }: { item: ApprovalItem }) {
  const { toast } = useToast();
  const [done, setDone] = useState<string | null>(null);
  const id = BOT_IDENTITY[item.bot];
  const approve = useMutation({
    mutationFn: async () => {
      if (item.kind === "draft") return leadCall("POST", `/api/sales/messages/${item.id}/approve`, { bodyHash: item.bodyHash }).then((r) => { trackEvent("outreach_draft_approved", { source: "ai_league", by_ai: true }); return r; });
      let final: { ok?: boolean; message?: string } | null = null;
      await postStream(`${LEAGUE}/approvals/${encodeURIComponent(item.id)}/approve`, undefined, { onEvent: (e) => { if (e.data?.final) final = e.data as { ok?: boolean; message?: string }; } });
      const f = final as { ok?: boolean; message?: string } | null;
      if (!f || f.ok === false) throw new Error(f?.message ?? "It didn't go through. Nothing was changed.");
      return f;
    },
    onSuccess: () => { setDone(item.kind === "draft" ? "Approved. Send it from the lead page." : "Approved. It's running."); void refreshLeague(); },
    onError: (e) => toast({ title: "Not approved", description: e instanceof Error && !(e as any).status ? e.message : leadError(e), variant: "destructive" }),
  });
  const reject = useMutation({
    mutationFn: () => item.kind === "draft" ? leadCall("POST", `/api/sales/messages/${item.id}/cancel`, {}) : leagueCall("POST", `${LEAGUE}/approvals/${encodeURIComponent(item.id)}/reject`),
    onSuccess: () => { setDone(item.kind === "draft" ? "Draft discarded." : "Declined. Nothing happened."); void refreshLeague(); },
    onError: (e) => toast({ title: "Couldn't decline", description: leadError(e), variant: "destructive" }),
  });
  const expired = item.expiresAt && new Date(item.expiresAt).getTime() < Date.now();
  return (
    <li className="rounded-xl border bg-card p-3.5" data-testid="approval-item">
      <div className="flex items-start gap-3">
        <Mascot bot={item.bot} size={32} />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className={cn("text-[11px] font-semibold uppercase tracking-wider", id.accent.fg)}>{id.name} · {item.kind === "draft" ? "Draft to approve" : "Needs your go-ahead"}</p>
            <p className="text-sm font-medium">{item.title}</p>
          </div>
          {item.lines.length > 0 && <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">{item.lines.map((l) => <div key={l.label} className="contents"><dt className="text-muted-foreground">{l.label}</dt><dd className="break-words">{l.value}</dd></div>)}</dl>}
          {item.kind === "draft" && item.body && (
            <div className="rounded-lg border bg-background/60 p-2.5 text-sm">
              {item.subject && <p className="font-medium">{item.subject}</p>}
              <p className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-muted-foreground">{item.body}</p>
            </div>
          )}
          {expired && <p className="text-xs text-amber-700 dark:text-amber-400">This request has expired. Ask again in the chat.</p>}
          {done ? <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400" role="status">{done}</p> : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="h-9" disabled={approve.isPending || !!expired} onClick={() => approve.mutate()} data-testid="approval-approve">{approve.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}{item.kind === "draft" ? "Approve this text" : "Approve"}</Button>
              <Button size="sm" variant="ghost" className="h-9" disabled={reject.isPending} onClick={() => reject.mutate()} data-testid="approval-reject"><X className="mr-1.5 h-3.5 w-3.5" />{item.kind === "draft" ? "Discard" : "Decline"}</Button>
              {item.href && <Button size="sm" variant="outline" className="h-9" asChild><Link href={item.href}>{item.kind === "draft" ? "Edit or send on the lead" : "Open the chat"}</Link></Button>}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/* ── schedules ───────────────────────────────────────────────────────────── */

export function SchedulesPanel() {
  const { toast } = useToast();
  const q = useSchedules();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
  const [form, setForm] = useState<{ task: LeagueTask; frequency: Frequency; timeOfDay: string; weekday: number; request: string }>({ task: "zee.briefing", frequency: "weekdays", timeOfDay: "09:00", weekday: 1, request: "" });
  const fail = (title: string) => (e: unknown) => toast({ title, description: leadError(e), variant: "destructive" });
  const create = useMutation({
    mutationFn: () => leagueCall("POST", SCHEDULES_URL, { task: form.task, frequency: form.frequency, timeOfDay: form.timeOfDay, weekday: form.frequency === "weekly" ? form.weekday : null, timezone: tz, input: form.task === "nibo.find_clients" ? { request: form.request } : {} }),
    onSuccess: () => { void refreshLeague(); toast({ title: "Schedule saved" }); },
    onError: fail("Couldn't save the schedule"),
  });
  const patch = useMutation({ mutationFn: (v: { id: number; status: "active" | "paused" }) => leagueCall("PATCH", `${SCHEDULES_URL}/${v.id}`, { status: v.status }), onSuccess: () => void refreshLeague(), onError: fail("Couldn't change it") });
  const del = useMutation({ mutationFn: (id: number) => leagueCall("DELETE", `${SCHEDULES_URL}/${id}`), onSuccess: () => void refreshLeague(), onError: fail("Couldn't delete it") });
  const runNow = useMutation({ mutationFn: (id: number) => leagueCall("POST", `${SCHEDULES_URL}/${id}/run`), onSuccess: () => { void refreshLeague(); toast({ title: "Started now" }); }, onError: fail("Couldn't start it") });
  const field = "h-9 rounded-md border bg-background px-2 text-sm";
  return (
    <div className="space-y-4" data-testid="schedules-panel">
      <form className="grid gap-2 rounded-xl border bg-card p-3.5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_auto_auto_auto_auto] lg:items-end" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <label className="flex flex-col gap-1 text-xs font-medium">Task
          <select className={field} value={form.task} onChange={(e) => setForm({ ...form, task: e.target.value as LeagueTask })}>{SCHEDULABLE.map((t) => <option key={t} value={t}>{BOT_IDENTITY[TASK_BOT[t]].name}: {TASK_LABEL[t]}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">How often
          <select className={field} value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as Frequency })}>{(["daily", "weekdays", "weekly"] as const).map((f) => <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>)}</select>
        </label>
        {form.frequency === "weekly" && (
          <label className="flex flex-col gap-1 text-xs font-medium">On
            <select className={field} value={form.weekday} onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs font-medium">At
          <Input type="time" value={form.timeOfDay} onChange={(e) => setForm({ ...form, timeOfDay: e.target.value })} className="h-9" />
        </label>
        <Button type="submit" className="h-9 sm:col-span-2 lg:col-span-1" disabled={create.isPending || (form.task === "nibo.find_clients" && form.request.trim().length < 8)} data-testid="schedule-create">{create.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-1.5 h-4 w-4" />}Add schedule</Button>
        {form.task === "nibo.find_clients" && <label className="flex flex-col gap-1 text-xs font-medium sm:col-span-2 lg:col-span-5">Who to look for<Input value={form.request} onChange={(e) => setForm({ ...form, request: e.target.value })} maxLength={500} placeholder={BOT_IDENTITY.nibo.suggestions[0]} className="h-9" /></label>}
        <p className="text-[11px] text-muted-foreground sm:col-span-2 lg:col-span-5">Times are in your timezone ({tz}). If DealInSec is offline when a run is due, it runs once when it's back; missed runs aren't replayed one by one.</p>
      </form>
      {q.isLoading ? <div className="h-16 animate-pulse rounded-xl bg-muted" /> : !q.data?.schedules.length ? <MascotEmpty bots={["zee"]}>No recurring tasks yet. A weekday briefing from Zee at 9am is a good first one.</MascotEmpty> : (
        <ul className="divide-y rounded-xl border bg-card" data-testid="schedules-list">
          {q.data.schedules.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
              <Mascot bot={s.bot} size={28} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{s.taskLabel} <span className="font-normal text-muted-foreground">· {FREQUENCY_LABEL[s.frequency as Frequency]}{s.frequency === "weekly" && s.weekday !== null ? ` on ${WEEKDAYS[s.weekday]}` : ""} at {s.timeOfDay}</span></p>
                <p className="text-xs text-muted-foreground">{s.status === "paused" ? "Paused" : `Next: ${fmtNext(s.nextRunAt, s.timezone)}`}{s.lastRunAt ? ` · Last: ${when(s.lastRunAt)}` : ""}</p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-9" onClick={() => runNow.mutate(s.id)} disabled={runNow.isPending}>Run now</Button>
                <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => patch.mutate({ id: s.id, status: s.status === "active" ? "paused" : "active" })} aria-label={s.status === "active" ? "Pause" : "Resume"}>{s.status === "active" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button>
                <Button size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground" onClick={() => del.mutate(s.id)} aria-label="Delete schedule"><Trash2 className="h-4 w-4" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── memory and usage ────────────────────────────────────────────────────── */

export function MemoryPanel() {
  const { toast } = useToast();
  const q = useMemory();
  const u = useLeagueUsage();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const save = useMutation({ mutationFn: (v: { bot: string; key: string; value: string }) => leagueCall("PUT", MEMORY_URL, v), onSuccess: () => { void refreshLeague(); toast({ title: "Saved" }); }, onError: (e) => toast({ title: "Not saved", description: leadError(e), variant: "destructive" }) });
  const del = useMutation({ mutationFn: (id: number) => leagueCall("DELETE", `${MEMORY_URL}/${id}`), onSuccess: () => void refreshLeague() });
  const usage = u.data?.usage;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <section className="space-y-3 rounded-xl border bg-card p-4" data-testid="memory-panel">
        <div>
          <h3 className="text-sm font-semibold">What your coworkers remember</h3>
          <p className="text-xs text-muted-foreground">Preferences they read before they work. They're context, never permission: a coworker still can't do anything its tools and your role don't allow. Never store passwords or keys here.</p>
        </div>
        {q.isLoading ? <div className="h-24 animate-pulse rounded bg-muted" /> : (
          <ul className="space-y-3">
            {Object.entries(q.data?.keys ?? {}).map(([key, meta]) => {
              const bot = meta.bots[0];
              const cur = q.data?.memory.find((m) => m.key === key && m.bot === bot);
              const k = `${bot}:${key}`;
              const value = draft[k] ?? cur?.value ?? "";
              return (
                <li key={k} className="space-y-1">
                  <label className="flex items-center gap-2 text-xs font-medium" htmlFor={`mem-${k}`}><Mascot bot={bot as "nibo"} size={18} />{meta.label}</label>
                  <div className="flex gap-2">
                    <Input id={`mem-${k}`} value={value} maxLength={500} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} placeholder="Not set" className="h-9" />
                    <Button size="sm" variant="outline" className="h-9" disabled={!value.trim() || value === cur?.value || save.isPending} onClick={() => save.mutate({ bot, key, value })}>Save</Button>
                    {cur && <Button size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground" onClick={() => { del.mutate(cur.id); setDraft({ ...draft, [k]: "" }); }} aria-label={`Forget ${meta.label}`}><Trash2 className="h-4 w-4" /></Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="space-y-3 rounded-xl border bg-card p-4" data-testid="usage-panel">
        <h3 className="text-sm font-semibold">Usage</h3>
        {!usage ? <div className="h-20 animate-pulse rounded bg-muted" /> : (
          <>
            <Meter label={`Tasks in the last ${usage.windowDays} days`} used={usage.runs.used} limit={usage.runs.limit} />
            <Meter label="Recurring tasks" used={usage.schedules.used} limit={usage.schedules.limit} />
            <ul className="space-y-1 text-xs text-muted-foreground">
              {BOTS.map((b) => <li key={b} className="flex justify-between"><span>{BOT_IDENTITY[b].name}</span><span className="tabular-nums">{usage.byBot[b] ?? 0} tasks</span></li>)}
              <li className="flex justify-between"><span>At once</span><span className="tabular-nums">up to {usage.concurrent}</span></li>
            </ul>
            <p className="text-[11px] text-muted-foreground">Each task also uses the allowance of what it does: Nibo's research counts toward AI Outbound searches, Mika's drafts toward your AI drafts. Nothing is unlimited.</p>
          </>
        )}
      </section>
    </div>
  );
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  return (
    <div>
      <div className="flex justify-between text-xs"><span>{label}</span><span className="tabular-nums text-muted-foreground">{used} of {limit}</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit} aria-label={label}>
        <div className={cn("h-full rounded-full", pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export { APPROVALS_URL };
