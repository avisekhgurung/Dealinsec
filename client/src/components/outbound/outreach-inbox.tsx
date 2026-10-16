/**
 * The outreach inbox (AI Outbound → Inbox): every conversation Gmail reply sync linked to an outreach, what each
 * reply says (labelled by fixed rules, or by you; never by AI), and what to do next. Replies are plain text shown as
 * text. Messages matched only by their sender's address wait in "Might be for your leads", visible to you alone.
 *
 * Desktop: the list and the open conversation side by side. Phone: one at a time, with Back. The open conversation is
 * in the address (?view=inbox&thread=ID), so Back and links work.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, Handshake, Inbox, Loader2, MailQuestion, RefreshCw, Search, Send, ShieldOff, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useGmailStatus, useSyncGmail } from "@/lib/gmail";
import { refreshInbox, useConversation, useInbox, useRelabel, useReviewDecision, useReviewQueue } from "@/lib/inbox";
import { leadError } from "@/lib/leads";
import { cn } from "@/lib/utils";
import { FOLLOWUP_STATUS_TEXT, INBOX_FILTERS, INBOX_FILTER_TEXT, REPLY_LABELS, REPLY_LABEL_TEXT, THREAD_STATUS_TEXT, type ConversationMessage, type InboxFilter, type InboxItem, type ReplyLabel, type ThreadStatus } from "@shared/inbox-view";
import { REPLY_SYNC_TEXT } from "@shared/gmail-connect";

const TONE: Record<ThreadStatus, string> = {
  awaiting: "border-border bg-muted text-muted-foreground",
  replied: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  interested: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  not_interested: "border-border bg-muted text-foreground/80",
  opted_out: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
  bounced: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
  needs_review: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
};
const when = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso), now = new Date();
  return d.toDateString() === now.toDateString() ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};
const fullWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");

function StatusChip({ status }: { status: ThreadStatus }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", TONE[status])} data-testid="inbox-status" data-state={status}>{THREAD_STATUS_TEXT[status].label}</span>;
}

/** Gmail and reply sync, as far as the inbox is concerned: connected and syncing, or what to fix in Settings. */
function SyncBar() {
  const { toast } = useToast();
  const { data } = useGmailStatus();
  const sync = useSyncGmail();
  if (!data) return null;
  const rs = data.replySync;
  const settings = <Link href="/settings?tab=integrations" className="font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400">Settings</Link>;
  if (!data.connection) return <p className="rounded-lg border bg-muted/40 p-3 text-sm" data-testid="inbox-sync" data-state="disconnected">Connect your Gmail in {settings} to see replies to your outreach here.</p>;
  if (!rs?.available) return <p className="rounded-lg border bg-muted/40 p-3 text-sm" data-testid="inbox-sync" data-state="off">Reply sync isn't switched on for your workspace yet, so only conversations synced earlier appear here.</p>;
  if (rs.state === "needs_permission" || rs.state === "needs_reconnect") {
    return <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40" role="status" data-testid="inbox-sync" data-state={rs.state}><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden /><span>{REPLY_SYNC_TEXT[rs.state]} Go to {settings}.</span></p>;
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground" data-testid="inbox-sync" data-state={rs.state}>
      <span>{rs.state === "retrying" ? REPLY_SYNC_TEXT.retrying : rs.lastSyncedAt ? `Replies checked ${when(rs.lastSyncedAt)} from ${data.connection.accountEmail}` : REPLY_SYNC_TEXT.starting}</span>
      <Button size="sm" variant="outline" disabled={sync.isPending} data-testid="inbox-check-now"
        onClick={() => sync.mutate(undefined, {
          onSuccess: (r) => { void refreshInbox(); toast({ title: r.outcome === "busy" ? "Already checking" : r.stored ? `${r.stored} new message${r.stored === 1 ? "" : "s"}` : "No new replies" }); },
          onError: (e) => toast({ title: "Couldn't check right now", description: leadError(e), variant: "destructive" }),
        })}>
        {sync.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden />}Check now
      </Button>
    </div>
  );
}

