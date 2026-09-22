/**
 * Lightweight confirm cards for the agreement and invoice proposals — the same
 * server-issued, single-use pattern as DealDraftCard, without its Protection
 * Check block (that already ran when the deal itself was created).
 */
import { Button } from "@/components/ui/button";
import { Check, FileSignature, Receipt } from "lucide-react";

export interface AgreementDraft {
  client: string;
  project: string;
  amount: string;
  timeline: string;
}

export interface InvoiceDraft {
  client: string;
  invoiceType: "full" | "advance" | "final";
  amount: string;
  dueDate: string | null;
  linkedAgreement: boolean;
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="min-w-0">
    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className="text-sm font-semibold break-words">{children}</p>
  </div>
);

const Shell = ({
  icon: Icon, kicker, done, busy, onCreate, label, children, testId,
}: {
  icon: typeof FileSignature; kicker: string; done: boolean; busy: boolean; onCreate: () => void; label: string; children: React.ReactNode; testId: string;
}) => (
  <div className="ml-9 mt-2 rounded-2xl border border-emerald-300/50 dark:border-emerald-800/50 overflow-hidden bg-background" data-testid={testId}>
    <div className="px-3.5 py-2 bg-emerald-500/[0.07] flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
      <Icon className="w-3.5 h-3.5" /> {kicker}
    </div>
    <div className="p-3.5 grid grid-cols-2 gap-x-3 gap-y-2.5">{children}</div>
    <div className="border-t border-border/70 px-3.5 py-2.5 flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={done || busy} onClick={onCreate} className="h-8 text-xs font-bold gradient-btn text-white" data-testid={`${kicker.toLowerCase()}-create`}>
        {done ? <Check className="w-3.5 h-3.5 mr-1" /> : null}
        {done ? "Created" : label}
      </Button>
      {!done && <span className="text-[11px] text-muted-foreground">Nothing is created until you confirm.</span>}
    </div>
  </div>
);

export function AgreementDraftCard({ draft, done, busy, onCreate }: { draft: AgreementDraft; done: boolean; busy: boolean; onCreate: () => void }) {
  return (
    <Shell icon={FileSignature} kicker="Draft agreement" done={done} busy={busy} onCreate={onCreate} label="Create Agreement" testId="agreement-draft-card">
      <Field label="Client">{draft.client}</Field>
      <Field label="Project">{draft.project}</Field>
      <Field label="Value"><span className="tabular-nums">{draft.amount}</span></Field>
      <Field label="Timeline">{draft.timeline}</Field>
    </Shell>
  );
}

const TYPE_LABEL: Record<InvoiceDraft["invoiceType"], string> = { full: "Full", advance: "Advance", final: "Final" };

export function InvoiceDraftCard({ draft, done, busy, onCreate }: { draft: InvoiceDraft; done: boolean; busy: boolean; onCreate: () => void }) {
  return (
    <Shell icon={Receipt} kicker="Draft invoice" done={done} busy={busy} onCreate={onCreate} label="Create Invoice" testId="invoice-draft-card">
      <Field label="Client">{draft.client}</Field>
      <Field label="Type">{TYPE_LABEL[draft.invoiceType]}</Field>
      <Field label="Amount"><span className="tabular-nums">{draft.amount}</span></Field>
      <Field label="Due">{draft.dueDate ?? "Not set"}</Field>
      {!draft.linkedAgreement && (
        <p className="col-span-2 text-[11px] text-amber-700 dark:text-amber-400">No signed agreement yet — this invoices the deal directly.</p>
      )}
    </Shell>
  );
}
