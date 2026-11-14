/**
 * The last onboarding step: connect the email you will send from.
 *
 * It is never required. The workspace is already saved by the time this shows, so "Skip for now" is a real choice,
 * not a dead end — the same connection lives in Settings → Integrations afterwards.
 *
 * What DealInSec asks Google for is deliberately narrow: permission to SEND, and nothing else. It cannot read,
 * change, label or delete anything in the mailbox, and a grant that carries any wider access is refused outright
 * (server/mail/provider.ts MAILBOX_ACCESS). That is why the choice below is one provider, not three: Outlook and
 * plain IMAP are not built, and showing them as if they were would be a lie the person only discovers after clicking.
 */
import { Check, Loader2, Lock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useConnectGmail, useGmailStatus } from "@/lib/gmail";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface Provider {
  key: "google" | "outlook" | "imap";
  name: string;
  detail: string;
  ready: boolean;
  /** Said plainly on the card when it isn't built yet, so nobody clicks and wonders. */
  note?: string;
}

const PROVIDERS: Provider[] = [
  { key: "google", name: "Google", detail: "Gmail / Google Workspace", ready: true },
  { key: "outlook", name: "Outlook", detail: "Hotmail, Live, Microsoft 365", ready: false, note: "Not connected yet — send from Outlook by copying the message." },
  { key: "imap", name: "Other", detail: "Any provider, IMAP", ready: false, note: "Not connected yet — send from your own email app by copying the message." },
];

export function ConnectEmailStep({ onDone, busy }: { onDone: () => void; busy?: boolean }) {
  const status = useGmailStatus();
  const connect = useConnectGmail();
  const [picked, setPicked] = useState<Provider["key"]>("google");
  const [agreed, setAgreed] = useState(true);
  const connected = status.data?.connection ?? null;
  const canConnect = status.data?.available !== false && status.data?.canConnect !== false;
  const chosen = PROVIDERS.find((p) => p.key === picked)!;

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">Connect the email you'll send from</h2>
        <p className="text-sm text-muted-foreground">
          Messages are written for you to read and approve. Connecting Gmail lets you send an approved one without leaving DealInSec — you still press send.
        </p>
      </div>

      {connected ? (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-300 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/30" data-testid="onboarding-email-connected">
          <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium">{connected.accountEmail} is connected</p>
            <p className="text-xs text-muted-foreground">You can change or disconnect it any time in Settings → Integrations.</p>
          </div>
        </div>
      ) : (
        <>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Choose your email provider</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {PROVIDERS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  role="radio"
                  aria-checked={picked === p.key}
                  disabled={!p.ready}
                  onClick={() => setPicked(p.key)}
                  className={cn(
                    "flex items-start gap-2.5 rounded-xl border p-3 text-left transition",
                    p.ready ? "hover:bg-muted/50" : "cursor-not-allowed opacity-60",
                    picked === p.key && p.ready ? "border-primary ring-1 ring-primary" : "border-border/70",
                  )}
                  data-testid={`onboarding-provider-${p.key}`}
                >
                  <Mail className={cn("mt-0.5 h-5 w-5 shrink-0", p.ready ? "text-foreground" : "text-muted-foreground")} aria-hidden />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-medium">{p.name}{!p.ready && <Lock className="h-3 w-3 text-muted-foreground" aria-label="Not available yet" />}</span>
                    <span className="block break-words text-xs text-muted-foreground">{p.detail}</span>
                  </span>
                </button>
              ))}
            </div>
            {!chosen.ready && <p className="text-xs text-muted-foreground" data-testid="onboarding-provider-note">{chosen.note}</p>}
          </fieldset>

          <label className="flex items-start gap-2.5 text-xs leading-relaxed text-muted-foreground">
            <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-0.5" data-testid="onboarding-email-agree" />
            <span>
              I'll only write to people I have a genuine reason to contact, and not send spam, bulk unsolicited or harassing email.
              DealInSec never sends anything by itself: every message waits for me to approve the exact words. It asks Google for
              permission to send only — it cannot read, change or delete anything in my mailbox.
            </span>
          </label>

          {!canConnect && (
            <p className="text-xs text-muted-foreground" data-testid="onboarding-email-unconfigured">
              {status.data?.available === false
                ? "Connecting Gmail isn't switched on for this server yet. Skip for now \u2014 you can always send by copying the message into your own email."
                : "Your role doesn't allow connecting a mailbox. Skip for now; an owner or admin can connect one in Settings."}
            </p>
          )}
        </>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
        <Button type="button" variant="outline" className="h-11 w-full sm:w-auto" onClick={onDone} disabled={busy} data-testid="onboarding-email-skip">
          {connected ? "Done" : "Skip for now"}
        </Button>
        {!connected && (
          <Button
            type="button"
            className="gradient-btn h-11 w-full text-white sm:flex-1"
            disabled={busy || !chosen.ready || !agreed || connect.isPending || !canConnect}
            onClick={() => connect.mutate()}
            data-testid="onboarding-email-connect"
          >
            {connect.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Opening Google" /> : <>Connect email</>}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">You can do this later in Settings → Integrations. Nothing here is required to start finding clients.</p>
    </div>
  );
}
