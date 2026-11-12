/**
 * Left panel: what DealInSec knows about the company, laid out the way Mika uses it. Facts (read on their website, or
 * entered by you) and Mika's guesses look different and say so; dated news shows its date, undated items say "Undated";
 * every item links to the page it came from. Nothing is shown that isn't in the lead's own research.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CalendarDays, CheckCircle2, ChevronDown, ExternalLink, Globe, Lightbulb, Mail, Phone, Search, User } from "lucide-react";
import type { EvidenceItem } from "@shared/draft-evidence";
import type { LeadScore } from "@shared/lead-score";
import { StageBadge } from "@/components/leads/stage-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { scoreUrl, type LeadView } from "@/lib/leads";
import { intelligenceUrl, type LeadIntelligence } from "@/lib/studio";
import type { Channel } from "@shared/channels";
import type { SocialLinks } from "@shared/social-links";
import { ChannelIcon } from "./channel-selector";

/** The company's own profiles, in the order the Studio's channels run, and where each opens. */
const SOCIAL_ROWS: [keyof SocialLinks, Channel, (v: string) => string][] = [
  ["whatsapp", "whatsapp", (v) => `https://wa.me/${v.replace(/^\+/, "")}`],
  ["linkedin", "linkedin", (v) => v],
  ["instagram", "instagram", (v) => `https://www.instagram.com/${v}/`],
  ["x", "x", (v) => `https://x.com/${v}`],
  ["facebook", "messenger", (v) => `https://www.facebook.com/${v}`],
];
import { cn } from "@/lib/utils";

const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
const host = (u: string | null | undefined) => { if (!u) return null; try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } };

