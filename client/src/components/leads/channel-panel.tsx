/**
 * Reaching a lead, on one card: Email (the existing outreach panel, untouched), WhatsApp, LinkedIn and X.
 *
 * Every channel shows the state the server checked (GET /api/channels/status) and only the actions that state allows:
 *   - WhatsApp with a connected business number: approve, then "Send from WhatsApp Business"; delivery, read and replies
 *     come back on their own. Without one, the person sends from their own WhatsApp (a wa.me link) and records it.
 *     Either way only to someone whose opt-in is recorded, and outside the 24-hour window only an approved template.
 *   - LinkedIn and X: DealInSec writes, the person copies it, opens LinkedIn or X and sends it there, then says so.
 *     "Copy" is never a send; "I sent it" is recorded as the person's word ("You marked it sent"), never as a delivery,
 *     and since replies don't reach DealInSec, follow-ups only stop when the person records the reply.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, CheckCheck, Copy, ExternalLink, Loader2, MessageCircle, Pencil, PenLine, Send, ShieldCheck, Sparkles, X as XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { leadCall, leadError, refreshLeads } from "@/lib/leads";
import { cn } from "@/lib/utils";
import { memberCan } from "@shared/permissions";
import { CHANNEL_LABEL, KIND_LABEL, MESSAGE_KINDS, externalUrl, maxFor, type Channel, type ChannelStatus, type MessageKind, type ShortChannel } from "@shared/channels";
import { SegmentedTabs } from "@/components/outbound/segmented-tabs";
import { OutreachPanel } from "./outreach-panel";
import {
  WHATSAPP_TEMPLATES_URL, channelDraftUrl, channelMessageUrl, optInUrl, refreshChannels, useChannelMessages, useChannelStatuses, waMeUrl,
  type ChannelMessage, type WhatsappContact, type WhatsappTemplate,
} from "@/lib/channels";

const when = (iso: string | null) => { try { return iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""; } catch { return ""; } };
const STATE_TONE: Record<string, string> = {
  ready_to_send: "bg-emerald-500", connected: "bg-emerald-500", sending_unavailable: "bg-slate-400", awaiting_connection: "bg-amber-500",
  permission_missing: "bg-red-500", not_configured: "bg-slate-300 dark:bg-slate-600", disconnected: "bg-slate-300",
};
const STATE_LABEL: Record<string, string> = {
  ready_to_send: "Ready to send", connected: "Connected", sending_unavailable: "Drafts only: you send it", awaiting_connection: "Not connected: you send it",
  permission_missing: "Needs reconnecting", not_configured: "Not switched on", disconnected: "Disconnected",
};
const TO_LABEL: Record<ShortChannel, { label: string; placeholder: string }> = {
  whatsapp: { label: "WhatsApp number", placeholder: "+91 98765 43210" },
  linkedin: { label: "LinkedIn profile or company page (optional)", placeholder: "linkedin.com/in/their-name" },
  x: { label: "X handle (optional)", placeholder: "@theirhandle" },
};
const UNSENT = ["draft", "approved", "sending", "uncertain", "failed"];

export function ChannelPanel({ leadId, companyName, contactName }: { leadId: number; companyName: string; contactName?: string | null }) {
  const [channel, setChannel] = useState<Channel>("email");
  const statuses = useChannelStatuses();
  // An older server (or the channel tables not migrated yet): email alone, exactly as before.
  if (statuses.isError || statuses.data?.channels.find((c) => c.channel === "linkedin")?.state === "not_configured") return <OutreachPanel leadId={leadId} />;
  const status = (c: ShortChannel) => statuses.data?.channels.find((x) => x.channel === c) ?? null;
  const dot = (c: ShortChannel) => <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", STATE_TONE[status(c)?.state ?? "not_configured"])} aria-hidden />;
  return (
    <div className="space-y-2" data-testid="channel-panel">
      <SegmentedTabs label="Channel" value={channel} onChange={setChannel} className="w-full sm:w-fit"
        tabs={[
          { value: "email", label: "Email", testId: "channel-tab-email" },
          ...(["whatsapp", "linkedin", "x"] as const).map((c) => ({ value: c, label: <span className="inline-flex items-center gap-1.5">{dot(c)}{CHANNEL_LABEL[c]}</span>, testId: `channel-tab-${c}` })),
        ]} />
      {channel === "email" ? <OutreachPanel leadId={leadId} /> : <ChannelComposer key={channel} leadId={leadId} channel={channel} status={status(channel)} search={[contactName, companyName].filter(Boolean).join(" ")} />}
    </div>
  );
}

function ChannelComposer({ leadId, channel, status, search }: { leadId: number; channel: ShortChannel; status: ChannelStatus | null; search: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const canRun = memberCan(user as any, "deals.create");
  const q = useChannelMessages(leadId);
  const msgs = (q.data?.messages ?? []).filter((m) => m.channel === channel);
  const current = msgs.find((m) => m.direction === "out" && UNSENT.includes(m.status)) ?? null;
  const history = msgs.filter((m) => m !== current && (m.direction === "in" || m.status === "sent"));
  const contacts = channel === "whatsapp" ? (q.data?.whatsappContacts ?? []) : [];
  const api = status?.mode === "api";

  const done = () => { void refreshChannels(leadId); void refreshLeads(); };
  const fail = (title: string) => (e: unknown) => { done(); toast({ title, description: leadError(e), variant: "destructive" }); };

  if (q.isLoading) return <Card className="glass-card"><CardContent className="p-4"><div className="h-4 w-1/3 animate-pulse rounded bg-muted" /></CardContent></Card>;
  if (q.isError) return <Card className="glass-card"><CardContent className="p-4 text-sm text-muted-foreground" data-testid="channel-unavailable">{leadError(q.error, "These messages couldn't be loaded.")}</CardContent></Card>;

  return (
    <Card className="glass-card" data-testid={`channel-${channel}`}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{CHANNEL_LABEL[channel]}</p>
            <p className="text-xs text-muted-foreground" data-testid="channel-note">{status?.note}</p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium" data-testid="channel-state">
            <span className={cn("h-1.5 w-1.5 rounded-full", STATE_TONE[status?.state ?? "not_configured"])} aria-hidden />{STATE_LABEL[status?.state ?? "not_configured"]}{status?.account ? ` · ${status.account}` : ""}
          </span>
        </div>

        {channel === "whatsapp" && <OptInBox leadId={leadId} contacts={contacts} canRun={canRun} api={api} onChange={done} />}

        {current ? <MessageEditor m={current} api={api} canRun={canRun} contacts={contacts} search={search} onDone={done} onFail={fail} />
          : canRun && <NewMessage leadId={leadId} channel={channel} api={api} contacts={contacts} onDone={done} onFail={fail} />}

        {!status?.capabilities.replySync && history.some((m) => m.status === "sent") && (
          <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200" data-testid="channel-no-reply-sync">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Replies on {CHANNEL_LABEL[channel]} don't reach DealInSec, so follow-ups can't stop by themselves. When they answer, press "They replied".
          </p>
        )}

        {history.length > 0 && (
          <ol className="space-y-2 border-t pt-3" aria-label={`${CHANNEL_LABEL[channel]} history`} data-testid="channel-history">
            {history.map((m) => <HistoryItem key={m.id} m={m} canRun={canRun} onDone={done} onFail={fail} />)}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/* ── WhatsApp permission ─────────────────────────────────────────────────── */

