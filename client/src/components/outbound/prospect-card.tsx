/**
 * One prospect, readable in ten seconds: score, who they are, why they fit, why now, a possible opportunity (marked as
 * an inference), the person to reach, and the evidence count. Everything shown comes from stored, checked findings.
 */
import { Check, CircleHelp, ExternalLink, Flame, Lightbulb, Link2, UserRound, X } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { countryName, type Evidence, type ProspectCard as Card } from "@/lib/outbound";

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

export function ProspectCard({ p, onOpen, onAdd, adding, canEdit }: { p: Card; onOpen: () => void; onAdd: () => void; adding: boolean; canEdit: boolean }) {
  const where = [p.profile.location, countryName(p.profile.country)].filter(Boolean).join(", ");
  const meta = [where, p.profile.industry, p.profile.employees].filter(Boolean);
  const fits = (p.fit?.signals ?? []).filter((s) => s.status === "match").slice(0, 3);
  const misses = (p.fit?.signals ?? []).filter((s) => s.status === "mismatch").slice(0, 1);
  const person = p.decisionMaker;
  return (
    <div className={cn("flex min-w-0 flex-col gap-3 rounded-2xl border bg-background p-4 transition-shadow hover:shadow-sm", p.ready && "border-emerald-300 dark:border-emerald-800")} data-testid="prospect-card">
      <div className="flex items-start gap-3">
        <ScoreBadge score={p.score} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <button onClick={onOpen} className="truncate text-left text-base font-semibold hover:underline" data-testid="prospect-name">{p.name}</button>
            {p.ready && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Ready</span>}
          </div>
          <a href={p.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">{p.domain}<ExternalLink className="h-3 w-3" /></a>
          {meta.length > 0 && <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta.join(" · ")}</p>}
        </div>
      </div>

      {(fits.length > 0 || misses.length > 0) && (
        <ul className="space-y-0.5 text-sm" aria-label="Why they fit">
          {fits.map((s) => <li key={s.key} className="flex gap-1.5"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /><span className="min-w-0 break-words">{s.detail}</span></li>)}
          {misses.map((s) => <li key={s.key} className="flex gap-1.5 text-muted-foreground"><X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" /><span className="min-w-0 break-words">{s.detail}</span></li>)}
        </ul>
      )}

      {p.whyNow && (
        <div className="rounded-xl bg-orange-50 px-3 py-2 text-sm dark:bg-orange-950/30" data-testid="prospect-why-now">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-orange-700 dark:text-orange-400"><Flame className="h-3 w-3" />Why now · {p.whyNow.label}{p.whyNow.freshness ? ` · ${p.whyNow.freshness}` : ""}</p>
          <p className="mt-0.5 break-words">{line(p.whyNow)}</p>
        </div>
      )}
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
          {person.source === "provider" && <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] text-muted-foreground">{person.meta?.emailStatus === "verified" ? "email verified by provider" : "from data provider"}</span>}
        </p>
      )}
      {p.rejectLabel && <p className="text-sm text-muted-foreground">Set aside: {p.rejectLabel}</p>}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <span className="mr-auto flex items-center gap-1 text-xs text-muted-foreground"><Link2 className="h-3.5 w-3.5" />{p.evidenceCount} evidence</span>
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