/** Messages from your mailbox that might belong to a lead (the sender's address matched): confirm or dismiss. Only you see these. */
function ReviewQueue() {
  const { toast } = useToast();
  const q = useReviewQueue(true);
  const decide = useReviewDecision();
  const [open, setOpen] = useState(false);
  const items = q.data?.items ?? [];
  if (!items.length) return null;
  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-950/30" aria-labelledby="review-title" data-testid="inbox-review">
      <button type="button" className="flex w-full items-center justify-between gap-2 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span id="review-title" className="flex items-center gap-2 text-sm font-semibold"><MailQuestion className="h-4 w-4 text-amber-600" aria-hidden />{items.length} message{items.length === 1 ? "" : "s"} might be for your leads</span>
        <span className="text-xs text-muted-foreground">{open ? "Hide" : "Review"}</span>
      </button>
      {open && (
        <ul className="mt-3 space-y-3">
          <li className="text-xs text-muted-foreground">Only the sender's address matched someone you wrote to. Only you can see these until you confirm them.</li>
          {items.map((i) => (
            <li key={i.mailMessageId} className="rounded-lg border bg-background p-3 text-sm" data-testid="review-item">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-medium">{i.fromName ? `${i.fromName} · ` : ""}{i.from}</span>
                <span className="text-xs text-muted-foreground">{fullWhen(i.sentAt)}</span>
              </div>
              <div className="text-xs text-muted-foreground">Might be about <span className="font-medium text-foreground">{i.company}</span> · {i.subject || "(no subject)"}</div>
              {i.text && <p className="mt-2 line-clamp-4 whitespace-pre-wrap break-words text-foreground/90">{i.text}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: i.mailMessageId, decision: "confirm" }, { onSuccess: () => toast({ title: `Added to the ${i.company} conversation` }), onError: (e) => toast({ title: "Couldn't confirm", description: leadError(e), variant: "destructive" }) })} data-testid="review-confirm">
                  <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden />Yes, it's about {i.company}
                </Button>
                <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: i.mailMessageId, decision: "dismiss" }, { onError: (e) => toast({ title: "Couldn't dismiss", description: leadError(e), variant: "destructive" }) })} data-testid="review-dismiss">Not related</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({ item, active, onOpen }: { item: InboxItem; active: boolean; onOpen: () => void }) {
  const f = item.followup;
  return (
    <li>
      <button type="button" onClick={onOpen} aria-current={active ? "true" : undefined} data-testid="inbox-row" data-thread={item.threadId}
        className={cn("w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500", active ? "border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30" : "bg-background hover:bg-muted/50")}>
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 truncate font-semibold">{item.company}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{when(item.lastMessageAt)}</span>
        </div>
        <div className="truncate text-sm text-muted-foreground">{item.subject || "(no subject)"}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <StatusChip status={item.status} />
          {item.replies > 0 && <span className="text-[11px] text-muted-foreground">{item.replies} repl{item.replies === 1 ? "y" : "ies"}</span>}
          {item.pendingReview > 0 && <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">review needed</span>}
          {f && <span className="text-[11px] text-muted-foreground">Follow-up {f.step}: {f.status === "scheduled" ? `due ${when(f.dueAt)}` : FOLLOWUP_STATUS_TEXT[f.status]?.toLowerCase()}</span>}
        </div>
      </button>
    </li>
  );
}

function Message({ m, canWrite }: { m: ConversationMessage; canWrite: boolean }) {
  const { toast } = useToast();
  const relabel = useRelabel();
  const decide = useReviewDecision();
  const id = Number(m.id.slice(2));
  const ours = m.direction === "out";
  const title = m.kind === "outreach" ? "Your outreach" : m.kind === "followup" ? "Your follow-up" : m.kind === "own_reply" ? "Your reply (from Gmail)" : m.kind === "bounce" ? "Delivery failure" : m.kind === "auto_reply" ? "Automatic reply" : m.fromName || m.from || "Reply";
  return (
    <li className={cn("flex", ours ? "justify-end" : "justify-start")} data-testid="conversation-message" data-direction={m.direction} data-kind={m.kind}>
      <article className={cn("w-full max-w-[42rem] rounded-xl border p-3 text-sm sm:w-[90%]", ours ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20" : "bg-background")} aria-label={title}>
        <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="font-semibold">{title}</span>
          <time className="text-xs text-muted-foreground" dateTime={m.at ?? undefined}>{fullWhen(m.at)}</time>
        </header>
        <div className="text-xs text-muted-foreground break-all">
          {!ours && m.from && <>From {m.from} · </>}To {m.to.join(", ") || "—"}
          {ours && m.status && m.status !== "sent" && <> · <span className="font-medium">{m.status === "draft" ? "draft, waiting for your review" : m.status === "approved" ? "approved, not sent" : m.status === "sending" ? "sending" : m.status}</span></>}
          {ours && m.sendState && <> · {m.sendState === "sent" ? "sent from Gmail" : m.sendState === "uncertain" ? "outcome uncertain: check your Gmail Sent folder" : m.sendState}</>}
        </div>
        {m.subject && <div className="mt-1 text-xs font-medium">{m.subject}</div>}
        {m.text ? <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{m.text}</p> : m.textNote && <p className="mt-2 text-xs italic text-muted-foreground">{m.textNote}</p>}
        {m.review?.state === "pending" && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-800 dark:bg-amber-950/40" role="status">
            This came from a different address than the one you wrote to (a colleague, or a forward). Follow-ups are paused until you decide.
            {canWrite && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id, decision: "confirm" }, { onError: (e) => toast({ title: "Couldn't confirm", description: leadError(e), variant: "destructive" }) })}>It's their reply</Button>
                <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id, decision: "dismiss" })}>Not related</Button>
              </div>
            )}
          </div>
        )}
        {!ours && m.label && m.review?.state !== "pending" && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">{m.labelBy === "user" ? "You marked this:" : "Reads as:"}</span>
            {canWrite ? (
              <Select value={m.label} onValueChange={(v) => relabel.mutate({ id, label: v as ReplyLabel }, { onSuccess: () => toast({ title: "Label changed", description: v === "opt_out" ? "They're on your do-not-contact list now." : undefined }), onError: (e) => toast({ title: "Couldn't change the label", description: leadError(e), variant: "destructive" }) })}>
                <SelectTrigger className="h-7 w-auto gap-1 px-2 text-xs" aria-label="What this reply says" data-testid="reply-label"><SelectValue /></SelectTrigger>
                <SelectContent>{REPLY_LABELS.map((l) => <SelectItem key={l} value={l}>{REPLY_LABEL_TEXT[l]}</SelectItem>)}</SelectContent>
              </Select>
            ) : <span className="font-medium">{REPLY_LABEL_TEXT[m.label]}</span>}
            {m.labelBy !== "user" && <span className="text-muted-foreground">(by fixed rules, not AI: check it)</span>}
          </div>
        )}
      </article>
    </li>
  );
}

