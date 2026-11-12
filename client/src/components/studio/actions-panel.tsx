/**
 * Right panel: getting the message out, by the person. Where it goes, approve it, copy it or open the platform with it,
 * say "I sent it", record what they replied, plan a follow-up, and the recent activity on this channel. Copying and
 * opening are recorded as exactly that, never as a send; "sent" is only what the person says (or what their connected
 * Gmail did). Nothing here invents a delivery, an open or a read.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CalendarClock, Check, CheckCheck, Copy, ExternalLink, Loader2, MessageSquareReply, X as XIcon } from "lucide-react";
import { CHANNEL_LABEL, type Channel } from "@shared/channels";
import { ACTIVITY_LABEL, activityDetail } from "@shared/activity-text";
import { GmailSendState, SendFromGmailButton, useGmailCanSend } from "@/components/leads/gmail-send";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { channelMessageUrl } from "@/lib/channels";
import { leadCall, leadError, messageUrl, stageLabel, type LeadEventView, type LeadTicketView } from "@/lib/leads";
import {
  DESTINATION, HOW_YOU_SEND, OUTREACH_EVENT_KINDS, REPLY_OUTCOMES, copyText, eventChannel, followUpDoneUrl, followUpsUrl, handoffUrl,
  mailtoUrl, openLabel, openUrlFor, replyNoteUrl, type StudioMessage,
} from "@/lib/studio";
import { cn } from "@/lib/utils";

export interface ActionsPanelProps {
  leadId: number;
  company: string;
  channel: Channel;
  current: StudioMessage | null;
  leadEmail: string | null;
  doNotContact: boolean;
  events: LeadEventView[];
  tickets: LeadTicketView[];
  canEdit: boolean;
  /** Unsaved words in the composer: nothing is approved or handed out until they are saved. */
  dirty: boolean;
  pendingTo: string;
  setPendingTo: (v: string) => void;
  refresh: () => void;
}

