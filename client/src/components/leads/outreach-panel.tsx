/**
 * The first message to a lead: written by the AI from verified facts, read and edited by a person, approved, then sent
 * by the person: from their own email app ("Open in my email app" hands the approved text over, "I sent it" records
 * it), or from their connected Gmail ("Send from my Gmail", gmail-send.tsx), which sends exactly the approved text once.
 * While a Gmail send is in flight or uncertain ("sending"), nothing else can send, change or discard the message.
 */
import { trackEvent } from "@/lib/analytics";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ProfileStyleView } from "@shared/acquisition-profile";
import type { FollowUpView } from "@shared/campaign";
import { ProfileStyleNote } from "./profile-style-note";
import { useEffect, useState } from "react";
import { Check, Copy, Loader2, Mail, Pencil, PenLine, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { draftUrl, leadCall, leadError, messageUrl, messagesUrl, refreshLeads } from "@/lib/leads";
import { chipText, chipTone, pendingVariants, shortcomings } from "@/lib/outreach-variants";
import { memberCan } from "@shared/permissions";
import { GmailSendState, SendFromGmailButton, useGmailCanSend } from "./gmail-send";
import { LIMITS } from "@shared/outreach-check";
import { STRATEGY_HINT, STRATEGY_LABEL, type OutreachStrategy } from "@shared/outreach-strategy";
import type { Scorecard } from "@shared/draft-scorecard";

interface Message {
  id: number; status: "variant" | "draft" | "approved" | "sending" | "sent" | "cancelled"; subject: string; body: string; bodyHash: string;
  to: string | null; toSource: "lead" | "site" | null; edited: boolean; createdBy: string; createdAt: string; approvedAt: string | null; sentAt: string | null;
  strategy?: string | null; variantGroup?: string | null; scorecard?: Scorecard;
}
/** What a person who has sent the first message should expect next, from the lead's own follow-up. */
const afterSent = (f: FollowUpView | null | undefined): string => {
  if (f?.state === "due_later") {
    const day = (() => { try { return f.dueAt ? new Date(f.dueAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : ""; } catch { return ""; } })();
    return `A follow-up is planned${day ? ` for ${day}` : ""}: a draft will be prepared here for you to read. It is never sent by itself, and a reply cancels it.`;
  }
  if (f?.state === "on_hold") return "The follow-up is on hold: a reply is waiting for you to read.";
  return "No follow-up is planned: after a reply, the conversation carries on in your email.";
};
const when = (iso: string | null) => { try { return iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""; } catch { return ""; } };
const SOURCE: Record<string, string> = { lead: "the address you recorded", site: "a business address found on their website" };

/** A mail program wants line breaks as CRLF. */
export const mailtoFor = (m: Pick<Message, "to" | "subject" | "body">) =>
  `mailto:${encodeURIComponent(m.to ?? "").replace(/%40/g, "@")}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body.replace(/\r?\n/g, "\r\n"))}`;

export function OutreachPanel({ leadId }: { leadId: number }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const canRun = memberCan(user as any, "deals.create");
  const gmail = useGmailCanSend(); // only offered (and mentioned) where this person can really send from Gmail
  const q = useQuery<{ messages: Message[]; sample?: { title: string; scope: string } | null; /** Older servers omit it. */ style?: ProfileStyleView | null; /** Older servers omit it. */ followUp?: FollowUpView | null }>({ queryKey: [messagesUrl(leadId)], retry: false });
  const sample = q.data?.sample ?? null;
  // Offering the plan's sample commits the person's time, so it's their choice, off until they tick it.
  const [offerSample, setOfferSample] = useState(false);
  const current = q.data?.messages.find((m) => m.status === "draft" || m.status === "approved" || m.status === "sending") ?? null;
  const lastSent = q.data?.messages.find((m) => m.status === "sent") ?? null;
  const variants = pendingVariants(q.data?.messages ?? []);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState(false);
  // The text on screen follows the saved message; a new id or a saved edit resets what is being typed.
  useEffect(() => { setSubject(current?.subject ?? ""); setBody(current?.body ?? ""); setEditing(false); }, [current?.id, current?.bodyHash]);

  const done = () => { void refreshLeads(); };
  const fail = (title: string) => (e: unknown) => toast({ title, description: leadError(e), variant: "destructive" });
  const draft = useMutation({ mutationFn: () => leadCall("POST", draftUrl(leadId), { offerSample: !!sample && offerSample }), onSuccess: done, onError: fail("Couldn't write the message") });
  const writeVariants = useMutation({ mutationFn: () => leadCall("POST", draftUrl(leadId), { offerSample: !!sample && offerSample, variants: true }), onSuccess: done, onError: fail("Couldn't write the versions") });
  // Choosing re-checks everything server-side (the exact text read, the lead's flag, the list); a refusal refreshes the page's picture of the batch.
  const choose = useMutation({ mutationFn: (v: Message) => leadCall("POST", messageUrl(v.id, "choose"), { bodyHash: v.bodyHash }), onSuccess: done, onError: (e) => { done(); fail("Couldn't use that version")(e); } });
  const discardAll = useMutation({ mutationFn: () => leadCall("POST", messageUrl(variants[0]!.id, "cancel"), {}), onSuccess: done, onError: (e) => { done(); fail("Couldn't discard them")(e); } });
  const save = useMutation({ mutationFn: () => leadCall("PATCH", messageUrl(current!.id), { subject, body }), onSuccess: done, onError: fail("Couldn't save your changes") });
  // Activation: a reviewed and approved draft (not merely generated), and a message recorded as sent.
  const approve = useMutation({ mutationFn: () => leadCall("POST", messageUrl(current!.id, "approve"), { bodyHash: current!.bodyHash }), onSuccess: () => { trackEvent("outreach_draft_approved", { source: "lead", edited: !!current?.edited, by_ai: current?.createdBy === "agent" }); done(); }, onError: fail("Couldn't approve it") });
  const sent = useMutation({ mutationFn: () => leadCall("POST", messageUrl(current!.id, "sent"), {}), onSuccess: () => { trackEvent("outreach_marked_sent", { source: "lead" }); done(); toast({ title: "Recorded as sent", description: "A follow-up is set for four days from now." }); }, onError: fail("Couldn't record it") });
  const cancel = useMutation({ mutationFn: () => leadCall("POST", messageUrl(current!.id, "cancel"), {}), onSuccess: done, onError: fail("Couldn't discard it") });
  // The approved text leaves the app only through the server, checked at that moment (the lead's do-not-contact flag, the
  // organization's list, the exact text approved): never from what this page happens to hold.
  const handOut = useMutation({
    mutationFn: (how: "open" | "copy") => leadCall<{ to: string; subject: string; body: string }>("POST", messageUrl(current!.id, "open"), { bodyHash: current!.bodyHash }).then((r) => ({ r, how })),
    onSuccess: async ({ r, how }) => {
      if (how === "open") { window.location.href = mailtoFor(r); return; }
      try { await navigator.clipboard.writeText(`Subject: ${r.subject}\n\n${r.body}`); toast({ title: "Copied" }); }
      catch { toast({ title: "Couldn't copy", description: "Select the text and copy it yourself.", variant: "destructive" }); }
    },
    onError: (e) => { done(); fail("Couldn't hand it over")(e); },
  });
  const busy = draft.isPending || writeVariants.isPending || choose.isPending || discardAll.isPending || save.isPending || approve.isPending || sent.isPending || cancel.isPending || handOut.isPending;

  if (q.error) return null; // not set up on this server: the card simply has no outreach section
  if (q.isLoading) return null;

  const dirty = !!current && (subject !== current.subject || body !== current.body);

  return (
    <Card className="glass-card" data-testid="outreach-panel">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">First message</p>
            {!current && !variants.length && (
              <p className="text-sm text-muted-foreground" data-testid="outreach-none">
                {lastSent ? `Sent ${when(lastSent.sentAt)}. ${afterSent(q.data?.followUp)}` : "No message yet. I write it from what's been verified about the company; you read it, change it and approve it. Nothing is sent for you."}
              </p>
            )}
            {!current && variants.length > 0 && (
              <p className="text-sm" data-testid="outreach-variants-note">
                {variants.length} versions, each opening a different way. Pick the one that sounds like you — you can still change every word before approving.
              </p>
            )}
            {current?.status === "draft" && <p className="text-sm" data-testid="outreach-draft-note">Written by AI. Read it and change anything before you approve it.</p>}
            {current?.status === "approved" && (
              <p className="text-sm" data-testid="outreach-approved-note">
                {gmail.ready ? "Approved. Send it from your connected Gmail, or open it in your email app, send it, then tell me here." : "Approved. Open it in your email app, send it, then tell me here."}
              </p>
            )}
          </div>
          {!current && !lastSent && !variants.length && canRun && (
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <Button size="sm" onClick={() => draft.mutate()} disabled={busy} data-testid="outreach-write">
                {draft.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="mr-1.5 h-4 w-4" />}Write a message
              </Button>
              <Button size="sm" variant="outline" onClick={() => writeVariants.mutate()} disabled={busy} title="Three versions, each opening a different way, to pick from. Counts as one AI draft." data-testid="outreach-write-variants">
                {writeVariants.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}3 versions
              </Button>
            </div>
          )}
        </div>

        {!current && !lastSent && !variants.length && canRun && <ProfileStyleNote style={q.data?.style} channel="email" />}

        {!current && !lastSent && !variants.length && canRun && sample && (
          <label className="flex items-start gap-2 rounded-lg border border-border/70 p-2.5 text-sm" data-testid="outreach-offer-sample">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={offerSample} onChange={(e) => setOfferSample(e.target.checked)} disabled={busy} />
            <span>
              <span className="font-medium">Offer a small sample: {sample.title}</span>
              <span className="block text-xs text-muted-foreground">{sample.scope} Only tick this if you're happy to make it.</span>
            </span>
          </label>
        )}

        {!current && variants.length > 0 && (
          <div className="space-y-2.5" data-testid="outreach-variants">
            <p className="text-xs text-muted-foreground" data-testid="outreach-variants-to">To: <span className="font-medium text-foreground">{variants[0].to}</span>{variants[0].toSource ? ` (${SOURCE[variants[0].toSource]})` : ""}</p>
            {variants.map((v) => (
              <div key={v.id} className="space-y-2 rounded-md border bg-background/60 p-3" data-testid={`outreach-variant-${v.strategy ?? v.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wide">{STRATEGY_LABEL[v.strategy as OutreachStrategy] ?? "Another way in"}</p>
                    <p className="text-xs text-muted-foreground">{STRATEGY_HINT[v.strategy as OutreachStrategy] ?? ""}</p>
                  </div>
                  {canRun && (
                    <Button size="sm" className="shrink-0" onClick={() => choose.mutate(v)} disabled={busy} data-testid={`outreach-choose-${v.strategy ?? v.id}`}>
                      {choose.isPending && choose.variables?.id === v.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}Use this one
                    </Button>
                  )}
                </div>
                <p className="text-sm font-medium" data-testid="variant-subject">{v.subject}</p>
                <p className="whitespace-pre-wrap break-words text-sm" data-testid="variant-body">{v.body}</p>
                {v.scorecard && <ScoreChips card={v.scorecard} />}
              </div>
            ))}
            {canRun && (
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => discardAll.mutate()} disabled={busy} data-testid="outreach-discard-variants">
                {discardAll.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <X className="mr-1.5 h-4 w-4" />}Discard all
              </Button>
            )}
          </div>
        )}

        {current && (
          <div className="space-y-2.5" data-testid="outreach-message">
            <p className="text-xs text-muted-foreground" data-testid="outreach-to">To: <span className="font-medium text-foreground">{current.to}</span>{current.toSource ? ` (${SOURCE[current.toSource]})` : ""}</p>
            {current.status === "draft" || editing ? (
              <>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={LIMITS.subjectMax} aria-label="Subject" data-testid="outreach-subject" disabled={!canRun || busy} />
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={11} maxLength={LIMITS.bodyMax} aria-label="Message" data-testid="outreach-body" disabled={!canRun || busy} className="text-sm" />
                <p className="text-right text-[11px] text-muted-foreground tabular-nums">{body.length} / {LIMITS.bodyMax}</p>
              </>
            ) : (
              <div className="rounded-md border bg-background/60 p-3 text-sm" data-testid="outreach-readonly">
                <p className="font-medium" data-testid="outreach-subject-text">{current.subject}</p>
                <p className="mt-2 whitespace-pre-wrap break-words" data-testid="outreach-body-text">{current.body}</p>
              </div>
            )}
            {current.status === "draft" && current.scorecard && !dirty && <ScoreChips card={current.scorecard} />}
            {(current.status === "sending" || current.status === "approved") && <GmailSendState messageId={current.id} messageStatus={current.status} />}
            {canRun && current.status !== "sending" && (
              <div className="flex flex-wrap items-center gap-2">
                {current.status === "draft" && dirty && (
                  <Button size="sm" onClick={() => save.mutate()} disabled={busy} data-testid="outreach-save">{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}Save changes</Button>
                )}
                {current.status === "draft" && !dirty && (
                  <Button size="sm" onClick={() => approve.mutate()} disabled={busy} data-testid="outreach-approve">{approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}Approve</Button>
                )}
                {current.status === "approved" && !editing && (
                  <>
                    <SendFromGmailButton messageId={current.id} bodyHash={current.bodyHash} to={current.to} disabled={busy} />
                    <Button size="sm" onClick={() => handOut.mutate("open")} disabled={busy} data-testid="outreach-open">{handOut.isPending && handOut.variables === "open" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Mail className="mr-1.5 h-4 w-4" />}Open in my email app</Button>
                    <Button size="sm" variant="outline" onClick={() => handOut.mutate("copy")} disabled={busy} data-testid="outreach-copy"><Copy className="mr-1.5 h-4 w-4" />Copy</Button>
                    <Button size="sm" variant="outline" onClick={() => sent.mutate()} disabled={busy} data-testid="outreach-sent">{sent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}I sent it</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={busy} data-testid="outreach-edit"><Pencil className="mr-1.5 h-4 w-4" />Edit</Button>
                  </>
                )}
                {current.status === "approved" && editing && dirty && (
                  <Button size="sm" onClick={() => save.mutate()} disabled={busy} data-testid="outreach-save">Save (needs approving again)</Button>
                )}
                {current.status === "approved" && editing && !dirty && (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)} data-testid="outreach-edit-cancel">Keep as approved</Button>
                )}
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => cancel.mutate()} disabled={busy} data-testid="outreach-discard"><X className="mr-1.5 h-4 w-4" />Discard</Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The deterministic quality card (shared/draft-scorecard.ts): what a program can honestly measure about the
 * text, each chip with its reason on hover, and anything that earned nothing spelled out. Never a prediction.
 */
const CHIP_TONE: Record<ReturnType<typeof chipTone>, string> = {
  full: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  partial: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  none: "border-border bg-muted/50 text-muted-foreground",
};
function ScoreChips({ card }: { card: Scorecard }) {
  const missed = shortcomings(card.components);
  return (
    <div className="space-y-1" data-testid="outreach-scorecard">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold tabular-nums text-muted-foreground" data-testid="scorecard-total">{card.total}/{card.max}</span>
        {card.components.map((c) => (
          <span key={c.key} title={c.reason} className={`rounded-full border px-1.5 py-0.5 text-[10px] leading-none ${CHIP_TONE[chipTone(c)]}`} data-testid={`scorecard-${c.key}`}>
            {chipText(c)}
          </span>
        ))}
      </div>
      {missed.map((c) => (
        <p key={c.key} className="text-[11px] text-muted-foreground" data-testid={`scorecard-why-${c.key}`}>{c.reason}</p>
      ))}
    </div>
  );
}
