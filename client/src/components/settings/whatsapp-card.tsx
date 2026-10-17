/**
 * Settings → Integrations → WhatsApp Business: the workspace's own business number on the official Cloud API.
 * Shows only what GET /api/integrations/whatsapp says: not switched on, not connected, connected, or needing a reconnect.
 * Owners and admins connect it with the number's IDs and an access token (a System User token from Meta Business
 * Settings); the token goes to the server once, is checked with WhatsApp, sealed, and never shown again.
 */
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm-dialog";
import { leadCall, leadError } from "@/lib/leads";
import { WHATSAPP_URL, refreshChannels, useWhatsappStatus } from "@/lib/channels";
import { queryClient } from "@/lib/queryClient";
import { SettingsSection } from "./section-card";

export function WhatsappCard() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const q = useWhatsappStatus();
  const [form, setForm] = useState({ phoneNumberId: "", wabaId: "", accessToken: "" });
  const [open, setOpen] = useState(false);
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: [WHATSAPP_URL] }); void refreshChannels(); };
  const connect = useMutation({
    mutationFn: () => leadCall("POST", WHATSAPP_URL, form),
    onSuccess: () => { setForm({ phoneNumberId: "", wabaId: "", accessToken: "" }); setOpen(false); refresh(); toast({ title: "WhatsApp Business connected" }); },
    onError: (e) => toast({ title: "Not connected", description: leadError(e), variant: "destructive" }),
  });
  const disconnect = useMutation({
    mutationFn: () => leadCall("DELETE", WHATSAPP_URL),
    onSuccess: () => { refresh(); toast({ title: "Disconnected", description: "The access token was deleted from DealInSec. Revoke it in Meta Business Settings too." }); },
    onError: (e) => toast({ title: "Couldn't disconnect", description: leadError(e), variant: "destructive" }),
  });
  const s = q.data, c = s?.connection;
  const badge = !s ? null : !s.configured ? "Not switched on" : !c ? "Not connected" : c.status === "needs_attention" ? "Needs reconnecting" : "Connected";
  return (
    <SettingsSection title="WhatsApp Business" icon={MessageCircle} testId="integration-whatsapp"
      description={!s ? "Loading…" : !s.configured ? `${s.reason ?? "Not switched on for your workspace."} Until then, you can still send messages from your own WhatsApp to people who agreed to hear from you.` : "Send approved messages from your business number through WhatsApp's official API, only to people who agreed to hear from you. Delivery, read receipts and replies show on the lead; WhatsApp bills your business account for each message."}
      action={badge && <Badge variant={badge === "Connected" ? "default" : "outline"} className="font-medium" data-testid="whatsapp-status">{badge}</Badge>}>
      {s?.configured && c && (
        <div className="space-y-2 text-sm" data-testid="whatsapp-connection">
          <p><span className="font-medium">{c.displayPhone ?? "Business number"}</span>{c.verifiedName ? ` · ${c.verifiedName}` : ""} <span className="text-muted-foreground">since {new Date(c.connectedAt).toLocaleDateString()}</span></p>
          {c.status === "needs_attention" && <p className="text-amber-800 dark:text-amber-300">WhatsApp stopped accepting the token ({c.lastErrorCode}). Disconnect, then connect again with a new token.</p>}
          {s.canManage && <Button size="sm" variant="outline" disabled={disconnect.isPending} onClick={async () => { if (await confirm({ title: "Disconnect WhatsApp Business?", description: "Messages can no longer be sent from DealInSec through this number. Nothing already sent changes.", confirmText: "Disconnect", destructive: true })) disconnect.mutate(); }} data-testid="whatsapp-disconnect">Disconnect</Button>}
        </div>
      )}
      {s?.configured && !c && (s.canManage ? (open ? (
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); connect.mutate(); }} data-testid="whatsapp-connect-form">
          <label className="flex flex-col gap-1 text-xs font-medium">Phone number ID<Input value={form.phoneNumberId} onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value.trim() })} inputMode="numeric" placeholder="1234567890123456" /></label>
          <label className="flex flex-col gap-1 text-xs font-medium">WhatsApp Business Account ID<Input value={form.wabaId} onChange={(e) => setForm({ ...form, wabaId: e.target.value.trim() })} inputMode="numeric" placeholder="1029384756" /></label>
          <label className="flex flex-col gap-1 text-xs font-medium sm:col-span-2">Access token (System User, with whatsapp_business_messaging and whatsapp_business_management)
            <Input type="password" autoComplete="off" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} placeholder="EAAG…" />
          </label>
          <p className="text-xs text-muted-foreground sm:col-span-2">DealInSec checks these with WhatsApp before saving. The token is encrypted and never shown again. In your Meta app, set the webhook to <code className="rounded bg-muted px-1">{window.location.origin}{s.webhookPath}</code> and subscribe to <code className="rounded bg-muted px-1">messages</code>.</p>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={connect.isPending || !form.phoneNumberId || !form.wabaId || form.accessToken.length < 20} data-testid="whatsapp-connect">{connect.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Connect"}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      ) : <Button size="sm" onClick={() => setOpen(true)} data-testid="whatsapp-connect-open">Connect a business number</Button>)
        : <p className="text-sm text-muted-foreground">Only the Owner or an Admin can connect the workspace's WhatsApp number.</p>)}
    </SettingsSection>
  );
}