function Section({ title, hint, children, testId }: { title: string; hint?: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="space-y-2" data-testid={testId}>
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** One piece of research: a fact (solid, check) or a guess (dashed, lightbulb), its date, and its source on request. */
export function EvidenceRow({ item }: { item: EvidenceItem }) {
  const [open, setOpen] = useState(false);
  const guess = item.grade === "guess";
  const src = host(item.sourceUrl);
  return (
    <div className={cn("rounded-lg border px-3 py-2 text-sm", guess ? "border-dashed border-[hsl(var(--evidence-guess)/0.5)] bg-[hsl(var(--evidence-guess)/0.05)]" : "border-border/70 bg-card", item.kind === "signal" && !guess && "border-l-2 border-l-[hsl(var(--evidence-fact))]")}
      data-testid="evidence-row" data-grade={item.grade}>
      <div className="flex items-start gap-2">
        {guess ? <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--evidence-guess))]" aria-hidden /> : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--evidence-fact))]" aria-hidden />}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
          <p className="break-words leading-snug">{item.value}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="rounded-full border px-1.5 py-0.5">{guess ? `Mika's guess${item.confidence ? ` · ${item.confidence}` : ""}` : "From their website"}</span>
            {item.kind === "signal" && <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5"><CalendarDays className="h-3 w-3" aria-hidden />{item.date ?? "Undated"}</span>}
            {item.offerMatch > 0 && <span className="rounded-full border border-[hsl(var(--evidence-fact)/0.4)] px-1.5 py-0.5">Matches what you offer</span>}
            {src && (
              <button type="button" className="underline-offset-2 hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>
                {open ? "Hide source" : "Show source"}
              </button>
            )}
          </div>
          {open && item.sourceUrl && (
            <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 break-all text-xs text-primary underline-offset-2 hover:underline">
              {src}{(() => { try { const p = new URL(item.sourceUrl).pathname; return p.length > 1 ? p.slice(0, 40) : ""; } catch { return ""; } })()}<ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export function IntelPanel({ lead, leadId }: { lead: LeadView; leadId: number }) {
  const q = useQuery<{ intelligence: LeadIntelligence }>({ queryKey: [intelligenceUrl(leadId)], retry: false });
  const score = useQuery<{ score: LeadScore }>({ queryKey: [scoreUrl(leadId)], retry: false });
  const [more, setMore] = useState(false);
  const intel = q.data?.intelligence;
  const ev = intel?.evidence;
  const signals = ev?.leads.filter((x) => x.kind === "signal") ?? [];
  const guesses = ev?.leads.filter((x) => x.grade === "guess") ?? [];
  const industry = ev?.profile.find((x) => x.label === "Industry")?.value ?? lead.industry ?? null;
  const location = ev?.profile.find((x) => x.label === "Based in")?.value ?? lead.location ?? null;
  const site = host(lead.website);
  return (
    <section aria-labelledby="studio-intel-h" className="space-y-5" data-testid="studio-intel">
      <h2 id="studio-intel-h" className="sr-only">About {lead.companyName}</h2>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary" aria-hidden>{initials(lead.companyName)}</span>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{lead.companyName}</p>
          <p className="truncate text-xs text-muted-foreground">{[industry, location].filter(Boolean).join(" · ") || "Industry and location not found yet."}</p>
          {site && <a href={lead.website!} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"><Globe className="h-3 w-3" aria-hidden />{site}</a>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <StageBadge status={lead.status} />
        {score.data?.score && <span>Lead score <span className="font-semibold text-foreground tabular-nums">{score.data.score.total}</span>/100 · checked {score.data.score.knownMax} of 100 points</span>}
      </div>

      {q.isLoading ? (
        <div className="space-y-2" aria-label="Loading research"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-12 w-full" /></div>
      ) : !intel ? (
        <p className="text-sm text-muted-foreground">The research couldn't be loaded. <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => q.refetch()}>Try again</button></p>
      ) : (
        <>
          <Section title="Research" testId="intel-research">
            <p className="text-sm">
              <span className="font-semibold tabular-nums">{intel.counts.facts}</span> {intel.counts.facts === 1 ? "fact" : "facts"} from their website · <span className="font-semibold tabular-nums">{intel.counts.guesses}</span> {intel.counts.guesses === 1 ? "guess" : "guesses"}
              {intel.counts.datedSignals > 0 && <> · <span className="font-semibold tabular-nums">{intel.counts.datedSignals}</span> dated news</>}
            </p>
            {ev!.thin && <p className="rounded-lg border border-amber-300/60 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Little is known about {lead.companyName}, so messages will be general. Research the company on the lead page for a more personal one.</p>}
          </Section>

          <Section title="Contact" testId="intel-contact">
            <ul className="space-y-1.5 text-sm">
              <li className="flex items-center gap-2"><User className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />{intel.contact.name ? <span>{intel.contact.name}{intel.contact.role ? <span className="text-muted-foreground"> · {intel.contact.role}</span> : null}</span> : <span className="text-muted-foreground">No contact person found yet.</span>}</li>
              <li className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />{intel.contact.email ? <span className="min-w-0 truncate">{intel.contact.email}<span className="text-muted-foreground"> · {intel.contact.emailSource === "you" ? "you added it" : "found on their website"}</span></span> : <span className="text-muted-foreground">No email address yet.</span>}</li>
              {intel.contact.phone && <li className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /><span>{intel.contact.phone}<span className="text-muted-foreground"> · on their website (not confirmed as WhatsApp)</span></span></li>}
              {SOCIAL_ROWS.map(([k, channel, href]) => {
                const v = intel.contact.socials?.[k];
                return v ? (
                  <li key={k} className="flex items-center gap-2" data-testid={`intel-social-${k}`}>
                    <ChannelIcon channel={channel} size={14} />
                    <a href={href(v)} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-primary underline-offset-2 hover:underline">{k === "linkedin" ? v.replace(/^https:\/\/www\.linkedin\.com\//, "").replace(/\/$/, "") : k === "whatsapp" ? v : `@${v}`}</a>
                    <span className="shrink-0 text-muted-foreground">· their website</span>
                  </li>
                ) : null;
              })}
            </ul>
            {intel.contact.socials && intel.contact.socialsCheckedAt && !Object.values(intel.contact.socials).some(Boolean) && <p className="text-xs text-muted-foreground">No social profiles linked on their website.</p>}
            {intel.contact.socials && !intel.contact.socialsCheckedAt && lead.website && <p className="text-xs text-muted-foreground" aria-live="polite">Looking on their website for social profiles…</p>}
          </Section>

          <Section title="Recent news" hint={signals.length ? undefined : "No news found on their website."} testId="intel-signals">
            <div className="space-y-2">{signals.slice(0, more ? 8 : 3).map((x) => <EvidenceRow key={x.key} item={x} />)}</div>
          </Section>

          {guesses.length > 0 && (
            <Section title="What it could mean" hint="Mika's reading of their website, not proof." testId="intel-guesses">
              <div className="space-y-2">{guesses.slice(0, more ? 6 : 2).map((x) => <EvidenceRow key={x.key} item={x} />)}</div>
            </Section>
          )}

          {ev!.profile.length > 0 && (
            <Section title="Who they are" testId="intel-profile">
              <div className="space-y-2">{ev!.profile.map((x) => <EvidenceRow key={x.key} item={x} />)}</div>
            </Section>
          )}

          {(signals.length > 3 || guesses.length > 2) && (
            <button type="button" onClick={() => setMore(!more)} className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline" aria-expanded={more}>
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", more && "rotate-180")} aria-hidden />{more ? "Show less" : "Show more research"}
            </button>
          )}

          {intel.sources.length > 0 && (
            <Section title="Sources" testId="intel-sources">
              <ul className="space-y-1 text-xs">
                {intel.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 truncate text-primary underline-offset-2 hover:underline">{s.host}<ExternalLink className="h-3 w-3 shrink-0" aria-hidden /></a> <span className="text-muted-foreground">· {s.items} item{s.items === 1 ? "" : "s"}</span></li>)}
              </ul>
            </Section>
          )}

          <Link href={`/leads/${leadId}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline" data-testid="intel-full-report"><Search className="h-3.5 w-3.5" aria-hidden />Full research on the lead page</Link>
        </>
      )}
    </section>
  );
}
