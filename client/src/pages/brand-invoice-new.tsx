/**
 * Invoice composer — the invoice module raises its own invoices.
 *
 * Creation used to live on the agreement page: the register's "New invoice"
 * button bounced you to /contracts/:id and the mutation ran there. That left
 * nowhere to type the things a real invoice needs — due date, billable lines,
 * per-invoice notes — and made "raise an invoice" a detour through Agreements.
 *
 * The agreement link stays mandatory (you cannot bill for something you never
 * agreed); only the workspace moved. Line items are itemised from day one, each
 * carrying an optional HSN/SAC, so Rule 46 GST columns are an extension of this
 * screen rather than a rewrite of it.
 *
 * Entry: /brand-invoices/new?contractId=<id>&mode=full|custom|split
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { BottomNav } from "@/components/bottom-nav";
import { useAuth } from "@/hooks/useAuth";
import { useIssuer } from "@/hooks/useIssuer";
import { memberCan } from "@shared/permissions";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useUpgradeModal } from "@/components/upgrade-modal";
import { parseApiError, isUpgradeError } from "@/lib/api-error";
import {
  ArrowLeft, Plus, Trash2, Loader2, Receipt, Scissors, AlertTriangle, Lock,
} from "lucide-react";
import type { BrandInvoice, Contract, Deal, InvoiceLineItem } from "@shared/schema";

/* ── helpers ─────────────────────────────────────────────────────────── */

const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function addDaysISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** A row while it's being edited — strings so fields can be emptied mid-typing. */
interface DraftLine {
  description: string;
  hsnSac: string;
  quantity: string;
  rate: string;
}

const lineAmount = (l: DraftLine) =>
  Math.max(0, Math.round((parseFloat(l.quantity) || 0) * (parseFloat(l.rate) || 0)));

/* ── page ────────────────────────────────────────────────────────────── */

