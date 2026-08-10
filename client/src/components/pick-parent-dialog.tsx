/**
 * PickParentDialog — "create X" never dead-ends into a list.
 *
 * A quotation and an agreement belong to a DEAL; an invoice belongs to an
 * AGREEMENT. Rather than redirecting to a list and leaving the user to work
 * that out, every "New …" button opens this picker: eligible parents only,
 * grouped and explained, with an escape hatch that CREATES the parent and
 * continues the journey automatically (?next=…).
 *
 * Eligibility is computed from the same rows the pages already cache, so the
 * list can never disagree with what the API would accept.
 */
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search, Plus, ArrowRight, FileText, FileCheck, Receipt, Crown,
  AlertTriangle, Scissors, IndianRupee,
} from "lucide-react";
import { hasProAccess } from "@shared/schema";
import type { Deal, Contract, Quote, BrandInvoice } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";
import { useUpgradeModal } from "@/components/upgrade-modal";

export type PickKind = "quotation" | "agreement" | "invoice";

const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

const COPY: Record<PickKind, { title: string; description: string; icon: any; newParent: string }> = {
  quotation: {
    title: "Create a quotation for which deal?",
    description: "A quotation is generated from a deal — pick one, or start a new deal and we'll take you straight to the quote.",
    icon: FileText,
    newParent: "Start a new deal",
  },
  agreement: {
    title: "Create an agreement for which deal?",
    description: "One agreement per deal. Deals you've already quoted are listed first — that's the usual order.",
    icon: FileCheck,
    newParent: "Start a new deal",
  },
  invoice: {
    title: "Invoice which agreement?",
    description: "Invoices are raised from an agreement, so the amount and terms carry across automatically.",
    icon: Receipt,
    newParent: "Create an agreement",
  },
};

interface Row {
  id: number;
  route: string;
  title: string;
  subtitle: string;
  amountLabel?: string;
  group: "ready" | "second";
  warn?: string;
}

