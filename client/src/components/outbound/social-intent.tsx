/**
 * Social Intent: people publicly asking for the kind of work you sell (the /api/social endpoints).
 *
 * The page is honest about three things, in the open rather than in a tooltip:
 *   - which sources are really connected here, and which platforms cannot be searched by anyone through an
 *     authorised route (LinkedIn, Facebook, Instagram) — for those, you paste a post's link and text yourself;
 *   - what a score is: points for what the post actually says, with what it doesn't say shown as unknown, and
 *     never a forecast of who will buy;
 *   - what a post is: something a person said in public. It is a reason to look, not permission to message them.
 *     Nothing here contacts anyone.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Ban, Check, ChevronDown, CircleSlash, Copy, ExternalLink, Link2, Loader2, Pause, Play, Plus, Radar, Search, Trash2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useUpgradeModal } from "@/components/upgrade-modal";
import { trackEvent } from "@/lib/analytics";
import { isUpgradeError, parseApiError } from "@/lib/api-error";
import { leadCall, leadError, refreshLeads } from "@/lib/leads";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { IntentCategory, SocialPlatformId, SocialScore } from "@shared/social-intent";

const OVERVIEW_URL = "/api/social/overview";
const LIST_URL = "/api/social/opportunities";
const PROFILES_URL = "/api/social/profiles";
const SCAN_URL = "/api/social/scan";

interface Platform { id: SocialPlatformId; label: string; mode: "search" | "manual"; connected: boolean; paid: boolean; access: string; limitation: string }
interface Overview {
  platforms: Platform[];
  allowance: { used: number; limit: number; remaining: number; windowDays: number; nextFreesAt: string | null; tier: string; label: string } | null;
  stats: { total: number; fresh: number; high: number; saved: number };
  services: string[]; highIntentScore: number; scheduleEnabled: boolean;
}
interface Opportunity {
  id: number; source: SocialPlatformId; sourceLabel: string; origin: "scan" | "manual"; url: string; community: string | null; title: string; excerpt: string;
  postedAt: string | null; discoveredAt: string; lastSeenAt: string;
  intent: IntentCategory; intentLabel: string; intentMatched: string | null; service: string | null;
  signals: { budget?: string | null; urgency?: string | null; unpaid?: boolean };
  score: number; scoreDetail: SocialScore | null; highIntent: boolean; companyUrl: string | null;
  status: "new" | "saved" | "ignored" | "contacted"; leadId: number | null;
}
interface Profile { id: number; name: string; services: string[]; keywords: string[]; platforms: SocialPlatformId[]; minScore: number; status: "active" | "paused"; schedule: "off" | "daily" | "weekly"; lastRunAt: string | null; nextRunAt: string | null }
interface ScanSummary { read: number; kept: number; fresh: number; sources: { name: string; ok: boolean; posts: number; error?: string }[] }

const INTENT_TONE: Record<string, string> = {
  hiring: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  recommendation: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  partnership: "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  problem: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  discussion: "border-border bg-muted text-muted-foreground", offer: "border-border bg-muted text-muted-foreground",
};
const SOURCE_PROBLEM: Record<string, string> = {
  auth: "its key wasn't accepted", rate_limited: "busy, or its limit was reached", unavailable: "couldn't be reached", bad_response: "sent something unreadable", timeout: "took too long", aborted: "took too long",
  daily_limit: "today's web searches are used", global_limit: "today's web searches are used up for everyone", workspace_budget: "this period's usage limit is reached",
};
const ago = (iso: string | null): string => {
  if (!iso) return "date not given";
  const d = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  return d === 0 ? "today" : d === 1 ? "yesterday" : d < 31 ? `${d} days ago` : new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};
const split = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter((x) => x.length >= 2).slice(0, 8);
const refresh = () => {
  void queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/social/") });
};

export function SocialIntent({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const { openUpgradeModal } = useUpgradeModal();
  const overview = useQuery<{ overview: Overview }>({ queryKey: [OVERVIEW_URL], retry: false });
  const [status, setStatus] = useState<"open" | "ignored">("open");
  const [intent, setIntent] = useState<string>("");
  const listKey = `${LIST_URL}?status=${status === "ignored" ? "ignored" : "new,saved,contacted"}${intent ? `&intent=${intent}` : ""}`;
  const list = useQuery<{ opportunities: Opportunity[]; total: number }>({ queryKey: [listKey], retry: false });
  const profiles = useQuery<{ profiles: Profile[] }>({ queryKey: [PROFILES_URL], retry: false });

  const o = overview.data?.overview;
  const [services, setServices] = useState<string | null>(null);
  const [keywords, setKeywords] = useState("");
  const [off, setOff] = useState<Set<string>>(new Set()); // searchable platforms the person switched off for this scan
  const [last, setLast] = useState<ScanSummary | null>(null);
  const [adding, setAdding] = useState(false);
  const [manual, setManual] = useState({ url: "", text: "" });
  const [showSources, setShowSources] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");

  const servicesText = services ?? (o?.services ?? []).join(", ");
  const searchable = (o?.platforms ?? []).filter((p) => p.mode === "search");
  const connected = searchable.filter((p) => p.connected);
  const picked = connected.filter((p) => !off.has(p.id)).map((p) => p.id);
  const refusal = (title: string) => (e: unknown) => {
    if (isUpgradeError(parseApiError(e))) openUpgradeModal({ feature: "outbound" });
    else toast({ title, description: leadError(e), variant: "destructive" });
    refresh();
  };

  const scan = useMutation({
    mutationFn: (body: Record<string, unknown>) => leadCall<{ scan: ScanSummary }>("POST", SCAN_URL, body),
    onSuccess: (r) => {
      setLast(r.scan); refresh();
      // Counts only: never the services searched for or anything a post said.
      trackEvent("social_scan_done", { kept: r.scan.kept, fresh: r.scan.fresh });
      toast({ title: r.scan.fresh ? `${r.scan.fresh} new ${r.scan.fresh === 1 ? "ask" : "asks"} for your services` : r.scan.kept ? "Nothing new since your last scan" : "No one is asking for that right now", description: `Read ${r.scan.read} posts, kept ${r.scan.kept}.` });
    },
    onError: refusal("The scan didn't run"),
  });
  const act = useMutation({
    mutationFn: (a: { id: number; kind: "status" | "lead" | "delete"; status?: string }) =>
      a.kind === "delete" ? leadCall("DELETE", `${LIST_URL}/${a.id}`) : a.kind === "lead" ? leadCall<{ leadId: number; existing: boolean }>("POST", `${LIST_URL}/${a.id}/lead`, {}) : leadCall("POST", `${LIST_URL}/${a.id}/status`, { status: a.status }),
    onSuccess: (r: any, a) => {
      refresh();
      if (a.kind === "lead") { void refreshLeads(); toast({ title: r.existing ? "Already in your leads" : "Saved to Leads", description: "The post is attached as the lead's evidence." }); }
    },
    onError: refusal("That didn't work"),
  });
  const addManual = useMutation({
    mutationFn: () => leadCall<{ existing: boolean }>("POST", LIST_URL, manual),
    onSuccess: (r) => { setManual({ url: "", text: "" }); setAdding(false); refresh(); toast({ title: r.existing ? "You'd already added that post" : "Post added" }); },
    onError: refusal("Couldn't add that post"),
  });
  const saveProfile = useMutation({
    mutationFn: () => leadCall("POST", PROFILES_URL, { name: saveName, services: split(servicesText), keywords: split(keywords), platforms: picked }),
    onSuccess: () => { setSaving(false); setSaveName(""); refresh(); toast({ title: "Search saved" }); },
    onError: refusal("Couldn't save that search"),
  });
  const profileAct = useMutation({
    mutationFn: (a: { id: number; kind: "patch" | "duplicate" | "delete"; body?: Record<string, unknown> }) =>
      a.kind === "delete" ? leadCall("DELETE", `${PROFILES_URL}/${a.id}`) : a.kind === "duplicate" ? leadCall("POST", `${PROFILES_URL}/${a.id}/duplicate`, {}) : leadCall("PATCH", `${PROFILES_URL}/${a.id}`, a.body),
    onSuccess: () => refresh(),
    onError: refusal("That didn't work"),
  });

  if (overview.isLoading) return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>;
  if (overview.error || !o) {
    const notSetUp = !!overview.error && /SOCIAL_NOT_SETUP/.test(String((overview.error as Error).message));
    return <p className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground" data-testid="social-unavailable">{notSetUp ? "Social Intent isn't switched on for this server yet." : "Social Intent couldn't be loaded. Try again in a moment."}</p>;
  }

  const outOfScans = !!o.allowance && o.allowance.remaining <= 0;
  const noSource = picked.length === 0;
  const canScan = canEdit && !scan.isPending && split(servicesText).length > 0 && !noSource && !outOfScans;
  const rows = list.data?.opportunities ?? [];

  return (
    <div className="space-y-5" data-testid="social-intent">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Radar className="h-5 w-5 text-primary" aria-hidden />People asking for your work</h2>
        <p className="mt-1 text-sm text-muted-foreground">Public posts where someone asks to hire, asks for a recommendation, or describes a problem you solve. Each one links to the original post. Nobody is contacted from here.</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="social-stats">
        {([["Open", o.stats.total], ["New", o.stats.fresh], [`High intent (${o.highIntentScore}+)`, o.stats.high], ["Saved or contacted", o.stats.saved]] as const).map(([label, n]) => (
          <div key={label} className="rounded-xl border bg-background px-3 py-2"><div className="text-xl font-semibold tabular-nums">{n}</div><div className="text-xs text-muted-foreground">{label}</div></div>
        ))}
      </div>

      {canEdit && (
        <div className="space-y-3 rounded-2xl border bg-background p-4" data-testid="social-scan-form">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm"><span className="font-medium">What you offer</span>
              <Input value={servicesText} onChange={(e) => setServices(e.target.value)} placeholder="web design, React development, SEO" maxLength={300} data-testid="social-services" />
              <span className="block text-xs text-muted-foreground">Separate with commas. Only posts that mention one of these are kept.</span>
            </label>
            <label className="space-y-1 text-sm"><span className="font-medium">Extra words to match <span className="font-normal text-muted-foreground">(optional)</span></span>
              <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="Next.js, Shopify, landing page" maxLength={300} data-testid="social-keywords" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Look in</span>
            {searchable.map((p) => p.connected ? (
              <button key={p.id} type="button" role="switch" aria-checked={!off.has(p.id)} onClick={() => setOff((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} data-testid={`social-source-${p.id}`}
                className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition", off.has(p.id) ? "text-muted-foreground" : "border-primary bg-primary/5 font-medium")}>
                {off.has(p.id) ? <CircleSlash className="h-3 w-3" aria-hidden /> : <Check className="h-3 w-3" aria-hidden />}{p.label}{p.paid && <span className="font-normal text-muted-foreground">· uses web searches</span>}
              </button>
            ) : (
              <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground" title={p.limitation} data-testid={`social-source-${p.id}-off`}><Ban className="h-3 w-3" aria-hidden />{p.label} · not connected</span>
            ))}
            <button type="button" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => setShowSources((v) => !v)} aria-expanded={showSources} data-testid="social-sources-toggle">What about LinkedIn and Facebook?<ChevronDown className={cn("h-3 w-3 transition", showSources && "rotate-180")} aria-hidden /></button>
          </div>
          {showSources && (
            <ul className="space-y-2 rounded-xl bg-muted/40 p-3 text-xs" data-testid="social-sources">
              {o.platforms.map((p) => (
                <li key={p.id}><span className="font-medium">{p.label}</span> <span className="text-muted-foreground">— {p.mode === "manual" ? "can't be searched automatically" : p.connected ? "connected" : "not connected here"}.</span> {p.access} <span className="text-muted-foreground">{p.limitation}</span></li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => scan.mutate({ services: split(servicesText), keywords: split(keywords), platforms: picked })} disabled={!canScan} className="gradient-btn text-white" data-testid="social-scan">
              {scan.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}{scan.isPending ? "Reading posts…" : "Scan now"}
            </Button>
            <Button variant="outline" onClick={() => setSaving((v) => !v)} disabled={split(servicesText).length === 0} data-testid="social-save-toggle"><Plus className="mr-1.5 h-4 w-4" />Save this search</Button>
            <Button variant="ghost" onClick={() => setAdding((v) => !v)} data-testid="social-add-toggle"><Link2 className="mr-1.5 h-4 w-4" />Add a post by link</Button>
            {o.allowance && <span className="text-xs text-muted-foreground" data-testid="social-allowance">{o.allowance.remaining} of {o.allowance.limit} scans left in the last {o.allowance.windowDays} days</span>}
          </div>
          {noSource && <p className="text-xs text-amber-700 dark:text-amber-400" role="status">{connected.length ? "Pick at least one source to look in." : "No source is connected on this server yet, so there is nothing to scan. You can still add posts by link."}</p>}
          {outOfScans && <p className="text-xs text-amber-700 dark:text-amber-400" role="status" data-testid="social-out">You've used this period's scans.{o.allowance?.nextFreesAt ? ` The next one frees up ${new Date(o.allowance.nextFreesAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}.` : ""}{o.allowance?.tier === "free" && <> <Link href="/pricing" className="font-semibold text-primary hover:underline">Pro includes more</Link>.</>}</p>}
          {saving && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/40 p-3">
              <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Name it, for example “React work”" maxLength={80} className="max-w-xs" data-testid="social-save-name" />
              <Button size="sm" onClick={() => saveProfile.mutate()} disabled={!saveName.trim() || saveProfile.isPending} data-testid="social-save">Save</Button>
            </div>
          )}
          {adding && (
            <div className="space-y-2 rounded-xl bg-muted/40 p-3" data-testid="social-add-form">
              <p className="text-xs text-muted-foreground">For a post you found yourself — on LinkedIn, Facebook, Instagram or anywhere. Paste its link and its text. DealInSec reads the text you paste and never opens the link.</p>
              <Input value={manual.url} onChange={(e) => setManual((m) => ({ ...m, url: e.target.value }))} placeholder="https://www.linkedin.com/posts/…" maxLength={500} data-testid="social-add-url" />
              <Textarea value={manual.text} onChange={(e) => setManual((m) => ({ ...m, text: e.target.value }))} placeholder="Paste what the post says" rows={3} maxLength={4000} data-testid="social-add-text" />
              <Button size="sm" onClick={() => addManual.mutate()} disabled={addManual.isPending || manual.url.trim().length < 8 || manual.text.trim().length < 20} data-testid="social-add">{addManual.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Add post</Button>
            </div>
          )}
          {last && (
            <p className="text-xs text-muted-foreground" role="status" data-testid="social-last-scan">
              Last scan read {last.read} posts and kept {last.kept} ({last.fresh} new).{" "}
              {last.sources.map((s) => `${o.platforms.find((p) => p.id === s.name)?.label ?? s.name}: ${s.ok ? `${s.posts} read` : SOURCE_PROBLEM[s.error ?? ""] ?? "had a problem"}`).join(" · ")}
            </p>
          )}
        </div>
      )}

      {(profiles.data?.profiles.length ?? 0) > 0 && (
        <div className="space-y-2" data-testid="social-profiles">
          <h3 className="text-sm font-semibold">Saved searches</h3>
          {profiles.data!.profiles.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl border bg-background px-3 py-2 text-sm" data-testid="social-profile">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.name}{p.status === "paused" && <span className="ml-2 text-xs font-normal text-muted-foreground">paused</span>}</div>
                <div className="truncate text-xs text-muted-foreground">{p.services.join(", ")}{p.lastRunAt ? ` · last scanned ${ago(p.lastRunAt)}` : " · not scanned yet"}{p.schedule !== "off" && p.nextRunAt && p.status === "active" ? ` · next ${new Date(p.nextRunAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}</div>
              </div>
              {canEdit && <>
                {o.scheduleEnabled ? (
                  <select value={p.schedule} onChange={(e) => profileAct.mutate({ id: p.id, kind: "patch", body: { schedule: e.target.value } })} className="h-8 rounded-md border bg-background px-2 text-xs" aria-label={`How often to scan ${p.name}`} data-testid="social-profile-schedule">
                    <option value="off">Only when I ask</option><option value="daily">Every day</option><option value="weekly">Every week</option>
                  </select>
                ) : <span className="text-xs text-muted-foreground" title="Scheduled scans aren't switched on for this server">Runs when you ask</span>}
                <Button size="sm" variant="outline" className="h-8" onClick={() => scan.mutate({ profileId: p.id })} disabled={scan.isPending || outOfScans || p.status === "paused"} data-testid="social-profile-run"><Search className="mr-1 h-3.5 w-3.5" />Scan</Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => profileAct.mutate({ id: p.id, kind: "patch", body: { status: p.status === "paused" ? "active" : "paused" } })} aria-label={p.status === "paused" ? `Resume ${p.name}` : `Pause ${p.name}`} data-testid="social-profile-pause">{p.status === "paused" ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}</Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => profileAct.mutate({ id: p.id, kind: "duplicate" })} aria-label={`Duplicate ${p.name}`} data-testid="social-profile-duplicate"><Copy className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => profileAct.mutate({ id: p.id, kind: "delete" })} aria-label={`Delete ${p.name}`} data-testid="social-profile-delete"><Trash2 className="h-4 w-4" /></Button>
              </>}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {([["", "All"], ["hiring", "Wants to hire"], ["recommendation", "Recommendation"], ["partnership", "Partner"], ["problem", "Problem"]] as const).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setIntent(v)} aria-pressed={intent === v} className={cn("rounded-full border px-2.5 py-1 transition", intent === v ? "border-primary bg-primary/5 font-medium" : "text-muted-foreground hover:bg-muted/50")} data-testid={`social-filter-${v || "all"}`}>{label}</button>
          ))}
          <button type="button" onClick={() => setStatus((s) => (s === "open" ? "ignored" : "open"))} className="ml-auto text-muted-foreground hover:underline" data-testid="social-toggle-ignored">{status === "open" ? "Show ignored" : "Back to open"}</button>
        </div>

        {list.isLoading ? <Skeleton className="h-32 w-full" /> : rows.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="social-empty">
            {status === "ignored" ? "Nothing ignored." : o.stats.total === 0 ? "No opportunities yet. Run a scan, or add a post you found by its link." : "Nothing matches that filter."}
          </p>
        ) : rows.map((r) => <OpportunityCard key={r.id} r={r} canEdit={canEdit} busy={act.isPending} onAct={(kind, s) => act.mutate({ id: r.id, kind, status: s })} />)}
        <p className="text-xs text-muted-foreground">A score ranks what to read first from what a post says. It is not a prediction that anyone will buy. Opportunities you don't save or mark contacted are removed after 60 days.</p>
      </div>
    </div>
  );
}

function OpportunityCard({ r, canEdit, busy, onAct }: { r: Opportunity; canEdit: boolean; busy: boolean; onAct: (kind: "status" | "lead" | "delete", status?: string) => void }) {
  const [open, setOpen] = useState(false);
  const unknown = (r.scoreDetail?.components ?? []).filter((c) => c.points === null);
  return (
    <div className={cn("space-y-2 rounded-2xl border bg-background p-4", r.highIntent && r.status === "new" && "border-emerald-300 dark:border-emerald-800")} data-testid="social-opportunity">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">{r.sourceLabel}</span>
            {r.community && <span>· {r.community}</span>}
            <span title={r.postedAt ? new Date(r.postedAt).toLocaleString() : "The source gives no date for this post"}>· {r.postedAt ? `posted ${ago(r.postedAt)}` : "post date not given"}</span>
            <span title={new Date(r.discoveredAt).toLocaleString()}>· found {ago(r.discoveredAt)}</span>
            {r.origin === "manual" && <span>· added by you</span>}
          </div>
          <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" className="mt-0.5 block font-medium hover:underline" data-testid="social-opportunity-title">{r.title}</a>
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="shrink-0 rounded-xl border px-2.5 py-1 text-center" data-testid="social-score" title="How this score was worked out">
          <div className="text-lg font-semibold tabular-nums leading-none">{r.score}</div>
          <div className="text-[10px] text-muted-foreground">of 100</div>
        </button>
      </div>
      <p className="text-sm text-muted-foreground">“{r.excerpt}”</p>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className={cn("rounded-full border px-2 py-0.5 font-medium", INTENT_TONE[r.intent] ?? INTENT_TONE.discussion)} data-testid="social-intent-badge">{r.intentLabel}</span>
        {r.service && <span className="rounded-full border px-2 py-0.5">About: {r.service}</span>}
        {r.signals?.budget && <span className="rounded-full border px-2 py-0.5">Budget: {r.signals.budget}</span>}
        {r.signals?.unpaid && <span className="rounded-full border px-2 py-0.5 text-muted-foreground">Says unpaid</span>}
        {r.signals?.urgency && <span className="rounded-full border px-2 py-0.5">Timing: {r.signals.urgency}</span>}
        {r.status !== "new" && <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{r.status === "saved" ? "In Leads" : r.status === "contacted" ? "Contacted" : "Ignored"}</span>}
      </div>
      {open && r.scoreDetail && (
        <div className="space-y-1 rounded-xl bg-muted/40 p-3 text-xs" data-testid="social-score-detail">
          {r.scoreDetail.components.map((c) => (
            <div key={c.key} className="flex gap-2"><span className="w-14 shrink-0 tabular-nums font-medium">{c.points === null ? "unknown" : `${c.points}/${c.max}`}</span><span><span className="font-medium">{c.label}.</span> <span className="text-muted-foreground">{c.reason}</span></span></div>
          ))}
          {unknown.length > 0 && <p className="pt-1 text-muted-foreground">“Unknown” means the post doesn't say. It adds no points and is not counted against the post.</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs font-medium hover:bg-muted/50" data-testid="social-open"><ExternalLink className="h-3.5 w-3.5" />View the post</a>
        {r.leadId ? <Link href={`/leads/${r.leadId}`} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs font-medium hover:bg-muted/50" data-testid="social-lead-link">Open the lead</Link>
          : canEdit && <Button size="sm" className="h-8" onClick={() => onAct("lead")} disabled={busy} data-testid="social-save-lead"><UserPlus className="mr-1 h-3.5 w-3.5" />Save to Leads</Button>}
        {canEdit && r.status !== "contacted" && <Button size="sm" variant="outline" className="h-8" onClick={() => onAct("status", "contacted")} disabled={busy} data-testid="social-contacted"><Check className="mr-1 h-3.5 w-3.5" />Mark contacted</Button>}
        {canEdit && (r.status === "ignored"
          ? <Button size="sm" variant="ghost" className="h-8" onClick={() => onAct("status", "new")} disabled={busy} data-testid="social-restore">Restore</Button>
          : r.status === "new" && <Button size="sm" variant="ghost" className="h-8" onClick={() => onAct("status", "ignored")} disabled={busy} data-testid="social-ignore"><X className="mr-1 h-3.5 w-3.5" />Ignore</Button>)}
        {canEdit && <Button size="icon" variant="ghost" className="ml-auto h-8 w-8 text-muted-foreground" onClick={() => onAct("delete")} disabled={busy} aria-label="Remove this opportunity for good" data-testid="social-delete"><Trash2 className="h-4 w-4" /></Button>}
      </div>
      {r.leadId && <p className="text-xs text-muted-foreground">Saved as a lead with this post as its evidence. Draft a first message from the lead; you approve and send it yourself.</p>}
    </div>
  );
}
