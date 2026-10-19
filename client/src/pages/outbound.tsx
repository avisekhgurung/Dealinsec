/**
 * Client Radar: say who you want to reach; DealInSec finds real companies, checks their websites, reads what they say,
 * looks for reasons to reach out now, scores each one with the same 100-point score as a lead, and shows only what it
 * can back with evidence. Nothing is contacted. The good ones are added to Leads by you.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, Loader2, Radar, Search, Sparkles, Square, X } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import { trackEvent } from "@/lib/analytics";
import { useUpgradeModal } from "@/components/upgrade-modal";
import { isUpgradeError, parseApiError } from "@/lib/api-error";
import { NotificationBell } from "@/components/notification-bell";
import { FlowSteps, flowState } from "@/components/outbound/flow-steps";
import { ProspectBrief } from "@/components/outbound/prospect-brief";
import { ProspectCard, ProspectCardSkeleton } from "@/components/outbound/prospect-card";
import { ProspectWorkspace } from "@/components/outbound/prospect-workspace";
import { OutreachQueue, outreachQueueKey, type QueueItem } from "@/components/outbound/outreach-queue";
import { SegmentedTabs } from "@/components/outbound/segmented-tabs";
import { OutreachInbox } from "@/components/outbound/outreach-inbox";
import { OUTBOUND_USAGE_URL, UsageNote, searchBlockedReason, useOutboundUsage } from "@/components/outbound/usage-note";
import { LocalSearch, type LocalFields } from "@/components/outbound/local-search";
import { LoadError } from "@/components/load-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { leadCall, leadError } from "@/lib/leads";
import { stagger, staggerItem, useCalmMotion } from "@/lib/motion";
import { queryClient } from "@/lib/queryClient";
import { COUNTRY_NAME, ICP_URL, OUTBOUND_RUNS_URL, RUN_ERROR, RUN_STAGE_LABEL, countryName, runUrl, prospectUrl, type ParsedIcp, type ProspectCard as Card_, type RunView } from "@/lib/outbound";
import { searchStrategies } from "@shared/icp";
import { DISCOVERY_PRESETS, suggestDiscoveryMode, type DiscoveryMode, type DiscoveryPreset } from "@shared/local-discovery";
import { takeOutboundPrefill } from "@/lib/outbound-prefill";
import { getTargetMarket } from "@/lib/first-goal";
import { cn } from "@/lib/utils";
import { memberCan } from "@shared/permissions";

const EXAMPLES = [
  "Find 30 US digital marketing agencies with 5–30 employees that serve SaaS companies",
  "20 UK accounting firms that work with restaurants",
  "Interior design studios in Bengaluru with their own website",
];

/**
 * Ready-made searches (shared/local-discovery.ts), each editable before it runs. A web preset's request is what is
 * searched (concrete businesses, size and place); the service the person sells is not put into it, or the search would
 * look for companies offering it. A local preset fills the local form; the person types their city.
 */
const PRESETS = DISCOVERY_PRESETS;
const presetChip = "rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-left text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";

/** A country as it reads in a sentence: "in the United States", "in the UAE", "in India". */
const placeName = (code: string) => { const n = countryName(code); return /^(United |UAE$|Netherlands$|Philippines$)/.test(n) ? `the ${n}` : n; };

const notSetUp = (e: unknown) => !!e && /PROSPECTS_NOT_SETUP/.test(String((e as Error).message));
type RunData = { run: RunView; prospects: Card_[] };
/** Passed the checks (shown as cards) vs set aside, split the same way everywhere on this page. */
const splitProspects = (ps: Card_[]) => [ps.filter((p) => !p.rejectReason), ps.filter((p) => p.rejectReason)] as const;

/** A run's stages, in the order the pipeline moves through them (server/outbound/pipeline.ts). */
const STAGES = [
  { key: "search", label: "Search" }, { key: "verify", label: "Check sites" }, { key: "enrich", label: "Read" },
  { key: "research", label: "Research" }, { key: "finalize", label: "Score" },
] as const;