export function PickParentDialog({
  kind, open, onOpenChange,
}: { kind: PickKind; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { openUpgradeModal } = useUpgradeModal();
  const [search, setSearch] = useState("");
  /** invoice flow: agreement chosen, now pick how much */
  const [chosenContract, setChosenContract] = useState<{ id: number; dealId: number; remaining: number; name: string } | null>(null);

  const enabled = open;
  const { data: deals = [], isLoading: l1 } = useQuery<Deal[]>({ queryKey: ["/api/deals"], enabled });
  const { data: quotes = [], isLoading: l2 } = useQuery<(Quote & { deal: Deal | null })[]>({ queryKey: ["/api/quotes"], enabled });
  const { data: contracts = [], isLoading: l3 } = useQuery<Contract[]>({ queryKey: ["/api/contracts"], enabled });
  const { data: invoices = [], isLoading: l4 } = useQuery<BrandInvoice[]>({ queryKey: ["/api/brand-invoices"], enabled });
  const loading = l1 || l2 || l3 || l4;

  const proBlocked = (kind === "agreement" || kind === "invoice") && !hasProAccess(user);

  const { rows, excludedNote } = useMemo(() => {
    const quotedDealIds = new Set(quotes.map((q) => q.dealId));
    const contractByDeal = new Map(contracts.map((c) => [c.dealId, c]));
    const isSigned = (c: Contract) => c.status === "Signed" || !!c.signedByBrand;

    if (kind === "quotation") {
      const eligible = deals.filter((d) => !quotedDealIds.has(d.id));
      return {
        rows: eligible.map<Row>((d) => ({
          id: d.id,
          route: `/deals/${d.id}`,
          title: d.brandName,
          subtitle: d.dealTitle,
          amountLabel: inr(Number(d.dealAmount)),
          group: "ready",
        })),
        excludedNote: quotedDealIds.size
          ? `${quotedDealIds.size} deal${quotedDealIds.size !== 1 ? "s" : ""} already quoted`
          : "",
      };
    }

    if (kind === "agreement") {
      const eligible = deals.filter((d) => !contractByDeal.has(d.id));
      return {
        rows: eligible.map<Row>((d) => ({
          id: d.id,
          route: `/deals/${d.id}/contract`,
          title: d.brandName,
          subtitle: d.dealTitle,
          amountLabel: inr(Number(d.dealAmount)),
          group: quotedDealIds.has(d.id) ? "ready" : "second",
        })),
        excludedNote: contracts.length
          ? `${contracts.length} deal${contracts.length !== 1 ? "s" : ""} already have an agreement`
          : "",
      };
    }

    // invoice → parent is an AGREEMENT, with remaining uninvoiced value
    let fullyInvoiced = 0;
    const out: Row[] = [];
    for (const c of contracts) {
      const invoiced = invoices
        .filter((i) => i.contractId === c.id || i.dealId === c.dealId)
        .reduce((s, i) => s + Number(i.dealAmount || 0), 0);
      const remaining = Number(c.contractValue) - invoiced;
      if (remaining <= 0) { fullyInvoiced++; continue; }
      out.push({
        id: c.id,
        route: `/contracts/${c.id}`,
        title: c.brandName,
        subtitle: c.contractName,
        amountLabel: `${inr(remaining)} remaining`,
        group: isSigned(c) ? "ready" : "second",
        warn: isSigned(c) ? undefined : "Signed proof not uploaded yet",
      });
    }
    return {
      rows: out,
      excludedNote: fullyInvoiced ? `${fullyInvoiced} agreement${fullyInvoiced !== 1 ? "s" : ""} fully invoiced` : "",
    };
  }, [kind, deals, quotes, contracts, invoices]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.title.toLowerCase().includes(q) || r.subtitle.toLowerCase().includes(q));
  }, [rows, search]);

  const ready = filtered.filter((r) => r.group === "ready");
  const second = filtered.filter((r) => r.group === "second");
  const copy = COPY[kind];

  const close = () => {
    onOpenChange(false);
    setSearch("");
    setChosenContract(null);
  };

  const pick = (row: Row) => {
    if (kind === "invoice") {
      const c = contracts.find((x) => x.id === row.id)!;
      const invoiced = invoices
        .filter((i) => i.contractId === c.id || i.dealId === c.dealId)
        .reduce((s, i) => s + Number(i.dealAmount || 0), 0);
      setChosenContract({ id: c.id, dealId: c.dealId, remaining: Number(c.contractValue) - invoiced, name: c.brandName });
      return;
    }
    close();
    setLocation(row.route);
  };

  const startParent = () => {
    close();
    if (kind === "invoice") {
      // No agreement to bill → send them to pick a deal to agree first.
      setLocation("/deals?pick=agreement");
    } else {
      setLocation(`/deals/new?next=${kind}`);
    }
  };

  const secondLabel =
    kind === "agreement" ? "Not quoted yet — most people send the quotation first" : "Waiting for signed proof — safer to upload it first";

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid={`pick-${kind}-dialog`}>
        {chosenContract ? (
          <InvoiceAmountStep
            contract={chosenContract}
            onBack={() => setChosenContract(null)}
            onGo={(mode) => {
              close();
              // Land in the invoice composer, not on the agreement page —
              // creating an invoice belongs to the invoice module.
              setLocation(`/brand-invoices/new?contractId=${chosenContract.id}&mode=${mode}`);
            }}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <copy.icon className="w-4.5 h-4.5 w-[18px] h-[18px] text-primary" />
                {copy.title}
              </DialogTitle>
              <DialogDescription>{copy.description}</DialogDescription>
            </DialogHeader>

            {proBlocked ? (
              <div className="text-center py-6">
                <Crown className="w-8 h-8 mx-auto text-amber-500 mb-2" />
                <p className="font-semibold text-sm">
                  {kind === "agreement" ? "Agreements" : "Invoices"} are a Pro feature
                </p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                  Your 7-day trial unlocks the full workflow — agreements, GST-ready invoices and payment tracking.
                </p>
                <Button
                  className="mt-4 gradient-btn text-white font-semibold"
                  onClick={() => { close(); openUpgradeModal({ feature: kind === "agreement" ? "agreements" : "invoices" }); }}
                >
                  See plans
                </Button>
              </div>
            ) : loading ? (
              <div className="space-y-2 py-2">
                {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
              </div>
            ) : (
              <>
                {rows.length > 4 && (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <Input
                      autoFocus
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search by client or title…"
                      className="pl-9 h-9"
                      data-testid="pick-search"
                    />
                  </div>
                )}

                {filtered.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-sm font-semibold">
                      {search
                        ? "Nothing matches that search"
                        : kind === "quotation" ? "Every deal already has a quotation"
                        : kind === "agreement" ? "Every deal already has an agreement"
                        : "Nothing left to invoice"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                      {kind === "invoice"
                        ? "Invoices are raised from an agreement. Create one and its value becomes billable here."
                        : "Start a new deal and we'll take you straight into the next step."}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {ready.length > 0 && (
                      <PickGroup rows={ready} onPick={pick} label={second.length > 0 ? "Ready" : undefined} />
                    )}
                    {second.length > 0 && (
                      <PickGroup rows={second} onPick={pick} label={secondLabel} muted />
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/60 mt-1">
                  <span className="text-[11px] text-muted-foreground">{excludedNote}</span>
                  <Button variant="outline" size="sm" className="font-semibold shrink-0" onClick={startParent} data-testid="pick-new-parent">
                    <Plus className="w-3.5 h-3.5 mr-1.5" /> {copy.newParent}
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PickGroup({ rows, onPick, label, muted }: {
  rows: Row[];
  onPick: (r: Row) => void;
  label?: string;
  muted?: boolean;
}) {
  return (
    <div>
      {label && (
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{label}</p>
      )}
      <div className="space-y-1.5">
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onPick(r)}
            className={`w-full text-left flex items-center gap-3 rounded-xl border p-3 transition-all hover:border-primary/50 hover:shadow-sm group ${
              muted ? "border-border/60 bg-muted/20" : "border-border"
            }`}
            data-testid={`pick-row-${r.id}`}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{r.title}</p>
              <p className="text-xs text-muted-foreground truncate">{r.subtitle}</p>
              {r.warn && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5 inline-flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {r.warn}
                </p>
              )}
            </div>
            {r.amountLabel && (
              <span className="text-sm font-bold tabular-nums shrink-0">{r.amountLabel}</span>
            )}
            <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-foreground shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Step 2 of the invoice flow — amount mode, pre-filled from remaining value. */
function InvoiceAmountStep({ contract, onBack, onGo }: {
  contract: { id: number; remaining: number; name: string };
  onBack: () => void;
  onGo: (mode: "full" | "split" | "custom") => void;
}) {
  const options = [
    { mode: "full" as const, icon: IndianRupee, title: `Full — ${inr(contract.remaining)}`, sub: "One invoice for the remaining value" },
    { mode: "split" as const, icon: Scissors, title: "Split — advance + final", sub: "Two invoices, percentage you choose" },
    { mode: "custom" as const, icon: FileText, title: "Custom amount", sub: "Bill a milestone or part payment" },
  ];
  return (
    <>
      <DialogHeader>
        <DialogTitle>{inr(contract.remaining)} remaining</DialogTitle>
        <DialogDescription>{contract.name} — how do you want to bill it?</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        {options.map((o) => (
          <button
            key={o.mode}
            type="button"
            onClick={() => onGo(o.mode)}
            className="w-full text-left flex items-center gap-3 rounded-xl border border-border p-3 hover:border-primary/50 hover:shadow-sm transition-all group"
            data-testid={`invoice-mode-${o.mode}`}
          >
            <span className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <o.icon className="w-4 h-4" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold">{o.title}</span>
              <span className="block text-xs text-muted-foreground">{o.sub}</span>
            </span>
            <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-foreground shrink-0" />
          </button>
        ))}
      </div>
      <Button variant="ghost" size="sm" className="w-fit" onClick={onBack}>← Choose a different agreement</Button>
    </>
  );
}
