/**
 * One prospect, readable in ten seconds: score, whether it's only discovered or already in your Leads, where it stands
 * (Ready / Qualified / Partial / Not enough evidence / Not a fit, with the reason), why they fit, why now, a possible
 * opportunity (marked as an inference), the person to reach, and its evidence one click away. Everything shown comes
 * from stored, checked findings.
 */
import { motion } from "framer-motion";
import { BadgeCheck, Check, CheckCircle2, CircleDashed, CircleHelp, Compass, ExternalLink, Flame, Lightbulb, Link2, UserCheck, UserRound, X, XCircle } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { press } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { countryName, type Evidence, type ProspectCard as Card } from "@/lib/outbound";
import { PROSPECT_FEEDBACK_LABEL } from "@shared/prospect-feedback";
import { SITE_SIGNAL_NOTE } from "@shared/site-signals";

export function ScoreBadge({ score, size = "md" }: { score: Card["score"]; size?: "md" | "lg" }) {
  if (!score) return <div className={cn("flex shrink-0 flex-col items-center justify-center rounded-xl border border-dashed text-muted-foreground", size === "lg" ? "h-16 w-16" : "h-12 w-12")}><CircleHelp className="h-4 w-4" /><span className="text-[9px]">no score</span></div>;
  const tone = score.total >= 70 ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
    : score.total >= 40 ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
    : "border-border bg-muted/40 text-foreground";
  return (
    <div className={cn("flex shrink-0 flex-col items-center justify-center rounded-xl border", tone, size === "lg" ? "h-16 w-16" : "h-12 w-12")} title={`${score.unknownPoints} of 100 points unknown`} data-testid="prospect-score">
      <span className={cn("font-bold tabular-nums leading-none", size === "lg" ? "text-2xl" : "text-lg")}>{score.total}</span>
      <span className="text-[9px] uppercase tracking-wide opacity-70">/ 100</span>
    </div>
  );
}

const line = (e: Evidence | null) => (e ? e.value : null);
/** A readiness blocker without its long explanation in brackets: "a dated reason to get in touch". */
const short = (m: string) => m.replace(/\s*\(.*\)\s*$/, "");

