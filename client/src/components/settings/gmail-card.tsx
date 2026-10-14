/**
 * Your Gmail: connect it so approved messages can later go out from your own address. Shows what DealInSec may do
 * with it, any problem that needs a reconnect, and a clear way to disconnect. Your mailbox only: nobody else's
 * connection is shown or changeable here. Hidden where the integration isn't switched on and nothing is connected.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Mail, ShieldCheck, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { parseApiError } from "@/lib/api-error";
import { useConnectGmail, useDisconnectGmail, useGmailStatus, useVerifyGmail } from "@/lib/gmail";
import { CONNECT_DISCLOSURE, CONNECT_OUTCOMES, isConnectOutcome, type ConnectOutcome } from "@shared/gmail-connect";

const GOOD: ConnectOutcome[] = ["connected", "reconnected"];
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function GmailCard() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data, isLoading, error } = useGmailStatus();
  const connect = useConnectGmail(), verify = useVerifyGmail(), disconnect = useDisconnectGmail();
  const [outcome, setOutcome] = useState<ConnectOutcome | null>(null);

  // Back from Google: show the fixed sentence for the outcome code (never text from the URL), then tidy the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("gmail");
    if (!code) return;
    if (isConnectOutcome(code)) setOutcome(code);
    params.delete("gmail");
    const rest = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
    document.getElementById("gmail-card")?.scrollIntoView({ block: "start" });
  }, []);

  if (isLoading || error || !data) return null;
  if (!data.available && !data.connection) return null;
  const c = data.connection;
  const busy = connect.isPending || verify.isPending || disconnect.isPending;
  const onError = (title: string) => (e: unknown) => toast({ title, description: parseApiError(e).error || "Try again in a moment.", variant: "destructive" });

  const startConnect = async () => {
    if (!c && !(await confirm({ title: "Connect your Gmail?", description: <ul className="list-disc space-y-1.5 pl-4 text-left">{CONNECT_DISCLOSURE.map((d) => <li key={d}>{d}</li>)}</ul>, confirmText: "Continue to Google" }))) return;
    setOutcome(null);
    connect.mutate(undefined, { onError: onError("Couldn't start connecting") });
  };
  const runVerify = () => verify.mutate(undefined, {
    onSuccess: (r) => toast(r.result === "ok" ? { title: "Connection works" } : r.result === "temporarily_unavailable" ? { title: "Couldn't reach Google", description: "Nothing changed. Try again in a moment." } : r.result === "not_connected" ? { title: "Not connected" } : { title: "Reconnect needed", description: "See the card for why.", variant: "destructive" }),
    onError: onError("Couldn't check the connection"),
  });
  const runDisconnect = async () => {
    if (!(await confirm({ title: "Disconnect Gmail?", description: "DealInSec's access is removed at Google and the stored credentials are deleted. You can connect again any time.", confirmText: "Disconnect", destructive: true }))) return;
    disconnect.mutate(undefined, {
      onSuccess: (r) => { setOutcome(null); toast(r.revoked === false
        ? { title: "Disconnected", description: "Stored access deleted. Google didn't confirm the removal, so you may also remove DealInSec under Third-party access in your Google account." }
        : { title: "Gmail disconnected" }); },
      onError: onError("Couldn't disconnect"),
    });
  };

  return (
    <Card className="glass-card scroll-mt-20" id="gmail-card" data-testid="gmail-card">
      <CardContent className="space-y-4 p-5 lg:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold"><Mail className="h-5 w-5" aria-hidden />Gmail</h2>
            <p className="text-sm text-muted-foreground">Connect your own Gmail so approved messages can go out from your address. Sending from DealInSec isn't switched on yet; connecting only prepares it.</p>
          </div>
          {c && (
            <Badge variant={c.status === "active" ? "secondary" : "destructive"} className="shrink-0" data-testid="gmail-status">
              {c.status === "active" ? "Connected" : "Reconnect needed"}
            </Badge>
          )}
        </div>

        {outcome && (
          <div role="status" data-testid="gmail-outcome" data-outcome={outcome}
            className={GOOD.includes(outcome) ? "flex gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm" : "flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm"}>
            {GOOD.includes(outcome) ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />}
            <span>{CONNECT_OUTCOMES[outcome]}</span>
          </div>
        )}

        {c ? (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3" data-testid="gmail-connection">
            <div className="text-sm">
              <div className="font-medium break-all" data-testid="gmail-account">{c.accountEmail}</div>
              <div className="text-xs text-muted-foreground">Connected {fmtDate(c.connectedAt)} · only you can send from it</div>
            </div>
            <ul className="space-y-1 text-sm" aria-label="What DealInSec may do with this mailbox" data-testid="gmail-capabilities">
              <li className="flex items-center gap-2">{c.capabilities.identify ? <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden /> : <XCircle className="h-4 w-4 text-destructive" aria-hidden />}See your email address</li>
              <li className="flex items-center gap-2">{c.capabilities.send ? <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden /> : <XCircle className="h-4 w-4 text-destructive" aria-hidden />}Send email you've approved{!data.sendingEnabled && <span className="text-xs text-muted-foreground">(not switched on yet)</span>}</li>
              <li className="flex items-center gap-2"><XCircle className="h-4 w-4 text-muted-foreground" aria-hidden />Read, change or delete your mail: never asked for</li>
            </ul>
            {c.problem && (
              <div role="alert" className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-sm" data-testid="gmail-problem" data-code={c.problem.code}>
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                <span>{c.problem.message}</span>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {data.available && data.canConnect && c.status !== "active" && (
                <Button size="sm" onClick={startConnect} disabled={busy} data-testid="gmail-reconnect">{connect.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Reconnect</Button>
              )}
              {data.available && c.status === "active" && (
                <Button size="sm" variant="outline" onClick={runVerify} disabled={busy} data-testid="gmail-verify">{verify.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Check connection</Button>
              )}
              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={runDisconnect} disabled={busy} data-testid="gmail-disconnect">
                {disconnect.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Disconnect
              </Button>
            </div>
          </div>
        ) : data.canConnect ? (
          <div className="space-y-3">
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground" data-testid="gmail-disclosure">
              {CONNECT_DISCLOSURE.map((d) => <li key={d}>{d}</li>)}
            </ul>
            <Button onClick={startConnect} disabled={busy} data-testid="gmail-connect">{connect.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Connect Gmail</Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="gmail-not-allowed">Your role doesn't include working on leads, so you can't connect a mailbox. Ask your organization owner.</p>
        )}
      </CardContent>
    </Card>
  );
}