function OptInBox({ leadId, contacts, canRun, api, onChange }: { leadId: number; contacts: WhatsappContact[]; canRun: boolean; api: boolean; onChange: () => void }) {
  const { toast } = useToast();
  const [phone, setPhone] = useState(""), [source, setSource] = useState(""), [open, setOpen] = useState(false);
  const record = useMutation({
    mutationFn: () => leadCall("POST", optInUrl(leadId), { phone, source }),
    onSuccess: () => { setOpen(false); setPhone(""); setSource(""); onChange(); toast({ title: "Permission recorded" }); },
    onError: (e) => toast({ title: "Couldn't record it", description: leadError(e), variant: "destructive" }),
  });
  const stop = useMutation({
    mutationFn: (p: string) => leadCall("POST", optInUrl(leadId, true), { phone: p }),
    onSuccess: () => { onChange(); toast({ title: "Marked as asked to stop", description: "Nothing more will be sent to this number." }); },
    onError: (e) => toast({ title: "Couldn't record it", description: leadError(e), variant: "destructive" }),
  });
  const optedIn = contacts.filter((c) => c.optedIn);
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3" data-testid="whatsapp-optin">
      <p className="flex items-center gap-1.5 text-xs font-semibold"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />Permission to message on WhatsApp</p>
      {contacts.length === 0 && <p className="text-xs text-muted-foreground">WhatsApp only allows messages to people who agreed to hear from your business. A phone number found online isn't permission.</p>}
      <ul className="space-y-1.5">
        {contacts.map((c) => (
          <li key={c.phone} className="flex flex-wrap items-center justify-between gap-2 text-xs" data-testid="whatsapp-contact">
            <span className="min-w-0">
              <span className="font-medium tabular-nums">{c.phone}</span>{" "}
              {c.optedOut ? <span className="font-medium text-red-700 dark:text-red-400">asked to stop</span>
                : c.optedIn ? <span className="text-muted-foreground">agreed: {c.optInSource}</span> : null}
              {c.optedIn && api && <span className="block text-muted-foreground">{c.windowOpenUntil ? `They wrote recently: you can send a normal message until ${when(c.windowOpenUntil)}.` : "They haven't written in the last 24 hours: only an approved template can be sent."}</span>}
            </span>
            {canRun && c.optedIn && <Button size="sm" variant="ghost" className="h-8 px-2 text-xs text-muted-foreground" onClick={() => stop.mutate(c.phone)} disabled={stop.isPending}>They asked to stop</Button>}
          </li>
        ))}
      </ul>
      {canRun && (open ? (
        <form className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); record.mutate(); }}>
          <label className="flex flex-col gap-1 text-[11px] font-medium">Their WhatsApp number<Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" inputMode="tel" className="h-9" data-testid="optin-phone" /></label>
          <label className="flex flex-col gap-1 text-[11px] font-medium">How they agreed<Input value={source} onChange={(e) => setSource(e.target.value)} maxLength={200} placeholder="Asked us to WhatsApp them on our website form, 12 Oct" className="h-9" data-testid="optin-source" /></label>
          <Button type="submit" size="sm" className="h-9" disabled={record.isPending || phone.trim().length < 8 || source.trim().length < 8} data-testid="optin-save">{record.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Record"}</Button>
        </form>
      ) : optedIn.length === 0 && <Button size="sm" variant="outline" className="h-8" onClick={() => setOpen(true)} data-testid="optin-open">Record their permission</Button>)}
    </div>
  );
}

