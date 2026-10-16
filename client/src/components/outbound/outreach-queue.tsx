/**
 * The outreach review queue: every first message waiting for a person (draft, approved) and recently sent, across the
 * organization's leads. Each one opens beside its evidence (the facts it was written from, with their sources) and
 * where the address came from, with the lead's own outreach panel to edit, approve, open in the person's email app and
 * record as sent. Then: what happened (a reply, a bounce, an opt-out). And the do-not-contact list.
 *
 * DealInSec never sends anything. A person approves exactly one text and sends it from their own email app.
 *
 * The summary above the list counts only what this page has loaded (the waiting and sent lists, each the newest 100
 * at most), and says so when a list is at that limit. A count that didn't load isn't shown.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, ExternalLink, Inbox, Loader2, MailCheck, MailX, MessageSquareReply, PenLine, ShieldOff, Trash2, XCircle } from "lucide-react";
import { OutreachPanel } from "@/components/leads/outreach-panel";
import { SegmentedTabs } from "@/components/outbound/segmented-tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { OUTREACH_QUEUE_URL, SUPPRESSIONS_URL, leadCall, leadError, messageUrl, refreshLeads } from "@/lib/leads";
import { cn } from "@/lib/utils";
import { OUTCOME_LABEL, type Outcome } from "@shared/outreach-safety";

export interface QueueItem {
  message: { id: number; leadId: number; status: "draft" | "approved" | "sending" | "sent" | "cancelled"; subject: string; to: string | null; toSource: string | null; edited: boolean; createdAt: string; approvedAt: string | null; sentAt: string | null };
  lead: { id: number; companyName: string; domain: string | null; status: string; doNotContact: boolean; contactName: string | null; contactRole: string | null; contactSource: string | null };
  recipient: { address: string | null; source: string | null; detail: string | null };
  evidence: { id: number; field: string; value: string; status: string; url: string | null; quote: string | null }[];
  outcomes: string[];
  suppressed: boolean;
}
interface Entry { id: number; kind: string; value: string; reasonLabel: string; removable: boolean; note: string | null; createdAt: string }

const STATUS: Record<string, string> = { draft: "Waiting for review", approved: "Approved, not sent", sending: "Sending from Gmail / check needed", sent: "Sent", cancelled: "Discarded" };
const STATUS_ICON: Record<string, typeof Inbox> = { draft: PenLine, approved: CheckCircle2, sending: AlertTriangle, sent: MailCheck, cancelled: XCircle };
/** What to do next, said where "Approved, not sent" appears, so an approval is never mistaken for a send. */
const SEND_YOURSELF = "Send it from your own email, then mark it sent.";
/** The server returns at most this many messages per list (server/sales/outreach.ts listOutreachQueue). */
const LIST_LIMIT = 100;
const TONE: Record<string, string> = { draft: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300", approved: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300", sending: "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300", sent: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300", cancelled: "border-border bg-muted text-muted-foreground" };
const FIELD: Record<string, string> = { description: "What it does", services: "What it offers", industry: "Industry", location: "Based in", recent_news: "Recent news", hiring: "Hiring", launch: "Launch", team_size: "Team size" };

/** The two lists' cache keys, shared with the page's flow indicator (which only reads what is already loaded). */
export const outreachQueueKey = (tab: "waiting" | "sent") => [`${OUTREACH_QUEUE_URL}?status=${tab}`];

export function StatusChip({ status }: { status: QueueItem["message"]["status"] }) {
  const Icon = STATUS_ICON[status] ?? Inbox;
  return <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", TONE[status])} data-testid="outreach-status" data-state={status}><Icon className="h-3 w-3" aria-hidden />{STATUS[status] ?? status}</span>;
}

/** Counts per status, from the loaded lists only: a list that didn't load gives no number, never a zero. */
function Summary({ waiting, sent }: { waiting: QueueItem[] | undefined; sent: QueueItem[] | undefined }) {
  const by = (items: QueueItem[] | undefined, st: string) => (items ? items.filter((i) => i.message.status === st).length : null);
  const rows: { status: QueueItem["message"]["status"]; label: string; n: number | null; hint?: string }[] = [
    { status: "draft", label: "Waiting for review", n: by(waiting, "draft") },
    { status: "approved", label: "Approved · not sent", n: by(waiting, "approved"), hint: SEND_YOURSELF },
    { status: "sending", label: "Sending from Gmail · check needed", n: by(waiting, "sending") },
    { status: "sent", label: "Sent", n: by(sent, "sent") },
  ];
  const shown = rows.filter((r) => r.n !== null && (r.status !== "sending" || r.n > 0));
  if (!shown.length) return null;
  const capped = (waiting?.length ?? 0) >= LIST_LIMIT || (sent?.length ?? 0) >= LIST_LIMIT;
  return (
    <div className="space-y-1.5">
      <dl className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" data-testid="outreach-summary" aria-label="Outreach by status">
        {shown.map((r) => {
          const Icon = STATUS_ICON[r.status];
          return (
            <div key={r.status} className="flex min-w-0 flex-col-reverse rounded-xl border px-3 py-2 sm:min-w-[10rem]" data-testid={`outreach-count-${r.status}`}>
              <dt className="flex items-start gap-1 text-[11px] leading-tight text-muted-foreground"><Icon className="mt-px h-3 w-3 shrink-0" aria-hidden /><span>{r.label}{r.hint && r.n ? <span className="block text-foreground/80">{r.hint}</span> : null}</span></dt>
              <dd className="text-lg font-bold tabular-nums leading-tight">{r.n}</dd>
            </div>
          );
        })}
      </dl>
      {capped && <p className="text-[11px] text-muted-foreground">Counts cover the newest {LIST_LIMIT} messages in each list.</p>}
    </div>
  );
}

export function OutreachQueue({ canEdit, onShowReady }: { canEdit: boolean; /** Opens All prospects filtered to Ready ones. */ onShowReady?: () => void }) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"waiting" | "sent">("waiting");
  // Both lists load, so the summary can count each status; the list below shows the chosen one.
  const waitingQ = useQuery<{ items: QueueItem[] }>({ queryKey: outreachQueueKey("waiting"), retry: false });
  const sentQ = useQuery<{ items: QueueItem[] }>({ queryKey: outreachQueueKey("sent"), retry: false });
  const q = tab === "waiting" ? waitingQ : sentQ;
  const [openId, setOpenId] = useState<number | null>(null);
  const open = q.data?.items.find((i) => i.message.id === openId) ?? null;
  // A message that has left this list (sent, discarded) closes its sheet for good: it never reopens on another tab by itself.
  useEffect(() => { if (openId !== null && q.data && !open) setOpenId(null); }, [q.data, open, openId]);
  const [confirm, setConfirm] = useState<null | { id: number; outcome: Outcome }>(null);
  const outcome = useMutation({
    mutationFn: (v: { id: number; outcome: Outcome }) => leadCall<{ already: boolean; suppressed: boolean; cancelled: number; movedTo: string | null }>("POST", messageUrl(v.id, "outcome"), { outcome: v.outcome }),
    onSuccess: (r, v) => {
      void refreshLeads();
      toast({ title: r.already ? "Already recorded" : OUTCOME_LABEL[v.outcome], description: r.suppressed ? `The address is on your do-not-contact list now${r.cancelled ? `; ${r.cancelled} unsent message${r.cancelled === 1 ? "" : "s"} to it discarded` : ""}.` : r.movedTo ? `The lead moved to ${r.movedTo}.` : undefined });
    },
    onError: (e) => toast({ title: "Couldn't record that", description: leadError(e), variant: "destructive" }),
  });
  const items = q.data?.items ?? [];
  const notSetUp = q.error && /MESSAGES_NOT_SETUP|LEADS_NOT_SETUP/.test(String((q.error as Error).message));

  return (
    <section className="min-w-0 space-y-4" aria-labelledby="outreach-title" data-testid="outreach-queue">
      <div>
        <h2 id="outreach-title" className="text-base font-semibold">Outreach</h2>
        <p className="text-xs text-muted-foreground">Drafts wait here for you. Nothing is sent from DealInSec: read each one beside its evidence, edit it, approve it, then send it from your own email app and record it.</p>
      </div>
      {!notSetUp && <Summary waiting={waitingQ.data?.items} sent={sentQ.data?.items} />}
      <SegmentedTabs label="Outreach messages" value={tab} onChange={(v) => { setTab(v); setOpenId(null); }}
        tabs={[{ value: "waiting", label: "Waiting for you", testId: "outreach-tab-waiting" }, { value: "sent", label: "Sent", testId: "outreach-tab-sent" }]} />

      {notSetUp ? (
        <p className="rounded-2xl border px-4 py-8 text-center text-sm text-muted-foreground">Outreach drafts aren't set up on this server yet.</p>
      ) : q.isError ? (
        <div className="rounded-2xl border border-destructive/40 px-4 py-6 text-center" role="alert"><p className="text-sm">{leadError(q.error, "The messages couldn't be loaded.")}</p><Button size="sm" variant="outline" className="mt-2" onClick={() => void q.refetch()}>Retry</Button></div>
      ) : !q.data ? (
        <ul className="divide-y rounded-xl border" aria-busy="true" aria-label="Loading messages">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3" aria-hidden>
              <span className="min-w-0 flex-1 space-y-1.5"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-3 w-2/3" /></span>
              <Skeleton className="h-5 w-28 rounded-full" />
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed px-4 py-10 text-center" data-testid="outreach-empty">
          <Inbox className="mx-auto mb-2 h-6 w-6 text-muted-foreground" aria-hidden />
          {tab === "waiting" ? (
            <>
              <p className="text-sm font-medium">Nothing waiting. Prepare first messages from Ready prospects.</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">Under All prospects, tick Ready prospects and choose Prepare drafts. Each draft waits here for you; nothing is sent.</p>
              {onShowReady && <Button size="sm" variant="outline" className="mt-3" onClick={onShowReady} data-testid="outreach-show-ready">Show Ready prospects</Button>}
            </>
          ) : <p className="text-sm text-muted-foreground">Nothing recorded as sent yet.</p>}
        </div>
      ) : (
        <ul className="divide-y rounded-xl border" data-testid="outreach-list">
          {items.map((i) => (
            <li key={i.message.id}>
              <button onClick={() => setOpenId(i.message.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none" data-testid={`outreach-item-${i.message.id}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{i.lead.companyName}</span>
                  <span className="block truncate text-xs text-muted-foreground">{i.message.subject || "(no subject)"} · to {i.recipient.address ?? "no address"}</span>
                  {i.message.status === "approved" && <span className="mt-0.5 block text-xs text-sky-800 dark:text-sky-300" data-testid="outreach-send-yourself">{SEND_YOURSELF}</span>}
                </span>
                {(i.suppressed || i.lead.doNotContact) && <span className="inline-flex items-center gap-1 rounded-full border border-red-300 px-2 py-0.5 text-[11px] text-red-700 dark:border-red-800 dark:text-red-400"><Ban className="h-3 w-3" />Do not contact</span>}
                {i.outcomes.map((o) => <span key={o} className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">{OUTCOME_LABEL[o as Outcome] ?? o}</span>)}
                <StatusChip status={i.message.status} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <SuppressionList canEdit={canEdit} />

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="outreach-sheet">
          {open && (
            <div className="space-y-5 pb-8">
              <SheetHeader className="space-y-1 text-left">
                <SheetTitle>{open.lead.companyName}</SheetTitle>
                <SheetDescription>{open.lead.domain ?? ""} · lead stage {open.lead.status}</SheetDescription>
                <div className="flex flex-wrap items-center gap-2 pt-1"><StatusChip status={open.message.status} />{open.message.status === "approved" && <span className="text-xs text-muted-foreground">{SEND_YOURSELF}</span>}</div>
              </SheetHeader>
              {(open.suppressed || open.lead.doNotContact) && (
                <p className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alert"><Ban className="mt-0.5 h-4 w-4 shrink-0" />This address or lead is on your do-not-contact list. Nothing can be approved for it or recorded as sent to it.</p>
              )}
              <section className="space-y-1" data-testid="outreach-recipient">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">To</h3>
                <p className="text-sm">{open.recipient.address ?? "No address"}</p>
                <p className="text-xs text-muted-foreground">{open.recipient.source === "lead" ? `The contact you chose${open.lead.contactName ? `: ${open.lead.contactName}${open.lead.contactRole ? `, ${open.lead.contactRole}` : ""}` : ""}. Found: ${open.recipient.detail ?? "not recorded"}.` : open.recipient.detail ?? "Source not recorded."}</p>
              </section>
              <section className="space-y-2" data-testid="outreach-evidence">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Written from these facts</h3>
                {open.evidence.length ? open.evidence.map((e) => (
                  <div key={e.id} className="rounded-lg border px-3 py-2 text-sm">
                    {/* A signal copied from AI Outbound already starts with its label ("Hiring: ..."): don't say it twice. */}
                    <p>{e.value.toLowerCase().startsWith(`${(FIELD[e.field] ?? e.field).toLowerCase()}:`) ? e.value : <><span className="text-xs text-muted-foreground">{FIELD[e.field] ?? e.field}:</span> {e.value}</>}</p>
                    {e.quote && <p className="mt-0.5 text-[11px] italic text-muted-foreground">“{e.quote}”</p>}
                    {e.url && <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:underline">{e.url.replace(/^https?:\/\//, "")}<ExternalLink className="h-2.5 w-2.5" /></a>}
                  </div>
                )) : <p className="text-sm text-muted-foreground">The facts this was written from are no longer on the lead.</p>}
                <p className="text-[11px] text-muted-foreground">Check the message says only what these show. Edit anything it doesn't.</p>
              </section>
              <OutreachPanel leadId={open.lead.id} />
              {open.message.status === "sent" && canEdit && (
                <section className="space-y-2" data-testid="outreach-outcomes">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">What happened</h3>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={outcome.isPending || open.outcomes.includes("replied")} onClick={() => outcome.mutate({ id: open.message.id, outcome: "replied" })} data-testid="outcome-replied"><MessageSquareReply className="mr-1.5 h-4 w-4" />They replied</Button>
                    <Button size="sm" variant="outline" disabled={outcome.isPending || open.outcomes.includes("bounced")} onClick={() => setConfirm({ id: open.message.id, outcome: "bounced" })} data-testid="outcome-bounced"><MailX className="mr-1.5 h-4 w-4" />It bounced</Button>
                    <Button size="sm" variant="outline" disabled={outcome.isPending || open.outcomes.includes("opted_out")} onClick={() => setConfirm({ id: open.message.id, outcome: "opted_out" })} data-testid="outcome-opted-out"><ShieldOff className="mr-1.5 h-4 w-4" />They asked not to be contacted</Button>
                  </div>
                </section>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.outcome === "opted_out" ? "Record an opt-out?" : "Record a bounce?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.outcome === "opted_out" ? "The address goes on your do-not-contact list for good, the lead is marked do-not-contact, and anything unsent to it is discarded." : "The address goes on your do-not-contact list (it doesn't receive mail), and anything unsent to it is discarded."} This can't be undone in the app.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirm) outcome.mutate(confirm); setConfirm(null); }} data-testid="outcome-confirm">Record it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function SuppressionList({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [show, setShow] = useState(false);
  const [value, setValue] = useState("");
  const q = useQuery<{ entries: Entry[] }>({ queryKey: [SUPPRESSIONS_URL], enabled: show, retry: false });
  const add = useMutation({
    mutationFn: () => leadCall<{ created: boolean; cancelled: number }>("POST", SUPPRESSIONS_URL, { value }),
    onSuccess: (r) => { setValue(""); void refreshLeads(); toast({ title: r.created ? "Added to your do-not-contact list" : "Already on your list", description: r.cancelled ? `${r.cancelled} unsent message${r.cancelled === 1 ? "" : "s"} to it discarded.` : undefined }); },
    onError: (e) => toast({ title: "Couldn't add it", description: leadError(e), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => leadCall("DELETE", `${SUPPRESSIONS_URL}/${id}`),
    onSuccess: () => void refreshLeads(),
    onError: (e) => toast({ title: "Couldn't remove it", description: leadError(e), variant: "destructive" }),
  });
  return (
    <section className="space-y-2" data-testid="suppression-list">
      <button onClick={() => setShow((v) => !v)} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-2 hover:underline"><Ban className="h-3.5 w-3.5" />{show ? "Hide" : "Show"} your do-not-contact list</button>
      {show && (
        <div className="space-y-3 rounded-xl border p-3">
          {canEdit && (
            <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (value.trim()) add.mutate(); }}>
              <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="name@company.com or company.com" className="h-8 max-w-xs text-sm" aria-label="Address or domain to never contact" maxLength={254} data-testid="suppression-input" />
              <Button size="sm" type="submit" disabled={!value.trim() || add.isPending} data-testid="suppression-add">{add.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Add</Button>
            </form>
          )}
          {q.isError ? <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5" />{leadError(q.error, "The list couldn't be loaded.")}</p>
            : !q.data ? <Skeleton className="h-10 w-full" />
            : q.data.entries.length === 0 ? <p className="text-xs text-muted-foreground">Nobody on the list yet. Opt-outs and bounces you record are added automatically.</p>
            : (
              <ul className="divide-y text-sm">
                {q.data.entries.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0 truncate">{e.kind === "domain" ? `Everyone at ${e.value}` : e.value} <span className="text-xs text-muted-foreground">· {e.reasonLabel}</span></span>
                    {canEdit && e.removable && <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => remove.mutate(e.id)} aria-label={`Remove ${e.value}`}><Trash2 className="h-3.5 w-3.5" /></Button>}
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
    </section>
  );
}
