/**
 * Campaigns (the /api/campaigns endpoints): a named group of leads written to together.
 *
 * The page is plain about what a campaign is and isn't:
 *   - drafts are prepared for you in the background, within your plan's AI drafts; a lead that can't be written to
 *     is skipped and says why;
 *   - every message is read and approved one at a time, on the same screen as any other outreach message. There is
 *     no "approve all";
 *   - where this server allows a sending queue, approved messages leave from YOUR Gmail at a steady pace and the
 *     queue stops itself on anything that needs you. Where it doesn't, you send each approved message yourself.
 * On a server where campaigns aren't set up the tab says so and nothing else changes.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AlertTriangle, Archive, ArrowLeft, Ban, CheckCircle2, CircleDashed, Loader2, MailCheck, Megaphone, Pause, PenLine, Play, Plus, Search, Send, Square, X } from "lucide-react";
import { OutreachPanel } from "@/components/leads/outreach-panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { trackEvent } from "@/lib/analytics";
import { leadCall, leadError } from "@/lib/leads";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { SenderCheck as SenderCheckView } from "@shared/sender-check";
import { CAMPAIGN_MAX_MEMBERS, DAILY_LIMIT, FOOTER_NOTE_MAX, GAP_SECONDS, OPT_OUT_LINE, type CampaignCounts, type CampaignRates, type MemberStage } from "@shared/campaign";

const CAMPAIGNS_URL = "/api/campaigns";
const campaignUrl = (id: number, action = "") => `${CAMPAIGNS_URL}/${id}${action ? `/${action}` : ""}`;

interface Campaign {
  id: number; name: string; profileName: string | null; status: "active" | "archived"; footerNote: string; dailyLimit: number; gapSeconds: number;
  preparing: boolean; prepareStop: string | null; prepareStopLabel: string | null; sending: boolean; sendStop: string | null; sendStopLabel: string | null; nextSendAt: string | null;
  createdAt: string; counts: CampaignCounts; rates: CampaignRates;
}
interface Member {
  leadId: number; companyName: string; domain: string | null; contactName: string | null; leadStatus: string | null; stage: MemberStage; stageLabel: string; note: string | null;
  message: { id: number; status: string; subject: string | null; to: string | null; edited: boolean; approvedAt: string | null; sentAt: string | null } | null;
  outcomes: string[]; interested: boolean;
  /** Older servers omit it. */
  followUp?: { state: "due_later" | "to_review" | "approved" | "on_hold"; label: string; dueAt: string | null; waiting: boolean } | null;
}
interface ListResponse { campaigns: Campaign[]; queueEnabled: boolean; unsubscribeLinks?: boolean }
interface DetailResponse { campaign: Campaign; members: Member[]; queueEnabled: boolean; followUps?: { waiting: number; planned: number } }
interface AudienceLead { id: number; companyName: string; domain: string | null; industry: string | null; location: string | null; status: string; source: string; contactName: string | null; hasEmail: boolean; hasUnsent: boolean; blocked: string | null; /** Older servers omit these two. */ profileName?: string | null; ready?: boolean }

