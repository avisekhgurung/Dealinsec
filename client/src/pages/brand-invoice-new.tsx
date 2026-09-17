/**
 * Invoice composer — the invoice module raises its own invoices.
 *
 * Creation used to live on the agreement page: the register's "New invoice"
 * button bounced you to /contracts/:id and the mutation ran there. That left
 * nowhere to type the things a real invoice needs — due date, billable lines,
 * per-invoice notes — and made "raise an invoice" a detour through Agreements.
 *
 * The agreement link stays mandatory (you cannot bill for something you never
 * agreed); only the workspace moved. Line items are itemised from day one, and
 * tax is a list of issuer-entered rates over the subtotal (shared/invoice-tax.ts)
 * — the same rows for a GST, VAT or sales-tax invoice, so no country's tax is a
 * rewrite of this screen. What prints under "From" and beneath the total follows
 * the organization's country; no rate is ever filled in for the user.
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
import { toMinor, type BrandInvoice, type Contract, type Deal, type InvoiceLineItem } from "@shared/schema";
import { splitMinor } from "@/lib/format";
import { MoneyCurrencyPendingError, useMoney, type MoneyFormat } from "@/hooks/use-locale";
import {
  INVOICE_TAX_LINES_ENABLED, MAX_TAX_LINES, cleanTaxRateInput, computeTaxLines, formatTaxRegistration,
  invoiceTaxLinesSchema, invoiceTaxProfile, invoiceTaxTotalMinor, parseTaxRatePercent, readInvoiceTaxLines,
  taxLineLabel, taxRegistrations, type TaxRate,
} from "@shared/invoice-tax";
import { addDaysToIsoDate, isoDateInZone } from "@shared/invoice-numbering";

/* ── helpers ─────────────────────────────────────────────────────────── */

function fmtDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

/** A row while it's being edited — strings so fields can be emptied mid-typing.
 *  `rate` holds MAJOR units, exactly as typed; nothing here is ever a minor
 *  value, so there is no half-converted state to get wrong. */
interface DraftLine {
  description: string;
  hsnSac: string;
  quantity: string;
  rate: string;
}

/** A typed rate → minor units in `currency`, for the live figures on screen.
 *
 *  Not `fmt.minor()`: that refuses until the org's currency has loaded, which
 *  is right for a save and wrong for a render — this runs on every keystroke,
 *  including the first render. The save path is gated on `fmt.ready` instead,
 *  and by then `fmt.currency` is the org's, so the figures shown and the
 *  figures sent are the same numbers. A runaway field that parses to Infinity
 *  counts as nothing rather than throwing mid-render. */
const typedRateMinor = (raw: string, currency: string): number => {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? toMinor(n, currency) : 0;
};

/** A draft row's line total, in MINOR units.
 *
 *  The rate crosses to minor BEFORE the multiplication: `qty × 1250.50` in
 *  major units is a float that then has to be rounded to a currency precision
 *  we would have to guess at, while `qty × 125050` is exact integer arithmetic.
 *  Minor units everywhere also means this total can be compared straight
 *  against the agreement's `contractValueMinor` with no unit bookkeeping. */
const lineAmountMinor = (l: DraftLine, currency: string) =>
  Math.max(0, Math.round((parseFloat(l.quantity) || 0) * typedRateMinor(l.rate, currency)));

/** A tax row while it's being edited. `rate` is the percentage as typed
 *  ("8.875"); it becomes thousandths of a percent only through
 *  parseTaxRatePercent, never through a float. */
interface DraftTax {
  label: string;
  rate: string;
}

const draftTaxRate = (t: DraftTax): TaxRate | null => {
  const rateMilliPercent = parseTaxRatePercent(t.rate);
  return t.label.trim() && rateMilliPercent !== null ? { label: t.label, rateMilliPercent } : null;
};

/** Stable identity, so the memoised tax lines are not rebuilt every render. */
const NO_TAXES: DraftTax[] = [];

/* ── page ────────────────────────────────────────────────────────────── */

