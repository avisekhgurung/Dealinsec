/**
 * Sending the approved first message from the person's own connected Gmail, and what happened to it. Shown inside the
 * outreach panel. The server decides everything (exact approved text, do-not-contact, the list, the mailbox, the daily
 * limit, no second send); this only asks, and shows the fixed sentence for the state it gets back.
 *
 * An uncertain send is never retried for the person: they check their Gmail Sent folder and say what they found.
 */
import { AlertTriangle, CheckCircle2, Loader2, Mail, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { useGmailStatus, useResolveSend, useSendFromGmail, useSendState } from "@/lib/gmail";
import { leadError, refreshLeads } from "@/lib/leads";

/** Whether this person can send from Gmail right now (connected, active, sending switched on in this build). */
export function useGmailCanSend() {
  const s = useGmailStatus();
  const c = s.data?.connection;
  return { ready: !!s.data?.sendingEnabled && c?.status === "active" && !!c.capabilities.send, account: c?.accountEmail ?? null };
}

/** The "Send from my Gmail" button for an approved message. */
export function SendFromGmailButton({ messageId, bodyHash, to, disabled }: { messageId: number; bodyHash: string; to: string | null; disabled?: boolean }) {
  const { ready, account } = useGmailCanSend();
  const confirm = useConfirm();
  const { toast } = useToast();
  const send = useSendFromGmail();
  if (!ready || !account) return null;
  const go = async () => {
    const ok = await confirm({
      title: "Send from your Gmail?",
      description: <span>DealInSec sends exactly the approved text from <b>{account}</b> to <b>{to}</b>. It appears in your Gmail Sent folder. This can't be undone.</span>,
      confirmText: "Send now",
    });
    if (!ok) return;
    send.mutate({ messageId, bodyHash }, {
      onSuccess: (r) => {
        void refreshLeads();
        if (r.outcome === "sent" || r.outcome === "already_sent") toast({ title: "Sent from your Gmail", description: "A follow-up is set for four days from now." });
        else if (r.outcome === "uncertain") toast({ title: "Not sure it went out", description: r.send.message, variant: "destructive" });
        else toast({ title: "Nothing was sent", description: r.send.message, variant: "destructive" });
      },
      onError: (e) => { void refreshLeads(); toast({ title: "Nothing was sent", description: leadError(e), variant: "destructive" }); },
    });
  };
  return (
    <Button size="sm" onClick={go} disabled={disabled || send.isPending} data-testid="outreach-send-gmail">
      {send.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Mail className="mr-1.5 h-4 w-4" />}Send from my Gmail
    </Button>
  );
}

/**
 * The send state of a message: for one that is "sending" (in flight, or uncertain until settled), and for an approved
 * one whose last Gmail attempt failed (so the person knows why, and that nothing went out).
 */
export function GmailSendState({ messageId, messageStatus }: { messageId: number; messageStatus: string }) {
  const sending = messageStatus === "sending";
  const q = useSendState(messageId, { enabled: sending || messageStatus === "approved", poll: sending });
  const resolve = useResolveSend();
  const confirm = useConfirm();
  const { toast } = useToast();
  const s = q.data?.send;
  if (!s || s.status === "sent" || (!sending && s.status !== "failed" && s.status !== "blocked")) {
    return sending ? <p className="text-sm text-muted-foreground" data-testid="gmail-send-state" data-status="loading">Checking its Gmail status…</p> : null;
  }
  const settle = async (decision: "sent" | "not_sent") => {
    const ok = await confirm(decision === "sent"
      ? { title: "It's in your Sent folder?", description: "DealInSec records it as sent and sets the follow-up. It won't be sent again.", confirmText: "Yes, it was sent" }
      : { title: "It isn't in your Sent folder?", description: "The message becomes approved again, so you can send it deliberately. If it did go out after all, sending again would send a second copy.", confirmText: "It wasn't sent" });
    if (!ok) return;
    resolve.mutate({ messageId, decision }, {
      onSuccess: () => { void refreshLeads(); toast({ title: decision === "sent" ? "Recorded as sent" : "Approved again" }); },
      onError: (e) => { void q.refetch(); toast({ title: "Couldn't record that", description: leadError(e), variant: "destructive" }); },
    });
  };
  const Icon = s.status === "sending" ? Loader2 : s.status === "uncertain" ? AlertTriangle : XCircle;
  return (
    <div role="status" className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm" data-testid="gmail-send-state" data-status={s.status} data-code={s.code ?? ""}>
      <p className="flex gap-2"><Icon className={`mt-0.5 h-4 w-4 shrink-0 ${s.status === "sending" ? "animate-spin" : ""}`} aria-hidden /><span>{s.message}</span></p>
      {s.status === "uncertain" && (s.canResolve ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => settle("sent")} disabled={resolve.isPending} data-testid="gmail-resolve-sent"><CheckCircle2 className="mr-1.5 h-4 w-4" />It's in my Sent folder</Button>
          <Button size="sm" variant="outline" onClick={() => settle("not_sent")} disabled={resolve.isPending} data-testid="gmail-resolve-not-sent"><XCircle className="mr-1.5 h-4 w-4" />It isn't there</Button>
        </div>
      ) : <p className="text-xs text-muted-foreground" data-testid="gmail-resolve-other">Only the person who sent it can confirm this, from their Gmail Sent folder.</p>)}
    </div>
  );
}