type QualKey = "ready" | "qualified" | "partial" | "insufficient" | "not_a_fit" | "aside";
const QUAL: Record<QualKey, { Icon: typeof Check; tone: string }> = {
  ready: { Icon: CheckCircle2, tone: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" },
  qualified: { Icon: BadgeCheck, tone: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300" },
  partial: { Icon: CircleDashed, tone: "border-sky-300 bg-background text-sky-800 dark:border-sky-800 dark:text-sky-300" },
  insufficient: { Icon: CircleHelp, tone: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300" },
  not_a_fit: { Icon: XCircle, tone: "border-border bg-muted text-muted-foreground" },
  aside: { Icon: XCircle, tone: "border-border bg-muted text-muted-foreground" },
};

/**
 * Where a prospect stands, from the server's classification (shared/prospect.ts readiness) and nothing else: a
 * qualified prospect whose fit is only partial reads "Partial". The reason is the first thing still missing.
 */
export function qualificationOf(p: Card): { key: QualKey; label: string; reason: string | null } | null {
  if (p.rejectReason) return { key: "aside", label: "Set aside", reason: p.rejectLabel };
  const blockers = p.blockers ?? p.score?.readyMissing ?? [];
  const missing = blockers.length ? `Missing ${short(blockers[0])}${blockers.length > 1 ? ` and ${blockers.length - 1} more` : ""}` : null;
  const cls = p.classification ?? (p.ready ? "ready" : undefined);
  if (cls === "ready") return { key: "ready", label: "Ready", reason: "Fits, with a reason to get in touch and a way in" };
  if (cls === "qualified") return p.fit?.verdict === "partial" ? { key: "partial", label: "Partial", reason: ["Partial fit", missing].filter(Boolean).join(" · ") } : { key: "qualified", label: "Qualified", reason: missing ?? "Fits on evidence" };
  if (cls === "insufficient_evidence") return { key: "insufficient", label: "Not enough evidence", reason: missing };
  if (cls === "not_a_fit") return { key: "not_a_fit", label: "Not a fit", reason: p.fit?.headline ?? null };
  return null;
}

export function ProspectCard({ p, onOpen, onEvidence, onAdd, adding, canEdit }: { p: Card; onOpen: () => void; /** Opens the brief at its evidence. */ onEvidence?: () => void; onAdd: () => void; adding: boolean; canEdit: boolean }) {
  const where = [p.profile.location, countryName(p.profile.country)].filter(Boolean).join(", ");
  const meta = [where, p.profile.industry, p.profile.employees].filter(Boolean);
  const fits = (p.fit?.signals ?? []).filter((s) => s.status === "match").slice(0, 3);
  const misses = (p.fit?.signals ?? []).filter((s) => s.status === "mismatch").slice(0, 1);
  const person = p.decisionMaker ?? p.contactPerson ?? null;
  const qual = qualificationOf(p);
  const Q = qual ? QUAL[qual.key] : null;
  return (
    <div className={cn("flex h-full min-w-0 flex-col gap-3 rounded-2xl border bg-background p-4 transition-[box-shadow,border-color] hover:border-foreground/20 hover:shadow-sm", p.ready && "border-emerald-300 hover:border-emerald-400 dark:border-emerald-800 dark:hover:border-emerald-700")} data-testid="prospect-card">
      <div className="flex items-start gap-3">
        <ScoreBadge score={p.score} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <button onClick={onOpen} className="min-w-0 truncate text-left text-base font-semibold underline-offset-2 hover:underline" data-testid="prospect-name">{p.name}</button>
            {p.leadId ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-300 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:border-emerald-800 dark:text-emerald-300" data-testid="prospect-lead-status" data-state="lead"><UserCheck className="h-3 w-3" aria-hidden />In your leads</span>
            ) : (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground" title="Found by this search; not in your Leads" data-testid="prospect-lead-status" data-state="discovered"><Compass className="h-3 w-3" aria-hidden />Discovered</span>
            )}
          </div>
          <a href={p.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">{p.domain}<ExternalLink className="h-3 w-3" /></a>
          {meta.length > 0 && <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta.join(" · ")}</p>}
        </div>
      </div>

      {qual && Q && (
        <div className="space-y-0.5" data-testid="prospect-qualification" data-state={qual.key}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold", Q.tone)} data-testid="prospect-class"><Q.Icon className="h-3 w-3" aria-hidden />{qual.label}</span>
            {p.timing === "strong" && <span className="inline-flex items-center gap-1 rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-800 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300" title="A concrete event from the last 90 days"><Flame className="h-3 w-3" aria-hidden />Strong timing</span>}
          </div>
          {qual.reason && <p className="break-words text-xs text-muted-foreground" data-testid="prospect-class-reason">{qual.reason}</p>}
        </div>
      )}

      {/* How it can be reached, kept apart from whether it fits; the person's own verdict; what their home page shows. */}
      <div className="flex flex-wrap items-center gap-1.5" data-testid="prospect-status-chips">
        {p.contact === "verified" && <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" title="An email the contact provider itself verified" data-testid="prospect-contact" data-state="verified"><BadgeCheck className="h-3 w-3" aria-hidden />Verified contact</span>}
        {p.contact === "public" && <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium" title="A business email or contact form found on their own site. Found, not verified." data-testid="prospect-contact" data-state="public"><Link2 className="h-3 w-3" aria-hidden />Public contact · not verified</span>}
        {p.contact === "none" && <span className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground" data-testid="prospect-contact" data-state="none"><CircleDashed className="h-3 w-3" aria-hidden />No contact found yet</span>}
        {(p.siteSignals?.length ?? 0) > 0 && <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground" title={`${p.siteSignals!.join(". ")}. ${SITE_SIGNAL_NOTE}`} data-testid="prospect-site-signals">Website: {p.siteSignals!.length} observation{p.siteSignals!.length === 1 ? "" : "s"}</span>}
        {p.feedback && <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium" data-testid="prospect-feedback">You marked: {PROSPECT_FEEDBACK_LABEL[p.feedback]}</span>}
      </div>

      {(fits.length > 0 || misses.length > 0) && (
        <ul className="space-y-0.5 text-sm" aria-label="Why they fit">
          {fits.map((s) => <li key={s.key} className="flex gap-1.5"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden /><span className="min-w-0 break-words">{s.detail}</span></li>)}
          {misses.map((s) => <li key={s.key} className="flex gap-1.5 text-muted-foreground"><X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" aria-label="Doesn't match" /><span className="min-w-0 break-words">{s.detail}</span></li>)}
        </ul>
      )}

      {p.whyNow && (p.timing === "strong" || !p.timing ? (
        <div className="rounded-xl bg-orange-50 px-3 py-2 text-sm dark:bg-orange-950/30" data-testid="prospect-why-now">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-orange-700 dark:text-orange-400"><Flame className="h-3 w-3" />Why now · {p.whyNow.label}{p.whyNow.date ? ` · ${p.whyNow.date}` : p.whyNow.freshness ? ` · ${p.whyNow.freshness}` : ""}</p>
          <p className="mt-0.5 break-words">{line(p.whyNow)}</p>
        </div>
      ) : (
        // A blog post, an older event or an undated statement: shown as background, never as a reason to write now.
        <div className="rounded-xl border px-3 py-2 text-sm" data-testid="prospect-context">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{p.timing === "undated" ? "Undated" : "Context, not urgency"} · {p.whyNow.label}{p.whyNow.date ? ` · ${p.whyNow.date}` : ""}</p>
          <p className="mt-0.5 break-words">{line(p.whyNow)}</p>
        </div>
      ))}
      {p.opportunity && (
        <div className="rounded-xl border border-dashed px-3 py-2 text-sm" data-testid="prospect-opportunity">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><Lightbulb className="h-3 w-3" />Possible opportunity · inference</p>
          <p className="mt-0.5 break-words">{line(p.opportunity)}</p>
        </div>
      )}
      {person && (
        <p className="flex items-center gap-1.5 text-sm" data-testid="prospect-person">
          <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate">{person.value}</span>
          {!p.decisionMaker && <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] text-muted-foreground" title="Named on their site, but not a senior decision-maker">employee</span>}
          {person.source === "provider" && <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] text-muted-foreground">{person.meta?.emailStatus === "verified" ? "email verified by provider" : "from data provider"}</span>}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-3">
        <motion.button type="button" {...press} onClick={onEvidence ?? onOpen} className="mr-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground underline-offset-2 hover:bg-muted hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60" aria-label={`Show the evidence for ${p.name} (${p.evidenceCount})`} data-testid="prospect-evidence">
          <Link2 className="h-3.5 w-3.5" aria-hidden />Evidence ({p.evidenceCount})
        </motion.button>
        <Button size="sm" variant="outline" onClick={onOpen} data-testid="prospect-brief">AI brief</Button>
        {p.leadId ? (
          <Button size="sm" variant="outline" asChild><Link href={`/leads/${p.leadId}`}>Open lead</Link></Button>
        ) : canEdit && !p.rejectReason ? (
          <Button size="sm" onClick={onAdd} disabled={adding} data-testid="prospect-add">Add to Leads</Button>
        ) : null}
      </div>
    </div>
  );
}

/** A loading placeholder with a prospect card's shape. */
export function ProspectCardSkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-background p-4" aria-hidden>
      <div className="flex items-start gap-3">
        <Skeleton className="h-12 w-12 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-1.5"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /><Skeleton className="h-3 w-1/2" /></div>
      </div>
      <Skeleton className="h-5 w-24 rounded-full" />
      <div className="space-y-1.5"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" /></div>
      <Skeleton className="h-14 w-full rounded-xl" />
      <div className="flex items-center gap-2 border-t pt-3"><Skeleton className="mr-auto h-4 w-20" /><Skeleton className="h-8 w-20" /><Skeleton className="h-8 w-24" /></div>
    </div>
  );
}