export default function BrandInvoiceNewPage() {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const issuer = useIssuer();
  // The ORG's locale — the invoice is the org's document, not the composer's.
  const fmt = useMoney();
  const taxProfile = invoiceTaxProfile(fmt.settings.country);
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

  /** Already billed against THIS agreement — the ceiling for a new invoice.
   *  Net of tax: an invoice's amount includes any tax on it, and that tax is
   *  not a draw on the agreed fee. Invoices without tax lines count in full,
   *  exactly as before. */
  const alreadyInvoicedMinor = useMemo(
    () =>
      allInvoices
        .filter((i) => i.contractId === contractId)
        .reduce((sum, i) => sum + (i.dealAmountMinor || 0) - invoiceTaxTotalMinor(readInvoiceTaxLines(i)), 0),
    [allInvoices, contractId],
  );
  const agreementValueMinor = Number(contract?.contractValueMinor || 0);
  const remainingMinor = Math.max(0, agreementValueMinor - alreadyInvoicedMinor);

  /* ── form state ── */
  const [mode, setMode] = useState<"single" | "split">(initialMode === "split" ? "split" : "single");
  // Default dates are "today" in the ORG's zone — the clock the server reads
  // the invoice number's period on (isoDateInZone). On UTC, a new Indian
  // invoice at 00:30 IST on 1 April was dated 31 March but numbered in the new
  // financial year.
  const [invoiceDate, setInvoiceDate] = useState(() => isoDateInZone(fmt.settings.timezone));
  const [dueDate, setDueDate] = useState(() => addDaysToIsoDate(isoDateInZone(fmt.settings.timezone), 30));
  const [datesEdited, setDatesEdited] = useState(false);
  // The zone above is the member's own until the org loads; re-derive once it
  // has, unless the user has already picked a date — theirs is never replaced.
  useEffect(() => {
    if (!fmt.ready || datesEdited) return;
    const today = isoDateInZone(fmt.settings.timezone);
    setInvoiceDate(today);
    setDueDate(addDaysToIsoDate(today, 30));
  }, [fmt.ready, fmt.settings.timezone, datesEdited]);
  const [notes, setNotes] = useState("");
  const [splitPct, setSplitPct] = useState("50");
  const [lines, setLines] = useState<DraftLine[]>([
    { description: "", hsnSac: "", quantity: "1", rate: "" },
  ]);
  // Empty by default everywhere: the no-tax invoice is correct for most
  // freelancers in most countries, and only the issuer knows otherwise.
  const [taxes, setTaxes] = useState<DraftTax[]>([]);
  const [seeded, setSeeded] = useState(false);

  /* Seed the first line from the agreement once it loads: the common case is
     "bill what we agreed", so the user edits rather than types from scratch. */
  useEffect(() => {
    // Wait for the deal too, otherwise the first line seeds from the contract
    // name and locks before the (better) deal title arrives.
    if (seeded || !contract) return;
    if (contract.dealId && !dealFetched) return;
    // And for the org's currency: the seed is a MAJOR-unit string, so seeding
    // with a member's different exponent would type the wrong figure into the
    // field, and the save would then send it in the org's.
    if (!fmt.ready) return;
    // The field holds MAJOR units, so the stored minor value converts back on
    // the way in — ungrouped, or it round-trips through parseFloat as NaN.
    const seedRate = initialMode === "custom" ? "" : fmt.input(remainingMinor || agreementValueMinor);
    setLines([
      {
        description: deal?.dealTitle || contract.contractName || "Professional services",
        hsnSac: "",
        quantity: "1",
        rate: seedRate,
      },
    ]);
    setSeeded(true);
  }, [contract, deal, dealFetched, remainingMinor, agreementValueMinor, initialMode, seeded, fmt]);

  // `totalMinor` is the SUBTOTAL — the sum of the billable lines, before tax.
  // It is what counts against the agreement: an agreement's value is the fee,
  // and tax is owed onward, not billed against the fee.
  const totalMinor = useMemo(
    () => lines.reduce((s, l) => s + lineAmountMinor(l, fmt.currency), 0),
    [lines, fmt.currency],
  );

  // The split preview must be what POST /api/deals/:id/split-invoices will
  // create, to the minor unit — so it splits what the SERVER splits (the deal's
  // stored amount, not the line typed on this screen, which split mode hides)
  // with the server's own rule. splitMinor keeps a whole-rupee deal in whole
  // rupees: ₹65,001 at 50% previews ₹32,501 + ₹32,500, as it is issued.
  const splitAdvancePct = parseInt(splitPct) || 50;
  const splitBaseMinor = Number(deal?.dealAmountMinor);
  const split =
    deal && Number.isSafeInteger(splitBaseMinor) && splitBaseMinor >= 0
      ? splitMinor(splitBaseMinor, splitAdvancePct, fmt.currency)
      : null;

  // Tax applies to single invoices only: the split endpoint creates both
  // invoices server-side from the deal value and carries no lines to tax.
  const taxRows = INVOICE_TAX_LINES_ENABLED && mode === "single" ? taxes : NO_TAXES;
  // computeTaxLines refuses an unsafe base rather than round it, and a
  // runaway rate field can type one; tax that base as zero on screen instead
  // of throwing mid-render. Such a total can never be saved anyway.
  const taxBaseMinor = Number.isSafeInteger(totalMinor) ? totalMinor : 0;
  const taxLines = useMemo(
    () => computeTaxLines(taxBaseMinor, taxRows.flatMap((t) => draftTaxRate(t) ?? [])),
    [taxBaseMinor, taxRows],
  );
  const grossMinor = totalMinor + invoiceTaxTotalMinor(taxLines);
  // Every row with anything typed in it must be complete, and the set must
  // pass the same schema the server writes with — a half-typed rate must block
  // the save, not be silently left off the client's invoice. A row still
  // entirely blank is simply not a tax yet.
  const taxInvalid =
    taxRows.some((t) => (t.label.trim() || t.rate) && draftTaxRate(t) === null) ||
    !invoiceTaxLinesSchema.safeParse(taxLines).success;

  const overBudget = totalMinor > remainingMinor && remainingMinor > 0;
  const fullyInvoiced = remainingMinor <= 0 && agreementValueMinor > 0;
  const blankLine = lines.some((l) => !l.description.trim());
  // `fmt.ready`: never save an amount before the org's currency is known.
  // A split is only offered once its preview can show what it will create.
  const canSubmit =
    totalMinor > 0 && !overBudget && !fullyInvoiced && !blankLine && !taxInvalid && canCreate &&
    fmt.ready && (mode !== "split" || split !== null);

  const updateTax = (i: number, patch: Partial<DraftTax>) =>
    setTaxes((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  const addTax = () => setTaxes((prev) => (prev.length >= MAX_TAX_LINES ? prev : [...prev, { label: "", rate: "" }]));
  const removeTax = (i: number) => setTaxes((prev) => prev.filter((_, idx) => idx !== i));

  const updateLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () =>
    setLines((prev) => [...prev, { description: "", hsnSac: "", quantity: "1", rate: "" }]);
  const removeLine = (i: number) =>
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));

  /* ── save ── */
  const create = useMutation({
    mutationFn: async () => {
      // canSubmit already waits for this; checked again because the typed
      // figures below are converted with fmt.currency, which is only the
      // org's currency once it has loaded.
      if (!fmt.ready) throw new MoneyCurrencyPendingError();
      if (mode === "split") {
        const res = await apiRequest("POST", `/api/deals/${contract!.dealId}/split-invoices`, {
          advancePercentage: splitAdvancePct,
        });
        return { split: true, data: await res.json() };
      }
      const payload: InvoiceLineItem[] = lines.map((l) => ({
        description: l.description.trim(),
        ...(l.hsnSac.trim() ? { hsnSac: l.hsnSac.trim() } : {}),
        quantity: Math.max(1, Math.round(parseFloat(l.quantity) || 1)),
        rateMinor: typedRateMinor(l.rate, fmt.currency),
        amountMinor: lineAmountMinor(l, fmt.currency),
      }));
      const res = await apiRequest("POST", "/api/brand-invoices", {
        currency: fmt.currency,
        dealId: contract!.dealId,
        contractId: contract!.id,
        brandName: contract!.brandName,
        // What the client owes: subtotal plus tax. With no tax lines this is
        // exactly the sum of the lines, as it has always been.
        dealAmountMinor: grossMinor,
        invoiceDate,
        dueDate,
        notes: notes.trim() || undefined,
        lineItems: payload,
        // The key is absent, not an empty array, on an untaxed invoice — the
        // request body stays byte-for-byte what the server already accepts.
        ...(taxLines.length > 0 ? { taxLines } : {}),
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
                <Stat label="Agreement value" value={fmt.money(agreementValueMinor)} />
                <Stat label="Already invoiced" value={fmt.money(alreadyInvoicedMinor)} />
                <Stat
                  label="Left to invoice"
                  value={fmt.money(remainingMinor)}
                  tone={remainingMinor <= 0 ? "danger" : "good"}
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
                    onChange={(e) => { setDatesEdited(true); setInvoiceDate(e.target.value); }}
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
                    onChange={(e) => { setDatesEdited(true); setDueDate(e.target.value); }}
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
                  aside={taxProfile.hsnSac ? "HSN/SAC optional" : undefined}
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
                            placeholder="Website design — milestone 1"
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

                      <div className={`grid grid-cols-2 ${taxProfile.hsnSac ? "sm:grid-cols-4" : "sm:grid-cols-3"} gap-2 pl-8`}>
                        {/* HSN/SAC is India's classification code; elsewhere
                            the field would only invite a number nobody asked for. */}
                        {taxProfile.hsnSac && (
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
                        )}
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
                          <Label htmlFor={`rate-${i}`} className="text-xs">Rate ({fmt.symbol})</Label>
                          <Input
                            id={`rate-${i}`}
                            value={line.rate}
                            // "decimal", not "numeric": a phone's numeric pad
                            // has no "." key, so ₹1,250.50 could not be typed.
                            inputMode="decimal"
                            placeholder="0"
                            onChange={(e) => updateLine(i, { rate: fmt.cleanInput(e.target.value) })}
                            data-testid={`input-line-rate-${i}`}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Amount</Label>
                          <div className="h-10 flex items-center px-3 rounded-md border border-border bg-muted/40 text-sm font-semibold tabular-nums">
                            {fmt.money(lineAmountMinor(line, fmt.currency))}
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

                {/* Until tax lines can be stored, say so where a VAT-registered
                    freelancer would look for them, rather than leave them
                    hunting. Not shown in India, whose composer is unchanged and
                    whose disclaimer below already states there is no GST. */}
                {!INVOICE_TAX_LINES_ENABLED && fmt.settings.country !== "IN" && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed pt-2 border-t border-border" data-testid="tax-lines-unsupported">
                    Tax lines (such as VAT or sales tax) can't be added to an invoice yet. This invoice is issued for the
                    agreed value with no tax added.
                  </p>
                )}
                {INVOICE_TAX_LINES_ENABLED && (
                  <div className="space-y-2 pt-2 border-t border-border" data-testid="tax-lines">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-semibold">Tax</span>
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Optional</span>
                    </div>
                    {/* No rate is suggested, looked up or pre-filled. Whether a
                        tax applies, and at what rate, is the issuer's call. */}
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Only add a tax you are registered to charge, at the rate that applies to you.
                      DealInSec calculates the amount but does not decide the rate.
                    </p>
                    {taxes.map((t, i) => {
                      const rate = draftTaxRate(t);
                      return (
                        <div key={i} className="flex items-end gap-2" data-testid={`tax-line-${i}`}>
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <Label htmlFor={`tax-label-${i}`} className="text-xs">Name</Label>
                            <Input
                              id={`tax-label-${i}`}
                              value={t.label}
                              placeholder={taxProfile.taxLabelHint}
                              maxLength={40}
                              onChange={(e) => updateTax(i, { label: e.target.value })}
                              data-testid={`input-tax-label-${i}`}
                            />
                          </div>
                          <div className="w-24 space-y-1.5">
                            <Label htmlFor={`tax-rate-${i}`} className="text-xs">Rate (%)</Label>
                            <Input
                              id={`tax-rate-${i}`}
                              value={t.rate}
                              inputMode="decimal"
                              placeholder="0"
                              onChange={(e) => updateTax(i, { rate: cleanTaxRateInput(e.target.value) })}
                              data-testid={`input-tax-rate-${i}`}
                            />
                          </div>
                          <div className="w-28 h-10 flex items-center justify-end px-3 rounded-md border border-border bg-muted/40 text-sm font-semibold tabular-nums">
                            {rate ? fmt.money(computeTaxLines(taxBaseMinor, [rate])[0].amountMinor) : "—"}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => removeTax(i)}
                            aria-label="Remove tax"
                            data-testid={`button-remove-tax-${i}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      );
                    })}
                    {taxes.length < MAX_TAX_LINES && (
                      <Button type="button" variant="ghost" size="sm" onClick={addTax} data-testid="button-add-tax">
                        <Plus className="w-4 h-4 mr-2" />
                        Add tax
                      </Button>
                    )}
                    {taxInvalid && (
                      <Notice tone="danger">
                        Give every tax a name and a rate between 0 and 100%, and list each one once.
                      </Notice>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <span className="text-sm font-semibold">Invoice total</span>
                  <span
                    className={`text-xl font-extrabold tabular-nums ${overBudget ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}
                    data-testid="text-invoice-total"
                  >
                    {fmt.money(grossMinor)}
                  </span>
                </div>

                {overBudget && (
                  <Notice tone="danger">
                    That's {fmt.money(totalMinor - remainingMinor)} more than this agreement has left. Lower the amount, or raise a
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
                    <p className="text-lg font-bold tabular-nums">{split ? fmt.money(split.advanceMinor) : "—"}</p>
                  </div>
                  <div className="rounded-xl border border-border p-3">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Final</p>
                    <p className="text-lg font-bold tabular-nums">{split ? fmt.money(split.finalMinor) : "—"}</p>
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
          <aside className="lg:sticky lg:top-[calc(var(--dis-topnav-h)+6rem)] space-y-3">
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
                  {/* The preview has always led with the indirect-tax number
                      (GSTIN, VAT number) — the one a client's accounts team
                      looks for first — so it sorts ahead of PAN here. */}
                  {taxRegistrations(taxProfile, issuer)
                    .sort((a, b) => Number(b.field === "gstNumber") - Number(a.field === "gstNumber"))
                    .map((r) => (
                      <p key={r.field} className={`text-muted-foreground${r.field === "gstNumber" ? " mt-0.5" : ""}`}>
                        {formatTaxRegistration(r)}
                      </p>
                    ))}
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
                  <p className="font-semibold">{fmtDate(invoiceDate, fmt.locale)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Due</p>
                  <p className="font-semibold">{mode === "split" ? "30 days" : fmtDate(dueDate, fmt.locale)}</p>
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
                              {parseFloat(l.quantity) || 0} × {fmt.money(typedRateMinor(l.rate, fmt.currency))}
                            </p>
                          </td>
                          <td className="py-2 text-right font-semibold tabular-nums whitespace-nowrap">
                            {fmt.money(lineAmountMinor(l, fmt.currency))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      {taxLines.length > 0 && (
                        <>
                          <tr>
                            <td className="pt-3 text-right text-muted-foreground pr-3">Subtotal</td>
                            <td className="pt-3 text-right font-semibold tabular-nums whitespace-nowrap">{fmt.money(totalMinor)}</td>
                          </tr>
                          {taxLines.map((t, i) => (
                            <tr key={i}>
                              <td className="pt-1 text-right text-muted-foreground pr-3">{taxLineLabel(t, fmt.locale)}</td>
                              <td className="pt-1 text-right font-semibold tabular-nums whitespace-nowrap">{fmt.money(t.amountMinor)}</td>
                            </tr>
                          ))}
                        </>
                      )}
                      <tr>
                        <td className="pt-3 text-right font-bold pr-3">Total</td>
                        <td className="pt-3 text-right">
                          <span className="text-base font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">
                            {fmt.money(grossMinor)}
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                ) : (
                  <div className="space-y-2 text-xs">
                    <PreviewRow label={`Advance invoice (${splitAdvancePct}%)`} value={split ? fmt.money(split.advanceMinor) : "—"} />
                    <PreviewRow label="Final invoice" value={split ? fmt.money(split.finalMinor) : "—"} />
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
                  {taxLines.length > 0 ? taxProfile.taxNote : taxProfile.noTaxExplainer}
                </p>
              </div>
            </div>

            {/* Desktop action */}
            <div className="hidden lg:block">
              <SaveButton
                pending={create.isPending}
                disabled={!canSubmit || create.isPending}
                mode={mode}
                totalMinor={grossMinor}
                fmt={fmt}
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
          totalMinor={grossMinor}
          fmt={fmt}
          onClick={() => create.mutate()}
        />
      </div>

      <BottomNav />
    </div>
  );
}

/* ── small pieces ────────────────────────────────────────────────────── */

function SaveButton({ pending, disabled, mode, totalMinor, fmt, onClick }: {
  pending: boolean; disabled: boolean; mode: "single" | "split";
  totalMinor: number; fmt: MoneyFormat; onClick: () => void;
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
      ) : !fmt.ready ? (
        // Saving waits for the org's currency (see useMoney().ready). Said on
        // the button itself, so a disabled button is never a silent mystery.
        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading currency…</>
      ) : mode === "split" ? (
        <>Create advance + final invoices</>
      ) : (
        <>Create invoice · {fmt.money(totalMinor)}</>
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
