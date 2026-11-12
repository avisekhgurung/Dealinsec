/**
 * Centre panel: Mika's message for the selected channel. Write it with Mika (built on one strong piece of research,
 * shown in "Why Mika wrote this"), three versions for email, or your own words; edit it, improve it with Mika, and see
 * how it will look on the platform. Saving is explicit and shown; nothing here sends anything.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, Check, ExternalLink, Eye, Loader2, PenLine, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { CHANNEL_LABEL, KIND_DRAFT_TARGET, maxFor, type Channel, type MessageKind } from "@shared/channels";
import { LIMITS } from "@shared/outreach-check";
import type { DraftBasis } from "@shared/draft-evidence";
import { MikaCharacter } from "@/components/ai-league/nest-character";
import { DraftAllowanceLine, refreshDraftAllowance } from "@/components/leads/draft-allowance-line";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import type { DraftAllowanceNote } from "@/lib/draft-allowance";
import { gapNote, type Gap } from "@/lib/first-message-gap";
import { channelDraftUrl, channelMessageUrl } from "@/lib/channels";
import { draftUrl, leadCall, leadError, messageUrl } from "@/lib/leads";
import { REWRITE_ACTIONS, STUDIO_KINDS, type StudioMessage } from "@/lib/studio";
import { ChannelPreview } from "./previews";
import { cn } from "@/lib/utils";

export interface ComposerProps {
  leadId: number;
  company: string;
  sender: string;
  channel: Channel;
  current: StudioMessage | null;
  variants: StudioMessage[];
  basis: DraftBasis | null;
  canEdit: boolean;
  /** Email only: what a first email still lacks (an address, or anything verified). */
  gap: Gap | null;
  hasWebsite: boolean;
  allowance: DraftAllowanceNote | null;
  /** The destination typed in the right panel before a message exists (channels). */
  pendingTo: string;
  /** Instagram / Messenger before the server allows them. */
  channelOff: string | null;
  refresh: () => void;
  /** Tells the actions panel there are unsaved words, so nothing is approved or copied that isn't saved. */
  onDirtyChange?: (dirty: boolean) => void;
}

const Spin = () => <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />;

