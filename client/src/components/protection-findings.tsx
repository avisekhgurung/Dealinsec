/**
 * Protection Check findings — one presentation for every place they appear
 * (the deal page, the AI draft card), so a finding looks and reads the same
 * wherever it is seen.
 *
 * Copy rules, kept from the check itself: this is a check on the WORDS of the
 * terms, not legal advice; it says what is worth clarifying, never that a deal
 * is "protected", "compliant" or "safe"; and it never blocks — "Continue
 * anyway" is always there.
 */
import { AlertTriangle, ArrowRight, Check, Loader2, MessageCircleQuestion, Plus, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type FindingLevel = "important" | "attention" | "informational";

export interface Finding {
  id: string;
  level: FindingLevel;
  title: string;
  /** Why it matters. */
  why: string;
  /** The question to ask, or the fix to make. */
  ask: string;
  suggestedTerm?: string;
}

const RANK: Record<FindingLevel, number> = { important: 0, attention: 1, informational: 2 };

const BADGE: Record<FindingLevel | "good", { label: string; cls: string }> = {
  important: { label: "Important", cls: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300" },
  attention: { label: "Attention", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300" },
  informational: { label: "Good to know", cls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  good: { label: "Good", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" },
};

function LevelBadge({ level }: { level: FindingLevel | "good" }) {
  const { label, cls } = BADGE[level];
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", cls)}>
      {label}
    </span>
  );
}

/** "3 things" / "1 thing" — the count in the heading. */
const things = (n: number) => `${n} thing${n === 1 ? "" : "s"}`;

export function ProtectionFindings({
  findings,
  passes = [],
  onAddTerm,
  addingId = null,
  disableAdd,
  onFix,
  fixing,
  fixLabel = "Fix these in my deal",
  onContinue,
  continueLabel = "Continue anyway",
  disclaimer = true,
}: {
  findings: Finding[];
  passes?: string[];
  /** Adds one finding's suggested term. Omit to hide the per-finding button. */
  onAddTerm?: (finding: Finding) => void;
  addingId?: string | null;
  disableAdd?: boolean;
  /** The primary action. Omit for a surface that has its own (the draft card). */
  onFix?: () => void;
  fixing?: boolean;
  fixLabel?: string;
  /** The secondary action — never blocks anything. */
  onContinue?: () => void;
  continueLabel?: string;
  disclaimer?: boolean;
}) {
  const sorted = [...findings].sort((a, b) => RANK[a.level] - RANK[b.level]);
  const clarify = sorted.filter((f) => f.level !== "informational");
  const alsoKnow = sorted.filter((f) => f.level === "informational");
  const clean = sorted.length === 0;

  const row = (f: Finding) => (
    <li key={f.id} className="rounded-lg border border-border/70 bg-background/60 p-3" data-testid={`finding-${f.id}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <LevelBadge level={f.level} />
        <p className="text-sm font-semibold leading-snug">{f.title}</p>
      </div>
      <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{f.why}</p>
      <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-snug">
        <MessageCircleQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <span>{f.ask}</span>
      </p>
      {f.suggestedTerm && onAddTerm && (
        <button
          type="button"
          disabled={disableAdd || addingId !== null}
          onClick={() => onAddTerm(f)}
          data-testid={`finding-add-${f.id}`}
          className="mt-2 inline-flex items-start gap-1 text-left text-[11px] font-semibold text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400"
        >
          {addingId === f.id ? <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" /> : <Plus className="mt-0.5 h-3 w-3 shrink-0" />}
          <span>Add: &ldquo;{f.suggestedTerm}&rdquo;</span>
        </button>
      )}
    </li>
  );

  return (
    <div className="space-y-3" data-testid="protection-findings">
      <div className="flex items-center gap-2">
        {clean ? (
          <ShieldCheck className="h-4 w-4 text-emerald-500" aria-hidden />
        ) : (
          <ShieldAlert
            className={cn("h-4 w-4", clarify.some((f) => f.level === "important") ? "text-rose-500" : "text-amber-500")}
            aria-hidden
          />
        )}
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Protection Check</p>
      </div>

      <div>
        <h3 className="text-base font-semibold leading-snug">
          {clean
            ? "No missing or risky terms found."
            : clarify.length > 0
              ? `Before you say yes, clarify ${clarify.length === 1 ? "this" : "these"} ${things(clarify.length)}.`
              : "Nothing important is missing."}
        </h3>
        {!clean && clarify.length > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">DealInSec found some terms worth clarifying before you proceed.</p>
        )}
      </div>

      {clarify.length > 0 && <ul className="space-y-2">{clarify.map(row)}</ul>}

      {alsoKnow.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Also worth knowing</p>
          <ul className="space-y-2">{alsoKnow.map(row)}</ul>
        </div>
      )}

      {passes.length > 0 && (
        <details className="group rounded-lg border border-border/60 px-3 py-2" open={passes.length <= 3}>
          <summary className="cursor-pointer list-none text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
              {passes.length} {passes.length === 1 ? "check" : "checks"} in order
            </span>
          </summary>
          <ul className="mt-2 space-y-1.5">
            {passes.map((p) => (
              <li key={p} className="flex items-center gap-2 text-xs">
                <LevelBadge level="good" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {(onFix || onContinue) && !clean && (
        <div className="flex flex-col gap-2 pt-1 sm:flex-row">
          {onFix && (
            <Button
              size="sm"
              className="h-9 flex-1 text-xs font-bold gradient-btn text-white"
              disabled={fixing}
              onClick={onFix}
              data-testid="button-fix-findings"
            >
              {fixing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />}
              {fixLabel}
            </Button>
          )}
          {onContinue && (
            <Button
              size="sm"
              variant="outline"
              className="h-9 flex-1 text-xs font-semibold"
              onClick={onContinue}
              data-testid="button-continue-anyway"
            >
              {continueLabel} <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}

      {disclaimer && (
        <p className="text-[10px] leading-snug text-muted-foreground">
          A check on the words in your terms, not legal advice.
        </p>
      )}
    </div>
  );
}
