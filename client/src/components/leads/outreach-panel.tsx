/**
 * The first message to a lead: written by the AI from verified facts, read and edited by a person, approved, then sent
 * by the person from their own email app. DealInSec never sends it: "Open in my email app" hands the approved text to
 * the person's own mail program, and "I sent it" records that they did. Nothing about the lead changes before that.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Check, Copy, Loader2, Mail, Pencil, PenLine, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { draftUrl, leadCall, leadError, messageUrl, messagesUrl, refreshLeads } from "@/lib/leads";
import { memberCan } from "@shared/permissions";
import { LIMITS } from "@shared/outreach-check";

interface Message {
  id: number; status: "draft" | "approved" | "sent" | "cancelled"; subject: string; body: string; bodyHash: string;
  to: string | null; toSource: "lead" | "site" | null; edited: boolean; createdBy: string; createdAt: string; approvedAt: string | null; sentAt: string | null;
}
const when = (iso: string | null) => { try { return iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""; } catch { return ""; } };
const SOURCE: Record<string, string> = { lead: "the address you recorded", site: "a business address found on their website" };

/** A mail program wants line breaks as CRLF. */
export const mailtoFor = (m: Pick<Message, "to" | "subject" | "body">) =>
  `mailto:${encodeURIComponent(m.to ?? "").replace(/%40/g, "@")}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body.replace(/\r?\n/g, "\r\n"))}`;

export function OutreachPanel({ leadId }: { leadId: number }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const canRun = memberCan(user as any, "deals.create");
  const q = useQuery<{ messages: Message[] }>({ queryKey: [messagesUrl(leadId)], retry: false });
  const current = q.data?.messages.find((m) => m.status === "draft" || m.status === "approved") ?? null;
  const lastSent = q.data?.messages.find((m) => m.status === "sent") ?? null;

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState(false);
  // The text on screen follows the saved message; a new id or a saved edit resets what is being typed.
  useEffect(() => { setSubject(current?.subject ?? ""); setBody(current?.body ?? ""); setEditing(false); }, [current?.id, current?.bodyHash]);

  const done = () => { void refreshLeads(); };
  const fail = (title: string) => (e: unknown) => toast({ title, description: leadError(e), variant: "destructive" });
  const draft = useMutation({ mutationFn: () => leadCall("POST", draftUrl(leadId), {}), onSuccess: done, onError: fail("Couldn't write the message") });
  const save = useMutation({ mutationFn: () => leadCall("PATCH", messageUrl(current!.id), { subject, body }), onSuccess: done, onError: fail("Couldn't save your changes") });
  const approve = useMutation({ mutationFn: () => leadCall("POST", messageUrl(current!.id, "approve"), { bodyHash: current!.bodyHash }), onSuccess: done, onError: fail("Couldn't approve it") });
  const sent = useMutation({ mutationFn: () => leadCall("POST", messageUrl(current!.id, "sent"), {}), onSuccess: () => { done(); toast({ title: "Recorded as sent", description: "A follow-up is set for four days from now." }); }, onError: fail("Couldn't record it") });
  const cancel = useMutation({ mutationFn: () => leadCall("POST", messageUrl(current!.id, "cancel"), {}), onSuccess: done, onError: fail("Couldn't discard it") });
  const busy = draft.isPending || save.isPending || approve.isPending || sent.isPending || cancel.isPending;

  if (q.error) return null; // not set up on this server: the card simply has no outreach section
  if (q.isLoading) return null;

  const dirty = !!current && (subject !== current.subject || body !== current.body);
  const copy = async () => {
    try { await navigator.clipboard.writeText(`Subject: ${current!.subject}\n\n${current!.body}`); toast({ title: "Copied" }); }
    catch { toast({ title: "Couldn't copy", description: "Select the text and copy it yourself.", variant: "destructive" }); }
  };

  return (
    <Card className="glass-card" data-testid="outreach-panel">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">First message</p>
            {!current && (
              <p className="text-sm text-muted-foreground" data-testid="outreach-none">
                {lastSent ? `Sent ${when(lastSent.sentAt)}. Follow-ups are written from the conversation, when they reply.` : "No message yet. I write it from what's been verified about the company; you read it, change it and approve it. Nothing is sent for you."}
              </p>
            )}
            {current?.status === "draft" && <p className="text-sm" data-testid="outreach-draft-note">Written by AI. Read it and change anything before you approve it.</p>}
            {current?.status === "approved" && <p className="text-sm" data-testid="outreach-approved-note">Approved. DealInSec doesn't send this: open it in your email app, send it, then tell me here.</p>}
          </div>
          {!current && !lastSent && canRun && (
            <Button size="sm" className="shrink-0" onClick={() => draft.mutate()} disabled={busy} data-testid="outreach-write">
              {draft.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="mr-1.5 h-4 w-4" />}Write a message
            </Button>
          )}
        </div>

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
            {canRun && (
              <div className="flex flex-wrap items-center gap-2">
                {current.status === "draft" && dirty && (
                  <Button size="sm" onClick={() => save.mutate()} disabled={busy} data-testid="outreach-save">{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}Save changes</Button>
                )}
                {current.status === "draft" && !dirty && (
                  <Button size="sm" onClick={() => approve.mutate()} disabled={busy} data-testid="outreach-approve">{approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}Approve</Button>
                )}
                {current.status === "approved" && !editing && (
                  <>
                    <Button size="sm" asChild data-testid="outreach-open"><a href={mailtoFor(current)}><Mail className="mr-1.5 h-4 w-4" />Open in my email app</a></Button>
                    <Button size="sm" variant="outline" onClick={copy} data-testid="outreach-copy"><Copy className="mr-1.5 h-4 w-4" />Copy</Button>
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
