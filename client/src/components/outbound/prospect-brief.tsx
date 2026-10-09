/**
 * The AI brief for one prospect: the score and why, then what is KNOWN (facts and signals, each with its quote and
 * page), who to reach, and what is only INFERRED (pain points, opportunities), kept visibly apart. Actions: research
 * again, find contacts (when a data provider is connected), generate the outreach angle, add to Leads.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { CircleHelp, ExternalLink, Flame, Lightbulb, Loader2, RefreshCw, Sparkles, UserRound, UserSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { leadCall, leadError } from "@/lib/leads";
import { countryName, prospectUrl, type Brief, type Evidence } from "@/lib/outbound";
import { cn } from "@/lib/utils";
import { ScoreBadge } from "./prospect-card";

const CONF: Record<string, string> = { low: "Mostly unknown", medium: "Partly known", high: "Well measured" };

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

export function ProspectBrief({ id, runId, open, onOpenChange, canEdit }: { id: number | null; runId: string; open: boolean; onOpenChange: (o: boolean) => void; canEdit: boolean }) {
  const { toast } = useToast();
  const q = useQuery<{ brief: Brief }>({ queryKey: [id ? prospectUrl(id) : "none"], enabled: !!id && open });
  const [contact, setContact] = useState<number | null>(null);
  const refresh = () => { void queryClient.invalidateQueries({ predicate: (k) => typeof k.queryKey[0] === "string" && (k.queryKey[0] as string).startsWith("/api/outbound") }); };
  const act = (action: string, body: Record<string, unknown> = {}, ok?: (r: any) => void) => useMutation({
    mutationFn: () => leadCall("POST", prospectUrl(id!, action), body),
    onSuccess: (r) => { refresh(); ok?.(r); },
    onError: (e) => toast({ title: "That didn't work", description: leadError(e), variant: "destructive" }),
  });
  const research = act("research", { runId });
  const contacts = act("contacts", { runId }, (r) => toast({ title: r.found ? `Found ${r.found} ${r.found === 1 ? "person" : "people"}` : "No one found", description: "From the connected data provider; check before you write." }));
  const angle = act("angle");
  const add = act("lead", contact ? { contactFindingId: contact } : {}, (r) => toast({ title: r.existing ? "Already in your leads" : "Added to Leads", description: "Its evidence is on the lead's Facts tab." }));
  const busy = research.isPending || contacts.isPending || angle.isPending || add.isPending;
  const b = q.data?.brief;
  const p = b?.prospect;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="prospect-brief-sheet">
        {!b || !p ? (
          <div className="space-y-3 pt-8">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
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
                <Button size="sm" variant="outline" onClick={() => research.mutate()} disabled={busy} data-testid="brief-research">{research.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}Research again</Button>
                <Button size="sm" variant="outline" onClick={() => contacts.mutate()} disabled={busy || !b.providers.contact} title={b.providers.contact ? undefined : "Connect a contact data provider (Hunter) to look people up"} data-testid="brief-contacts">{contacts.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UserSearch className="mr-1.5 h-4 w-4" />}Find contact</Button>
                <Button size="sm" variant="outline" onClick={() => angle.mutate()} disabled={busy} data-testid="brief-angle">{angle.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}{b.angle ? "New angle" : "Generate angle"}</Button>
                {p.leadId ? (
                  <Button size="sm" asChild><Link href={`/leads/${p.leadId}`}>Open lead · draft outreach</Link></Button>
                ) : !p.rejectReason && (
                  <Button size="sm" onClick={() => add.mutate()} disabled={busy} data-testid="brief-add">{add.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Add to Leads</Button>
                )}
              </div>
            )}
            {!b.providers.contact && <p className="-mt-3 text-[11px] text-muted-foreground">People shown come from the company's own website. Connect a contact data provider to look up business emails.</p>}

            {b.angle && (
              <Section title="Outreach angle" tone="inference" hint={`${b.angle.confidence} confidence · from ${b.angle.evidenceIds.length} finding${b.angle.evidenceIds.length === 1 ? "" : "s"}`}>
                <div className="space-y-1.5 rounded-xl border border-violet-200 bg-violet-50/60 p-3 text-sm dark:border-violet-900/60 dark:bg-violet-950/20" data-testid="brief-angle-text">
                  <p><span className="font-medium">Problem:</span> {b.angle.problem}</p>
                  <p><span className="font-medium">Opportunity:</span> {b.angle.opportunity}</p>
                  <p><span className="font-medium">Position it as:</span> {b.angle.positioning}</p>
                  {b.angle.targetPerson && <p><span className="font-medium">Write to:</span> {b.angle.targetPerson}</p>}
                  <p className="text-xs text-muted-foreground">{b.angle.reason}</p>
                </div>
              </Section>
            )}

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

            <Section title="Why now · signals" tone="signal" hint="stated on their site">
              {b.signals.length ? b.signals.map((e) => (
                <div key={e.id} className="rounded-lg bg-orange-50/70 px-3 py-2 text-sm dark:bg-orange-950/20">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-orange-700 dark:text-orange-400"><Flame className="h-3 w-3" />{e.label} · {e.freshness}</p>
                  <p className="break-words">{e.value}</p><Quote e={e} />
                </div>
              )) : <p className="text-sm text-muted-foreground">No dated change found on their site{p.researched ? "." : " yet. Research it to look."}</p>}
            </Section>

            <Section title="People" hint="ranked by the roles you want">
              {b.people.length ? b.people.map((e) => (
                <label key={e.id} className="flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm">
                  {canEdit && !p.leadId && <input type="radio" name="contact" className="mt-1" checked={contact === e.id} onChange={() => setContact(e.id)} aria-label={`Use ${e.value} as the lead's contact`} />}
                  <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block break-words font-medium">{e.value}</span>
                    {e.meta?.email && <span className="block text-xs">{e.meta.email} · <span className={e.meta.emailStatus === "verified" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>{e.meta.emailStatus === "verified" ? "verified by provider" : e.meta.emailStatus === "accept_all" ? "domain accepts all (unverified)" : "not verified"}</span></span>}
                    <Quote e={e} />
                  </span>
                </label>
              )) : <p className="text-sm text-muted-foreground">No one named with a role on their website.</p>}
              {canEdit && !p.leadId && b.people.length > 0 && <p className="text-[11px] text-muted-foreground">Pick a person to make them the lead's contact. An email is added only when the provider verified it.</p>}
            </Section>

            <Section title="Facts" tone="fact" hint="each with the words from their site">
              {b.facts.length ? b.facts.map((e) => (
                <div key={e.id} className="text-sm"><span className="text-xs text-muted-foreground">{e.label}:</span> <span className="break-words">{e.value}</span><Quote e={e} /></div>
              )) : <p className="text-sm text-muted-foreground">Nothing confirmed yet.</p>}
            </Section>

            {(b.inferences.length > 0 || b.opportunities.length > 0) && (
              <Section title="Inferences · not confirmed" tone="inference">
                {[...b.inferences, ...b.opportunities].map((e) => (
                  <div key={e.id} className="rounded-lg border border-dashed px-3 py-2 text-sm">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-700 dark:text-violet-400"><Lightbulb className="h-3 w-3" />{e.label}{e.source === "provider" ? " · data provider" : ""}</p>
                    <p className="break-words">{e.value}</p>
                    {!!e.supports?.length && <p className="text-[11px] text-muted-foreground">Based on {e.supports.length} finding{e.supports.length === 1 ? "" : "s"} above.</p>}
                    <Quote e={e} />
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
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