const STAGE_TONE: Record<MemberStage, string> = {
  queued: "border-border text-muted-foreground", skipped: "border-border bg-muted text-muted-foreground", failed: "border-rose-300 text-rose-700 dark:border-rose-800 dark:text-rose-400",
  draft: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  approved: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  sending: "border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200",
  sent: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  discarded: "border-border bg-muted text-muted-foreground",
};
const STAGE_ICON: Record<MemberStage, typeof Send> = { queued: CircleDashed, skipped: Ban, failed: AlertTriangle, draft: PenLine, approved: CheckCircle2, sending: AlertTriangle, sent: MailCheck, discarded: X };
const OUTCOME: Record<string, string> = { replied: "Replied", bounced: "Bounced", opted_out: "Asked to stop" };
const pct = (n: number | null) => (n === null ? "–" : `${n}%`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const refresh = (id?: number) => { void queryClient.invalidateQueries({ queryKey: [CAMPAIGNS_URL] }); if (id) void queryClient.invalidateQueries({ queryKey: [campaignUrl(id)] }); };

/** "12 leads · 5 to review · 3 approved · 4 sent · 1 reply" — only the parts that aren't zero. */
function countsLine(c: CampaignCounts): string {
  return [plural(c.members, "lead"), c.queued ? `${c.queued} waiting for a draft` : "", c.draft ? `${c.draft} to review` : "", c.approved ? `${c.approved} approved` : "", c.sent ? `${c.sent} sent` : "", c.replied ? plural(c.replied, "reply", "replies") : "", c.skipped ? `${c.skipped} skipped` : ""].filter(Boolean).join(" · ");
}

function StateChips({ c }: { c: Campaign }) {
  return (
    <>
      {c.status === "archived" && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Archived</span>}
      {c.preparing && <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"><Loader2 className="h-3 w-3 animate-spin" aria-hidden />Preparing drafts</span>}
      {c.sending && <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"><Send className="h-3 w-3" aria-hidden />Sending</span>}
    </>
  );
}

/* ── new campaign ───────────────────────────────────────────────────────── */

function NewCampaign({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: number) => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [profileId, setProfileId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [source, setSource] = useState("");
  const [emailOnly, setEmailOnly] = useState(false);
  // Who Client Radar found for a saved client profile, and which of them it marked Ready (asked of the server).
  const [fromProfile, setFromProfile] = useState<number | null>(null);
  const [readyOnly, setReadyOnly] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const params = new URLSearchParams(); if (search.trim()) params.set("q", search.trim()); if (stage) params.set("status", stage); if (source) params.set("source", source);
  if (fromProfile) params.set("profileId", String(fromProfile)); if (readyOnly) params.set("ready", "1");
  const audienceKey = `${CAMPAIGNS_URL}/audience${params.toString() ? `?${params}` : ""}`;
  const audience = useQuery<{ leads: AudienceLead[]; limit: number }>({ queryKey: [audienceKey], enabled: open, retry: false });
  const profiles = useQuery<{ profiles: { id: number; name: string }[] }>({ queryKey: ["/api/client-profiles"], enabled: open, retry: false });
  // "With an email" narrows what is SHOWN (and so what "pick all" takes); the other filters are asked of the server.
  const leads = (audience.data?.leads ?? []).filter((l) => !emailOnly || l.hasEmail);
  const pickable = leads.filter((l) => !l.blocked);
  const toggle = (id: number) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else if (n.size < CAMPAIGN_MAX_MEMBERS) n.add(id); return n; });
  const allShown = pickable.length > 0 && pickable.every((l) => picked.has(l.id));
  const toggleAll = () => setPicked((p) => { const n = new Set(p); if (allShown) pickable.forEach((l) => n.delete(l.id)); else for (const l of pickable) { if (n.size >= CAMPAIGN_MAX_MEMBERS) break; n.add(l.id); } return n; });
  const noteBad = /https?:\/\/|www\.|@/i.test(note);
  const links = !!queryClient.getQueryData<ListResponse>([CAMPAIGNS_URL])?.unsubscribeLinks;
  const create = useMutation({
    mutationFn: () => leadCall<{ campaign: Campaign; added: number }>("POST", CAMPAIGNS_URL, { name, leadIds: Array.from(picked), profileId, footerNote: note }),
    onSuccess: (r) => { trackEvent("campaign_created", { leads: r.added }); refresh(); setName(""); setNote(""); setPicked(new Set()); setProfileId(null); setFromProfile(null); setReadyOnly(false); onOpenChange(false); onCreated(r.campaign.id); },
    onError: (e) => toast({ title: "Couldn't create the campaign", description: leadError(e), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="campaign-new-dialog">
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription>Pick the leads to write to. Creating a campaign writes nothing and contacts nobody: drafts are prepared only when you ask, and each one waits for your approval.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="campaign-name" className="text-sm font-medium">Name</label>
            <Input id="campaign-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="For example: D2C brands, November" data-testid="campaign-name" />
          </div>
          {(profiles.data?.profiles.length ?? 0) > 0 && (
            <div className="space-y-1.5">
              <label htmlFor="campaign-profile" className="text-sm font-medium">For which client profile? <span className="font-normal text-muted-foreground">· optional, a label for your results</span></label>
              <select id="campaign-profile" value={profileId ?? ""} onChange={(e) => { const v = e.target.value ? Number(e.target.value) : null; setProfileId(v); setFromProfile(v); }} className="h-9 w-full rounded-md border bg-background px-2 text-sm" data-testid="campaign-profile">
                <option value="">None</option>
                {profiles.data!.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <label htmlFor="campaign-note" className="text-sm font-medium">Footer note <span className="font-normal text-muted-foreground">· optional: your business name and address</span></label>
            <Input id="campaign-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={FOOTER_NOTE_MAX} placeholder="Pixel Studio, 12 MG Road, Pune" data-testid="campaign-note" />
            {noteBad && <p className="text-xs text-rose-600">The footer note can't contain a link or an email address.</p>}
            <p className="text-xs text-muted-foreground">Every draft ends with{note.trim() ? " this note and" : ""} the line: <span className="italic">"{OPT_OUT_LINE}"</span>{links ? " and a link the person can click to stop these emails." : ""} You see it before you approve.</p>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">Leads <span className="font-normal text-muted-foreground">· {picked.size} picked, up to {CAMPAIGN_MAX_MEMBERS}</span></p>
              <div className="flex items-center gap-2">
                <select value={stage} onChange={(e) => setStage(e.target.value)} className="h-8 w-auto rounded-md border bg-background px-2 py-0 text-xs" aria-label="Lead stage" data-testid="campaign-audience-stage">
                  <option value="">Any stage</option><option value="new">New</option><option value="researching">Researching</option><option value="qualified">Qualified</option>
                </select>
                <select value={source} onChange={(e) => setSource(e.target.value)} className="h-8 w-auto rounded-md border bg-background px-2 py-0 text-xs" aria-label="Where the lead came from" data-testid="campaign-audience-source">
                  <option value="">From anywhere</option><option value="outbound">Found by Client Radar</option><option value="agent">Added by your AI team</option><option value="manual">Added by hand</option><option value="import">Imported</option>
                </select>
                <div className="relative"><Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Company, industry, city" className="h-8 w-44 pl-7 text-xs" aria-label="Search leads" data-testid="campaign-audience-search" /></div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {(profiles.data?.profiles.length ?? 0) > 0 && (
                <select value={fromProfile ?? ""} onChange={(e) => setFromProfile(e.target.value ? Number(e.target.value) : null)} className="h-8 w-auto rounded-md border bg-background px-2 py-0 text-xs" aria-label="Found for which client profile" data-testid="campaign-audience-profile">
                  <option value="">Found for any profile</option>
                  {profiles.data!.profiles.map((p) => <option key={p.id} value={p.id}>Found for: {p.name}</option>)}
                </select>
              )}
              <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={readyOnly} onChange={(e) => setReadyOnly(e.target.checked)} data-testid="campaign-audience-ready-only" />Only Ready companies</label>
              <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={emailOnly} onChange={(e) => setEmailOnly(e.target.checked)} data-testid="campaign-audience-email-only" />Only leads with a contact email</label>
            </div>
            {audience.isLoading ? <Skeleton className="h-32 w-full rounded-xl" /> : audience.isError ? (
              <p className="rounded-xl border border-destructive/40 px-3 py-4 text-center text-sm">{leadError(audience.error, "The leads couldn't be loaded.")}</p>
            ) : leads.length === 0 ? (
              <p className="rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">{search.trim() || stage || source || emailOnly || fromProfile || readyOnly ? "No open leads match these filters. Clear one to see more." : "No open leads yet. Add companies to Leads from Client Radar first."}</p>
            ) : (
              <>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={allShown} onChange={toggleAll} data-testid="campaign-audience-all" />Pick all {pickable.length} shown</label>
                <ul className="max-h-64 divide-y overflow-y-auto rounded-xl border" data-testid="campaign-audience">
                  {leads.map((l) => (
                    <li key={l.id}>
                      <label className={cn("flex items-start gap-2.5 px-3 py-2 text-sm", l.blocked ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted/40")}>
                        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-emerald-600" disabled={!!l.blocked} checked={picked.has(l.id)} onChange={() => toggle(l.id)} data-testid={`campaign-audience-lead-${l.id}`} />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5 font-medium"><span className="truncate">{l.companyName}</span>
                            {l.ready && <span className="rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">Ready</span>}
                            {l.profileName && <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">for {l.profileName}</span>}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">{[l.industry, l.location, l.contactName, l.status].filter(Boolean).join(" · ")}</span>
                          {l.blocked ? <span className="block text-xs text-rose-700 dark:text-rose-400">{l.blocked}</span>
                            : l.hasUnsent ? <span className="block text-xs text-muted-foreground">Already has a message waiting: the campaign will use it.</span>
                            : !l.hasEmail ? <span className="block text-xs text-muted-foreground">No contact email on the lead. An address published on their site is used if there is one; otherwise it is skipped.</span> : null}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                {leads.length >= (audience.data?.limit ?? 300) && <p className="text-xs text-muted-foreground">Showing the {audience.data?.limit} most recent. Search to narrow it down.</p>}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => create.mutate()} disabled={!name.trim() || picked.size === 0 || noteBad || create.isPending} className="gradient-btn text-white" data-testid="campaign-create">{create.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Create campaign</Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── the sender check ───────────────────────────────────────────────────── */

const CHECK_TONE: Record<string, string> = { ok: "text-emerald-700 dark:text-emerald-400", warn: "text-amber-700 dark:text-amber-400", missing: "text-rose-700 dark:text-rose-400", unknown: "text-muted-foreground" };
const CHECK_WORD: Record<string, string> = { ok: "In place", warn: "Needs a look", missing: "Not set up", unknown: "Couldn't confirm" };

/**
 * Whether the address you send from is set up to be trusted by other mail servers (GET /api/campaigns/sender-check):
 * SPF, DKIM and DMARC for your own connected Gmail's domain, read from public DNS. Advice, never a gate.
 */
function SenderCheck() {
  const q = useQuery<{ check: SenderCheckView; mailbox: "none" | "active" | "needs_reconnect" }>({ queryKey: [`${CAMPAIGNS_URL}/sender-check`], retry: false, staleTime: 5 * 60_000 });
  if (!q.data) return null;
  const { check: c, mailbox } = q.data;
  if (c.kind === "none") return <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground" data-testid="sender-check" data-kind="none">No Gmail is connected to your account. Connect it in Settings → Integrations to send from DealInSec, or send approved messages from your own email app.</p>;
  return (
    <div className="space-y-1.5 rounded-lg border px-3 py-2" data-testid="sender-check" data-kind={c.kind} data-ready={c.ready}>
      <p className="text-xs"><span className="font-semibold">Sending from {c.address}</span>{mailbox === "needs_reconnect" && <span className="ml-1 text-amber-700 dark:text-amber-400">· reconnect it in Settings</span>}</p>
      <p className={cn("text-xs", c.ready ? "text-muted-foreground" : "text-rose-700 dark:text-rose-400")} data-testid="sender-check-summary">{c.summary}</p>
      {c.kind === "custom" && (
        <ul className="space-y-1">
          {c.items.map((i) => (
            <li key={i.key} className="text-xs" data-testid={`sender-check-${i.key}`} data-state={i.state}>
              <span className="font-medium">{i.label}</span> · <span className={cn("font-medium", CHECK_TONE[i.state])}>{CHECK_WORD[i.state]}</span>
              {i.state !== "ok" && <span className="block text-muted-foreground">{i.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      {c.kind === "custom" && <p className="text-[11px] text-muted-foreground">Read from your domain's public DNS. These records are added where your domain is managed; a change can take an hour to show here.</p>}
    </div>
  );
}

/* ── one campaign ───────────────────────────────────────────────────────── */

function Tile({ label, value, sub, testId }: { label: string; value: string | number; sub?: string; testId?: string }) {
  return <div className="rounded-xl border px-3 py-2" data-testid={testId}><p className="text-xl font-bold tabular-nums leading-tight">{value}</p><p className="text-xs text-muted-foreground">{label}{sub ? ` · ${sub}` : ""}</p></div>;
}

function CampaignDetail({ id, canEdit, onBack }: { id: number; canEdit: boolean; onBack: () => void }) {
  const { toast } = useToast();
  const [openLead, setOpenLead] = useState<number | null>(null);
  const q = useQuery<DetailResponse>({ queryKey: [campaignUrl(id)], retry: false, refetchInterval: (query) => { const c = query.state.data?.campaign; return c?.preparing || c?.sending || openLead !== null ? 4000 : false; } });
  const oops = (title: string) => (e: unknown) => { toast({ title, description: leadError(e), variant: "destructive" }); refresh(id); };
  const act = useMutation({
    mutationFn: (action: "prepare" | "prepare/stop" | "send" | "send/pause" | "archive") => leadCall("POST", campaignUrl(id, action), {}),
    onSuccess: (_r, action) => { trackEvent("campaign_action", { action }); refresh(id); if (action === "archive") onBack(); },
    onError: oops("That didn't work"),
  });
  const pace = useMutation({ mutationFn: (patch: { dailyLimit?: number; gapSeconds?: number }) => leadCall("PATCH", campaignUrl(id), patch), onSuccess: () => refresh(id), onError: oops("Couldn't change the pace") });
  const remove = useMutation({ mutationFn: (leadId: number) => leadCall("DELETE", campaignUrl(id, `members/${leadId}`)), onSuccess: () => refresh(id), onError: oops("Couldn't take it out") });

  if (q.isError && !q.data) return <div className="rounded-2xl border border-destructive/40 px-4 py-6 text-center" role="alert"><p className="text-sm">{leadError(q.error, "The campaign couldn't be loaded.")}</p><Button size="sm" variant="outline" className="mt-2" onClick={onBack}>Back to campaigns</Button></div>;
  if (!q.data) return <div className="space-y-3"><Skeleton className="h-8 w-1/3" /><Skeleton className="h-20 w-full rounded-xl" /><Skeleton className="h-40 w-full rounded-xl" /></div>;
  const { campaign: c, members, queueEnabled } = q.data;
  const n = c.counts, active = c.status === "active", waiting = n.queued + n.failed;
  const open = members.find((m) => m.leadId === openLead) ?? null;
  return (
    <section className="min-w-0 space-y-4" data-testid="campaign-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button onClick={onBack} className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="campaign-back"><ArrowLeft className="h-3 w-3" />All campaigns</button>
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold"><span className="break-words">{c.name}</span><StateChips c={c} /></h2>
          <p className="text-xs text-muted-foreground">{c.profileName ? `For "${c.profileName}" · ` : ""}{countsLine(n)}</p>
        </div>
        {canEdit && active && <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(`Archive "${c.name}"? Drafting and sending stop. Its messages stay in Outreach.`)) act.mutate("archive"); }} disabled={act.isPending} data-testid="campaign-archive"><Archive className="mr-1.5 h-3.5 w-3.5" />Archive</Button>}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="campaign-numbers">
        <Tile label="Leads" value={n.members} testId="campaign-n-members" />
        <Tile label="To review" value={n.draft} testId="campaign-n-draft" />
        <Tile label="Approved" value={n.approved} testId="campaign-n-approved" />
        <Tile label="Sent" value={n.sent} testId="campaign-n-sent" />
        <Tile label="Replied" value={n.replied} sub={pct(c.rates.reply)} testId="campaign-n-replied" />
        <Tile label="Bounced" value={n.bounced} sub={pct(c.rates.bounce)} testId="campaign-n-bounced" />
      </div>
      {(n.interested > 0 || n.optedOut > 0) && <p className="text-xs text-muted-foreground">{n.interested > 0 && <>{plural(n.interested, "reply", "replies")} read as interested. </>}{n.optedOut > 0 && <>{n.optedOut} asked not to be contacted and {n.optedOut === 1 ? "is" : "are"} on your do-not-contact list.</>}</p>}

      {/* Step 1: drafts */}
      <div className="space-y-2 rounded-xl border p-3" data-testid="campaign-prepare">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold">1. Prepare drafts</p>
            <p className="text-xs text-muted-foreground">{c.preparing ? `Writing one at a time. ${waiting} still waiting.` : waiting > 0 ? `${plural(waiting, "lead")} waiting for a draft. Each draft uses one of your plan's AI drafts.` : "Every lead has a draft or was skipped."}</p>
          </div>
          {canEdit && active && (c.preparing
            ? <Button size="sm" variant="outline" onClick={() => act.mutate("prepare/stop")} disabled={act.isPending} data-testid="campaign-prepare-stop"><Square className="mr-1.5 h-3.5 w-3.5" />Stop</Button>
            : <Button size="sm" onClick={() => act.mutate("prepare")} disabled={act.isPending || waiting === 0} className="gradient-btn text-white" data-testid="campaign-prepare-start">{act.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <PenLine className="mr-1.5 h-3.5 w-3.5" />}Prepare drafts</Button>)}
        </div>
        {c.prepareStopLabel && c.prepareStop !== "stopped" && <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200" role="status" data-testid="campaign-prepare-stopped">Drafting stopped: {c.prepareStopLabel}. What was written is below; press Prepare drafts to carry on when you can.</p>}
      </div>

      {/* Step 2: review */}
      <div className="space-y-2 rounded-xl border p-3">
        <p className="text-sm font-semibold">2. Read and approve each one</p>
        <p className="text-xs text-muted-foreground">Open a lead to read its draft beside the facts it was written from. Edit it, approve it, or discard it. Nothing is approved for you.</p>
        {members.length === 0 ? <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">No leads in this campaign.</p> : (
          <ul className="divide-y rounded-xl border" data-testid="campaign-members">
            {members.map((m) => {
              const Icon = STAGE_ICON[m.stage];
              return (
                <li key={m.leadId} className="flex items-center gap-1" data-testid="campaign-member" data-stage={m.stage}>
                  <button onClick={() => setOpenLead(m.leadId)} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{m.companyName}</span>
                      <span className="block truncate text-xs text-muted-foreground">{m.message ? `${m.message.subject || "(no subject)"} · to ${m.message.to ?? "no address"}` : m.contactName ?? m.domain ?? ""}</span>
                      {m.note && <span className="block text-xs text-amber-800 dark:text-amber-300" data-testid="campaign-member-note">{m.note}</span>}
                    </span>
                    {m.followUp && (
                      <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", m.followUp.waiting ? "border-amber-300 bg-amber-50 font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300" : "text-muted-foreground")} data-testid="campaign-member-followup" data-state={m.followUp.state}>
                        {m.followUp.state === "due_later" && m.followUp.dueAt ? `Follow-up planned for ${new Date(m.followUp.dueAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : m.followUp.state === "on_hold" ? "Follow-up on hold" : m.followUp.label}
                      </span>
                    )}
                    {m.interested && <span className="rounded-full border border-emerald-300 px-2 py-0.5 text-[11px] text-emerald-800 dark:border-emerald-800 dark:text-emerald-300">Interested</span>}
                    {m.outcomes.map((o) => <span key={o} className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">{OUTCOME[o] ?? o}</span>)}
                    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", STAGE_TONE[m.stage])}><Icon className="h-3 w-3" aria-hidden />{m.stageLabel}</span>
                  </button>
                  {canEdit && active && m.stage !== "sent" && m.stage !== "sending" && (
                    <Button size="icon" variant="ghost" className="mr-1 h-8 w-8 shrink-0 text-muted-foreground" onClick={() => remove.mutate(m.leadId)} disabled={remove.isPending} title="Take out of this campaign" aria-label={`Take ${m.companyName} out of this campaign`} data-testid="campaign-member-remove"><X className="h-4 w-4" /></Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Step 3: sending */}
      <div className="space-y-2 rounded-xl border p-3" data-testid="campaign-send">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold">3. Send</p>
            {queueEnabled
              ? <p className="text-xs text-muted-foreground">{c.sending ? `Sending approved messages from your Gmail, one at a time.${c.nextSendAt ? ` Next at about ${new Date(c.nextSendAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.` : ""}` : `${plural(n.approved, "approved message")} ready. They leave from your own Gmail, at most ${c.dailyLimit} a day, a few minutes apart.`}</p>
              : <p className="text-xs text-muted-foreground" data-testid="campaign-queue-off">A sending queue isn't switched on for this server. Open each approved message and send it yourself: from Gmail if it is connected, or from your own email app.</p>}
          </div>
          {canEdit && active && queueEnabled && (c.sending
            ? <Button size="sm" variant="outline" onClick={() => act.mutate("send/pause")} disabled={act.isPending} data-testid="campaign-send-pause"><Pause className="mr-1.5 h-3.5 w-3.5" />Pause</Button>
            : <Button size="sm" onClick={() => { if (window.confirm(`Start sending ${plural(n.approved, "approved message")} from your Gmail? Later approvals in this campaign are sent too, until you pause it.`)) act.mutate("send"); }} disabled={act.isPending || n.approved === 0} className="gradient-btn text-white" data-testid="campaign-send-start"><Play className="mr-1.5 h-3.5 w-3.5" />Start sending</Button>)}
        </div>
        {q.data.followUps && (q.data.followUps.waiting > 0 || q.data.followUps.planned > 0) && (
          <p className="rounded-lg border px-3 py-2 text-xs" data-testid="campaign-followups">
            <span className="font-semibold">Follow-ups.</span>{" "}
            {q.data.followUps.waiting > 0 && <span className="text-amber-800 dark:text-amber-300">{plural(q.data.followUps.waiting, "follow-up")} waiting for you: open the lead above to read and approve it. </span>}
            {q.data.followUps.planned > 0 && <span className="text-muted-foreground">{q.data.followUps.planned} planned for later. </span>}
            <span className="text-muted-foreground">A follow-up is never sent by itself: when it falls due a draft is prepared for you, and a reply cancels it.</span>
          </p>
        )}
        <SenderCheck />
        {c.sendStopLabel && c.sendStop !== "paused" && <p className={cn("rounded-lg border px-3 py-2 text-xs", c.sendStop === "done" ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200" : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200")} role="status" data-testid="campaign-send-stopped">{c.sendStop === "done" ? c.sendStopLabel : `Sending paused: ${c.sendStopLabel}.`}</p>}
        {queueEnabled && canEdit && active && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <label className="flex items-center gap-1.5">At most <input type="number" min={DAILY_LIMIT.min} max={DAILY_LIMIT.max} defaultValue={c.dailyLimit} key={`d${c.dailyLimit}`} onBlur={(e) => { const v = Math.floor(Number(e.target.value)); if (v !== c.dailyLimit && v >= DAILY_LIMIT.min && v <= DAILY_LIMIT.max) pace.mutate({ dailyLimit: v }); else e.target.value = String(c.dailyLimit); }} className="w-16 rounded-md border bg-background px-2 py-1 text-foreground" data-testid="campaign-daily-limit" /> a day</label>
            <label className="flex items-center gap-1.5">at least <input type="number" min={GAP_SECONDS.min / 60} max={GAP_SECONDS.max / 60} defaultValue={Math.round(c.gapSeconds / 60)} key={`g${c.gapSeconds}`} onBlur={(e) => { const v = Math.floor(Number(e.target.value)) * 60; if (v !== c.gapSeconds && v >= GAP_SECONDS.min && v <= GAP_SECONDS.max) pace.mutate({ gapSeconds: v }); else e.target.value = String(Math.round(c.gapSeconds / 60)); }} className="w-16 rounded-md border bg-background px-2 py-1 text-foreground" data-testid="campaign-gap" /> minutes apart</label>
          </div>
        )}
        {queueEnabled && <p className="text-xs text-muted-foreground">Only approved messages that still end with the opt-out line are sent. The queue pauses itself if Gmail needs reconnecting, a limit is reached, a send can't be confirmed, or messages bounce.</p>}
      </div>

      <Sheet open={openLead !== null} onOpenChange={(o) => { if (!o) { setOpenLead(null); refresh(id); } }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="campaign-member-sheet">
          {open && (
            <div className="space-y-5 pb-8">
              <SheetHeader className="space-y-1 text-left">
                <SheetTitle>{open.companyName}</SheetTitle>
                <SheetDescription>{[open.domain, open.leadStatus ? `lead stage ${open.leadStatus}` : null, open.stageLabel].filter(Boolean).join(" · ")}</SheetDescription>
              </SheetHeader>
              {open.note && <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200" role="status">{open.note}.</p>}
              <OutreachPanel leadId={open.leadId} />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}

/* ── the tab ────────────────────────────────────────────────────────────── */

/** ?campaign=<id> opens that campaign straight away (a coworker's "Review in Campaigns" link). Read once, on arrival. */
const linkedCampaign = (): number | null => {
  try { const n = Number(new URLSearchParams(window.location.search).get("campaign")); return Number.isInteger(n) && n > 0 ? n : null; } catch { return null; }
};

export function Campaigns({ canEdit }: { canEdit: boolean }) {
  const [openId, setOpenId] = useState<number | null>(linkedCampaign);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const q = useQuery<ListResponse>({ queryKey: [CAMPAIGNS_URL], retry: false, refetchInterval: (query) => (query.state.data?.campaigns.some((c) => c.preparing || c.sending) ? 8000 : false) });
  const notSetUp = q.error && /CAMPAIGNS_NOT_SETUP/.test(String((q.error as Error).message));
  const list = useMemo(() => (q.data?.campaigns ?? []).filter((c) => showArchived || c.status === "active"), [q.data, showArchived]);
  const archived = (q.data?.campaigns ?? []).filter((c) => c.status !== "active").length;

  if (openId !== null) return <CampaignDetail id={openId} canEdit={canEdit} onBack={() => { setOpenId(null); refresh(); }} />;
  return (
    <section className="min-w-0 space-y-4" aria-labelledby="campaigns-title" data-testid="campaigns">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="campaigns-title" className="text-base font-semibold">Campaigns</h2>
          <p className="max-w-2xl text-xs text-muted-foreground">Write to a group of leads together. Drafts are prepared for you from each lead's verified facts; you read and approve every one. Nothing is sent that you didn't approve.</p>
        </div>
        {canEdit && !notSetUp && <Button size="sm" onClick={() => setCreating(true)} className="gradient-btn text-white" data-testid="campaign-new"><Plus className="mr-1.5 h-3.5 w-3.5" />New campaign</Button>}
      </div>
      {notSetUp ? (
        <p className="rounded-2xl border px-4 py-8 text-center text-sm text-muted-foreground" data-testid="campaigns-not-setup">Campaigns aren't set up on this server yet.</p>
      ) : q.isError && !q.data ? (
        <div className="rounded-2xl border border-destructive/40 px-4 py-6 text-center" role="alert"><p className="text-sm">{leadError(q.error, "Your campaigns couldn't be loaded.")}</p><Button size="sm" variant="outline" className="mt-2" onClick={() => void q.refetch()}>Try again</Button></div>
      ) : !q.data ? (
        <div className="space-y-2" aria-busy="true"><Skeleton className="h-16 w-full rounded-xl" /><Skeleton className="h-16 w-full rounded-xl" /></div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-dashed px-4 py-10 text-center" data-testid="campaigns-empty">
          <Megaphone className="mx-auto mb-2 h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">No campaigns yet.</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">A campaign groups leads you already have. Find companies in Client Radar, add the good ones to Leads, then start a campaign for them here.</p>
        </div>
      ) : (
        <ul className="divide-y rounded-xl border" data-testid="campaign-list">
          {list.map((c) => (
            <li key={c.id}>
              <button onClick={() => setOpenId(c.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none" data-testid={`campaign-item-${c.id}`}>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium"><span className="truncate">{c.name}</span><StateChips c={c} /></span>
                  <span className="block truncate text-xs text-muted-foreground">{c.profileName ? `For "${c.profileName}" · ` : ""}{countsLine(c.counts)}</span>
                  {!c.preparing && c.prepareStopLabel && c.prepareStop !== "stopped" && <span className="block text-xs text-amber-800 dark:text-amber-300">Drafting stopped: {c.prepareStopLabel}</span>}
                  {!c.sending && c.sendStopLabel && !["paused", "done"].includes(c.sendStop ?? "") && <span className="block text-xs text-amber-800 dark:text-amber-300">Sending paused: {c.sendStopLabel}</span>}
                </span>
                {c.counts.sent > 0 && <span className="shrink-0 text-xs text-muted-foreground">Reply rate {pct(c.rates.reply)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {archived > 0 && <button onClick={() => setShowArchived((v) => !v)} className="text-xs text-muted-foreground underline-offset-2 hover:underline" data-testid="campaigns-toggle-archived">{showArchived ? "Hide" : "Show"} {archived} archived</button>}
      <NewCampaign open={creating} onOpenChange={setCreating} onCreated={setOpenId} />
    </section>
  );
}