/* ── a new message ───────────────────────────────────────────────────────── */

function NewMessage({ leadId, channel, api, contacts, onDone, onFail }: { leadId: number; channel: ShortChannel; api: boolean; contacts: WhatsappContact[]; onDone: () => void; onFail: (t: string) => (e: unknown) => void }) {
  const kinds = (MESSAGE_KINDS[channel] as readonly MessageKind[]).filter((k) => k !== "template" || api);
  const optedIn = contacts.filter((c) => c.optedIn);
  const windowOpen = optedIn.some((c) => c.windowOpenUntil);
  const [kind, setKind] = useState<MessageKind>(channel === "whatsapp" && api && optedIn.length && !windowOpen ? "template" : kinds[0]);
  const [to, setTo] = useState(channel === "whatsapp" ? optedIn[0]?.phone ?? "" : "");
  const [text, setText] = useState(""), [own, setOwn] = useState(false), [premium, setPremium] = useState(false);
  const [tpl, setTpl] = useState<{ key: string; params: string[] }>({ key: "", params: [] });
  useEffect(() => { if (channel === "whatsapp" && !to && optedIn[0]) setTo(optedIn[0].phone); }, [optedIn[0]?.phone]);
  const templates = useQuery<{ templates: WhatsappTemplate[] }>({ queryKey: [WHATSAPP_TEMPLATES_URL], enabled: kind === "template", retry: false });
  const chosen = templates.data?.templates.find((t) => `${t.name}|${t.language}` === tpl.key) ?? null;
  const max = maxFor(kind, premium);
  const create = useMutation({
    mutationFn: (write: "ai" | "own") => leadCall("POST", channelDraftUrl(leadId), {
      channel, kind, to: to || null, write, premium,
      ...(kind === "template" ? { template: { name: chosen?.name, language: chosen?.language, params: tpl.params } } : write === "own" ? { text } : {}),
    }),
    onSuccess: () => { setText(""); setOwn(false); onDone(); },
    onError: onFail("Couldn't write the message"),
  });
  const needsPermission = channel === "whatsapp" && !optedIn.length;
  return (
    <div className="space-y-2.5" data-testid="channel-new">
      {kinds.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Message type">
          {kinds.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
              className={cn("rounded-full border px-3 py-1 text-xs", kind === k ? "border-emerald-600 bg-emerald-600 text-white" : "bg-background hover:bg-muted")} data-testid={`kind-${k}`}>{KIND_LABEL[k]}</button>
          ))}
        </div>
      )}
      <label className="flex flex-col gap-1 text-[11px] font-medium">{TO_LABEL[channel].label}
        {channel === "whatsapp" && optedIn.length > 0
          ? <select value={to} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">{optedIn.map((c) => <option key={c.phone} value={c.phone}>{c.phone}</option>)}</select>
          : <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder={TO_LABEL[channel].placeholder} className="h-9" disabled={needsPermission} data-testid="channel-to" />}
      </label>
      {needsPermission ? <p className="text-xs text-muted-foreground">Record their permission above first.</p>
        : kind === "template" ? (
          <div className="space-y-2" data-testid="channel-template">
            {templates.isLoading && <p className="text-xs text-muted-foreground">Loading your approved templates…</p>}
            {templates.isError && <p className="text-xs text-red-700">{leadError(templates.error, "Your templates couldn't be loaded.")}</p>}
            {templates.data && !templates.data.templates.length && <p className="text-xs text-muted-foreground">No approved templates with plain-text values yet. Create one in WhatsApp Manager and wait for approval.</p>}
            {!!templates.data?.templates.length && (
              <select value={tpl.key} onChange={(e) => { const t = templates.data!.templates.find((x) => `${x.name}|${x.language}` === e.target.value); setTpl({ key: e.target.value, params: Array(t?.params ?? 0).fill("") }); }} className="h-9 w-full rounded-md border bg-background px-2 text-sm" data-testid="template-pick">
                <option value="">Choose an approved template</option>
                {templates.data.templates.map((t) => <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} ({t.language}, {t.category || "template"})</option>)}
              </select>
            )}
            {chosen && <>
              <p className="whitespace-pre-wrap rounded-md border bg-background/60 p-2 text-xs text-muted-foreground">{chosen.body}</p>
              {tpl.params.map((v, i) => <Input key={i} value={v} onChange={(e) => setTpl((s) => ({ ...s, params: s.params.map((x, j) => (j === i ? e.target.value : x)) }))} placeholder={`Value for {{${i + 1}}}`} maxLength={200} className="h-9" />)}
              <Button size="sm" onClick={() => create.mutate("own")} disabled={create.isPending || tpl.params.some((p) => !p.trim())} data-testid="template-create">{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}Use this template</Button>
            </>}
          </div>
        ) : own ? (
          <div className="space-y-2">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={channel === "linkedin" && kind === "connection_note" ? 3 : 6} maxLength={max} className="text-sm" aria-label="Your message" data-testid="channel-own-text" />
            <CharCount n={text.length} max={max} kind={kind} premium={premium} onPremium={setPremium} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => create.mutate("own")} disabled={create.isPending || text.trim().length < 2 || text.length > max} data-testid="channel-own-save">{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}Save draft</Button>
              <Button size="sm" variant="ghost" onClick={() => setOwn(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => create.mutate("ai")} disabled={create.isPending} data-testid="channel-write-ai">{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}Write it with AI</Button>
            <Button size="sm" variant="outline" onClick={() => setOwn(true)} data-testid="channel-write-own"><PenLine className="mr-1.5 h-4 w-4" />Write my own</Button>
            {channel === "linkedin" && kind === "connection_note" && <p className="w-full text-[11px] text-muted-foreground">Kept within LinkedIn's 200-character note limit (300 with Premium). AI writes only from what's been verified about the company.</p>}
          </div>
        )}
    </div>
  );
}

