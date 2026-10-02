/**
 * Where the money stands, and the follow-up draft. The draft is text for the
 * user to copy — the agent never sends anything to a client.
 */
import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Check, Copy, Receipt, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PAYMENT_STATE_LABEL, type PaymentState } from "@shared/paymentState";
import type { AgentCard } from "@shared/agent";
import { CardShell } from "./card-shell";

const STATE_CLS: Record<PaymentState, string> = {
  overdue: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  due_soon: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  pending: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
};

export const StateChip = ({ state }: { state: PaymentState }) => (
  <span className={cn("inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", STATE_CLS[state])}>{PAYMENT_STATE_LABEL[state]}</span>
);

interface InvoiceRow { id: number; number: string; client: string; amount: string; state: PaymentState; dueDate?: string | null; paidAt?: string | null; route: string }

function InvoiceList({ rows }: { rows: InvoiceRow[] }) {
  return (
    <ul className="divide-y divide-border/60">
      {rows.map((i) => (
        <li key={i.id}>
          <Link href={i.route} className="flex items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-muted/40">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{i.number} · {i.client}</p>
              <p className="text-xs text-muted-foreground">{i.paidAt ? `Paid ${i.paidAt}` : i.dueDate ? `Due ${i.dueDate}` : "No due date"}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-sm font-semibold tabular-nums">{i.amount}</span>
              <StateChip state={i.state} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function InvoiceCard({ card }: { card: AgentCard }) {
  const d = card.data as { invoices: InvoiceRow[] };
  return (
    <CardShell label={d.invoices.length === 1 ? "Invoice" : "Invoices"} icon={<Receipt className="h-3 w-3" />} testId="invoice-card">
      <InvoiceList rows={d.invoices} />
    </CardShell>
  );
}

export function PaymentCard({ card }: { card: AgentCard }) {
  const d = card.data as any;
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  if (d.followUp) {
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(d.draft);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } catch {
        toast({ title: "Couldn't copy. Select the text and copy it." });
      }
    };
    return (
      <CardShell label={`Follow-up draft · ${d.tone}`} icon={<Receipt className="h-3 w-3" />} tone="emerald" testId="followup-card">
        <div className="space-y-2.5 p-3.5">
          <p className="whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 text-sm leading-relaxed">{d.draft}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={copy} className="h-9 text-xs font-semibold" data-testid="followup-copy">
              {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
            </Button>
            <p className="text-[11px] text-muted-foreground">Drafted for {d.invoiceNumber}. Nothing has been sent.</p>
          </div>
        </div>
      </CardShell>
    );
  }

  return (
    <CardShell label="Payment status" icon={<Wallet className="h-3 w-3" />} testId="payment-card">
      {d.tally?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3.5 pt-3">
          {d.tally.map((t: any) => (
            <span key={t.state} className={cn("rounded-lg px-2.5 py-1.5 text-xs", STATE_CLS[t.state as PaymentState])}>
              <span className="font-bold">{t.label}</span> · {t.count} · <span className="tabular-nums">{t.amount}</span>
            </span>
          ))}
        </div>
      )}
      {d.unpaid?.length > 0 ? <div className="mt-2"><InvoiceList rows={d.unpaid} /></div> : <p className="px-3.5 py-3 text-sm text-muted-foreground">Nothing unpaid.</p>}
    </CardShell>
  );
}

export const OpenLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Link href={href} className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400">
    {children} <ArrowRight className="h-3 w-3" />
  </Link>
);