const Spin = () => <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />;
const when = (d: string | Date) => new Date(d).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const day = (d: string | Date) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const isoDay = (offset: number) => { const d = new Date(Date.now() + offset * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function Block({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="space-y-2" data-testid={testId}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function ActionsPanel(p: ActionsPanelProps) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const gmail = useGmailCanSend();
  const m = p.current;
  const isEmail = p.channel === "email";
  const fail = (title: string) => (e: unknown) => { p.refresh(); toast({ title, description: leadError(e), variant: "destructive" }); };
  const act = (action: string, body: Record<string, unknown> = {}) =>
    leadCall(action === "edit" ? "PATCH" : "POST", m!.source === "email" ? messageUrl(m!.id, action === "edit" ? "" : action) : channelMessageUrl(m!.id, action === "edit" ? undefined : action), body);
  const handoff = (action: "copied" | "opened") => { void leadCall("POST", handoffUrl(p.leadId), { channel: p.channel, action, ...(m ? { messageId: m.id } : {}) }).then(p.refresh).catch(() => undefined); };

  /* destination */
  const [to, setTo] = useState(m?.to ?? "");
  useEffect(() => { setTo(m?.to ?? p.pendingTo); }, [m?.id, m?.to, p.channel]);
  const toEditable = !isEmail && p.canEdit && (!m || m.status === "draft" || m.status === "approved");
  const toDirty = !!m && toEditable && to.trim() !== (m.to ?? "");
  const saveTo = useMutation({ mutationFn: () => act("edit", { to: to.trim() || null }), onSuccess: () => { p.refresh(); toast({ title: "Saved" }); }, onError: fail("Couldn't save where it goes") });

  const approve = useMutation({ mutationFn: () => act("approve", { bodyHash: m!.bodyHash }), onSuccess: p.refresh, onError: fail("Couldn't approve it") });
  const markSent = useMutation({
    mutationFn: () => (m!.source === "email" ? act("sent") : act("sent", { bodyHash: m!.bodyHash })),
    onSuccess: () => { p.refresh(); toast({ title: "Recorded: you sent it", description: isEmail ? "A follow-up reminder is set for four days from now." : "Record their reply here when it comes." }); },
    onError: fail("Couldn't record it"),
  });
  const discard = useMutation({ mutationFn: () => act("cancel"), onSuccess: p.refresh, onError: fail("Couldn't discard it") });

  /** Email leaves only through the server's own check of the approved text (do-not-contact, the list, the exact words). */
  const emailHandOut = useMutation({
    mutationFn: (how: "copy" | "open") => leadCall<{ to: string; subject: string; body: string }>("POST", messageUrl(m!.id, "open"), { bodyHash: m!.bodyHash }).then((r) => ({ r, how })),
    onSuccess: async ({ r, how }) => {
      if (how === "open") { handoff("opened"); window.location.href = mailtoUrl(r.to, r.subject, r.body); return; }
      try { await navigator.clipboard.writeText(copyText({ channel: "email", subject: r.subject, body: r.body })); handoff("copied"); toast({ title: "Copied", description: "Copying doesn't send it. Paste it, send it, then press \"I sent it\"." }); }
      catch { toast({ title: "Couldn't copy", description: "Select the text and copy it yourself.", variant: "destructive" }); }
    },
    onError: fail("Couldn't hand it over"),
  });
  const copyShort = async () => {
    try { await navigator.clipboard.writeText(m!.body); handoff("copied"); toast({ title: "Copied", description: `Copying doesn't send it. Paste it on ${CHANNEL_LABEL[p.channel]}, send it, then press "I sent it".` }); }
    catch { toast({ title: "Couldn't copy", description: "Select the text and copy it yourself.", variant: "destructive" }); }
  };
  const iSentIt = async () => {
    const ok = await confirm({ title: isEmail ? "Did you send this email?" : `Did you send it on ${CHANNEL_LABEL[p.channel]}?`, description: "DealInSec records that you sent it yourself. It can't see your other apps, so it takes your word for it.", confirmText: "Yes, I sent it" });
    if (ok) markSent.mutate();
  };
  const discardIt = async () => {
    const ok = await confirm({ title: "Discard this draft?", description: "It's removed from this lead. Nothing was sent.", confirmText: "Discard", destructive: true });
    if (ok) discard.mutate();
  };

  /* reply + follow-up dialogs */
  const [replyOpen, setReplyOpen] = useState(false);
  const [fuOpen, setFuOpen] = useState(false);
  const followUps = p.tickets.filter((t) => t.kind === "follow_up" && t.status === "open").sort((a, b) => String(a.dueAt ?? "").localeCompare(String(b.dueAt ?? "")));
  const doneFu = useMutation({ mutationFn: (tid: number) => leadCall("POST", followUpDoneUrl(p.leadId, tid), {}), onSuccess: p.refresh, onError: fail("Couldn't close it") });

  const busy = approve.isPending || markSent.isPending || discard.isPending || emailHandOut.isPending || saveTo.isPending;
  const unsent = !!m && ["draft", "approved"].includes(m.status);
  const openHref = m && !isEmail ? openUrlFor({ channel: p.channel, to: m.to, subject: null, body: m.body }, p.company) : null;
  const activity = p.events.filter((e) => OUTREACH_EVENT_KINDS.has(e.kind) && (e.kind === "status_changed" || eventChannel(e) === p.channel)).slice(0, 8);
  const destination = isEmail ? (m?.to ?? p.leadEmail) : null;

  return (
    <section aria-labelledby="studio-actions-h" className="space-y-5" data-testid="studio-actions">
      <h2 id="studio-actions-h" className="sr-only">Send and follow up</h2>

      <Block title="Where it goes" testId="studio-destination">
        {isEmail ? (
          destination ? <p className="break-all text-sm font-medium">{destination}</p> : <p className="text-sm text-muted-foreground">{DESTINATION.email.missing}</p>
        ) : (
          <div className="space-y-1.5">
            <label htmlFor="studio-to" className="sr-only">{DESTINATION[p.channel].label}</label>
            <div className="flex gap-1.5">
              <Input id="studio-to" value={to} placeholder={DESTINATION[p.channel].placeholder} disabled={!toEditable || busy}
                onChange={(e) => { setTo(e.target.value); if (!m) p.setPendingTo(e.target.value); }} inputMode={p.channel === "whatsapp" ? "tel" : "text"} autoComplete="off" data-testid="studio-to" />
              {toDirty && <Button size="sm" variant="outline" className="h-10" onClick={() => saveTo.mutate()} disabled={busy}>{saveTo.isPending ? <Spin /> : "Save"}</Button>}
            </div>
            <p className="text-xs text-muted-foreground">{DESTINATION[p.channel].label}{!to.trim() ? `. ${DESTINATION[p.channel].missing}` : ""}</p>
          </div>
        )}
        {p.doNotContact && <p className="text-xs font-medium text-destructive">This lead is marked do-not-contact.</p>}
      </Block>

      <Block title="Send it yourself" testId="studio-send">
        <p className="text-sm text-muted-foreground">{isEmail && !gmail.ready ? "Open it in your email app and send it there, or copy it. (Connect Gmail in Settings to send from here.)" : HOW_YOU_SEND[p.channel]}</p>
        {m && <p className="text-sm" data-testid="studio-state">Now: <span className="font-semibold">{m.stateLabel}</span>{m.sentAt && m.status === "sent" ? <span className="text-muted-foreground"> · {day(m.sentAt)}</span> : null}</p>}
        {!m && <p className="text-sm text-muted-foreground">Write the message first (in the middle).</p>}

        {m && p.canEdit && (
          <div className="sticky-actions flex flex-col gap-2">
            {m.status === "draft" && (
              <Button onClick={() => approve.mutate()} disabled={busy || p.dirty} title={p.dirty ? "Save your changes first" : undefined} data-testid="studio-approve">
                {approve.isPending ? <Spin /> : <Check className="mr-1.5 h-4 w-4" />}Approve this message
              </Button>
            )}
            {m.status === "draft" && <p className="text-xs text-muted-foreground">{p.dirty ? "Save your changes, then approve." : "Read it once more. Approving locks this text for sending."}</p>}

            {m.status === "approved" && (
              <>
                {isEmail && <SendFromGmailButton messageId={m.id} bodyHash={m.bodyHash} to={m.to} disabled={busy || p.dirty || p.doNotContact} />}
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => (isEmail ? emailHandOut.mutate("copy") : void copyShort())} disabled={busy || p.dirty} data-testid="studio-copy">
                    {emailHandOut.isPending && emailHandOut.variables === "copy" ? <Spin /> : <Copy className="mr-1.5 h-4 w-4" />}Copy
                  </Button>
                  {isEmail ? (
                    <Button variant="outline" onClick={() => emailHandOut.mutate("open")} disabled={busy || p.dirty || !m.to} data-testid="studio-open">
                      {emailHandOut.isPending && emailHandOut.variables === "open" ? <Spin /> : <ExternalLink className="mr-1.5 h-4 w-4" />}Email app
                    </Button>
                  ) : openHref ? (
                    <Button variant="outline" asChild disabled={p.dirty}>
                      <a href={openHref} target="_blank" rel="noopener noreferrer" onClick={() => handoff("opened")} data-testid="studio-open">
                        <ExternalLink className="mr-1.5 h-4 w-4" />{p.channel === "whatsapp" ? "WhatsApp" : m.to ? CHANNEL_LABEL[p.channel] : "Find them"}
                      </a>
                    </Button>
                  ) : (
                    <Button variant="outline" disabled title={DESTINATION[p.channel].missing}><ExternalLink className="mr-1.5 h-4 w-4" />{CHANNEL_LABEL[p.channel]}</Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{isEmail ? `${openLabel("email")} fills in the email; you press send there.` : p.channel === "whatsapp" ? "WhatsApp opens with the message filled in." : `Paste the message on ${CHANNEL_LABEL[p.channel]} and send it there.`}</p>
                <Button onClick={() => void iSentIt()} disabled={busy || p.dirty} variant={isEmail && gmail.ready ? "outline" : "default"} data-testid="studio-mark-sent">
                  {markSent.isPending ? <Spin /> : <CheckCheck className="mr-1.5 h-4 w-4" />}I sent it
                </Button>
                {isEmail && <GmailSendState messageId={m.id} messageStatus={m.status} />}
              </>
            )}
            {isEmail && m.status === "sending" && <GmailSendState messageId={m.id} messageStatus={m.status} />}
            {(m.status === "uncertain" || m.status === "failed") && <p className="text-sm text-muted-foreground">Open the lead page to settle this message.</p>}

            {m.status === "sent" && (
              <div className="grid gap-2">
                <Button variant="outline" onClick={() => setReplyOpen(true)} data-testid="studio-record-reply"><MessageSquareReply className="mr-1.5 h-4 w-4" />{m.repliedAt ? "Add a note about their reply" : "They replied"}</Button>
                <Button variant="outline" onClick={() => setFuOpen(true)} data-testid="studio-follow-up"><CalendarClock className="mr-1.5 h-4 w-4" />Plan a follow-up</Button>
              </div>
            )}
            {unsent && <Button variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={() => void discardIt()} disabled={busy} data-testid="studio-discard"><XIcon className="mr-1.5 h-4 w-4" />Discard draft</Button>}
          </div>
        )}
      </Block>

      <Block title="Follow-ups" testId="studio-followups">
        {followUps.length === 0 ? (
          <p className="text-sm text-muted-foreground">None planned.{m?.status === "sent" ? "" : " You can plan one after you send."}</p>
        ) : (
          <ul className="space-y-1.5">
            {followUps.slice(0, 4).map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/70 px-2.5 py-1.5 text-sm">
                <span className="min-w-0"><span className="block truncate">{t.title}</span>{t.dueAt && <span className="text-xs text-muted-foreground">Due {day(t.dueAt)}</span>}</span>
                {p.canEdit && <Button size="sm" variant="ghost" className="h-8 shrink-0 px-2 text-xs" onClick={() => doneFu.mutate(t.id)} disabled={doneFu.isPending} aria-label={`Mark "${t.title}" done`}>Done</Button>}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">Reminders only. DealInSec never sends a follow-up by itself.</p>
      </Block>

      <Block title="Recent activity" testId="studio-activity">
        <p className="-mt-1 text-xs text-muted-foreground">On {CHANNEL_LABEL[p.channel]}, plus the lead's stage changes.</p>
        {activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ol className="relative space-y-3 border-l border-border/70 pl-4">
            {activity.map((e) => {
              const detail = activityDetail(e.kind, (e.data ?? {}) as Record<string, unknown>, stageLabel);
              return (
                <li key={e.id} className="relative text-sm">
                  <span aria-hidden className={cn("absolute -left-[21px] top-1.5 h-2 w-2 rounded-full", e.kind.includes("sent") ? "bg-primary" : "bg-muted-foreground/40")} />
                  <p className="font-medium leading-tight">{ACTIVITY_LABEL[e.kind] ?? e.kind}</p>
                  {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
                  <p className="text-[11px] text-muted-foreground">{when(e.createdAt)}</p>
                </li>
              );
            })}
          </ol>
        )}
      </Block>

      {m && <ReplyDialog open={replyOpen} onOpenChange={setReplyOpen} leadId={p.leadId} channel={p.channel} message={m} refresh={p.refresh} />}
      <FollowUpDialog open={fuOpen} onOpenChange={setFuOpen} leadId={p.leadId} channel={p.channel} refresh={p.refresh} />
    </section>
  );
}

function ReplyDialog({ open, onOpenChange, leadId, channel, message, refresh }: { open: boolean; onOpenChange: (v: boolean) => void; leadId: number; channel: Channel; message: StudioMessage; refresh: () => void }) {
  const { toast } = useToast();
  const [outcome, setOutcome] = useState<string>("interested");
  const [note, setNote] = useState("");
  useEffect(() => { if (open) { setOutcome("interested"); setNote(""); } }, [open]);
  const save = useMutation({
    mutationFn: async () => {
      // The reply itself first (it stops this lead's follow-up drafts and moves the stage), then what it said.
      if (!message.repliedAt) {
        if (message.source === "email") await leadCall("POST", messageUrl(message.id, "outcome"), { outcome: "replied" });
        else await leadCall("POST", channelMessageUrl(message.id, "reply"), {});
      }
      await leadCall("POST", replyNoteUrl(leadId), { channel, outcome, ...(note.trim() ? { note: note.trim() } : {}), messageId: message.id });
    },
    onSuccess: () => { refresh(); onOpenChange(false); toast({ title: "Reply recorded", description: "Follow-up drafts for this lead are stopped." }); },
    onError: (e) => { refresh(); toast({ title: "Couldn't record it", description: leadError(e), variant: "destructive" }); },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="studio-reply-dialog">
        <DialogHeader>
          <DialogTitle>What did they reply?</DialogTitle>
          <DialogDescription>You're recording this yourself. DealInSec doesn't read your {CHANNEL_LABEL[channel]} messages.</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Their reply" className="grid grid-cols-2 gap-2">
          {REPLY_OUTCOMES.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={outcome === o.value} onClick={() => setOutcome(o.value)}
              className={cn("min-h-[44px] rounded-lg border px-3 py-2 text-left text-sm", outcome === o.value ? "border-primary bg-primary/10 font-semibold" : "hover:bg-muted")}>{o.label}</button>
          ))}
        </div>
        <div className="space-y-1">
          <label htmlFor="studio-reply-note" className="text-sm font-medium">Note (optional)</label>
          <Textarea id="studio-reply-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} placeholder="e.g. Asked for a quote by Friday" />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="studio-reply-save">{save.isPending ? <Spin /> : <Check className="mr-1.5 h-4 w-4" />}Record reply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FollowUpDialog({ open, onOpenChange, leadId, channel, refresh }: { open: boolean; onOpenChange: (v: boolean) => void; leadId: number; channel: Channel; refresh: () => void }) {
  const { toast } = useToast();
  const [dueOn, setDueOn] = useState(isoDay(4));
  const [note, setNote] = useState("");
  useEffect(() => { if (open) { setDueOn(isoDay(4)); setNote(""); } }, [open]);
  const save = useMutation({
    mutationFn: () => leadCall("POST", followUpsUrl(leadId), { channel, dueOn, ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: () => { refresh(); onOpenChange(false); toast({ title: "Follow-up planned", description: "It shows in your follow-ups on the day. Nothing is sent by itself." }); },
    onError: (e) => toast({ title: "Couldn't plan it", description: leadError(e), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="studio-followup-dialog">
        <DialogHeader>
          <DialogTitle>Plan a follow-up on {CHANNEL_LABEL[channel]}</DialogTitle>
          <DialogDescription>A reminder for you. DealInSec never sends it by itself.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="studio-fu-date" className="text-sm font-medium">On</label>
            <Input id="studio-fu-date" type="date" value={dueOn} min={isoDay(0)} max={isoDay(365)} onChange={(e) => setDueOn(e.target.value)} data-testid="studio-fu-date" />
          </div>
          <div className="space-y-1">
            <label htmlFor="studio-fu-note" className="text-sm font-medium">Note (optional)</label>
            <Input id="studio-fu-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Share two sample designs" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)} data-testid="studio-fu-save">{save.isPending ? <Spin /> : <CalendarClock className="mr-1.5 h-4 w-4" />}Plan it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