function Conversation({ threadId, onBack }: { threadId: number; onBack: () => void }) {
  const q = useConversation(threadId);
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (q.data) head.current?.focus(); }, [q.data?.thread.id]);
  if (q.isLoading) return <div className="space-y-3 p-1" aria-busy="true"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-4/5" /></div>;
  if (q.isError || !q.data) {
    return <div className="rounded-lg border p-4 text-sm" role="alert">That conversation couldn't be loaded. <Button size="sm" variant="outline" className="ml-2" onClick={() => q.refetch()}>Try again</Button></div>;
  }
  const { thread: t, messages, followups, canWrite } = q.data;
  const next = THREAD_STATUS_TEXT[t.status];
  return (
    <section aria-labelledby="conversation-title" data-testid="conversation">
      <div className="mb-3 flex items-start gap-2">
        <Button variant="ghost" size="icon" className="-ml-2 shrink-0 lg:hidden" onClick={onBack} aria-label="Back to the inbox"><ArrowLeft className="h-5 w-5" /></Button>
        <div className="min-w-0 flex-1">
          <h2 id="conversation-title" ref={head} tabIndex={-1} className="truncate text-lg font-bold outline-none">{t.company}</h2>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><StatusChip status={t.status} /><span className="break-all">{t.contact}</span></div>
        </div>
      </div>
      <div className="mb-3 rounded-lg border bg-muted/30 p-3 text-sm" data-testid="conversation-next"><span className="font-medium">Next: </span>{next.next}</div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline"><Link href={`/leads/${t.leadId}`}>Open the lead</Link></Button>
        {t.dealId ? <Button asChild size="sm" variant="outline"><Link href={`/deals/${t.dealId}`}><Handshake className="mr-1.5 h-4 w-4" aria-hidden />Open the deal</Link></Button>
          : t.canConvert && t.status === "interested" && canWrite && <Button asChild size="sm" className="gradient-btn text-white" data-testid="review-create-deal"><Link href={`/leads/${t.leadId}?createDeal=1`}><Handshake className="mr-1.5 h-4 w-4" aria-hidden />Review and create deal</Link></Button>}
        {t.gmailUrl && <Button asChild size="sm" variant="outline"><a href={t.gmailUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1.5 h-4 w-4" aria-hidden />Reply in Gmail</a></Button>}
      </div>
      <ol className="space-y-3" aria-label="Messages, oldest first">{messages.map((m) => <Message key={m.id} m={m} canWrite={canWrite} />)}</ol>
      {followups.length > 0 && (
        <div className="mt-4 rounded-lg border p-3 text-sm" data-testid="conversation-followups">
          <div className="mb-1 font-semibold">Follow-ups</div>
          <ul className="space-y-1">
            {followups.map((f) => (
              <li key={f.step} className="flex flex-wrap items-center gap-x-2">
                {f.status === "cancelled" || f.status === "skipped" ? <XCircle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> : f.status === "sent" ? <Send className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> : <Inbox className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
                <span>Follow-up {f.step}: {FOLLOWUP_STATUS_TEXT[f.status] ?? f.status}{f.status === "scheduled" ? `, due ${fullWhen(f.dueAt)}` : ""}{f.reason === "replied" ? " (they replied)" : f.reason === "opted_out" ? " (they asked not to be contacted)" : f.reason === "bounced" ? " (the address bounced)" : ""}</span>
                {f.status === "drafted" && <Link href={`/leads/${t.leadId}`} className="text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400">Review the draft</Link>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">Follow-ups are drafts for you to review and approve. Nothing is sent automatically, and none is drafted once they reply.</p>
        </div>
      )}
    </section>
  );
}

export function OutreachInbox() {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const threadId = Number(params.get("thread")) || null;
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const list = useInbox(filter, q);
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const counts = list.data?.pages[0]?.counts;
  const open = (id: number | null) => {
    const p = new URLSearchParams(search);
    p.set("view", "inbox");
    if (id) p.set("thread", String(id)); else p.delete("thread");
    navigate(`${location}?${p}`, { replace: !id });
  };

  return (
    <div className="space-y-4" data-testid="outreach-inbox">
      <SyncBar />
      <ReviewQueue />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className={cn("min-w-0 space-y-3", threadId && "hidden lg:block")}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search company, subject or address" className="pl-8" aria-label="Search conversations" maxLength={80} data-testid="inbox-search" />
          </div>
          <div className="relative -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:flex-wrap lg:overflow-visible" role="tablist" aria-label="Show">
            {INBOX_FILTERS.map((f) => (
              <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} data-testid={`inbox-filter-${f}`}
                className={cn("shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors", filter === f ? "border-emerald-600 bg-emerald-600 text-white" : "bg-background hover:bg-muted")}>
                {INBOX_FILTER_TEXT[f]}{counts ? ` · ${counts[f]}` : ""}
              </button>
            ))}
          </div>
          {list.isLoading ? <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
            : list.isError ? <div className="rounded-lg border p-4 text-sm" role="alert">{leadError(list.error, "The inbox couldn't be loaded.")} <Button size="sm" variant="outline" className="ml-2" onClick={() => list.refetch()}>Try again</Button></div>
              : !items.length ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="inbox-empty">
                  <Inbox className="mx-auto mb-2 h-6 w-6" aria-hidden />
                  {q ? "Nothing matches that search." : filter === "all" ? "No conversations yet. When someone replies to outreach you sent from your connected Gmail, it shows up here." : `Nothing under "${INBOX_FILTER_TEXT[filter]}".`}
                </div>
              ) : (
                <>
                  <ul className="space-y-2" aria-label="Conversations">{items.map((i) => <Row key={i.threadId} item={i} active={i.threadId === threadId} onOpen={() => open(i.threadId)} />)}</ul>
                  {list.hasNextPage && <Button variant="outline" className="w-full" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>{list.isFetchingNextPage && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Load more</Button>}
                </>
              )}
        </div>
        <div className={cn("min-w-0", !threadId && "hidden lg:block")}>
          {threadId ? <Conversation threadId={threadId} onBack={() => open(null)} />
            : <div className="flex h-full min-h-[12rem] items-center justify-center rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground"><span><ShieldOff className="mx-auto mb-2 h-5 w-5" aria-hidden />Pick a conversation to read it. Replies are read by fixed rules only: no AI ever sees your email.</span></div>}
        </div>
      </div>
    </div>
  );
}