function Funnel({ run }: { run: RunView }) {
  const c = run.counters;
  const steps = [
    { n: c.discovered ?? 0, label: "discovered" }, { n: c.verified ?? 0, label: "verified" }, { n: c.icpMatch ?? 0, label: "match your client profile" },
    { n: c.signals ?? 0, label: "with a dated reason" }, { n: c.strongTiming ?? 0, label: "strong timing" }, { n: c.decisionMakers ?? 0, label: "with a decision maker" }, { n: c.ready ?? 0, label: "ready for outreach", strong: true },
  ];
  return (
    <dl className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7" data-testid="funnel" aria-label="What this search counted so far">
      {steps.map((s) => (
        <div key={s.label} className={cn("flex flex-col-reverse rounded-xl border px-3 py-2", s.strong && "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30")}>
          <dt className="text-[11px] leading-tight text-muted-foreground">{s.label}</dt>
          <dd className="text-xl font-bold tabular-nums leading-tight">{s.n}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Which stage a running search is in, from its stage field only. Unknown stages show nothing rather than a guess. */
function StageTrack({ stage }: { stage: string }) {
  const at = STAGES.findIndex((s) => s.key === stage);
  if (at < 0) return null;
  return (
    <div className="space-y-1" data-testid="run-stages">
      <ol className="flex gap-1" aria-label={`Stage ${at + 1} of ${STAGES.length}: ${RUN_STAGE_LABEL[stage] ?? stage}`}>
        {STAGES.map((s, i) => <li key={s.key} className={cn("h-1.5 flex-1 rounded-full", i < at ? "bg-emerald-600/50" : i === at ? "bg-emerald-600" : "bg-muted")} aria-hidden />)}
      </ol>
      <p className="flex justify-between text-[10px] text-muted-foreground" aria-hidden>{STAGES.map((s, i) => <span key={s.key} className={cn(i === at && "font-semibold text-foreground")}>{s.label}</span>)}</p>
    </div>
  );
}

function RunPanel({ id, canEdit, onOpen }: { id: string; canEdit: boolean; onOpen: (p: Card_, focus?: "evidence") => void }) {
  const { toast } = useToast();
  const q = useQuery<RunData>({ queryKey: [runUrl(id)], refetchInterval: (query) => (query.state.data?.run.status === "running" ? 3000 : false) });
  const [showAside, setShowAside] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);
  const calm = useCalmMotion();
  const cancel = useMutation({ mutationFn: () => leadCall("POST", `${runUrl(id)}/cancel`, {}), onSuccess: () => void queryClient.invalidateQueries({ queryKey: [runUrl(id)] }) });
  const add = useMutation({
    mutationFn: (pid: number) => { setAdding(pid); return leadCall("POST", prospectUrl(pid, "lead"), {}); },
    onSuccess: (r: any) => { if (!r.existing) trackEvent("lead_created", { source: "outbound" }); toast({ title: r.existing ? "Already in your leads" : "Added to Leads", description: "Its evidence is on the lead's Facts tab." }); void queryClient.invalidateQueries({ predicate: (k) => typeof k.queryKey[0] === "string" && ((k.queryKey[0] as string).startsWith("/api/outbound") || (k.queryKey[0] as string).startsWith("/api/leads")) }); },
    onError: (e) => toast({ title: "Couldn't add it", description: leadError(e), variant: "destructive" }),
    onSettled: () => setAdding(null),
  });
  const data = q.data;
  const [good, aside] = useMemo(() => splitProspects(data?.prospects ?? []), [data]);
  // "Prospect research completed": once, when THIS page saw the search finish (not for a search that was already done).
  const sawRunning = useRef(false);
  useEffect(() => {
    const status = data?.run.status;
    if (status === "running") sawRunning.current = true;
    else if (status === "done" && sawRunning.current) {
      sawRunning.current = false;
      const [shown] = splitProspects(data!.prospects);
      trackEvent("prospect_research_completed", { prospects: shown.length, ready: shown.filter((p) => (p.classification ? p.classification === "ready" : p.ready)).length });
    }
  }, [data?.run.status]);
  // The cards that animate in: the first ones this panel shows for this search. Later polls add cards without motion.
  const firstIds = useRef<Set<number> | null>(null);
  if (firstIds.current === null && good.length > 0) firstIds.current = new Set(good.map((p) => p.id));
  if (!data && q.isError) return <Card className="glass-card"><CardContent className="p-0"><LoadError compact what="this search" onRetry={() => void q.refetch()} retrying={q.isFetching} /></CardContent></Card>;
  if (!data) return <RunSkeleton />;
  const run = data.run;
  const running = run.status === "running";
  const stopped = run.status === "cancelled" || run.status === "failed";
  const readyN = good.filter((p) => (p.classification ? p.classification === "ready" : p.ready)).length;
  const qualifiedN = good.filter((p) => p.classification === "qualified").length;
  const errorText = run.errorCode ? RUN_ERROR[run.errorCode] : undefined;
  return (
    <div className="min-w-0 space-y-4" data-testid="run-panel">
      <Card className="glass-card"><CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Search
              {run.by === "agent" && <span className="inline-flex items-center gap-1 rounded-full border border-emerald-600/30 bg-emerald-600/10 px-1.5 py-0.5 normal-case tracking-normal text-emerald-800 dark:text-emerald-300" data-testid="run-by-agent"><Sparkles className="h-2.5 w-2.5" aria-hidden />Started from Agent</span>}
            </p>
            <p className="break-words text-sm font-semibold">{run.description}</p>
            <p className={cn("mt-1 flex items-center gap-1.5 text-sm", running ? "" : stopped ? "font-medium text-amber-800 dark:text-amber-300" : "text-muted-foreground")} data-testid="run-status" aria-live="polite">
              {running ? <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />{RUN_STAGE_LABEL[run.stage] ?? "Working"}…</>
                : run.status === "done" ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />Completed · included in your plan</>
                : run.status === "cancelled" ? <><Square className="h-3.5 w-3.5" aria-hidden />Stopped</>
                : <><AlertTriangle className="h-3.5 w-3.5" aria-hidden />Couldn't complete this search</>}
            </p>
            {/* A finished search's own numbers, counted from the prospects shown below. */}
            {!running && good.length > 0 && (
              <p className="mt-1 text-sm" data-testid="run-summary">
                <span className="text-muted-foreground">{stopped ? "Found before it stopped" : "Found"}</span> <strong className="tabular-nums">{good.length}</strong>
                <span className="text-muted-foreground"> · Ready </span><strong className="tabular-nums">{readyN}</strong>
                <span className="text-muted-foreground"> · Qualified </span><strong className="tabular-nums">{qualifiedN}</strong>
                {aside.length > 0 && <span className="text-muted-foreground"> · {aside.length} set aside</span>}
              </p>
            )}
          </div>
          {running && canEdit && <Button size="sm" variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending} data-testid="run-cancel">{cancel.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Square className="mr-1.5 h-3.5 w-3.5" />}Stop</Button>}
        </div>
        {run.status === "done" && good.length < 3 && (
          // Honest about thin results: search coverage varies by market, and nothing is padded or invented to fill the list.
          <p className="rounded-xl border bg-muted/40 px-3 py-2 text-sm text-muted-foreground" role="status" data-testid="run-thin-market">
            {good.length === 0 ? "No companies" : `Only ${good.length} compan${good.length === 1 ? "y" : "ies"}`} passed the checks{run.icp.locations[0] || run.icp.countries.length ? ` in ${run.icp.locations[0] ?? run.icp.countries.map(placeName).join(", ")}` : ""}. Coverage of some markets and niches is thin: try a broader kind of business, a nearby city, or another country.
          </p>
        )}
        {stopped ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200" role="status" data-testid="run-stopped">
            <p>{errorText ?? (run.status === "cancelled" ? "This search was stopped before it finished." : "This search stopped before it finished.")}</p>
            <p className="mt-0.5 text-xs">
              {good.length > 0 ? "What it found before stopping is below. " : "Nothing passed the checks before it stopped. "}
              {canEdit ? "To try again, describe who you want above and start a new search." : "Someone who can run searches can start it again."}
            </p>
          </div>
        ) : errorText ? (
          <p className="text-xs text-amber-700 dark:text-amber-400">{errorText}</p>
        ) : null}
        {running && <StageTrack stage={run.stage} />}
        <Funnel run={run} />
        {good.length > 0 && <p className="text-[11px] text-muted-foreground" data-testid="outbound-ai-disclaimer">AI results may be incomplete or inaccurate. Check important details before contacting a client.</p>}
      </CardContent></Card>

      {good.length === 0 && running && <p className="text-sm text-muted-foreground" aria-live="polite">Companies appear here as they are checked. This usually takes a minute or two.</p>}
      {good.length === 0 && run.status === "done" && <p className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No company passed the checks. Try a broader description, or a different place.</p>}
      {good.length > 0 && (
        <motion.div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" variants={stagger} initial={calm ? false : "hidden"} animate="visible" data-testid="prospect-grid">
          {good.map((p, i) => (
            <motion.div key={p.id} className="min-w-0" variants={staggerItem(i)} initial={firstIds.current?.has(p.id) ? undefined : false}>
              <ProspectCard p={p} canEdit={canEdit} adding={adding === p.id} onOpen={() => onOpen(p)} onEvidence={() => onOpen(p, "evidence")} onAdd={() => add.mutate(p.id)} />
            </motion.div>
          ))}
        </motion.div>
      )}

      {aside.length > 0 && (
        <div>
          <button onClick={() => setShowAside((v) => !v)} aria-expanded={showAside} className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" data-testid="toggle-aside">
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showAside && "rotate-180")} aria-hidden />{showAside ? "Hide" : "Show"} {aside.length} set aside
          </button>
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

/** A search loading: the shape of its header and the first cards, nothing more. */
function RunSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading the search">
      <div className="space-y-3 rounded-2xl border p-4" aria-hidden>
        <Skeleton className="h-3 w-16" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-40" />
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <ProspectCardSkeleton key={i} />)}</div>
    </div>
  );
}

/** No searches yet: what happens, that nothing is contacted, and examples to start from. */
function FirstSearch({ canEdit, onPick, onPreset }: { canEdit: boolean; onPick: (example: string) => void; onPreset: (p: DiscoveryPreset) => void }) {
  return (
    <div className="rounded-2xl border border-dashed px-5 py-10 text-center" data-testid="outbound-first-time">
      <Radar className="mx-auto mb-3 h-7 w-7 text-emerald-700 dark:text-emerald-400" aria-hidden />
      <p className="font-semibold">{canEdit ? "Start by describing the clients you want" : "No searches yet"}</p>
      <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
        {canEdit ? "DealInSec searches the web (or Google Maps, for local businesses in a city), checks each company's own website and keeps only what it can back with evidence. Nothing is contacted: you choose who goes to Leads and what gets sent." : "Searches your team runs show up here, with the evidence behind each company. Nothing is contacted from here."}
      </p>
      {canEdit && (
        <div className="mx-auto mt-4 flex max-w-2xl flex-wrap justify-center gap-2">
          {PRESETS.map((x) => <button key={x.key} onClick={() => onPreset(x)} title={x.note} className={presetChip} data-testid="outbound-preset">{x.label}</button>)}
          {EXAMPLES.map((x) => <button key={x} onClick={() => onPick(x)} className="rounded-full border bg-background px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" data-testid="outbound-example">{x}</button>)}
        </div>
      )}
    </div>
  );
}

export default function OutboundPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { openUpgradeModal } = useUpgradeModal();
  const canEdit = memberCan(user as any, "deals.create");
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedIcp | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  // Two sources, one search: companies found online (web research) or local businesses in a city (map listings). The
  // person chooses; a suggestion never switches it by itself. The country is where to look, never the account's own.
  const [mode, setMode] = useState<DiscoveryMode>("web");
  const [localFields, setLocalFields] = useState<LocalFields>(() => {
    const t = getTargetMarket(user?.id);
    return { category: "", city: "", country: t && t !== "WW" && t in COUNTRY_NAME ? t : "IN", website: "any", max: 10 };
  });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // The drawer: a prospect, and the search it belongs to (research and contact lookups are tied to a run).
  const [open, setOpen] = useState<{ id: number; runId: string | null; focus?: "evidence" } | null>(null);
  const search = useSearch();
  const [location, navigate] = useLocation();
  const viewParam = new URLSearchParams(search).get("view");
  // ?run=<id>: open that search (the agent's "Open in Client Radar" link).
  const runParam = new URLSearchParams(search).get("run");
  useEffect(() => { if (runParam) setRunId(runParam); }, [runParam]);
  const view = viewParam === "prospects" || viewParam === "outreach" || viewParam === "inbox" ? viewParam : "searches";
  const setView = (v: "prospects" | "searches" | "outreach" | "inbox") => navigate(v === "searches" ? location : `${location}?view=${v}`, { replace: true });
  // Client Radar opened (counts only; which view, never a search or a company).
  useEffect(() => { trackEvent("outbound_opened", { view }); }, []);
  const runs = useQuery<{ runs: RunView[] }>({ queryKey: [OUTBOUND_RUNS_URL], retry: false, refetchInterval: (q) => (q.state.data?.runs.some((r) => r.status === "running") ? 5000 : false) });
  // Open the most recent run on arrival, once.
  useEffect(() => { if (!runId && runs.data?.runs.length) setRunId(runs.data.runs[0].id); }, [runs.data, runId]);

  const parse = useMutation({
    mutationFn: (request?: string) => leadCall<ParsedIcp>("POST", ICP_URL, { request: request ?? text }),
    // A request that names no place starts from the market chosen at setup, as a visible, removable chip; "worldwide"
    // (or no choice) leaves it worldwide. Never the person's own account country.
    onSuccess: (r) => {
      const target = getTargetMarket(user?.id);
      if (target && target !== "WW" && !r.icp.countries.length && !r.icp.locations.length) {
        const icp = { ...r.icp, countries: [target] };
        setParsed({ ...r, icp, searches: searchStrategies(icp), fromSetup: true });
      } else setParsed(r);
    },
    onError: (e) => toast({ title: "I couldn't read that", description: leadError(e), variant: "destructive" }),
  });
  // A target typed in the landing demo before signing up: filled in and read once, so the person lands on the profile
  // to confirm (reading it is one model call against the workspace's own allowance; no search starts until they confirm).
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !canEdit) return;
    prefilled.current = true;
    const request = takeOutboundPrefill();
    if (!request) return;
    setText(request);
    trackEvent("outbound_prefill_from_demo");
    parse.mutate(request);
  }, [canEdit]);
  const start = useMutation({
    mutationFn: () => leadCall<{ run: RunView; existing: boolean }>("POST", OUTBOUND_RUNS_URL, { request: text, icp: parsed!.icp, searches: parsed!.searches }),
    onSuccess: (r) => {
      // Counts only: never the request, the profile or a company. first_search marks the workspace's first search in its window.
      if (!r.existing) trackEvent("outbound_search_started", { first_search: (usage.data?.usage.plan?.searches?.used ?? 0) === 0 });
      setRunId(r.run.id); setParsed(null); setText(""); if (view === "prospects") setView("searches"); if (r.existing) toast({ title: "That search is already running" }); void queryClient.invalidateQueries({ queryKey: [OUTBOUND_RUNS_URL] }); void queryClient.invalidateQueries({ queryKey: [OUTBOUND_USAGE_URL] }); },
    // A refusal (a limit reached meanwhile) refreshes the allowance shown, so the page and the server agree again.
    onError: (e) => {
      // Out of the free plan's searches: the upgrade sheet, not an error.
      if (isUpgradeError(parseApiError(e))) openUpgradeModal({ feature: "outbound" });
      else toast({ title: "Couldn't start the search", description: leadError(e), variant: "destructive" });
      void queryClient.invalidateQueries({ queryKey: [OUTBOUND_USAGE_URL] });
    },
  });
  const icp = parsed?.icp;
  const setQty = (n: number) => setParsed((p) => (p ? { ...p, icp: { ...p.icp, quantity: Math.max(1, Math.min(maxCompanies, n || 1)) } } : p));
  const chip = (label: string, onRemove?: () => void) => <span key={label} className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs">{label}{onRemove && <button onClick={onRemove} aria-label={`Remove ${label}`}><X className="h-3 w-3" /></button>}</span>;

  const off = notSetUp(runs.error);
  const usage = useOutboundUsage(canEdit && !off);
  const blocked = searchBlockedReason(usage.data?.usage, mode);
  const localReady = !!usage.data?.usage.localReady;
  // The most companies one search may look for on this plan (the server caps it the same way).
  const maxCompanies = usage.data?.usage.plan?.maxCompanies ?? 50;
  // Where to look is the person's choice (never their own account's country): editing it re-plans the searches with the
  // same rules the server uses (shared/icp.ts searchStrategies).
  const editPlaces = (patch: { countries?: string[]; locations?: string[] }) =>
    setParsed((p) => { if (!p) return p; const next = { ...p.icp, ...patch }; return { ...p, icp: next, searches: searchStrategies(next) }; });
  const [placeText, setPlaceText] = useState("");
  const addLocation = () => {
    const v = placeText.replace(/\s+/g, " ").trim().slice(0, 60);
    if (v && icp && !icp.locations.includes(v) && icp.locations.length < 5) editPlaces({ locations: [...icp.locations, v] });
    setPlaceText("");
  };
  const firstTime = !!runs.data && runs.data.runs.length === 0;
  const pickExample = (x: string) => { setMode("web"); setText(x); setParsed(null); setTimeout(() => inputRef.current?.focus(), 0); };
  const applyPreset = (p: DiscoveryPreset) => {
    trackEvent("outbound_preset_used", { preset: p.key });
    if (p.mode === "local") { setMode("local"); setLocalFields((f) => ({ ...f, ...p.local })); }
    else if (p.request) pickExample(p.request);
  };
  // "Dentists in Siliguri" read as a web search: offer the local source with the same business type and place.
  const suggestLocal = !!icp && localReady && suggestDiscoveryMode(icp) === "local";
  const switchToLocal = () => {
    if (!icp) return;
    trackEvent("outbound_mode_suggested_local");
    setLocalFields((f) => ({ ...f, category: icp.industry.slice(0, 80), city: (icp.locations[0] ?? "").slice(0, 60), country: icp.countries[0] && icp.countries[0] in COUNTRY_NAME ? icp.countries[0] : f.country }));
    setMode("local"); setParsed(null);
  };

  // The flow indicator reads only what this page already holds: the selected search (kept fresh by its panel or the
  // runs list) and outreach lists the Outreach view loaded. These observers never fetch on their own.
  const runCache = useQuery<RunData>({ queryKey: [runId ? runUrl(runId) : "outbound-no-run"], enabled: false });
  const waitingCache = useQuery<{ items: QueueItem[] }>({ queryKey: outreachQueueKey("waiting"), enabled: false });
  const sentCache = useQuery<{ items: QueueItem[] }>({ queryKey: outreachQueueKey("sent"), enabled: false });
  const listed = runs.data?.runs.find((r) => r.id === runId) ?? null;
  const flowRun = view === "searches" ? runCache.data?.run ?? listed : listed ?? runCache.data?.run ?? null;
  const flow = flowState({
    view: view === "inbox" ? "outreach" : view, // the inbox is the outreach step's other half
    composing: parse.isPending ? "reading" : parsed ? "confirming" : null,
    run: flowRun ? { status: flowRun.status, stage: flowRun.stage } : null,
    results: runCache.data ? splitProspects(runCache.data.prospects)[0].length : null,
    anyInLeads: !!runCache.data?.prospects.some((p) => p.leadId),
    queue: waitingCache.data ? { waiting: waitingCache.data.items.length, sent: sentCache.data?.items.length ?? 0 } : null,
  });

  return (
    <div className="min-h-screen bg-background pb-20 lg:pb-12">
      <header className="glass-header sticky top-0 z-40 lg:border-b lg:border-neutral-200/60 dark:lg:border-neutral-800/60">
        <div className="flex items-center justify-between gap-4 px-4 py-4 lg:mx-auto lg:max-w-[1600px] lg:px-8">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight lg:text-2xl">Client Radar <span aria-hidden>🔎</span></h1>
            <p className="mt-0.5 hidden text-sm text-muted-foreground lg:block">Find potential clients for your services: companies that fit, a reason to get in touch now, and the evidence behind each one. You can also ask Agent mode or Nibo to run a search; the results show here.</p>
          </div>
          <NotificationBell className="lg:hidden" />
        </div>
      </header>

      <main className="animate-fade-in space-y-5 px-4 py-5 lg:mx-auto lg:max-w-[1600px] lg:px-8 lg:py-6">
        {off ? (
          <div className="rounded-2xl border px-6 py-14 text-center"><p className="font-semibold">Client Radar isn't switched on yet</p><p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">This workspace is still being set up for it. Try again shortly.</p></div>
        ) : (
          <>
            <FlowSteps state={flow} />

            {canEdit ? (
              <Card className="glass-card"><CardContent className="space-y-3 p-4">
                <SegmentedTabs label="Where to look" value={mode} onChange={(m) => { setMode(m); trackEvent("outbound_mode_changed", { mode: m }); }} className="w-full sm:w-fit"
                  tabs={[
                    { value: "web", label: <><span className="sm:hidden">Companies online</span><span className="hidden sm:inline">Companies online (any country)</span></>, testId: "mode-web" },
                    { value: "local", label: <><span className="sm:hidden">Local businesses</span><span className="hidden sm:inline">Local businesses (a city)</span></>, testId: "mode-local" },
                  ]} />
                {!text && !parsed && !firstTime && !runs.isLoading && <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0" data-testid="outbound-presets">
                  {PRESETS.map((x) => <button key={x.key} onClick={() => applyPreset(x)} title={x.note} className={cn(presetChip, "shrink-0 whitespace-nowrap sm:whitespace-normal")} data-testid="outbound-preset">{x.label}</button>)}
                </div>}
                {mode === "local" ? <>
                  {!localReady && usage.data && <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200" data-testid="local-not-ready">Local business search isn't switched on yet. Search for companies online meanwhile: a city in your request still narrows it.</p>}
                  <LocalSearch fields={localFields} onChange={setLocalFields} blocked={blocked} maxCompanies={maxCompanies} onOpenProspect={(id) => setOpen({ id, runId: null })}
                    onResearchStarted={(id) => { setRunId(id); if (view !== "searches") setView("searches"); setTimeout(() => document.getElementById("outbound-run")?.scrollIntoView({ behavior: "smooth", block: "start" }), 150); }} />
                  <UsageNote usage={usage.data?.usage} mode="local" />
                </> : <>
                <label htmlFor="outbound-request" className="text-sm font-semibold">Describe the type of client you're looking for</label>
                <Textarea ref={inputRef} id="outbound-request" value={text} onChange={(e) => { setText(e.target.value); setParsed(null); }} rows={2} maxLength={500}
                  placeholder="For example: US SEO agencies with 5–30 employees serving SaaS companies" disabled={parse.isPending || start.isPending} data-testid="outbound-input" />
                {!text && !firstTime && !runs.isLoading && <div className="flex flex-wrap gap-2">
                  {EXAMPLES.map((x) => <button key={x} onClick={() => pickExample(x)} className="rounded-full border px-3 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">{x}</button>)}
                </div>}
                <UsageNote usage={usage.data?.usage} />
                {!parsed ? (
                  <Button onClick={() => parse.mutate(undefined)} disabled={text.trim().length < 3 || parse.isPending || !!blocked} className="gradient-btn text-white" data-testid="outbound-find">
                    {parse.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}Find prospects
                  </Button>
                ) : icp && (
                  <div className="space-y-3 rounded-xl border bg-muted/30 p-3" data-testid="icp-confirm">
                    <p className="text-sm font-medium">Here's what I'll look for. Change anything before I start.</p>
                    <div className="flex flex-wrap gap-1.5">
                      {chip(icp.industry)}
                      {icp.countries.map((c) => chip(countryName(c), () => editPlaces({ countries: icp.countries.filter((x) => x !== c) })))}
                      {icp.locations.map((l) => chip(l, () => editPlaces({ locations: icp.locations.filter((x) => x !== l) })))}
                      {!icp.countries.length && !icp.locations.length && chip("Anywhere (worldwide)")}
                      {(icp.employeeMin || icp.employeeMax) && chip(icp.employeeMin && icp.employeeMax ? `${icp.employeeMin}–${icp.employeeMax} people` : icp.employeeMax ? `up to ${icp.employeeMax} people` : `${icp.employeeMin}+ people`)}
                      {icp.targetMarket.map((m) => chip(`serves ${m}`))}
                      {icp.exclusions.map((x) => chip(`not ${x}`))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2" data-testid="outbound-places">
                      <label className="sr-only" htmlFor="outbound-add-country">Add a country to search</label>
                      <select id="outbound-add-country" value="" disabled={icp.countries.length >= 5} onChange={(e) => { const c = e.target.value; if (c && !icp.countries.includes(c)) editPlaces({ countries: [...icp.countries, c] }); }}
                        className="h-8 rounded-md border bg-background px-2 text-xs" data-testid="outbound-add-country">
                        <option value="">+ Add a country</option>
                        {Object.entries(COUNTRY_NAME).filter(([c]) => !icp.countries.includes(c)).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                      </select>
                      <input value={placeText} onChange={(e) => setPlaceText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLocation(); } }} onBlur={addLocation}
                        placeholder="+ City or region (optional)" aria-label="Add a city or region" maxLength={60} disabled={icp.locations.length >= 5}
                        className="h-8 w-48 rounded-md border bg-background px-2 text-xs" data-testid="outbound-add-location" />
                    </div>
                    {parsed.fromSetup && icp.countries.length > 0 && <p className="text-xs text-muted-foreground" data-testid="outbound-from-setup">The country comes from the market you chose at setup. Remove it to search worldwide.</p>}
                    {!icp.countries.length && !icp.locations.length && <p className="text-xs text-muted-foreground" data-testid="outbound-worldwide">Searching worldwide. Pick a country (the US, the UK, Canada, Australia, the UAE, India…) for more relevant companies.</p>}
                    <p className="text-xs text-muted-foreground">Reaching: {icp.roles.slice(0, 4).join(", ") || "decision makers"} · {parsed.searches.length} searches planned{parsed.source === "rules" ? " · read by simple rules (the AI was unavailable)" : ""}</p>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-sm">How many <input type="number" min={1} max={maxCompanies} value={icp.quantity} onChange={(e) => setQty(Number(e.target.value))} className="w-16 rounded-md border bg-background px-2 py-1 text-sm" data-testid="outbound-quantity" /></label>
                      <Button onClick={() => start.mutate()} disabled={start.isPending || !!blocked} className="gradient-btn text-white" data-testid="outbound-start">{start.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-1.5 h-4 w-4" />}Start search</Button>
                      <Button variant="ghost" onClick={() => setParsed(null)}>Change</Button>
                    </div>
                    {suggestLocal && <p className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs dark:border-emerald-900 dark:bg-emerald-950/30" data-testid="outbound-suggest-local">
                      This looks like local businesses in a place. Map listings usually find more of them than web search.
                      <Button type="button" size="sm" variant="outline" className="h-8" onClick={switchToLocal}>Search local businesses instead</Button>
                    </p>}
                    <p className="text-xs text-muted-foreground">Starting a search only looks companies up. Nobody is contacted.</p>
                  </div>
                )}
                </>}
              </CardContent></Card>
            ) : (
              <p className="text-sm text-muted-foreground">You can see searches your team ran. Ask the workspace owner for permission to start one.</p>
            )}

            <SegmentedTabs label="Client Radar views" value={view} onChange={setView}
              tabs={[{ value: "searches", label: "Searches", testId: "view-searches" }, { value: "prospects", label: "All prospects", testId: "view-prospects" }, { value: "outreach", label: "Outreach", testId: "view-outreach" }, { value: "inbox", label: "Inbox", testId: "view-inbox" }]} />

            {view === "inbox" ? <OutreachInbox />
              : view === "outreach" ? <OutreachQueue canEdit={canEdit} onShowReady={() => navigate(`${location}?view=prospects&readiness=ready`, { replace: true })} />
              : view === "prospects" ? <ProspectWorkspace canExport={canEdit} onOpen={(r, focus) => setOpen({ id: r.id, runId: r.latestRunId, focus })} onPrepared={() => setView("outreach")} /> : <>
            {runs.data && runs.data.runs.length > 1 && (
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0" role="tablist" aria-label="Recent searches">
                {runs.data.runs.slice(0, 8).map((r) => (
                  <button key={r.id} role="tab" aria-selected={runId === r.id} onClick={() => setRunId(r.id)} className={cn("inline-flex max-w-[16rem] shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors", runId === r.id ? "border-emerald-600 bg-emerald-600 text-white" : "border-border bg-background hover:bg-muted")}>
                    {r.status === "running" && <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-label="Running" />}
                    {r.by === "agent" && <Sparkles className="h-3 w-3 shrink-0" aria-label="Started from Agent" />}
                    <span className="truncate">{r.description}</span>
                  </button>
                ))}
              </div>
            )}

            <div id="outbound-run" className="scroll-mt-20" />
            {runId ? <RunPanel key={runId} id={runId} canEdit={canEdit} onOpen={(p, focus) => setOpen({ id: p.id, runId, focus })} />
              : runs.isLoading ? <RunSkeleton />
              : runs.isError && !runs.data ? <Card className="glass-card"><CardContent className="p-0"><LoadError what="your searches" onRetry={() => void runs.refetch()} retrying={runs.isFetching} /></CardContent></Card>
              : <FirstSearch canEdit={canEdit} onPick={pickExample} onPreset={applyPreset} />}
            </>}
          </>
        )}
      </main>
      <ProspectBrief id={open?.id ?? null} runId={open?.runId ?? null} open={!!open} onOpenChange={(o) => !o && setOpen(null)} canEdit={canEdit} focus={open?.focus ?? null} />
      <BottomNav />
    </div>
  );
}
