/**
 * The AI brief for one prospect: where it stands (ICP fit, research readiness, contact readiness and outreach
 * eligibility, kept apart, each with what blocks it and a safe next step), the score and why, then what is KNOWN (facts and signals, each with its quote and
 * page), who to reach, and what is only INFERRED (pain points, opportunities), kept visibly apart. Actions: research
 * again, find contacts (when a data provider is connected), generate the outreach angle, add to Leads.
 *
 * Opened with focus="evidence" (a card's "N evidence"), it scrolls to the evidence and moves keyboard focus there once
 * the brief has loaded, so the sources are one click from the card.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, CircleDashed, CircleHelp, ExternalLink, Flame, Lightbulb, Loader2, RefreshCw, Sparkles, UserRound, UserSearch, XCircle } from "lucide-react";
import { MISSING_CONTACT, MISSING_REASON } from "@shared/prospect";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { leadCall, leadError } from "@/lib/leads";
import { useCalmMotion } from "@/lib/motion";
import { countryName, prospectUrl, type Brief, type Evidence } from "@/lib/outbound";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/analytics";
import { PROSPECT_FEEDBACK, PROSPECT_FEEDBACK_LABEL, type ProspectFeedback } from "@shared/prospect-feedback";
import { SITE_SIGNAL_NOTE } from "@shared/site-signals";
import { ScoreBadge } from "./prospect-card";
import { OpportunityPlan } from "./opportunity-plan";

const CONF: Record<string, string> = { low: "Mostly unknown", medium: "Partly known", high: "Well measured" };
const SOURCE: Record<string, string> = { website: "their website", provider: "a data provider", search: "a search result", derived: "worked out from other findings" };
const STATUS: Record<string, string> = { confirmed: "confirmed", inferred: "inferred, not confirmed", unknown: "unknown", conflicting: "sources disagree" };
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null);

/** Where a finding came from and how sure it is: source type, validation status, confidence. Never more than is stored. */
function Provenance({ e }: { e: Evidence }) {
  const bits = [`From ${SOURCE[e.source] ?? e.source}`, STATUS[e.status] ?? e.status, e.confidence ? `${e.confidence} confidence` : null].filter(Boolean);
  return <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{bits.join(" · ")}</p>;
}

