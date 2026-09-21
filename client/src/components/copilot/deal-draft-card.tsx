/**
 * The draft deal the Copilot prepared, as a business object rather than prose.
 *
 * Everything shown comes from the server: the fields are the validated ones the
 * deal would be saved with, and the protection check is computed, not written
 * by the model. Nothing here creates anything until Create Deal is pressed.
 */
import { Button } from "@/components/ui/button";
import { AlertTriangle, Check, Loader2, Pencil, ShieldCheck, Plus } from "lucide-react";

export interface DealDraft {
  client: string;
  project: string;
  dealType: string;
  amount: string;
  timeline: string;
  deliverables: string[];
  terms: string[];
  advancePercent: number | null;
  revisions: number | null;
  protection: {
    flags: { id: string; priority: "high" | "attention"; title: string; detail: string; suggestedTerm?: string }[];
    passes: string[];
  };
  warnings: string[];
  prefill: Record<string, unknown>;
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="min-w-0">
    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className="text-sm font-semibold break-words">{children}</p>
  </div>
);

export function DealDraftCard({
  draft,
  done,
  busy,
  fixingId,
  onCreate,
  onEdit,
  onAddTerm,
}: {
  draft: DealDraft;
  done: boolean;
  busy: boolean;
  fixingId: string | null;
  onCreate: () => void;
  onEdit: () => void;
  onAddTerm: (flagId: string) => void;
}) {
  const high = draft.protection.flags.filter((f) => f.priority === "high");
  const attention = draft.protection.flags.filter((f) => f.priority === "attention");

  return (
    <div className="ml-9 mt-2 rounded-2xl border border-emerald-300/50 dark:border-emerald-800/50 overflow-hidden bg-background" data-testid="deal-draft-card">
      <div className="px-3.5 py-2 bg-emerald-500/[0.07] text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
        Draft deal
      </div>

      <div className="p-3.5 grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Field label="Client">{draft.client}</Field>
        <Field label="Project">{draft.project}</Field>
        <Field label="Amount"><span className="tabular-nums">{draft.amount}</span></Field>
        <Field label="Timeline">{draft.timeline}</Field>
        {draft.advancePercent != null && <Field label="Advance">{draft.advancePercent}%</Field>}
        {draft.revisions != null && <Field label="Revisions">{draft.revisions}</Field>}
        <div className="col-span-2">
          <Field label="Deliverables">{draft.deliverables.join(" · ")}</Field>
        </div>
        {draft.terms.length > 0 && (
          <div className="col-span-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Terms</p>
            <ul className="text-[13px] list-disc pl-4 space-y-0.5">
              {draft.terms.map((t) => <li key={t}>{t}</li>)}
            </ul>
          </div>
        )}
      </div>

      {draft.warnings.map((w) => (
        <p key={w} className="mx-3.5 mb-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {w}
        </p>
      ))}

      {/* Protection Check — computed from the terms above */}
      <div className="border-t border-border/70 px-3.5 py-3 space-y-2" data-testid="draft-protection">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <ShieldCheck className="w-3.5 h-3.5" /> Protection check
        </p>
        {[...high.map((f) => ({ f, tone: "high" as const })), ...attention.map((f) => ({ f, tone: "attention" as const }))].map(({ f, tone }) => (
          <div key={f.id} className="flex items-start gap-2">
            <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${tone === "high" ? "bg-rose-500" : "bg-amber-500"}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold">
                <span className={tone === "high" ? "text-rose-600 dark:text-rose-400" : "text-amber-700 dark:text-amber-400"}>
                  {tone === "high" ? "High priority" : "Needs attention"}
                </span>{" "}
                · {f.title}
              </p>
              <p className="text-[11px] text-muted-foreground leading-snug">{f.detail}</p>
              {f.suggestedTerm && !done && (
                <button
                  type="button"
                  disabled={busy || fixingId !== null}
                  onClick={() => onAddTerm(f.id)}
                  data-testid={`draft-fix-${f.id}`}
                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline disabled:opacity-50"
                >
                  {fixingId === f.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  Add: &ldquo;{f.suggestedTerm}&rdquo;
                </button>
              )}
            </div>
          </div>
        ))}
        {draft.protection.passes.map((p) => (
          <p key={p} className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" aria-hidden /> {p}
          </p>
        ))}
        <p className="text-[10px] text-muted-foreground">A check on the words in your terms, not legal advice.</p>
      </div>

      <div className="border-t border-border/70 px-3.5 py-2.5 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={done || busy} onClick={onCreate} className="h-8 text-xs font-bold gradient-btn text-white" data-testid="draft-create">
          {done ? <Check className="w-3.5 h-3.5 mr-1" /> : null}
          {done ? "Created" : "Create Deal"}
        </Button>
        {!done && (
          <Button size="sm" variant="outline" disabled={busy} onClick={onEdit} className="h-8 text-xs font-semibold" data-testid="draft-edit">
            <Pencil className="w-3 h-3 mr-1" /> Edit
          </Button>
        )}
        {!done && <span className="text-[11px] text-muted-foreground">Nothing is created until you confirm.</span>}
      </div>
    </div>
  );
}