/** "Why Mika wrote this": the point a draft was built on, its date and source, and how sure it is. Never invented. */
export function WhyMika({ basis, byAi }: { basis: DraftBasis | null; byAi: boolean }) {
  const [open, setOpen] = useState(true);
  if (!byAi) return <p className="text-xs text-muted-foreground" data-testid="why-mika">You wrote this message.</p>;
  const lead = basis?.lead ?? null;
  const host = (u: string | null) => { if (!u) return null; try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } };
  return (
    <section className="rounded-xl border border-border/70 bg-muted/20" data-testid="why-mika">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold">
        <MikaCharacter size={20} /> Why Mika wrote this
      </button>
      {open && (
        <div className="space-y-2 border-t border-border/60 px-3 py-3 text-sm">
          {!basis ? (
            <p className="text-muted-foreground">This was written before Mika recorded which piece of research she used.</p>
          ) : !lead ? (
            <p className="text-muted-foreground">Mika had only general facts about the company, so this message is general. Research the company for a more personal one.</p>
          ) : (
            <>
              <p className="text-xs font-medium text-muted-foreground">Built on</p>
              <p><span className="font-medium">{lead.label}:</span> {lead.value}</p>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="rounded-full border px-1.5 py-0.5">{lead.grade === "fact" ? "Fact from their website" : `Mika's guess${lead.confidence ? ` · ${lead.confidence} confidence` : ""}`}</span>
                {lead.kind === "signal" && <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5"><CalendarDays className="h-3 w-3" aria-hidden />{lead.date ?? "Undated"}</span>}
                {host(lead.sourceUrl) && <a href={lead.sourceUrl!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">{host(lead.sourceUrl)}<ExternalLink className="h-3 w-3" aria-hidden /></a>}
              </div>
              <p className="text-xs text-muted-foreground">{lead.offerMatch > 0 ? "It connects to what you offer." : "It doesn't clearly connect to what you offer: consider one line on how you'd help."}</p>
              {lead.grade === "guess" && <p className="text-xs text-amber-800 dark:text-amber-300">This is a guess, not a fact from their site. Check it before you send.</p>}
              {lead.kind === "signal" && !lead.date && <p className="text-xs text-amber-800 dark:text-amber-300">This has no date. Don't call it recent unless you know it is.</p>}
            </>
          )}
          {basis && basis.also.length > 0 && (
            <p className="text-xs text-muted-foreground">Also used: {basis.also.map((a) => a.label.toLowerCase()).join(", ")}.</p>
          )}
        </div>
      )}
    </section>
  );
}

export function Composer(p: ComposerProps) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const m = p.current && p.current.status !== "sent" ? p.current : null;
  const sent = p.current?.status === "sent" ? p.current : null;
  const [subject, setSubject] = useState(m?.subject ?? "");
  const [body, setBody] = useState(m?.body ?? "");
  const [own, setOwn] = useState(false);
  const [preview, setPreview] = useState(false);
  const kinds = p.channel === "email" ? [] : STUDIO_KINDS[p.channel];
  const [kind, setKind] = useState(kinds[0]?.kind ?? "email");
  useEffect(() => { setSubject(m?.subject ?? ""); setBody(m?.body ?? ""); setOwn(false); }, [m?.id, m?.bodyHash, p.channel]);
  useEffect(() => { setKind((p.channel === "email" ? "email" : STUDIO_KINDS[p.channel][0].kind)); setPreview(false); }, [p.channel]);

  const fail = (title: string) => (e: unknown) => toast({ title, description: leadError(e), variant: "destructive" });
  const done = () => { p.refresh(); void refreshDraftAllowance(); };
  const isEmail = p.channel === "email";
  const max = isEmail ? LIMITS.bodyMax : maxFor(kind as MessageKind);
  const editable = !!m && (m.status === "draft" || m.status === "approved") && p.canEdit;
  const dirty = !!m && (body !== m.body || (isEmail && subject !== (m.subject ?? "")));
  useEffect(() => { p.onDirtyChange?.(dirty || own); }, [dirty, own]);
  const tooShort = isEmail ? body.trim().length < LIMITS.bodyMin || subject.trim().length < LIMITS.subjectMin : body.trim().length < 2;
  const tooLong = body.length > max || (isEmail && subject.length > LIMITS.subjectMax);

  const write = useMutation({
    mutationFn: (how: "ai" | "versions" | "own") => {
      if (isEmail) {
        if (how === "own") return leadCall("POST", draftUrl(p.leadId), { write: "own", subject, body });
        return leadCall("POST", draftUrl(p.leadId), how === "versions" ? { variants: true } : {});
      }
      return leadCall("POST", channelDraftUrl(p.leadId), { channel: p.channel, kind, to: p.pendingTo.trim() || null, write: how === "own" ? "own" : "ai", ...(how === "own" ? { text: body } : {}) });
    },
    onSuccess: () => { setOwn(false); done(); },
    onError: (e) => { done(); fail("Mika couldn't write it")(e); },
  });
  const save = useMutation({
    mutationFn: () => isEmail ? leadCall("PATCH", messageUrl(m!.id), { subject, body }) : leadCall("PATCH", channelMessageUrl(m!.id), { text: body }),
    onSuccess: () => { done(); toast({ title: "Saved" }); },
    onError: fail("Couldn't save your changes"),
  });
  const rewrite = useMutation({
    mutationFn: (action: string) => leadCall("POST", isEmail ? messageUrl(m!.id, "rewrite") : channelMessageUrl(m!.id, "rewrite"), { action, bodyHash: m!.bodyHash }).then(() => action),
    onSuccess: (action) => {
      const before = { subject: m!.subject ?? "", body: m!.body };
      done();
      toast({ title: `${REWRITE_ACTIONS.find((a) => a.action === action)?.label ?? "Improved"}: done`, description: "Read it before you approve it. Your previous text is below if you want it back." });
      setUndo(before);
    },
    onError: (e) => { done(); fail("Mika couldn't improve it")(e); },
  });
  const [undo, setUndo] = useState<{ subject: string; body: string } | null>(null);
  useEffect(() => { if (!m) setUndo(null); }, [m?.id]);
  const choose = useMutation({
    mutationFn: (v: StudioMessage) => leadCall("POST", messageUrl(v.id, "choose"), { bodyHash: v.bodyHash }),
    onSuccess: done, onError: (e) => { done(); fail("Couldn't use that version")(e); },
  });
  const discardVersions = useMutation({ mutationFn: () => leadCall("POST", messageUrl(p.variants[0]!.id, "cancel"), {}), onSuccess: done, onError: fail("Couldn't discard them") });
  const again = async () => {
    if (!m) return;
    const ok = await confirm({ title: `Write a new ${CHANNEL_LABEL[p.channel]} draft?`, description: `This replaces the current text with a new one from Mika and uses 1 of your AI drafts.${p.allowance && !p.allowance.out ? ` ${p.allowance.text}` : ""}`, confirmText: "Write again" });
    if (!ok) return;
    try {
      await leadCall("POST", isEmail ? messageUrl(m.id, "cancel") : channelMessageUrl(m.id, "cancel"), {});
      write.mutate("ai");
    } catch (e) { fail("Couldn't replace it")(e); }
  };
  const busy = write.isPending || save.isPending || rewrite.isPending || choose.isPending || discardVersions.isPending;
  const outOfDrafts = !!p.allowance?.out;
  const gap = isEmail ? gapNote(p.gap, p.hasWebsite) : null;
  const needsNumber = p.channel === "whatsapp" && !p.pendingTo.trim();

  /* ── versions to choose from (email) ── */
  if (isEmail && !m && p.variants.length > 0) {
    return (
      <Panel channel={p.channel}>
        <p className="text-sm" data-testid="studio-versions-note">{p.variants.length} versions, each built on a different piece of research. Pick the one that sounds like you; you can still change every word.</p>
        <div className="grid gap-3 xl:grid-cols-3">
          {p.variants.map((v) => (
            <div key={v.id} className="flex flex-col rounded-xl border border-border/70 bg-card p-3" data-testid="studio-version">
              <p className="text-sm font-semibold">{v.subject}</p>
              <p className="mt-1 line-clamp-6 whitespace-pre-wrap text-sm text-muted-foreground">{v.body}</p>
              <Button size="sm" className="mt-3 self-start" disabled={busy || !p.canEdit} onClick={() => choose.mutate(v)} data-testid="studio-version-choose">{choose.isPending && choose.variables?.id === v.id ? <Spin /> : <Check className="mr-1.5 h-4 w-4" />}Use this one</Button>
            </div>
          ))}
        </div>
        {p.canEdit && <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={() => discardVersions.mutate()}>Discard all versions</Button>}
      </Panel>
    );
  }

  /* ── nothing written yet ── */
  if (!m && !own) {
    return (
      <Panel channel={p.channel}>
        {sent && (
          <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-sm" data-testid="studio-sent">
            <p className="text-xs font-medium text-muted-foreground">{sent.stateLabel}{sent.sentAt ? ` · ${new Date(sent.sentAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}</p>
            {sent.subject && <p className="mt-1 font-semibold">{sent.subject}</p>}
            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{sent.body}</p>
          </div>
        )}
        {p.channelOff ? (
          <p className="text-sm text-muted-foreground">{p.channelOff}</p>
        ) : isEmail && sent ? (
          <p className="text-sm text-muted-foreground">Your first email to {p.company} is out. Record their reply or plan a follow-up on the right.</p>
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border/80 p-4" data-testid="studio-empty">
            <div className="flex items-center gap-3">
              <MikaCharacter size={40} />
              <div>
                <p className="font-semibold">{isEmail ? "Mika hasn't written the first email yet" : sent ? `Write another ${CHANNEL_LABEL[p.channel]} message` : `Mika hasn't written your ${CHANNEL_LABEL[p.channel]} message yet`}</p>
                <p className="text-sm text-muted-foreground">She writes from what we found about {p.company}. You check it, then send it yourself.</p>
              </div>
            </div>
            {kinds.length > 1 && (
              <div role="radiogroup" aria-label="Message type" className="flex flex-wrap gap-1.5">
                {kinds.map((k) => (
                  <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind} onClick={() => setKind(k.kind)}
                    className={cn("rounded-full border px-3 py-1 text-xs", kind === k.kind ? "border-primary bg-primary/10 font-semibold text-foreground" : "text-muted-foreground hover:bg-muted")}>{k.label}</button>
                ))}
              </div>
            )}
            {gap && <p className="text-sm" data-testid="studio-gap">{gap.why} <span className="text-muted-foreground">{gap.fix}</span></p>}
            {needsNumber && <p className="text-sm text-muted-foreground">First add their WhatsApp number under "Where it goes", with the country code.</p>}
            {p.canEdit && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => write.mutate("ai")} disabled={busy || !!gap || outOfDrafts || needsNumber} data-testid="studio-write-ai">{write.isPending && write.variables === "ai" ? <Spin /> : <Sparkles className="mr-1.5 h-4 w-4" />}Write with Mika</Button>
                {isEmail && <Button variant="outline" onClick={() => write.mutate("versions")} disabled={busy || !!gap || outOfDrafts} title="Three versions, each built on a different piece of research. Counts as one AI draft." data-testid="studio-write-versions">{write.isPending && write.variables === "versions" ? <Spin /> : <Sparkles className="mr-1.5 h-4 w-4" />}3 versions</Button>}
                <Button variant="ghost" onClick={() => setOwn(true)} disabled={busy || (isEmail && p.gap === "address")} data-testid="studio-write-own"><PenLine className="mr-1.5 h-4 w-4" />Write my own</Button>
              </div>
            )}
            {write.isPending && <p className="text-xs text-muted-foreground" aria-live="polite">Mika is writing from the research. This takes a few seconds.</p>}
            <DraftAllowanceLine note={p.allowance} own />
          </div>
        )}
      </Panel>
    );
  }

  /* ── writing or editing ── */
  return (
    <Panel channel={p.channel}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" data-testid="studio-meta">
          To {p.company} · {CHANNEL_LABEL[p.channel]} · {m ? m.kindLabel : kinds.find((k) => k.kind === kind)?.label ?? "First email"}
          {m && <> · <span className="font-medium text-foreground">{m.byAi ? (m.edited ? "Written by Mika, edited by you" : "Written by Mika") : "Written by you"}</span></>}
        </p>
        <div className="flex items-center gap-1">
          <Button size="sm" variant={preview ? "secondary" : "ghost"} onClick={() => setPreview(!preview)} aria-pressed={preview} data-testid="studio-preview-toggle"><Eye className="mr-1.5 h-4 w-4" />Preview</Button>
          {m && editable && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={busy || dirty} title={dirty ? "Save your changes first" : undefined} data-testid="studio-improve">{rewrite.isPending ? <Spin /> : <Wand2 className="mr-1.5 h-4 w-4" />}Improve</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Mika rewrites the words only. It doesn't use an AI draft.</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {REWRITE_ACTIONS.map((a) => (
                  <DropdownMenuItem key={a.action} onSelect={() => rewrite.mutate(a.action)} className="flex flex-col items-start gap-0" data-testid={`studio-rewrite-${a.action}`}>
                    <span className="font-medium">{a.label}</span><span className="text-xs text-muted-foreground">{a.hint}</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void again()} disabled={outOfDrafts} className="flex flex-col items-start gap-0" data-testid="studio-write-again">
                  <span className="inline-flex items-center gap-1.5 font-medium"><RefreshCw className="h-3.5 w-3.5" aria-hidden />Write again</span><span className="text-xs text-muted-foreground">A new draft from Mika. Uses 1 AI draft.</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {rewrite.isPending && <div className="h-0.5 w-full overflow-hidden rounded bg-primary/20" aria-hidden><div className="h-full w-1/3 animate-pulse bg-primary/60 motion-reduce:animate-none" /></div>}

      {preview ? (
        <ChannelPreview channel={p.channel} kind={m?.kind ?? kind} company={p.company} to={m?.to ?? (p.pendingTo || null)} subject={isEmail ? subject : null} body={body} sender={p.sender} />
      ) : (
        <div className="space-y-2" aria-busy={rewrite.isPending}>
          {isEmail && (
            <div className="space-y-1">
              <label htmlFor="studio-subject" className="text-sm font-medium">Subject</label>
              <Input id="studio-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={LIMITS.subjectMax + 20} disabled={(!!m && !editable) || busy} data-testid="studio-subject" />
            </div>
          )}
          <div className="space-y-1">
            <label htmlFor="studio-body" className="text-sm font-medium">Message</label>
            <Textarea id="studio-body" value={body} onChange={(e) => setBody(e.target.value)} rows={isEmail ? 12 : 8} disabled={(!!m && !editable) || busy}
              className={cn("min-h-[200px] text-[15px] leading-relaxed", rewrite.isPending && "opacity-60")} data-testid="studio-body" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className={cn("tabular-nums", tooLong ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
              {tooLong ? `${body.length - max} characters over the limit` : isEmail ? `${body.trim().length} / ${max}` : `${body.length} / ${max}${!isEmail && body.length > KIND_DRAFT_TARGET[(m?.kind ?? kind) as MessageKind].max ? " · shorter messages get more replies" : ""}`}
            </span>
            <span className="w-32 text-right text-muted-foreground" data-testid="studio-save-state">{save.isPending ? "Saving…" : dirty ? "Not saved yet" : m ? "Saved" : "Not saved yet"}</span>
          </div>
          {m?.status === "approved" && <p className="text-xs text-muted-foreground">Approved. Editing moves it back to a draft, and you'll approve it again.</p>}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {m && editable && dirty && <Button onClick={() => save.mutate()} disabled={busy || tooShort || tooLong} data-testid="studio-save">{save.isPending ? <Spin /> : <Check className="mr-1.5 h-4 w-4" />}Save changes</Button>}
        {m && dirty && <Button variant="ghost" onClick={() => { setSubject(m.subject ?? ""); setBody(m.body); }} disabled={busy}>Undo changes</Button>}
        {!m && own && (
          <>
            <Button onClick={() => write.mutate("own")} disabled={busy || tooShort || tooLong || (p.channel === "whatsapp" && !p.pendingTo.trim())} data-testid="studio-save-own">{write.isPending ? <Spin /> : <Check className="mr-1.5 h-4 w-4" />}Save draft</Button>
            <Button variant="ghost" onClick={() => setOwn(false)} disabled={busy}>Cancel</Button>
            <p className="w-full text-xs text-muted-foreground">It doesn't use an AI draft. You'll read it once more and approve it before it can be sent.{isEmail && tooShort ? ` The subject needs ${LIMITS.subjectMin}+ characters and the message ${LIMITS.bodyMin}+.` : ""}</p>
          </>
        )}
      </div>

      {undo && m && !dirty && (
        <details className="rounded-lg border border-border/60 px-3 py-2 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Your previous text</summary>
          <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{undo.body}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => { setSubject(undo.subject); setBody(undo.body); setUndo(null); }}>Put it back (then save)</Button>
        </details>
      )}

      {m && <WhyMika basis={p.basis} byAi={m.byAi} />}
      {m && p.basis?.thin && m.byAi && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Mika knows little about {p.company}, so this message is general. Research the company on the lead page for a more personal one.
        </p>
      )}
    </Panel>
  );
}

function Panel({ channel, children }: { channel: Channel; children: React.ReactNode }) {
  return (
    <section id="studio-message-panel" role="tabpanel" aria-labelledby={`studio-tab-${channel}`} className="space-y-4" data-testid="studio-composer">
      <h2 className="sr-only">Message</h2>
      {children}
    </section>
  );
}