export default function BrandInvoiceNewPage() {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const issuer = useIssuer();
  const { toast } = useToast();
  const { openUpgradeModal } = useUpgradeModal();

  const params = new URLSearchParams(location.split("?")[1] || window.location.search);
  const contractId = parseInt(params.get("contractId") || "", 10);
  const initialMode = (params.get("mode") || "full") as "full" | "custom" | "split";

  const canCreate = memberCan(user as any, "invoices.create");

  const { data: contract, isLoading: loadingContract } = useQuery<Contract>({
    queryKey: ["/api/contracts", contractId],
    enabled: Number.isFinite(contractId),
  });
  const { data: deal, isFetched: dealFetched } = useQuery<Deal>({
    queryKey: ["/api/deals", contract?.dealId],
    enabled: !!contract?.dealId,
  });
  const { data: allInvoices = [] } = useQuery<BrandInvoice[]>({
    queryKey: ["/api/brand-invoices"],
  });

  /** Already billed against THIS agreement — the ceiling for a new invoice. */
  const alreadyInvoiced = useMemo(
    () =>
      allInvoices
        .filter((i) => i.contractId === contractId)
        .reduce((sum, i) => sum + (i.dealAmount || 0), 0),
    [allInvoices, contractId],
  );
  const agreementValue = Number(contract?.contractValue || 0);
  const remaining = Math.max(0, agreementValue - alreadyInvoiced);

  /* ── form state ── */
  const [mode, setMode] = useState<"single" | "split">(initialMode === "split" ? "split" : "single");
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState(addDaysISO(30));
  const [notes, setNotes] = useState("");
  const [splitPct, setSplitPct] = useState("50");
  const [lines, setLines] = useState<DraftLine[]>([
    { description: "", hsnSac: "", quantity: "1", rate: "" },
  ]);
  const [seeded, setSeeded] = useState(false);

  /* Seed the first line from the agreement once it loads: the common case is
     "bill what we agreed", so the user edits rather than types from scratch. */
  useEffect(() => {
    // Wait for the deal too, otherwise the first line seeds from the contract
    // name and locks before the (better) deal title arrives.
    if (seeded || !contract) return;
    if (contract.dealId && !dealFetched) return;
    const seedRate = initialMode === "custom" ? "" : String(remaining || agreementValue);
    setLines([
      {
        description: deal?.dealTitle || contract.contractName || "Professional services",
        hsnSac: "",
        quantity: "1",
        rate: seedRate,
      },
    ]);
    setSeeded(true);
  }, [contract, deal, dealFetched, remaining, agreementValue, initialMode, seeded]);

  const total = useMemo(() => lines.reduce((s, l) => s + lineAmount(l), 0), [lines]);
  const advanceAmount = Math.round((total * (parseInt(splitPct) || 50)) / 100);
  const finalAmount = total - advanceAmount;

  const overBudget = total > remaining && remaining > 0;
  const fullyInvoiced = remaining <= 0 && agreementValue > 0;
  const blankLine = lines.some((l) => !l.description.trim());
  const canSubmit = total > 0 && !overBudget && !fullyInvoiced && !blankLine && canCreate;

  const updateLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () =>
    setLines((prev) => [...prev, { description: "", hsnSac: "", quantity: "1", rate: "" }]);
  const removeLine = (i: number) =>
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));

  /* ── save ── */
  const create = useMutation({
    mutationFn: async () => {
      if (mode === "split") {
        const res = await apiRequest("POST", `/api/deals/${contract!.dealId}/split-invoices`, {
          advancePercentage: parseInt(splitPct) || 50,
        });
        return { split: true, data: await res.json() };
      }
      const payload: InvoiceLineItem[] = lines.map((l) => ({
        description: l.description.trim(),
        ...(l.hsnSac.trim() ? { hsnSac: l.hsnSac.trim() } : {}),
        quantity: Math.max(1, Math.round(parseFloat(l.quantity) || 1)),
        rate: Math.round(parseFloat(l.rate) || 0),
        amount: lineAmount(l),
      }));
      const res = await apiRequest("POST", "/api/brand-invoices", {
        dealId: contract!.dealId,
        contractId: contract!.id,
        brandName: contract!.brandName,
        dealAmount: total,
        invoiceDate,
        dueDate,
        notes: notes.trim() || undefined,
        lineItems: payload,
      });
      return { split: false, data: await res.json() };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/brand-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals", contract?.dealId, "brand-invoices"] });
      if (result.split) {
        toast({ title: "Invoices created", description: "Advance and final invoices generated." });
        setLocation("/invoices");
        return;
      }
      toast({ title: "Invoice created", description: `${result.data.invoiceNumber} is ready to send.` });
      setLocation(`/brand-invoices/${result.data.id}`);
    },
    onError: (err) => {
      const parsed = parseApiError(err);
      if (isUpgradeError(parsed)) {
        openUpgradeModal({ feature: "invoices" });
        return;
      }
      toast({
        title: "Could not create invoice",
        description: parsed.error || "Please try again.",
        variant: "destructive",
      });
    },
  });

  /* ── guards ── */
  if (!Number.isFinite(contractId)) {
    return (
      <EmptyShell
        title="Pick an agreement first"
        body="Invoices are raised from a signed agreement, so the client, amount and terms carry across."
        actionLabel="Go to invoices"
        onAction={() => setLocation("/invoices")}
      />
    );
  }
  if (loadingContract) {
    return (
      <div className="min-h-screen bg-background">
        <div className="px-4 py-6 lg:max-w-[1600px] lg:mx-auto lg:px-8 space-y-4">
          <Skeleton className="h-10 w-56" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      </div>
    );
  }
  if (!contract) {
    return (
      <EmptyShell
        title="Agreement not found"
        body="It may have been deleted, or it belongs to another organisation."
        actionLabel="Back to invoices"
        onAction={() => setLocation("/invoices")}
      />
    );
  }
  if (!canCreate) {
    return (
      <EmptyShell
        icon={<Lock className="w-7 h-7 text-muted-foreground" />}
        title="Your role can't raise invoices"
        body="Ask your organisation owner for the invoice permission."
        actionLabel="Back to invoices"
        onAction={() => setLocation("/invoices")}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background pb-28 lg:pb-10">
      <header className="glass-header sticky top-0 z-40">
        <div className="flex items-center gap-3 px-4 py-4 lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-3.5">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/invoices")} data-testid="button-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-xl lg:text-lg font-bold lg:font-semibold leading-tight">New Invoice</h1>
            <p className="text-xs text-muted-foreground truncate">
              {contract.brandName} · {contract.contractName}
            </p>
          </div>
        </div>
      </header>

      <div className="px-4 py-6 lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-7">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_460px] items-start">

          {/* ══ Form column ══ */}
          <div className="space-y-5">

            {/* Billable ceiling */}
            <section className="glass-card rounded-xl p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <Stat label="Agreement value" value={inr(agreementValue)} />
                <Stat label="Already invoiced" value={inr(alreadyInvoiced)} />
                <Stat
                  label="Left to invoice"
                  value={inr(remaining)}
                  tone={remaining <= 0 ? "danger" : "good"}
                />
              </div>
              {!issuer.accountNumber && !issuer.bankName && (
                <Notice tone="muted">
                  No bank details on the account yet, so this invoice will print without payment
                  instructions. Add them in Profile — clients pay faster when they don't have to ask.
                </Notice>
              )}
              {fullyInvoiced && (
                <Notice tone="danger">
                  This agreement is fully invoiced. Raise a new agreement, or edit an existing invoice instead.
                </Notice>
              )}
            </section>

            {/* Mode */}
            <section className="glass-card rounded-xl p-4 sm:p-5 space-y-3">
              <SectionHead step="Step 1" title="How are you billing?" />
              <div className="grid gap-2 sm:grid-cols-2">
                <ModeCard
                  active={mode === "single"}
                  icon={<Receipt className="w-4 h-4" />}
                  title="One invoice"
                  sub="Bill the full value or a milestone"
                  onClick={() => setMode("single")}
                  testId="mode-single"
                />
                <ModeCard
                  active={mode === "split"}
                  icon={<Scissors className="w-4 h-4" />}
                  title="Advance + final"
                  sub="Two invoices, percentage you choose"
                  onClick={() => setMode("split")}
                  testId="mode-split"
                />
              </div>
            </section>

            {/* Dates */}
            <section className="glass-card rounded-xl p-4 sm:p-5 space-y-4">
              <SectionHead step="Step 2" title="Dates" />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="invoiceDate">Invoice date</Label>
                  <Input
                    id="invoiceDate"
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    data-testid="input-invoice-date"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dueDate">Payment due</Label>
                  <Input
                    id="dueDate"
                    type="date"
                    value={dueDate}
                    min={invoiceDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    data-testid="input-due-date"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Payment Chaser counts overdue days from here.
                  </p>
                </div>
              </div>
            </section>

            {/* Lines */}
            {mode === "single" ? (
              <section className="glass-card rounded-xl p-4 sm:p-5 space-y-4">
                <SectionHead
                  step="Step 3"
                  title="What are you billing for?"
                  aside="HSN/SAC optional"
                />

                <div className="space-y-3">
                  {lines.map((line, i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-border p-3 space-y-3 bg-background/40"
                      data-testid={`line-item-${i}`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="mt-2.5 w-6 h-6 rounded-md bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <Label htmlFor={`desc-${i}`} className="text-xs">Description</Label>
                          <Input
                            id={`desc-${i}`}
                            value={line.description}
                            placeholder="Interior design — phase 1"
                            onChange={(e) => updateLine(i, { description: e.target.value })}
                            data-testid={`input-line-desc-${i}`}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="mt-6 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeLine(i)}
                          disabled={lines.length === 1}
                          aria-label="Remove line"
                          data-testid={`button-remove-line-${i}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pl-8">
                        <div className="space-y-1.5">
                          <Label htmlFor={`hsn-${i}`} className="text-xs">HSN/SAC</Label>
                          <Input
                            id={`hsn-${i}`}
                            value={line.hsnSac}
                            placeholder="9954"
                            inputMode="numeric"
                            onChange={(e) => updateLine(i, { hsnSac: e.target.value })}
                            data-testid={`input-line-hsn-${i}`}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`qty-${i}`} className="text-xs">Qty</Label>
                          <Input
                            id={`qty-${i}`}
                            value={line.quantity}
                            inputMode="numeric"
                            onChange={(e) => updateLine(i, { quantity: e.target.value.replace(/[^\d]/g, "") })}
                            data-testid={`input-line-qty-${i}`}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`rate-${i}`} className="text-xs">Rate (₹)</Label>
                          <Input
                            id={`rate-${i}`}
                            value={line.rate}
                            inputMode="numeric"
                            placeholder="0"
                            onChange={(e) => updateLine(i, { rate: e.target.value.replace(/[^\d]/g, "") })}
                            data-testid={`input-line-rate-${i}`}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Amount</Label>
                          <div className="h-10 flex items-center px-3 rounded-md border border-border bg-muted/40 text-sm font-semibold tabular-nums">
                            {inr(lineAmount(line))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addLine}
                  className="w-full"
                  data-testid="button-add-line"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add another line
                </Button>

                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <span className="text-sm font-semibold">Invoice total</span>
                  <span
                    className={`text-xl font-extrabold tabular-nums ${overBudget ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}
                    data-testid="text-invoice-total"
                  >
                    {inr(total)}
                  </span>
                </div>

                {overBudget && (
                  <Notice tone="danger">
                    That's {inr(total - remaining)} more than this agreement has left. Lower the amount, or raise a
                    fresh agreement for the extra scope.
                  </Notice>
                )}
              </section>
            ) : (
              <section className="glass-card rounded-xl p-4 sm:p-5 space-y-4">
                <SectionHead step="Step 3" title="Split the agreement value" />
                <div className="space-y-1.5">
                  <Label htmlFor="splitPct">Advance percentage</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="splitPct"
                      value={splitPct}
                      inputMode="numeric"
                      className="w-24"
                      onChange={(e) => setSplitPct(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
                      data-testid="input-split-pct"
                    />
                    <span className="text-sm text-muted-foreground">% up front</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-border p-3">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Advance</p>
                    <p className="text-lg font-bold tabular-nums">{inr(advanceAmount)}</p>
                  </div>
                  <div className="rounded-xl border border-border p-3">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Final</p>
                    <p className="text-lg font-bold tabular-nums">{inr(finalAmount)}</p>
                  </div>
                </div>
                <Notice tone="muted">
                  Both invoices are created now, numbered in sequence, and split the deal value. Itemised lines and a
                  due date apply to single invoices — use those for milestone billing.
                </Notice>
              </section>
            )}

            {/* Notes */}
            <section className="glass-card rounded-xl p-4 sm:p-5 space-y-3">
              <SectionHead step="Step 4" title="Notes for the client" aside="Optional" />
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Payment reference, milestone context, anything the client should read."
                rows={3}
                maxLength={2000}
                data-testid="input-notes"
              />
            </section>
          </div>

          {/* ══ Live preview ══ */}
          <aside className="lg:sticky lg:top-24 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground px-1">
              Live preview
            </p>
            <div className="rounded-2xl border border-border overflow-hidden bg-white dark:bg-zinc-900 shadow-sm">
              <div className="px-5 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
                <p className="text-lg font-extrabold tracking-wide">INVOICE</p>
                <p className="text-xs text-white/80">Number assigned on save</p>
              </div>

              <div className="px-5 py-4 grid grid-cols-2 gap-4 border-b border-border text-xs">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-1">From</p>
                  <p className="font-bold">{issuer.name || "—"}</p>
                  {issuer.gstNumber && <p className="text-muted-foreground mt-0.5">GSTIN: {issuer.gstNumber}</p>}
                  {issuer.panNumber && <p className="text-muted-foreground">PAN: {issuer.panNumber}</p>}
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-teal-600 mb-1">Bill To</p>
                  <p className="font-bold">{contract.brandName}</p>
                  {deal?.dealTitle && <p className="text-muted-foreground mt-0.5">Re: {deal.dealTitle}</p>}
                </div>
              </div>

              <div className="px-5 py-3 grid grid-cols-2 gap-4 border-b border-border text-xs">
                <div>
                  <p className="text-muted-foreground">Invoice date</p>
                  <p className="font-semibold">{fmtDate(invoiceDate)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Due</p>
                  <p className="font-semibold">{mode === "split" ? "30 days" : fmtDate(dueDate)}</p>
                </div>
              </div>

              <div className="px-5 py-4">
                {mode === "single" ? (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="text-left pb-1.5 font-semibold">Description</th>
                        <th className="text-right pb-1.5 font-semibold">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => (
                        <tr key={i} className="border-b border-border/60">
                          <td className="py-2 pr-3">
                            <p className="font-medium">{l.description || <span className="text-muted-foreground italic">Untitled line</span>}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {l.hsnSac ? `HSN/SAC ${l.hsnSac} · ` : ""}
                              {parseFloat(l.quantity) || 0} × {inr(parseFloat(l.rate) || 0)}
                            </p>
                          </td>
                          <td className="py-2 text-right font-semibold tabular-nums whitespace-nowrap">
                            {inr(lineAmount(l))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="pt-3 text-right font-bold pr-3">Total</td>
                        <td className="pt-3 text-right">
                          <span className="text-base font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">
                            {inr(total)}
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                ) : (
                  <div className="space-y-2 text-xs">
                    <PreviewRow label={`Advance invoice (${parseInt(splitPct) || 50}%)`} value={inr(advanceAmount)} />
                    <PreviewRow label="Final invoice" value={inr(finalAmount)} />
                  </div>
                )}
              </div>

              {notes.trim() && mode === "single" && (
                <div className="px-5 py-3 border-t border-border">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Notes</p>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">{notes}</p>
                </div>
              )}

              <div className="px-5 py-3 bg-muted/40 border-t border-border">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Amounts are the agreed contract value and carry no GST computation — this is not a tax invoice
                  under Rule 46 of the CGST Rules, 2017.
                </p>
              </div>
            </div>

            {/* Desktop action */}
            <div className="hidden lg:block">
              <SaveButton
                pending={create.isPending}
                disabled={!canSubmit || create.isPending}
                mode={mode}
                total={total}
                onClick={() => create.mutate()}
              />
            </div>
          </aside>
        </div>
      </div>

      {/* Mobile sticky action */}
      <div className="lg:hidden fixed bottom-16 left-0 right-0 px-4 pb-3 pt-3 bg-background/95 backdrop-blur border-t border-border z-30">
        <SaveButton
          pending={create.isPending}
          disabled={!canSubmit || create.isPending}
          mode={mode}
          total={total}
          onClick={() => create.mutate()}
        />
      </div>

      <BottomNav />
    </div>
  );
}

/* ── small pieces ────────────────────────────────────────────────────── */

function SaveButton({ pending, disabled, mode, total, onClick }: {
  pending: boolean; disabled: boolean; mode: "single" | "split"; total: number; onClick: () => void;
}) {
  return (
    <Button
      className="w-full h-12 rounded-xl gradient-btn text-white font-semibold"
      disabled={disabled}
      onClick={onClick}
      data-testid="button-create-invoice"
    >
      {pending ? (
        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating…</>
      ) : mode === "split" ? (
        <>Create advance + final invoices</>
      ) : (
        <>Create invoice · {inr(total)}</>
      )}
    </Button>
  );
}

function SectionHead({ step, title, aside }: { step: string; title: string; aside?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-primary mb-1">{step}</div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
      </div>
      {aside && (
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{aside}</span>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "danger" }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p
        className={`font-bold tabular-nums ${
          tone === "danger" ? "text-destructive" : tone === "good" ? "text-emerald-600 dark:text-emerald-400" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Notice({ tone, children }: { tone: "danger" | "muted"; children: React.ReactNode }) {
  const styles =
    tone === "danger"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : "border-border bg-muted/40 text-muted-foreground";
  return (
    <div className={`mt-3 flex gap-2 rounded-lg border p-3 text-xs leading-relaxed ${styles}`}>
      {tone === "danger" && <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
      <span>{children}</span>
    </div>
  );
}

function ModeCard({ active, icon, title, sub, onClick, testId }: {
  active: boolean; icon: React.ReactNode; title: string; sub: string; onClick: () => void; testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`text-left flex items-center gap-3 rounded-xl border p-3 transition-all ${
        active ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/40"
      }`}
    >
      <span
        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
          active ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">{sub}</span>
      </span>
    </button>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 pb-2">
      <span>{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function EmptyShell({ icon, title, body, actionLabel, onAction }: {
  icon?: React.ReactNode; title: string; body: string; actionLabel: string; onAction: () => void;
}) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
          {icon ?? <Receipt className="w-7 h-7 text-muted-foreground" />}
        </div>
        <h2 className="font-semibold mb-1">{title}</h2>
        <p className="text-sm text-muted-foreground mb-5">{body}</p>
        <Button onClick={onAction} className="rounded-xl">{actionLabel}</Button>
      </div>
    </div>
  );
}
