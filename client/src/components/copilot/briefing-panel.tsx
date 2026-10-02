/**
 * The Copilot's daily briefing: deterministic intelligence (Money Radar, next
 * best actions) computed server-side from real rows — the model never invents
 * a number here. Shown in the drawer before a conversation starts.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Clock, Loader2, Receipt, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

/* ── types mirrored from server/copilot/insights.ts ── */
export interface Briefing {
  greetingName: string;
  attentionCount: number;
  radar: {
    overdue: { totalMinor: number; count: number; invoices: { id: number; brandName: string; amountMinor: number; daysOverdue: number; invoiceNumber: string }[] };
    dueThisWeek: { totalMinor: number; count: number; invoices: { id: number; brandName: string; amountMinor: number; dueDate: string; invoiceNumber: string }[] };
    readyToInvoice: { totalMinor: number; count: number; contracts: { id: number; dealId: number; brandName: string; remainingMinor: number; contractName: string }[] };
    collectibleMinor: number;
  };
  nextActions: { dealId: number; dealTitle: string; brandName: string; action: string; route: string; urgency: "red" | "yellow" | "green" }[];
}

const LOADING_STAGES = [
  "Reviewing your active deals…",
  "Checking payment status…",
  "Totalling what's collectible…",
];

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Rotating staged loading line while the briefing is computed. */
function StagedLoading() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % LOADING_STAGES.length), 900);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center">
      <Loader2 className="w-3.5 h-3.5 animate-spin" /> {LOADING_STAGES[i]}
    </div>
  );
}

export function BriefingPanel({
  briefing, loading, money, go, onFollowUp,
}: {
  briefing: Briefing | undefined;
  loading: boolean;
  money: (minor: number) => string;
  go: (to: string) => void;
  /** "Prepare Follow-up" on the worst overdue invoice. */
  onFollowUp: (invoiceNumber: string) => void;
}) {
  const radar = briefing?.radar;
  const allClear = briefing && briefing.attentionCount === 0;
  const worstOverdue = radar?.overdue.invoices[0];
  return (
    <>
    {/* ── Daily briefing (deterministic) ── */}
    {loading && <StagedLoading />}

    {briefing && (
      <div className="space-y-2.5" data-testid="copilot-briefing">
        <p className="text-sm font-semibold px-0.5">
          {greeting()}, {briefing.greetingName} 👋
        </p>
        <p className="text-xs text-muted-foreground px-0.5 -mt-1.5">
          {allClear
            ? "I've reviewed your deals — everything looks protected."
            : `I've reviewed your active deals. ${briefing.attentionCount} thing${briefing.attentionCount !== 1 ? "s" : ""} need${briefing.attentionCount === 1 ? "s" : ""} your attention.`}
        </p>

        {allClear && (
          <div className="rounded-xl border border-emerald-300/50 dark:border-emerald-800/50 bg-emerald-500/[0.05] p-3.5 flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-500 shrink-0" />
            <p className="text-xs text-muted-foreground">
              No overdue payments, nothing waiting to be invoiced. Create your next deal and I'll watch it end to end.
            </p>
          </div>
        )}

        {radar && radar.overdue.count > 0 && (
          <div className="rounded-xl border border-rose-300/50 dark:border-rose-900/50 bg-rose-500/[0.05] p-3.5" data-testid="briefing-overdue">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
              <p className="text-sm font-bold text-rose-600 dark:text-rose-400 tabular-nums">{money(radar.overdue.totalMinor)} overdue</p>
            </div>
            {worstOverdue && (
              <p className="text-xs text-muted-foreground mb-2.5">
                {worstOverdue.brandName} · {worstOverdue.invoiceNumber} · {worstOverdue.daysOverdue} day{worstOverdue.daysOverdue !== 1 ? "s" : ""} overdue
                {radar.overdue.count > 1 ? ` · +${radar.overdue.count - 1} more` : ""}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {worstOverdue && (
                <Button size="sm" className="h-7 text-xs font-bold gradient-btn text-white" onClick={() => onFollowUp(worstOverdue.invoiceNumber)} data-testid="briefing-chaser">
                  Prepare Follow-up
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-7 text-xs font-semibold" onClick={() => go("/invoices")}>
                View invoices
              </Button>
            </div>
          </div>
        )}

        {radar && radar.readyToInvoice.count > 0 && (
          <div className="rounded-xl border border-emerald-300/50 dark:border-emerald-800/50 bg-emerald-500/[0.05] p-3.5" data-testid="briefing-ready">
            <div className="flex items-center gap-2 mb-1">
              <Receipt className="w-4 h-4 text-emerald-500 shrink-0" />
              <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{money(radar.readyToInvoice.totalMinor)} ready to invoice</p>
            </div>
            <p className="text-xs text-muted-foreground mb-2.5">
              {radar.readyToInvoice.count} signed agreement{radar.readyToInvoice.count !== 1 ? "s" : ""} with uninvoiced value
            </p>
            <div className="flex flex-wrap gap-1.5">
              {radar.readyToInvoice.contracts.slice(0, 2).map((c) => (
                <Button key={c.id} size="sm" variant="outline" className="h-7 text-xs font-semibold border-emerald-300/60 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300" onClick={() => go(`/contracts/${c.id}`)}>
                  {c.brandName}: {money(c.remainingMinor)} <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              ))}
            </div>
          </div>
        )}

        {radar && radar.dueThisWeek.count > 0 && (
          <div className="rounded-xl border border-amber-300/50 dark:border-amber-900/50 bg-amber-500/[0.05] p-3.5" data-testid="briefing-due">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-amber-500 shrink-0" />
              <p className="text-sm font-bold text-amber-600 dark:text-amber-400 tabular-nums">{money(radar.dueThisWeek.totalMinor)} due this week</p>
            </div>
            <p className="text-xs text-muted-foreground">
              {radar.dueThisWeek.invoices.slice(0, 2).map((i) => i.brandName).join(", ")}
              {radar.dueThisWeek.count > 2 ? ` +${radar.dueThisWeek.count - 2} more` : ""} — watching these for you.
            </p>
          </div>
        )}

        {briefing.nextActions.length > 0 && (
          <div className="rounded-xl border border-border/60 p-3.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Next best actions</p>
            <ul className="space-y-1.5">
              {briefing.nextActions.slice(0, 3).map((a) => (
                <li key={a.dealId}>
                  <button type="button" onClick={() => go(a.route)} className="w-full text-left flex items-center gap-2 text-xs rounded-lg px-2 py-1.5 -mx-2 hover:bg-muted/60 transition-colors group">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.urgency === "red" ? "bg-rose-500" : a.urgency === "yellow" ? "bg-amber-500" : "bg-emerald-500"}`} />
                    <span className="flex-1 min-w-0 truncate"><b className="font-semibold">{a.brandName}:</b> {a.action}</span>
                    <ArrowRight className="w-3 h-3 text-muted-foreground/50 group-hover:text-foreground shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )}

    </>
  );
}
