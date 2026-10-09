/**
 * AI Outbound: say who you want to reach; DealInSec finds real companies, checks their websites, reads what they say,
 * looks for reasons to reach out now, scores each one with the same 100-point score as a lead, and shows only what it
 * can back with evidence. Nothing is contacted. The good ones are added to Leads by you.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Loader2, Radar, Search, Square, X } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import { NotificationBell } from "@/components/notification-bell";
import { ProspectBrief } from "@/components/outbound/prospect-brief";
import { ProspectCard } from "@/components/outbound/prospect-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { leadCall, leadError } from "@/lib/leads";
import { queryClient } from "@/lib/queryClient";
import { ICP_URL, OUTBOUND_RUNS_URL, RUN_ERROR, RUN_STAGE_LABEL, countryName, runUrl, prospectUrl, type ParsedIcp, type ProspectCard as Card_, type RunView } from "@/lib/outbound";
import { cn } from "@/lib/utils";
import { memberCan } from "@shared/permissions";

const EXAMPLES = [
  "Find 30 US digital marketing agencies with 5–30 employees that serve SaaS companies",
  "20 UK accounting firms that work with restaurants",
  "Boutique hotels in Portugal with their own website",
];

const notSetUp = (e: unknown) => !!e && /PROSPECTS_NOT_SETUP/.test(String((e as Error).message));

function Funnel({ run }: { run: RunView }) {
  const c = run.counters;
  const steps = [
    { n: c.discovered ?? 0, label: "discovered" }, { n: c.verified ?? 0, label: "verified" }, { n: c.icpMatch ?? 0, label: "match your ICP" },
    { n: c.signals ?? 0, label: "with a reason now" }, { n: c.decisionMakers ?? 0, label: "with a person" }, { n: c.ready ?? 0, label: "outreach-ready", strong: true },
  ];
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" data-testid="funnel">
      {steps.map((s) => (
        <div key={s.label} className={cn("rounded-xl border px-3 py-2", s.strong && "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30")}>
          <p className="text-xl font-bold tabular-nums leading-tight">{s.n}</p>
          <p className="text-[11px] leading-tight text-muted-foreground">{s.label}</p>
        </div>
      ))}
    </div>
  );
}

function RunPanel({ id, canEdit, onOpen }: { id: string; canEdit: boolean; onOpen: (p: Card_) => void }) {
  const { toast } = useToast();
  const q = useQuery<{ run: RunView; prospects: Card_[] }>({ queryKey: [runUrl(id)], refetchInterval: (query) => (query.state.data?.run.status === "running" ? 3000 : false) });
  const [showAside, setShowAside] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);
  const cancel = useMutation({ mutationFn: () => leadCall("POST", `${runUrl(id)}/cancel`, {}), onSuccess: () => void queryClient.invalidateQueries({ queryKey: [runUrl(id)] }) });
  const add = useMutation({
    mutationFn: (pid: number) => { setAdding(pid); return leadCall("POST", prospectUrl(pid, "lead"), {}); },
    onSuccess: (r: any) => { toast({ title: r.existing ? "Already in your leads" : "Added to Leads", description: "Its evidence is on the lead's Facts tab." }); void queryClient.invalidateQueries({ predicate: (k) => typeof k.queryKey[0] === "string" && ((k.queryKey[0] as string).startsWith("/api/outbound") || (k.queryKey[0] as string).startsWith("/api/leads")) }); },
    onError: (e) => toast({ title: "Couldn't add it", description: leadError(e), variant: "destructive" }),
    onSettled: () => setAdding(null),
  });
  const data = q.data;
  const [good, aside] = useMemo(() => {
    const ps = data?.prospects ?? [];
    return [ps.filter((p) => !p.rejectReason), ps.filter((p) => p.rejectReason)] as const;
  }, [data]);
  if (!data) return <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}</div>;
  const run = data.run;
  const running = run.status === "running";
  return (
    <div className="min-w-0 space-y-4" data-testid="run-panel">
      <Card className="glass-card"><CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Search</p>
            <p className="break-words text-sm font-semibold">{run.description}</p>
            <p className={cn("mt-1 flex items-center gap-1.5 text-sm", running ? "" : "text-muted-foreground")} data-testid="run-status">
              {running ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />{RUN_STAGE_LABEL[run.stage] ?? "Working"}…</> : run.status === "done" ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />Done · ${run.costUsd.toFixed(2)} of AI and data</> : run.status === "cancelled" ? "Stopped" : "Couldn't finish"}
            </p>
            {run.errorCode && RUN_ERROR[run.errorCode] && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{RUN_ERROR[run.errorCode]}</p>}
          </div>
          {running && canEdit && <Button size="sm" variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending} data-testid="run-cancel"><Square className="mr-1.5 h-3.5 w-3.5" />Stop</Button>}
        </div>
        <Funnel run={run} />
      </CardContent></Card>

      {good.length === 0 && running && <p className="text-sm text-muted-foreground">Companies appear here as they are checked. This usually takes a minute or two.</p>}
      {good.length === 0 && !running && <p className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No company passed the checks. Try a broader description, or a different place.</p>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0" data-testid="prospect-grid">
        {good.map((p) => <ProspectCard key={p.id} p={p} canEdit={canEdit} adding={adding === p.id} onOpen={() => onOpen(p)} onAdd={() => add.mutate(p.id)} />)}
      </div>

      {aside.length > 0 && (
        <div>
          <button onClick={() => setShowAside((v) => !v)} className="text-sm text-muted-foreground underline-offset-2 hover:underline" data-testid="toggle-aside">{showAside ? "Hide" : "Show"} {aside.length} set aside</button>
          {showAside && (
            <ul className="mt-2 divide-y rounded-2xl border text-sm">
              {aside.map((p) => <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2"><span className="min-w-0 truncate">{p.name} <span className="text-muted-foreground">· {p.domain}</span></span><span className="shrink-0 text-xs text-muted-foreground">{p.rejectLabel}</span></li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function OutboundPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canEdit = memberCan(user as any, "deals.create");
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedIcp | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [open, setOpen] = useState<Card_ | null>(null);
  const runs = useQuery<{ runs: RunView[] }>({ queryKey: [OUTBOUND_RUNS_URL], retry: false, refetchInterval: (q) => (q.state.data?.runs.some((r) => r.status === "running") ? 5000 : false) });
  // Open the most recent run on arrival, once.
  useEffect(() => { if (!runId && runs.data?.runs.length) setRunId(runs.data.runs[0].id); }, [runs.data, runId]);

  const parse = useMutation({
    mutationFn: () => leadCall<ParsedIcp>("POST", ICP_URL, { request: text }),
    onSuccess: (r) => setParsed(r),
    onError: (e) => toast({ title: "I couldn't read that", description: leadError(e), variant: "destructive" }),
  });
  const start = useMutation({
    mutationFn: () => leadCall<{ run: RunView; existing: boolean }>("POST", OUTBOUND_RUNS_URL, { request: text, icp: parsed!.icp, searches: parsed!.searches }),
    onSuccess: (r) => { setRunId(r.run.id); setParsed(null); setText(""); if (r.existing) toast({ title: "That search is already running" }); void queryClient.invalidateQueries({ queryKey: [OUTBOUND_RUNS_URL] }); },
    onError: (e) => toast({ title: "Couldn't start the search", description: leadError(e), variant: "destructive" }),
  });
  const icp = parsed?.icp;
  const setQty = (n: number) => setParsed((p) => (p ? { ...p, icp: { ...p.icp, quantity: Math.max(1, Math.min(50, n || 1)) } } : p));
  const chip = (label: string, onRemove?: () => void) => <span key={label} className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs">{label}{onRemove && <button onClick={onRemove} aria-label={`Remove ${label}`}><X className="h-3 w-3" /></button>}</span>;

  const off = notSetUp(runs.error);

  return (
    <div className="min-h-screen bg-background pb-20 lg:pb-12">
      <header className="glass-header sticky top-0 z-40 lg:border-b lg:border-neutral-200/60 dark:lg:border-neutral-800/60">
        <div className="flex items-center justify-between gap-4 px-4 py-4 lg:mx-auto lg:max-w-[1600px] lg:px-8">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight lg:text-2xl"><Radar className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />AI Outbound</h1>
            <p className="mt-0.5 hidden text-sm text-muted-foreground lg:block">Who to contact, why now, who exactly, and what to say. Only what it can back with evidence.</p>
          </div>
          <NotificationBell className="lg:hidden" />
        </div>
      </header>

      <main className="animate-fade-in space-y-5 px-4 py-5 lg:mx-auto lg:max-w-[1600px] lg:px-8 lg:py-6">
        {off ? (
          <div className="rounded-2xl border px-6 py-14 text-center"><p className="font-semibold">AI Outbound isn't switched on yet</p><p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">This workspace is still being set up for it. Try again shortly.</p></div>
        ) : (
          <>
            {canEdit ? (
              <Card className="glass-card"><CardContent className="space-y-3 p-4">
                <label htmlFor="outbound-request" className="text-sm font-semibold">Tell me who you want to reach…</label>
                <Textarea id="outbound-request" value={text} onChange={(e) => { setText(e.target.value); setParsed(null); }} rows={2} maxLength={500}
                  placeholder="US SEO agencies with 5–30 employees serving SaaS companies" disabled={parse.isPending || start.isPending} data-testid="outbound-input" />
                {!text && <div className="flex flex-wrap gap-2">{EXAMPLES.map((x) => <button key={x} onClick={() => setText(x)} className="rounded-full border px-3 py-1 text-left text-xs text-muted-foreground hover:bg-muted">{x}</button>)}</div>}
                {!parsed ? (
                  <Button onClick={() => parse.mutate()} disabled={text.trim().length < 3 || parse.isPending} className="gradient-btn text-white" data-testid="outbound-find">
                    {parse.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}Find prospects
                  </Button>
                ) : icp && (
                  <div className="space-y-3 rounded-xl border bg-muted/30 p-3" data-testid="icp-confirm">
                    <p className="text-sm font-medium">Here's what I'll look for. Change anything before I start.</p>
                    <div className="flex flex-wrap gap-1.5">
                      {chip(icp.industry)}
                      {icp.countries.map((c) => chip(countryName(c)))}
                      {icp.locations.map((l) => chip(l))}
                      {(icp.employeeMin || icp.employeeMax) && chip(icp.employeeMin && icp.employeeMax ? `${icp.employeeMin}–${icp.employeeMax} people` : icp.employeeMax ? `up to ${icp.employeeMax} people` : `${icp.employeeMin}+ people`)}
                      {icp.targetMarket.map((m) => chip(`serves ${m}`))}
                      {icp.exclusions.map((x) => chip(`not ${x}`))}
                    </div>
                    <p className="text-xs text-muted-foreground">Reaching: {icp.roles.slice(0, 4).join(", ") || "decision makers"} · {parsed.searches.length} searches planned{parsed.source === "rules" ? " · read by simple rules (the AI was unavailable)" : ""}</p>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-sm">How many <input type="number" min={1} max={50} value={icp.quantity} onChange={(e) => setQty(Number(e.target.value))} className="w-16 rounded-md border bg-background px-2 py-1 text-sm" data-testid="outbound-quantity" /></label>
                      <Button onClick={() => start.mutate()} disabled={start.isPending} className="gradient-btn text-white" data-testid="outbound-start">{start.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-1.5 h-4 w-4" />}Start search</Button>
                      <Button variant="ghost" onClick={() => setParsed(null)}>Change</Button>
                    </div>
                  </div>
                )}
              </CardContent></Card>
            ) : (
              <p className="text-sm text-muted-foreground">You can see searches your team ran. Ask your owner for permission to start one.</p>
            )}

            {runs.data && runs.data.runs.length > 1 && (
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0" role="tablist" aria-label="Recent searches">
                {runs.data.runs.slice(0, 8).map((r) => (
                  <button key={r.id} role="tab" aria-selected={runId === r.id} onClick={() => setRunId(r.id)} className={cn("max-w-[16rem] shrink-0 truncate rounded-full border px-3 py-1.5 text-sm", runId === r.id ? "border-emerald-600 bg-emerald-600 text-white" : "border-border bg-background hover:bg-muted")}>{r.description}</button>
                ))}
              </div>
            )}

            {runId ? <RunPanel key={runId} id={runId} canEdit={canEdit} onOpen={setOpen} />
              : runs.isLoading ? <Skeleton className="h-40 w-full rounded-2xl" />
              : <p className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">Your searches will show up here, with who to contact and why now.</p>}
          </>
        )}
      </main>
      {runId && <ProspectBrief id={open?.id ?? null} runId={runId} open={!!open} onOpenChange={(o) => !o && setOpen(null)} canEdit={canEdit} />}
      <BottomNav />
    </div>
  );
}
