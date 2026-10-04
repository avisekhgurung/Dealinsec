/**
 * One lead: its details, the stage it is in and where it can go next, the
 * next-step tickets, the evidence behind what we believe about the company,
 * and the timeline. "Create deal" is the closing step: it creates the deal
 * through the same service as the Deals page and marks the lead Won.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useRoute } from "wouter";
import { ArrowLeft, Archive, Check, ExternalLink, Handshake, Pencil } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import { FitCard } from "@/components/leads/fit-card";
import { SalesCard } from "@/components/leads/sales-card";
import { LeadFormDialog } from "@/components/leads/lead-form-dialog";
import { StageBadge } from "@/components/leads/stage-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/confirm-dialog";
import { useAuth } from "@/hooks/useAuth";
import { useMoney } from "@/hooks/use-locale";
import { useToast } from "@/hooks/use-toast";
import { trackEvent } from "@/lib/analytics";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { dateLabel, detailUrl, isOverdue, leadCall, leadError, refreshLeads, stageLabel, type LeadDetailView, type LeadStatus } from "@/lib/leads";
import { memberCan } from "@shared/permissions";
import { CLAIM_STATUSES, TICKET_KINDS } from "@shared/leads";

const EVENT_LABEL: Record<string, string> = {
  created: "Lead added", updated: "Details updated", status_changed: "Stage changed", note: "Note", ticket_created: "Next step added",
  ticket_done: "Next step closed", claim_added: "Fact recorded", converted: "Turned into a deal", archived: "Archived",
};
const CLAIM_STYLE: Record<string, string> = {
  confirmed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  inferred: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  conflicting: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  unknown: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};
const safeHref = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : undefined);

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="break-words text-sm font-medium">{children}</p>
    </div>
  );
}

export default function LeadDetailsPage() {
  const [, params] = useRoute("/leads/:id");
  const id = params?.id ?? "";
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { locale, input } = useMoney();
  const { toast } = useToast();
  const confirm = useConfirm();
  const canEdit = memberCan(user as any, "deals.create");

  const { data, isLoading, error } = useQuery<LeadDetailView>({ queryKey: [detailUrl(id)], enabled: !!id });
  const lead = data?.lead;
  const open = !!lead && !lead.archivedAt && lead.status !== "won" && lead.status !== "lost";

  const [editOpen, setEditOpen] = useState(false);
  const [lostFor, setLostFor] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [dealOpen, setDealOpen] = useState(false);
  const [dealAmount, setDealAmount] = useState("");
  const [dealTitle, setDealTitle] = useState("");
  const [dealError, setDealError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [ticket, setTicket] = useState({ title: "", kind: "other", dueAt: "" });
  const [claim, setClaim] = useState({ field: "", value: "", status: "inferred", evidenceUrl: "", evidenceSnippet: "" });
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => { setDealAmount(lead?.estValueMinor ? input(lead.estValueMinor) : ""); }, [lead?.id, lead?.estValueMinor]);

  const done = (title: string) => { refreshLeads(); toast({ title }); };
  const fail = (e: unknown) => toast({ title: "Couldn't do that", description: leadError(e), variant: "destructive" });

  const move = useMutation({
    mutationFn: (v: { status: LeadStatus; lostReason?: string }) => leadCall("POST", `/api/leads/${id}/move`, v),
    onSuccess: (_r, v) => { trackEvent("lead_stage_changed", { to_stage: v.status }); setLostFor(false); setLostReason(""); done(`Moved to ${stageLabel(v.status)}`); },
    onError: fail,
  });
  const addNote = useMutation({ mutationFn: () => leadCall("POST", `/api/leads/${id}/notes`, { text: note }), onSuccess: () => { setNote(""); done("Note added"); }, onError: fail });
  const addTicket = useMutation({
    mutationFn: () => leadCall("POST", `/api/leads/${id}/tickets`, { title: ticket.title, kind: ticket.kind, ...(ticket.dueAt ? { dueAt: ticket.dueAt } : {}) }),
    onSuccess: () => { setTicket({ title: "", kind: "other", dueAt: "" }); done("Next step added"); }, onError: fail,
  });
  const closeTicket = useMutation({
    mutationFn: (v: { tid: number; status: "done" | "cancelled" }) => leadCall("PATCH", `/api/leads/${id}/tickets/${v.tid}`, { status: v.status }),
    onSuccess: (_r, v) => { if (v.status === "done") trackEvent("lead_ticket_done"); done(v.status === "done" ? "Marked done" : "Cancelled"); }, onError: fail,
  });
  const addClaim = useMutation({
    mutationFn: () => leadCall("POST", `/api/leads/${id}/claims`, {
      field: claim.field, value: claim.value, status: claim.status,
      ...(claim.evidenceUrl.trim() ? { evidenceUrl: claim.evidenceUrl.trim() } : {}), ...(claim.evidenceSnippet.trim() ? { evidenceSnippet: claim.evidenceSnippet.trim() } : {}),
    }),
    onSuccess: () => { setClaim({ field: "", value: "", status: "inferred", evidenceUrl: "", evidenceSnippet: "" }); setClaimError(null); done("Fact recorded"); },
    onError: (e) => setClaimError(leadError(e, "Couldn't record that fact.")),
  });
  const archive = useMutation({ mutationFn: () => leadCall("POST", `/api/leads/${id}/archive`), onSuccess: () => { refreshLeads(); toast({ title: "Lead archived" }); setLocation("/leads"); }, onError: fail });
  const convert = useMutation({
    mutationFn: () => {
      const amount = Number(dealAmount.replace(/,/g, ""));
      return leadCall<{ dealId: number; route: string }>("POST", `/api/leads/${id}/convert`, { ...(amount > 0 ? { dealAmount: amount } : {}), ...(dealTitle.trim() ? { dealTitle: dealTitle.trim() } : {}) });
    },
    onSuccess: (r) => { trackEvent("lead_converted"); refreshLeads(); setDealOpen(false); toast({ title: "Deal created", description: "The lead is marked Won." }); setLocation(r.route || `/deals/${r.dealId}`); },
    onError: (e) => setDealError(leadError(e, "Couldn't create the deal.")),
  });

  if (isLoading) return <div className="space-y-4 p-4 lg:mx-auto lg:max-w-4xl lg:p-8"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-40 w-full" /></div>;
  if (error || !data || !lead) {
    return (
      <div className="min-h-screen px-4 py-16 text-center">
        <p className="font-semibold">That lead isn't here</p>
        <p className="mt-1 text-sm text-muted-foreground">It may have been removed, or it belongs to another workspace.</p>
        <Button asChild className="mt-4" variant="outline"><Link href="/leads">Back to leads</Link></Button>
        <BottomNav />
      </div>
    );
  }

  const openTickets = data.tickets.filter((t) => t.status === "open");
  const closedTickets = data.tickets.filter((t) => t.status !== "open");
  const value = lead.estValueMinor && lead.currency ? formatMoney(lead.estValueMinor, lead.currency, locale) : null;

  return (
    <div className="min-h-screen bg-background pb-24 lg:pb-12">
      <header className="glass-header sticky top-0 z-40 lg:border-b lg:border-neutral-200/60 dark:lg:border-neutral-800/60">
        <div className="px-4 py-3 lg:mx-auto lg:max-w-4xl lg:px-8 lg:py-4">
          <Link href="/leads" className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />Leads</Link>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="break-words text-xl font-bold tracking-tight lg:text-2xl" data-testid="lead-title">{lead.companyName}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <StageBadge status={lead.status} />
                {lead.archivedAt && <span className="text-xs text-muted-foreground">Archived</span>}
                {lead.doNotContact && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">Do not contact</span>}
              </div>
            </div>
            {canEdit && !lead.archivedAt && (
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} data-testid="button-edit-lead"><Pencil className="mr-1.5 h-3.5 w-3.5" />Edit</Button>
            )}
          </div>
        </div>
      </header>

      <main className="animate-fade-in space-y-4 px-4 py-5 lg:mx-auto lg:max-w-4xl lg:px-8 lg:py-6">
        {lead.convertedDealId && (
          <Card className="border-emerald-300/60 bg-emerald-50/60 dark:border-emerald-800/60 dark:bg-emerald-950/20">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-sm font-medium">This lead was won and turned into a deal.</p>
              <Button asChild size="sm" variant="outline"><Link href={`/deals/${lead.convertedDealId}`}>Open the deal</Link></Button>
            </CardContent>
          </Card>
        )}

        {canEdit && open && (
          <Card className="glass-card">
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Move to</span>
                {data.moves.filter((m) => m !== "lost").map((m) => (
                  <Button key={m} size="sm" variant="outline" disabled={move.isPending} onClick={() => move.mutate({ status: m })} data-testid={`move-${m}`}>{stageLabel(m)}</Button>
                ))}
                {data.moves.includes("lost") && <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setLostFor(true)} data-testid="move-lost">Mark lost</Button>}
              </div>
              {data.canConvert && (
                <Button className="gradient-btn w-full text-white sm:w-auto" onClick={() => { setDealError(null); setDealOpen(true); }} data-testid="button-create-deal">
                  <Handshake className="mr-1.5 h-4 w-4" />Won it: create the deal
                </Button>
              )}
            </CardContent>
          </Card>
        )}
        {canEdit && lead.status === "lost" && !lead.archivedAt && data.moves.includes("new") && (
          <Button variant="outline" size="sm" onClick={() => move.mutate({ status: "new" })} data-testid="move-reopen">Reopen this lead</Button>
        )}

        <Tabs defaultValue="overview">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="tickets" data-testid="tab-tickets">Steps{openTickets.length ? ` (${openTickets.length})` : ""}</TabsTrigger>
            <TabsTrigger value="evidence" data-testid="tab-evidence">Facts</TabsTrigger>
            <TabsTrigger value="timeline" data-testid="tab-timeline">Timeline</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4 space-y-3">
            <SalesCard leadId={lead.id} hasWebsite={!!lead.website} />
            <FitCard leadId={lead.id} />
            <Card className="glass-card"><CardContent className="grid gap-x-4 gap-y-3 p-4 sm:grid-cols-2">
              <Fact label="Website">{lead.website ? <a className="inline-flex items-center gap-1 text-primary hover:underline" href={safeHref(lead.website) ?? `https://${lead.website}`} target="_blank" rel="noopener noreferrer">{lead.website}<ExternalLink className="h-3 w-3" /></a> : "—"}</Fact>
              <Fact label="Estimated value">{value ?? "—"}</Fact>
              <Fact label="Industry">{lead.industry || "—"}</Fact>
              <Fact label="Location">{lead.location || "—"}</Fact>
              <Fact label="Size">{lead.sizeHint || "—"}</Fact>
              <Fact label="Source">{lead.source}</Fact>
              <Fact label="Contact">{[lead.contactName, lead.contactRole].filter(Boolean).join(", ") || "—"}</Fact>
              <Fact label="Contact email">{lead.contactEmail ? <a className="text-primary hover:underline" href={`mailto:${lead.contactEmail}`}>{lead.contactEmail}</a> : "—"}</Fact>
              {lead.fitSummary && <div className="sm:col-span-2"><Fact label="Why they may need you">{lead.fitSummary}</Fact></div>}
              {lead.lostReason && <div className="sm:col-span-2"><Fact label="Lost because">{lead.lostReason}</Fact></div>}
            </CardContent></Card>
            {canEdit && !lead.archivedAt && (
              <Button variant="ghost" size="sm" className="mt-3 text-muted-foreground" data-testid="button-archive-lead"
                onClick={async () => { if (await confirm({ title: "Archive this lead?", description: "It leaves your pipeline but is kept, and nothing is deleted.", confirmText: "Archive" })) archive.mutate(); }}>
                <Archive className="mr-1.5 h-3.5 w-3.5" />Archive lead
              </Button>
            )}
          </TabsContent>

          <TabsContent value="tickets" className="mt-4 space-y-3">
            {canEdit && open && (
              <Card className="glass-card"><CardContent className="space-y-3 p-4">
                <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ticket.title.trim()) addTicket.mutate(); }}>
                  <div className="space-y-1.5"><Label htmlFor="ticket-title" className="text-xs">Next step</Label>
                    <Input id="ticket-title" placeholder="Send intro email" value={ticket.title} maxLength={200} onChange={(e) => setTicket({ ...ticket, title: e.target.value })} data-testid="input-ticket-title" /></div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5"><Label className="text-xs">Type</Label>
                      <Select value={ticket.kind} onValueChange={(v) => setTicket({ ...ticket, kind: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{TICKET_KINDS.map((k) => <SelectItem key={k} value={k}>{k.replace("_", " ")}</SelectItem>)}</SelectContent></Select></div>
                    <div className="space-y-1.5"><Label htmlFor="ticket-due" className="text-xs">Due</Label>
                      <Input id="ticket-due" type="date" value={ticket.dueAt} onChange={(e) => setTicket({ ...ticket, dueAt: e.target.value })} data-testid="input-ticket-due" /></div>
                  </div>
                  <Button type="submit" size="sm" disabled={!ticket.title.trim() || addTicket.isPending} data-testid="button-add-ticket">Add step</Button>
                </form>
              </CardContent></Card>
            )}
            {openTickets.length === 0 && <p className="px-1 text-sm text-muted-foreground">No open steps.{open ? " Add the next thing to do on this lead." : ""}</p>}
            <ul className="space-y-2">
              {openTickets.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 rounded-xl border bg-background p-3" data-testid={`ticket-${t.id}`}>
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium">{t.title}</p>
                    <p className={cn("text-xs", isOverdue(t.dueAt) ? "font-semibold text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
                      {t.kind.replace("_", " ")}{t.dueAt ? ` · ${isOverdue(t.dueAt) ? "overdue, was due" : "due"} ${dateLabel(t.dueAt, locale)}` : ""}
                    </p>
                  </div>
                  {canEdit && <Button size="sm" variant="outline" onClick={() => closeTicket.mutate({ tid: t.id, status: "done" })} disabled={closeTicket.isPending} data-testid={`done-ticket-${t.id}`}><Check className="mr-1 h-3.5 w-3.5" />Done</Button>}
                </li>
              ))}
            </ul>
            {closedTickets.length > 0 && (
              <div><p className="mb-1 mt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Closed</p>
                <ul className="space-y-1">{closedTickets.map((t) => <li key={t.id} className="text-sm text-muted-foreground line-through decoration-muted-foreground/50">{t.title}</li>)}</ul></div>
            )}
          </TabsContent>

          <TabsContent value="evidence" className="mt-4 space-y-3">
            <p className="px-1 text-xs text-muted-foreground">What we believe about this company, and how we know. A fact is only <b>confirmed</b> with the page it came from and the words on it.</p>
            {data.claims.length === 0 && <p className="px-1 text-sm text-muted-foreground">Nothing recorded yet.</p>}
            <ul className="space-y-2">
              {data.claims.map((c) => (
                <li key={c.id} className="rounded-xl border bg-background p-3" data-testid={`claim-${c.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{c.field}</p><p className="break-words text-sm font-medium">{c.value}</p></div>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", CLAIM_STYLE[c.status])}>{c.status}</span>
                  </div>
                  {c.evidenceSnippet && <p className="mt-1.5 break-words border-l-2 border-border pl-2 text-xs italic text-muted-foreground">“{c.evidenceSnippet}”</p>}
                  {safeHref(c.evidenceUrl) && <a href={safeHref(c.evidenceUrl)} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 inline-flex max-w-full items-center gap-1 text-xs text-primary hover:underline"><span className="truncate">{c.evidenceUrl}</span><ExternalLink className="h-3 w-3 shrink-0" /></a>}
                  <p className="mt-1 text-[11px] text-muted-foreground">Added by {c.source === "agent" ? "the agent" : "you"} · {dateLabel(c.createdAt, locale)}</p>
                </li>
              ))}
            </ul>
            {canEdit && !lead.archivedAt && (
              <Card className="glass-card"><CardContent className="p-4">
                <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setClaimError(null); addClaim.mutate(); }}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5"><Label htmlFor="claim-field" className="text-xs">About</Label><Input id="claim-field" placeholder="headcount, hiring…" value={claim.field} maxLength={60} onChange={(e) => setClaim({ ...claim, field: e.target.value })} data-testid="input-claim-field" /></div>
                    <div className="space-y-1.5"><Label className="text-xs">How sure</Label>
                      <Select value={claim.status} onValueChange={(v) => setClaim({ ...claim, status: v })}><SelectTrigger data-testid="select-claim-status"><SelectValue /></SelectTrigger>
                        <SelectContent>{CLAIM_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
                  </div>
                  <div className="space-y-1.5"><Label htmlFor="claim-value" className="text-xs">The fact</Label><Input id="claim-value" value={claim.value} maxLength={400} onChange={(e) => setClaim({ ...claim, value: e.target.value })} data-testid="input-claim-value" /></div>
                  {claim.status === "confirmed" && (
                    <div className="space-y-3">
                      <div className="space-y-1.5"><Label htmlFor="claim-url" className="text-xs">Page it was seen on</Label><Input id="claim-url" inputMode="url" placeholder="https://…" value={claim.evidenceUrl} onChange={(e) => setClaim({ ...claim, evidenceUrl: e.target.value })} data-testid="input-claim-url" /></div>
                      <div className="space-y-1.5"><Label htmlFor="claim-snippet" className="text-xs">The words on that page</Label><Textarea id="claim-snippet" rows={2} value={claim.evidenceSnippet} maxLength={500} onChange={(e) => setClaim({ ...claim, evidenceSnippet: e.target.value })} data-testid="input-claim-snippet" /></div>
                    </div>
                  )}
                  {claimError && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400" data-testid="claim-error">{claimError}</p>}
                  <Button type="submit" size="sm" disabled={!claim.field.trim() || !claim.value.trim() || addClaim.isPending} data-testid="button-add-claim">Record fact</Button>
                </form>
              </CardContent></Card>
            )}
          </TabsContent>

          <TabsContent value="timeline" className="mt-4 space-y-3">
            {canEdit && !lead.archivedAt && (
              <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) addNote.mutate(); }}>
                <Textarea placeholder="Add a note: what was said, decided or learned" rows={2} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} data-testid="input-note" />
                <Button type="submit" size="sm" disabled={!note.trim() || addNote.isPending} data-testid="button-add-note">Add note</Button>
              </form>
            )}
            <ol className="space-y-3 border-l border-border pl-4">
              {data.events.map((e) => {
                const d = (e.data ?? {}) as Record<string, any>;
                return (
                  <li key={e.id} className="relative" data-testid={`event-${e.kind}`}>
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-border" />
                    <p className="text-sm font-medium">
                      {EVENT_LABEL[e.kind] ?? e.kind}
                      {e.kind === "status_changed" && d.from && d.to ? `: ${stageLabel(d.from)} → ${stageLabel(d.to)}` : ""}
                    </p>
                    {e.kind === "note" && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{String(d.text ?? "")}</p>}
                    <p className="text-[11px] text-muted-foreground">{e.actor === "agent" ? "Agent" : "You"} · {dateLabel(e.createdAt, locale)}</p>
                  </li>
                );
              })}
            </ol>
          </TabsContent>
        </Tabs>
      </main>

      <LeadFormDialog open={editOpen} onOpenChange={setEditOpen} lead={lead} valueMajor={lead.estValueMinor ? input(lead.estValueMinor) : ""} />

      <Dialog open={lostFor} onOpenChange={setLostFor}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Mark as lost</DialogTitle><DialogDescription>You can reopen it later. A short reason helps you remember why.</DialogDescription></DialogHeader>
          <Input placeholder="Reason (optional)" value={lostReason} maxLength={300} onChange={(e) => setLostReason(e.target.value)} data-testid="input-lost-reason" />
          <DialogFooter><Button variant="outline" onClick={() => setLostFor(false)}>Cancel</Button>
            <Button disabled={move.isPending} onClick={() => move.mutate({ status: "lost", ...(lostReason.trim() ? { lostReason: lostReason.trim() } : {}) })} data-testid="button-confirm-lost">Mark lost</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dealOpen} onOpenChange={setDealOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Create the deal</DialogTitle><DialogDescription>This creates a pending deal for {lead.companyName} and marks the lead Won. Nothing is sent to them.</DialogDescription></DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setDealError(null); convert.mutate(); }}>
            <div className="space-y-1.5"><Label htmlFor="deal-amount" className="text-xs">Deal amount *</Label>
              <Input id="deal-amount" inputMode="decimal" value={dealAmount} onChange={(e) => setDealAmount(e.target.value)} placeholder="50000" data-testid="input-deal-amount" /></div>
            <div className="space-y-1.5"><Label htmlFor="deal-title" className="text-xs">Project name</Label>
              <Input id="deal-title" value={dealTitle} maxLength={200} onChange={(e) => setDealTitle(e.target.value)} placeholder={`Work for ${lead.companyName}`} data-testid="input-deal-title" /></div>
            {dealError && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400" data-testid="deal-error">{dealError}</p>}
            <DialogFooter><Button type="button" variant="outline" onClick={() => setDealOpen(false)}>Cancel</Button>
              <Button type="submit" className="gradient-btn text-white" disabled={convert.isPending || !(Number(dealAmount.replace(/,/g, "")) > 0)} data-testid="button-confirm-deal">{convert.isPending ? "Creating…" : "Create deal"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <BottomNav />
    </div>
  );
}
