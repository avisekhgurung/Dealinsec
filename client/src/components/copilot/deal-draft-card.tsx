/**
 * The draft deal the Copilot prepared, as a business object rather than prose.
 *
 * Everything shown comes from the server: the fields are the validated ones the
 * deal would be saved with, and the protection check is computed, not written
 * by the model. Nothing here creates anything until Create Deal is pressed.
 */
import { Button } from "@/components/ui/button";
import { AlertTriangle, Check, Loader2, Pencil } from "lucide-react";
import { ProtectionFindings, type Finding } from "@/components/protection-findings";
import { BRAND_TERM_LABELS, NOT_SPECIFIED, type Audience, type BrandTerms } from "@shared/audience";

export interface DealDraft {
  client: string;
  project: string;
  dealType: string;
  audience: Audience;
  brandTerms: BrandTerms | null;
  amount: string;
  timeline: string;
  deliverables: string[];
  terms: string[];
  advancePercent: number | null;
  revisions: number | null;
  protection: {
    flags: { id: string; priority: "high" | "attention"; level: Finding["level"]; title: string; detail: string; why: string; ask: string; suggestedTerm?: string }[];
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
  const brand = draft.audience === "brand_collaboration";
  const findings: Finding[] = draft.protection.flags.map((f) => ({
    id: f.id, level: f.level, title: f.title, why: f.why, ask: f.ask, suggestedTerm: f.suggestedTerm,
  }));

  return (
    <div className="ml-9 mt-2 rounded-2xl border border-emerald-300/50 dark:border-emerald-800/50 overflow-hidden bg-background" data-testid="deal-draft-card">
      <div className="px-3.5 py-2 bg-emerald-500/[0.07] text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
        Draft deal
      </div>

      <div className="p-3.5 grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Field label={brand ? "Brand" : "Client"}>{draft.client}</Field>
        <Field label={brand ? "Campaign" : "Project"}>{draft.project}</Field>
        <Field label="Amount"><span className="tabular-nums">{draft.amount}</span></Field>
        <Field label="Timeline">{draft.timeline}</Field>
        {draft.advancePercent != null && <Field label="Advance">{draft.advancePercent}%</Field>}
        {draft.revisions != null && <Field label="Revisions">{draft.revisions}</Field>}
        <div className="col-span-2">
          <Field label="Deliverables">{draft.deliverables.join(" · ")}</Field>
        </div>
        {brand && (
          // Read from the brand's message: anything it did not say is shown as
          // "Not specified", never filled in.
          <div className="col-span-2 grid grid-cols-2 gap-x-3 gap-y-2.5" data-testid="draft-brand-terms">
            {(["usageRights", "usageDuration", "exclusivity", "approval"] as const).map((k) => {
              const value = draft.brandTerms?.[k];
              return (
                <Field key={k} label={BRAND_TERM_LABELS[k]}>
                  {value ? value : <span className="font-normal text-muted-foreground">{NOT_SPECIFIED}</span>}
                </Field>
              );
            })}
          </div>
        )}
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

      {/* Protection Check — computed from the terms above. The card keeps its
          own Create / Edit buttons below, so the findings show no action pair. */}
      <div className="border-t border-border/70 px-3.5 py-3" data-testid="draft-protection">
        <ProtectionFindings
          findings={findings}
          passes={draft.protection.passes}
          onAddTerm={done ? undefined : (f) => onAddTerm(f.id)}
          addingId={fixingId}
          disableAdd={busy}
        />
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