type State = "ok" | "partial" | "blocked" | "unknown";
function StateRow({ title, state, label, children }: { title: string; state: State; label: string; children?: React.ReactNode }) {
  const Icon = state === "ok" ? CheckCircle2 : state === "blocked" ? XCircle : state === "partial" ? CircleDashed : CircleHelp;
  return (
    <div className="rounded-lg border px-3 py-2" data-testid={`qual-${title.toLowerCase().replace(/\W+/g, "-")}`}>
      <p className="flex items-center gap-1.5 text-sm"><Icon className={cn("h-4 w-4 shrink-0", state === "ok" ? "text-emerald-600" : state === "blocked" ? "text-red-600" : state === "partial" ? "text-amber-600" : "text-muted-foreground")} /><span className="font-medium">{title}:</span> {label}</p>
      {children && <div className="mt-1 space-y-0.5 pl-5 text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

/** The four states, never merged: a verified email doesn't make a prospect ready, and a ready one doesn't make its contact verified. */
function Qualification({ b }: { b: Brief }) {
  const p = b.prospect;
  const blockers = p.blockers ?? p.score?.readyMissing ?? [];
  const research = blockers.filter((m) => m !== MISSING_CONTACT);
  const fit = p.fit?.verdict;
  const fitState: State = fit === "strong" ? "ok" : fit === "partial" ? "partial" : fit === "weak" || fit === "excluded" ? "blocked" : "unknown";
  const fitLabel = fit === "strong" ? "Match" : fit === "partial" ? "Partial match" : fit === "weak" || fit === "excluded" ? "Not qualified" : "Not known";
  const cls = p.classification;
  const researchState: State = p.rejectReason ? "blocked" : cls === "ready" ? "ok" : cls === "not_a_fit" ? "blocked" : research.length ? "partial" : "ok";
  const senior = b.people.filter((e) => e.senior && e.status === "confirmed");
  const verified = b.people.filter((e) => e.meta?.email && e.meta?.emailStatus === "verified");
  const unverified = b.people.filter((e) => e.meta?.email && e.meta?.emailStatus !== "verified");
  const companyEmail = b.facts.find((e) => e.type === "business_email");
  const form = b.facts.find((e) => e.type === "contact_form" && e.label === "Contact page");
  const phone = b.facts.find((e) => e.type === "business_phone");
  const contactOk = !blockers.includes(MISSING_CONTACT);
  return (
    <Section title="Where it stands" hint="four separate checks">
      <StateRow title="ICP fit" state={fitState} label={fitLabel}>
        {p.fit?.headline && <p>{p.fit.headline}</p>}
        {(p.fit?.signals ?? []).map((sg) => <p key={sg.key} className={sg.status === "match" ? "text-emerald-700 dark:text-emerald-400" : undefined}>{sg.status === "match" ? "✓" : sg.status === "mismatch" ? "✗" : "?"} {sg.detail}</p>)}
      </StateRow>
      <StateRow title="Research readiness" state={researchState} label={`${p.rejectLabel ? `Set aside · ${p.rejectLabel}` : p.classificationLabel ?? (p.ready ? "Ready" : "Not ready")}${p.timingLabel ? ` · ${p.timingLabel}` : ""}`}>
        {research.map((m) => <p key={m}>Missing: {m}</p>)}
        {research.includes(MISSING_REASON) && <p className="font-medium text-foreground">Next: research again to look for a recent, dated reason. Old or year-only dates don't count.</p>}
        {research.includes("a verified website") && <p className="font-medium text-foreground">Next: open their website and check it yourself.</p>}
      </StateRow>
      <StateRow title="Contact readiness" state={contactOk ? (verified.length ? "ok" : "partial") : "blocked"} label={contactOk ? (verified.length ? "A provider-verified email" : "A way in, not a verified email") : "No way to reach a person yet"}>
        {senior.length > 0 && <p>Decision maker named on their site: {senior.map((e) => e.meta?.name ?? e.value).join(", ")}</p>}
        {verified.length > 0 && <p>Verified by {String(verified[0].meta?.provider ?? "the provider")}: {verified.map((e) => e.meta?.email).join(", ")}</p>}
        {unverified.length > 0 && <p>Not verified: {unverified.map((e) => e.meta?.email).join(", ")}</p>}
        {companyEmail && <p>Company email on their site: {companyEmail.value}</p>}
        {phone && <p>Company phone on their site: {phone.value}</p>}
        {form && <p>Contact form on their site</p>}
        {!contactOk && <p className="font-medium text-foreground">Next: {b.providers.contact ? "look a contact up with the connected provider, or " : ""}add them to Leads and enter the contact by hand.</p>}
        <p>A verified email alone doesn't make a prospect ready, and readiness doesn't mean the contact is verified.</p>
      </StateRow>
      <StateRow title="Outreach eligibility" state={p.leadId ? "partial" : "unknown"} label={p.leadId ? "Decided on the lead" : "Not assessed here"}>
        <p>{p.leadId ? "Outreach is drafted and approved on the lead, where do-not-contact and approval rules apply." : "Nothing is sent from Client Radar. Add it to Leads to draft outreach for your approval; consent and do-not-contact are checked there."}</p>
      </StateRow>
    </Section>
  );
}

function Section({ title, tone, children, hint }: { title: string; tone?: "fact" | "signal" | "inference"; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className={cn("text-[11px] font-bold uppercase tracking-wider", tone === "signal" ? "text-orange-700 dark:text-orange-400" : tone === "inference" ? "text-violet-700 dark:text-violet-400" : "text-muted-foreground")}>{title}</h3>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Quote({ e }: { e: Evidence }) {
  if (!e.quote && !e.url) return e.source === "provider" ? <p className="text-[11px] text-muted-foreground">From a data provider (not on their website)</p> : null;
  return (
    <p className="mt-1 text-[11px] text-muted-foreground">
      {e.quote && <span className="italic">“{e.quote}”</span>}
      {e.url && <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="ml-1 inline-flex items-center gap-0.5 underline-offset-2 hover:underline">{e.url.replace(/^https:\/\//, "")}<ExternalLink className="h-2.5 w-2.5" /></a>}
    </p>
  );
}

export function ProspectBrief({ id, runId, open, onOpenChange, canEdit, focus = null }: { id: number | null; runId: string | null; open: boolean; onOpenChange: (o: boolean) => void; canEdit: boolean; /** Where to take the reader once loaded. */ focus?: "evidence" | null }) {
  const { toast } = useToast();
  const q = useQuery<{ brief: Brief }>({ queryKey: [id ? prospectUrl(id) : "none"], enabled: !!id && open });
  const [contact, setContact] = useState<number | null>(null);
  const refresh = () => { void queryClient.invalidateQueries({ predicate: (k) => typeof k.queryKey[0] === "string" && (k.queryKey[0] as string).startsWith("/api/outbound") }); };
  const act = (action: string, body: Record<string, unknown> = {}, ok?: (r: any) => void) => useMutation({
    mutationFn: () => leadCall("POST", prospectUrl(id!, action), body),
    onSuccess: (r) => { refresh(); ok?.(r); },
    onError: (e) => toast({ title: "Couldn't complete that", description: leadError(e), variant: "destructive" }),
  });
  const research = act("research", { runId });
  const contacts = act("contacts", { runId }, (r) => toast({ title: r.found ? `Found ${r.found} ${r.found === 1 ? "person" : "people"}` : "No one found", description: "From the connected data provider; check before you write." }));
  const angle = act("angle");
  const add = act("lead", contact ? { contactFindingId: contact } : {}, (r) => toast({ title: r.existing ? "Already in your leads" : "Added to Leads", description: "Its evidence is on the lead's Facts tab." }));
  const busy = research.isPending || contacts.isPending || angle.isPending || add.isPending;
  // The person's verdict: stored as given, changes nothing else; the same choice again clears it.
  const verdict = useMutation({
    mutationFn: (value: ProspectFeedback | null) => leadCall("POST", prospectUrl(id!, "feedback"), { value }),
    onSuccess: (_r, value) => { refresh(); if (value) trackEvent("prospect_feedback", { value }); },
    onError: (e) => toast({ title: "Couldn't save your answer", description: leadError(e), variant: "destructive" }),
  });
  const b = q.data?.brief;
  const p = b?.prospect;

  // Taken to the evidence once per opening, when the brief is there; a refetch never yanks the reader back.
  const evidenceRef = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  const calm = useCalmMotion();
  useEffect(() => { if (!open) focused.current = false; }, [open]);
  useEffect(() => {
    if (!open || focus !== "evidence" || !b || focused.current) return;
    const el = evidenceRef.current;
    if (!el) return;
    focused.current = true;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "start", behavior: calm ? "auto" : "smooth" });
  }, [open, focus, b, calm]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="prospect-brief-sheet">
        {!b || !p ? (
          <div className="space-y-3 pt-8" aria-busy="true">
            {/* The dialog needs a title for screen readers while the brief loads. */}
            <SheetTitle className="sr-only">Loading the prospect's details</SheetTitle>
            <SheetDescription className="sr-only">The company, its contact, evidence and where it stands.</SheetDescription>
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : (
          <div className="space-y-5 pb-8">
            <SheetHeader className="space-y-1 text-left">
              <div className="flex items-start gap-3">
                <ScoreBadge score={p.score} size="lg" />
                <div className="min-w-0">
                  <SheetTitle className="break-words">{p.name}</SheetTitle>
                  <SheetDescription asChild>
                    <div className="space-y-0.5 text-xs">
                      <a href={p.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 hover:underline">{p.domain}<ExternalLink className="h-3 w-3" /></a>
                      <p>{[p.profile.location, countryName(p.profile.country), p.profile.industry, p.profile.employees].filter(Boolean).join(" · ")}</p>
                      {p.score && <p>{CONF[p.score.confidence]} · {p.score.unknownPoints} of 100 points unknown{p.fit ? ` · ${p.fit.headline}` : ""}</p>}
                    </div>
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => research.mutate()} disabled={busy || !runId} title={runId ? undefined : "No search found this company, so it can't be researched again here"} data-testid="brief-research">{research.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}Research again</Button>
                <Button size="sm" variant="outline" onClick={() => contacts.mutate()} disabled={busy || !b.providers.contact || !runId} title={!b.providers.contact ? "Connect a contact data provider (Hunter) to look people up" : !runId ? "No search found this company, so contacts can't be looked up here" : undefined} data-testid="brief-contacts">{contacts.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UserSearch className="mr-1.5 h-4 w-4" />}Find contact</Button>
                <Button size="sm" variant="outline" onClick={() => angle.mutate()} disabled={busy} data-testid="brief-angle">{angle.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}{b.angle ? "New angle and plan" : "Find the opportunity"}</Button>
                {p.leadId ? (
                  <Button size="sm" asChild><Link href={`/leads/${p.leadId}`}>Open lead · draft outreach</Link></Button>
                ) : !p.rejectReason && (
                  <Button size="sm" onClick={() => add.mutate()} disabled={busy} data-testid="brief-add">{add.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Add to Leads</Button>
                )}
              </div>
            )}
            {!b.providers.contact && <p className="-mt-3 text-[11px] text-muted-foreground">People shown come from the company's own website. Connect a contact data provider to look up business emails.</p>}

            {canEdit && (
              <div className="space-y-1.5" data-testid="brief-feedback">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Is this a useful prospect?</p>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Your verdict on this prospect">
                  {PROSPECT_FEEDBACK.map((v) => {
                    const on = p.feedback === v;
                    return (
                      <Button key={v} size="sm" variant={on ? "default" : "outline"} aria-pressed={on} disabled={verdict.isPending}
                        onClick={() => verdict.mutate(on ? null : v)} data-testid={`brief-feedback-${v}`}>{PROSPECT_FEEDBACK_LABEL[v]}</Button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground">Your answer is kept so research quality can be measured. It doesn't change the score.</p>
              </div>
            )}

            <Qualification b={b} />

            <OpportunityPlan b={b} />

            {p.score && (
              <Section title={`Score ${p.score.total} / 100`}>
                <ul className="space-y-1.5">
                  {p.score.components.map((c) => (
                    <li key={c.key} className="flex items-start gap-3 text-sm">
                      <span className={cn("w-12 shrink-0 text-right font-semibold tabular-nums", c.points === null && "text-muted-foreground")}>{c.points === null ? <span className="inline-flex items-center gap-0.5"><CircleHelp className="h-3 w-3" />?</span> : `${c.points}/${c.max}`}</span>
                      <span className="min-w-0"><span className="font-medium">{c.label}</span><span className="block break-words text-xs text-muted-foreground">{c.reason}</span></span>
                    </li>
                  ))}
                </ul>
                {!!p.score.readyMissing?.length && <p className="text-xs text-muted-foreground">Not outreach-ready yet. Missing: {p.score.readyMissing.join("; ")}.</p>}
              </Section>
            )}

            <div ref={evidenceRef} id="brief-evidence" tabIndex={-1} role="region" aria-labelledby="brief-evidence-title" className="scroll-mt-4 space-y-5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 focus-visible:ring-offset-4" data-testid="brief-evidence">
              <p id="brief-evidence-title" className="border-t pt-4 text-xs font-semibold">Evidence <span className="font-normal text-muted-foreground">· what was found, each with where it came from</span></p>
              <Section title="Why now · signals" tone="signal" hint={`stated on their site · ${p.timingLabel ?? ""}`}>
                {b.signals.length ? b.signals.map((e) => (
                  <div key={e.id} className={cn("rounded-lg px-3 py-2 text-sm", e.timing === "strong" ? "bg-orange-50/70 dark:bg-orange-950/20" : "border")}>
                    <p className={cn("flex items-center gap-1.5 text-[11px] font-semibold", e.timing === "strong" ? "text-orange-700 dark:text-orange-400" : "text-muted-foreground")}>{e.timing === "strong" && <Flame className="h-3 w-3" />}{e.label} · {e.date ?? e.freshness}{e.freshness && e.date && e.freshness !== "Undated" ? ` (${e.freshness.toLowerCase()})` : ""} · {e.timing === "strong" ? "strong timing" : e.timing === "context" ? "context, not urgency" : e.timing === "stale" ? "over a year old" : "no usable date"}</p>
                    <p className="break-words">{e.value}</p><Quote e={e} /><Provenance e={e} />
                  </div>
                )) : <p className="text-sm text-muted-foreground">No dated change found on their site{p.researched ? "." : " yet. Research it to look."}</p>}
              </Section>

              <Section title="People" hint="decision makers first, then other employees">
                {b.people.length ? b.people.map((e) => (
                  <label key={e.id} className="flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm">
                    {canEdit && !p.leadId && <input type="radio" name="contact" className="mt-1" checked={contact === e.id} onChange={() => setContact(e.id)} aria-label={`Use ${e.value} as the lead's contact`} />}
                    <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block break-words font-medium">{e.value}</span>
                      <span className={cn("block text-[11px]", e.senior ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>{e.senior ? "Decision maker" : "Employee · not a senior decision-maker"}</span>
                      {e.meta?.title && <span className="block text-xs">{String(e.meta.title)}</span>}
                      {e.meta?.email && <span className="block text-xs">{e.meta.email} · <span className={e.meta.emailStatus === "verified" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>{e.meta.emailStatus === "verified" ? "verified by provider" : e.meta.emailStatus === "accept_all" ? "domain accepts all (unverified)" : "not verified"}</span></span>}
                      <Quote e={e} />
                      {/* The person's own provenance, apart from any research evidence about the company. */}
                      <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{e.source === "provider" ? `Contact from ${String(e.meta?.provider ?? "a data provider")}` : "Named on their website"}{e.retrievedAt ? ` · checked ${day(e.retrievedAt)}` : ""} · no phone or LinkedIn stored</span>
                    </span>
                  </label>
                )) : <p className="text-sm text-muted-foreground">No one named with a role on their website.</p>}
                {canEdit && !p.leadId && b.people.length > 0 && <p className="text-[11px] text-muted-foreground">Pick a person to make them the lead's contact. An email is added only when the provider verified it.</p>}
              </Section>

              {b.facts.some((e) => e.type === "site_signal") && (
                <Section title="Website observations" hint="from their home page's markup" >
                  {b.facts.filter((e) => e.type === "site_signal").map((e) => (
                    <div key={e.id} className="text-sm" data-testid="brief-site-signal"><span className="break-words">{e.value}</span><Quote e={e} /></div>
                  ))}
                  <p className="text-[11px] text-muted-foreground">{SITE_SIGNAL_NOTE}</p>
                </Section>
              )}

              <Section title="Facts" tone="fact" hint="each with the words from their site">
                {b.facts.filter((e) => e.type !== "site_signal").length ? b.facts.filter((e) => e.type !== "site_signal").map((e) => (
                  <div key={e.id} className="text-sm"><span className="text-xs text-muted-foreground">{e.label}:</span> <span className="break-words">{e.value}</span><Quote e={e} /><Provenance e={e} /></div>
                )) : <p className="text-sm text-muted-foreground">Nothing confirmed yet.</p>}
              </Section>
            </div>

            {(b.inferences.length > 0 || b.opportunities.length > 0) && (
              <Section title="Inferences · not confirmed" tone="inference">
                <p className="text-[11px] text-muted-foreground" data-testid="brief-unverified-note">Some details couldn't be verified. Review before reaching out.</p>
                {[...b.inferences, ...b.opportunities].map((e) => (
                  <div key={e.id} className="rounded-lg border border-dashed px-3 py-2 text-sm">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-700 dark:text-violet-400"><Lightbulb className="h-3 w-3" />{e.label}{e.source === "provider" ? " · data provider" : ""}</p>
                    <p className="break-words">{e.value}</p>
                    {!!e.supports?.length && <p className="text-[11px] text-muted-foreground">Based on {e.supports.length} finding{e.supports.length === 1 ? "" : "s"} above.</p>}
                    <Quote e={e} /><Provenance e={e} />
                  </div>
                ))}
              </Section>
            )}

            {!!p.score?.missing.length && (
              <Section title="What isn't known"><ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">{p.score.missing.map((m) => <li key={m}>{m}</li>)}</ul></Section>
            )}

            <Section title="Found through">
              <ul className="space-y-0.5 text-[11px] text-muted-foreground">{b.sources.slice(0, 5).map((s, i) => <li key={i} className="break-words">“{s.query}” · {s.provider}</li>)}</ul>
            </Section>
            <p className="text-[11px] text-muted-foreground" data-testid="brief-ai-disclaimer">AI results may be incomplete or inaccurate. Check important details before contacting a client.</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