function CharCount({ n, max, kind, premium, onPremium }: { n: number; max: number; kind: MessageKind; premium: boolean; onPremium: (v: boolean) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
      {kind === "connection_note" ? <label className="inline-flex items-center gap-2"><Switch checked={premium} onCheckedChange={onPremium} aria-label="I have LinkedIn Premium" />I have LinkedIn Premium (300 characters)</label> : <span />}
      <span className={cn("tabular-nums", n > max && "font-semibold text-red-600")} data-testid="channel-count">{n.toLocaleString()} / {max.toLocaleString()}</span>
    </div>
  );
}

/* ── the message being worked on ─────────────────────────────────────────── */

function MessageEditor({ m, api, canRun, contacts, search, onDone, onFail }: { m: ChannelMessage; api: boolean; canRun: boolean; contacts: WhatsappContact[]; search: string; onDone: () => void; onFail: (t: string) => (e: unknown) => void }) {
  const { toast } = useToast();
  const [text, setText] = useState(m.body ?? ""), [editing, setEditing] = useState(false), [premium, setPremium] = useState(false);
  useEffect(() => { setText(m.body ?? ""); setEditing(false); }, [m.id, m.bodyHash]);
  const kind = m.kind as MessageKind, max = maxFor(kind, premium), dirty = text !== (m.body ?? "");
  const act = (action: string, body: Record<string, unknown> = {}) => leadCall(action === "edit" ? "PATCH" : "POST", channelMessageUrl(m.id, action === "edit" ? undefined : action), body);
  const save = useMutation({ mutationFn: () => act("edit", { text, premium }), onSuccess: onDone, onError: onFail("Couldn't save your changes") });
  const approve = useMutation({ mutationFn: () => act("approve", { bodyHash: m.bodyHash }), onSuccess: onDone, onError: onFail("Couldn't approve it") });
  const sendApi = useMutation({ mutationFn: () => act("send", { bodyHash: m.bodyHash }), onSuccess: () => { onDone(); toast({ title: "Sent from your WhatsApp Business number", description: "Delivery and replies will show here." }); }, onError: onFail("Not sent") });
  const sent = useMutation({ mutationFn: () => act("sent", { bodyHash: m.bodyHash }), onSuccess: onDone, onError: onFail("Couldn't record it") });
  const resolve = useMutation({ mutationFn: (outcome: "sent" | "not_sent") => act("resolve", { outcome }), onSuccess: onDone, onError: onFail("Couldn't record it") });
  const cancel = useMutation({ mutationFn: () => act("cancel"), onSuccess: onDone, onError: onFail("Couldn't discard it") });
  const busy = save.isPending || approve.isPending || sendApi.isPending || sent.isPending || resolve.isPending || cancel.isPending;
  const copy = async () => { try { await navigator.clipboard.writeText(m.body ?? ""); toast({ title: "Copied", description: "Copying doesn't send it. Paste it, send it, then press \"I sent it\"." }); } catch { toast({ title: "Couldn't copy", description: "Select the text and copy it yourself.", variant: "destructive" }); } };
  const open = m.channel === "whatsapp" ? (m.to ? waMeUrl(m.to, m.body ?? "") : null) : externalUrl(m.channel, m.to, search);
  const windowOpen = contacts.find((c) => c.phone === m.to)?.windowOpenUntil;
  const editable = m.status === "draft" || editing;

  return (
    <div className="space-y-2.5" data-testid="channel-message">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{m.kindLabel}{m.to ? <> · To <span className="font-medium text-foreground">{m.channel === "x" ? `@${m.to}` : m.to}</span></> : null}</span>
        <span className="font-medium" data-testid="channel-status">{m.statusLabel}</span>
      </div>
      {editable && m.kind !== "template" ? (
        <>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={kind === "connection_note" ? 3 : 7} maxLength={Math.max(max, text.length)} className="text-sm" aria-label="Message" disabled={!canRun || busy} data-testid="channel-text" />
          <CharCount n={text.length} max={max} kind={kind} premium={premium} onPremium={setPremium} />
        </>
      ) : (
        <p className="whitespace-pre-wrap break-words rounded-md border bg-background/60 p-3 text-sm" data-testid="channel-readonly">{m.body}</p>
      )}
      {m.status === "draft" && m.createdBy !== "agent" && !m.edited && m.body && <p className="text-[11px] text-muted-foreground">Read it and change anything before you approve it.</p>}
      {m.status === "uncertain" && <p className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />WhatsApp didn't answer, so it isn't known whether this went out. It won't be sent again by itself. Check with them, then say what happened.</p>}
      {m.status === "failed" && <p className="flex items-start gap-1.5 text-xs text-red-700 dark:text-red-400"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />Not sent ({(m.errorCode ?? "").replace(/^whatsapp_/, "").replace(/_/g, " ")}). Discard it and write a new one, or try again later.</p>}
      {m.channel === "whatsapp" && m.kind === "text" && m.status === "approved" && api && !windowOpen && <p className="text-xs text-amber-800 dark:text-amber-300">The 24-hour window is closed: WhatsApp will only accept an approved template now.</p>}
      {canRun && (
        <div className="flex flex-wrap items-center gap-2">
          {m.status === "draft" && dirty && <Button size="sm" onClick={() => save.mutate()} disabled={busy || text.length > max} data-testid="channel-save"><Check className="mr-1.5 h-4 w-4" />Save changes</Button>}
          {m.status === "draft" && !dirty && <Button size="sm" onClick={() => approve.mutate()} disabled={busy} data-testid="channel-approve">{approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}Approve</Button>}
          {m.status === "approved" && !editing && <>
            {m.channel === "whatsapp" && api
              ? <Button size="sm" onClick={() => sendApi.mutate()} disabled={busy} data-testid="channel-send">{sendApi.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}Send from WhatsApp Business</Button>
              : <>
                <Button size="sm" variant="outline" onClick={copy} disabled={busy} data-testid="channel-copy"><Copy className="mr-1.5 h-4 w-4" />Copy</Button>
                {open && <Button size="sm" variant="outline" asChild><a href={open} target="_blank" rel="noopener noreferrer" data-testid="channel-open"><ExternalLink className="mr-1.5 h-4 w-4" />{m.channel === "whatsapp" ? "Open WhatsApp" : m.to ? `Open on ${CHANNEL_LABEL[m.channel]}` : `Find them on ${CHANNEL_LABEL[m.channel]}`}</a></Button>}
                <Button size="sm" onClick={() => sent.mutate()} disabled={busy} data-testid="channel-sent">{sent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="mr-1.5 h-4 w-4" />}I sent it</Button>
              </>}
            {m.kind !== "template" && <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={busy} data-testid="channel-edit"><Pencil className="mr-1.5 h-4 w-4" />Edit</Button>}
          </>}
          {m.status === "approved" && editing && (dirty
            ? <Button size="sm" onClick={() => save.mutate()} disabled={busy || text.length > max}>Save (needs approving again)</Button>
            : <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Keep as approved</Button>)}
          {m.status === "uncertain" && <>
            <Button size="sm" variant="outline" onClick={() => resolve.mutate("sent")} disabled={busy} data-testid="channel-resolve-sent">It arrived</Button>
            <Button size="sm" variant="outline" onClick={() => resolve.mutate("not_sent")} disabled={busy} data-testid="channel-resolve-not">It didn't arrive</Button>
          </>}
          {["draft", "approved", "failed"].includes(m.status) && <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => cancel.mutate()} disabled={busy} data-testid="channel-discard"><XIcon className="mr-1.5 h-4 w-4" />Discard</Button>}
        </div>
      )}
      {m.status === "approved" && !(m.channel === "whatsapp" && api) && <p className="text-[11px] text-muted-foreground">DealInSec can't send this for you. Copy it, send it on {CHANNEL_LABEL[m.channel]}, then press "I sent it".</p>}
    </div>
  );
}

function HistoryItem({ m, canRun, onDone, onFail }: { m: ChannelMessage; canRun: boolean; onDone: () => void; onFail: (t: string) => (e: unknown) => void }) {
  const reply = useMutation({ mutationFn: () => leadCall("POST", channelMessageUrl(m.id, "reply"), {}), onSuccess: onDone, onError: onFail("Couldn't record it") });
  const inbound = m.direction === "in";
  const time = inbound ? m.createdAt : m.readAt ?? m.deliveredAt ?? m.sentAt;
  return (
    <li className={cn("rounded-lg border p-2.5 text-sm", inbound ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20" : "bg-background/60")} data-testid={inbound ? "channel-inbound" : "channel-sent-item"}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">{inbound ? <MessageCircle className="h-3 w-3" /> : <Send className="h-3 w-3" />}{inbound ? "They wrote" : m.kindLabel}</span>
        <span>{m.statusLabel}{time ? ` · ${when(time)}` : ""}</span>
      </div>
      {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : <p className="text-xs italic text-muted-foreground">{inbound ? "A message that isn't text (open WhatsApp to see it)." : ""}</p>}
      {!inbound && canRun && !m.repliedAt && m.sentVia === "manual" && (
        <Button size="sm" variant="ghost" className="mt-1 h-8 px-2 text-xs" onClick={() => reply.mutate()} disabled={reply.isPending} data-testid="channel-replied">They replied</Button>
      )}
    </li>
  );
}
