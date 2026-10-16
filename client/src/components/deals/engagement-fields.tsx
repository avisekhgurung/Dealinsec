/**
 * The deal's engagement model and service (shared/engagement.ts), as the create and edit forms show them:
 *   EngagementModelPicker  step 1: the 11 models as cards, plus a search over all 55 named deal types
 *   ServiceSelect          the optional, searchable, grouped service picker
 *   EngagementFields       the details the chosen model asks for (amounts typed in major units)
 * Amounts are drafted as text in MAJOR units and become minor units only through draftToTerms (the form's one
 * conversion point, with the workspace currency). Nothing here converts between currencies.
 */
import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Plus, Search, Trash2, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  BILLING_FREQUENCIES, ENGAGEMENT_MODELS, SERVICE_GROUPS, engagementModelMeta, searchPresets, serviceMeta,
  type BillingFrequency, type DealPreset, type EngagementModel, type EngagementTerms,
} from "@shared/engagement";

/* ── Draft ⇄ stored terms ────────────────────────────────────────────────────────────── */

export interface EngagementDraft {
  billingFrequency?: BillingFrequency;
  recurringAmount?: string;
  renewalDate?: string;
  hourlyRate?: string;
  estimatedHours?: string;
  milestones?: { title: string; amount: string; dueDate?: string }[];
  paymentDueDate?: string;
  commissionKind?: "percent" | "fixed";
  commissionPercent?: string;
  commissionAmount?: string;
  calculationBasis?: string;
  paymentTrigger?: string;
  unitLabel?: string;
  unitPrice?: string;
  estimatedUsage?: string;
  consultingBilling?: "hourly" | "fixed";
  scope?: string;
  expectedCloseDate?: string;
}

const num = (s?: string) => { if (s === undefined || s.trim() === "") return undefined; const n = Number(s.replace(/,/g, "")); return Number.isFinite(n) ? n : NaN; };

/** The draft as stored terms. `toMinor` is the form's currency conversion (major → minor, same currency). */
export function draftToTerms(d: EngagementDraft, toMinor: (major: number) => number): EngagementTerms {
  const money = (s?: string) => { const n = num(s); return n === undefined ? undefined : Number.isNaN(n) ? -1 : toMinor(n); };
  const t: Record<string, unknown> = {
    billingFrequency: d.billingFrequency, recurringAmountMinor: money(d.recurringAmount), renewalDate: d.renewalDate || undefined,
    hourlyRateMinor: money(d.hourlyRate), estimatedHours: num(d.estimatedHours), paymentDueDate: d.paymentDueDate || undefined,
    commissionKind: d.commissionKind, commissionPercent: num(d.commissionPercent), commissionAmountMinor: money(d.commissionAmount),
    calculationBasis: d.calculationBasis?.trim() || undefined, paymentTrigger: d.paymentTrigger?.trim() || undefined,
    unitLabel: d.unitLabel?.trim() || undefined, unitPriceMinor: money(d.unitPrice), estimatedUsage: num(d.estimatedUsage),
    consultingBilling: d.consultingBilling, scope: d.scope?.trim() || undefined, expectedCloseDate: d.expectedCloseDate || undefined,
    milestones: d.milestones?.filter((m) => m.title.trim() || m.amount.trim()).map((m) => ({ title: m.title.trim(), amountMinor: money(m.amount) ?? 0, ...(m.dueDate ? { dueDate: m.dueDate } : {}) })),
  };
  for (const k of Object.keys(t)) if (t[k] === undefined) delete t[k];
  return t as EngagementTerms;
}

/** Stored terms as a draft, for editing. `toMajor` turns minor units back into the same currency's major units. */
export function termsToDraft(t: EngagementTerms | null | undefined, toMajor: (minor: number) => number): EngagementDraft {
  if (!t) return {};
  const s = (n?: number) => (n === undefined ? undefined : String(n));
  const m = (n?: number) => (n === undefined ? undefined : String(toMajor(n)));
  return {
    billingFrequency: t.billingFrequency, recurringAmount: m(t.recurringAmountMinor), renewalDate: t.renewalDate,
    hourlyRate: m(t.hourlyRateMinor), estimatedHours: s(t.estimatedHours), paymentDueDate: t.paymentDueDate,
    commissionKind: t.commissionKind, commissionPercent: s(t.commissionPercent), commissionAmount: m(t.commissionAmountMinor),
    calculationBasis: t.calculationBasis, paymentTrigger: t.paymentTrigger, unitLabel: t.unitLabel, unitPrice: m(t.unitPriceMinor),
    estimatedUsage: s(t.estimatedUsage), consultingBilling: t.consultingBilling, scope: t.scope, expectedCloseDate: t.expectedCloseDate,
    milestones: t.milestones?.map((x) => ({ title: x.title, amount: String(toMajor(x.amountMinor)), dueDate: x.dueDate })),
  };
}

/** A sensible starting draft when a model (or a named deal type) is picked. */
export function draftForPick(model: EngagementModel | null, preset?: DealPreset): EngagementDraft {
  const kind = engagementModelMeta(model)?.kind;
  if (kind === "recurring" || kind === "usage") return { billingFrequency: preset?.frequency ?? "monthly" };
  if (kind === "consulting") return { consultingBilling: preset?.consultingBilling ?? "fixed" };
  if (kind === "commission") return { commissionKind: "percent" };
  if (kind === "milestone") return { milestones: [{ title: "", amount: "" }, { title: "", amount: "" }] };
  return {};
}

/* ── Step 1: the engagement model ────────────────────────────────────────────────────── */

export function EngagementModelPicker({ onPick, onQuick, extra }: {
  onPick: (model: EngagementModel, preset?: DealPreset) => void;
  /** "Just the basics": no model, no details. */
  onQuick: () => void;
  /** An extra first card (the brand-collaboration path for creator accounts). */
  extra?: { label: string; description: string; onPick: () => void } | null;
}) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => searchPresets(q, 8), [q]);
  return (
    <div className="space-y-6">
      <div className="relative mx-auto max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) { e.preventDefault(); onPick(hits[0].model, hits[0]); } }} placeholder="Search deal types: SEO retainer, chatbot, hourly consulting…" className="h-11 pl-9" aria-label="Search deal types" data-testid="deal-type-search" />
        {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>}
      </div>
      {q ? (
        <ul className="mx-auto max-w-xl space-y-1.5" aria-label="Matching deal types" data-testid="deal-type-results">
          {hits.length === 0 && <li className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No match. Pick the closest model below, or Custom / Other.</li>}
          {hits.map((p) => {
            const svc = serviceMeta(p.service);
            return (
              <li key={p.label}>
                <button type="button" onClick={() => onPick(p.model, p)} className="flex w-full items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-left transition hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" data-testid="deal-type-result">
                  <span className="min-w-0"><span className="block text-sm font-semibold">{p.label}</span><span className="block truncate text-xs text-muted-foreground">{engagementModelMeta(p.model)!.label}{svc ? ` · ${svc.label}` : ""}</span></span>
                  <span className="shrink-0 text-xs font-medium text-primary">Choose</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3" role="list" aria-label="Engagement models">
          {extra && (
            <button type="button" role="listitem" onClick={extra.onPick} className="rounded-2xl border border-primary/40 bg-primary/5 p-4 text-left shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" data-testid="select-brand-collaboration">
              <span className="block text-sm font-semibold">{extra.label}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{extra.description}</span>
            </button>
          )}
          {ENGAGEMENT_MODELS.map((m) => (
            <button key={m.id} type="button" role="listitem" onClick={() => onPick(m.id)} data-testid={`select-engagement-${m.id}`}
              className="group rounded-2xl border border-input/60 bg-card/80 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
              <span className="block text-sm font-semibold text-foreground">{m.label}</span>
              <span className="mt-1 block text-xs leading-snug text-muted-foreground">{m.description}</span>
              <span className="mt-2 block truncate text-[11px] text-muted-foreground/80">e.g. {m.example}</span>
            </button>
          ))}
        </div>
      )}
      <p className="text-center text-sm text-muted-foreground">
        In a hurry? <button type="button" onClick={onQuick} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline" data-testid="quick-deal"><Zap className="h-3.5 w-3.5" />Create a quick deal</button> with just the basics.
      </p>
    </div>
  );
}

/* ── The service (optional) ──────────────────────────────────────────────────────────── */

export function ServiceSelect({ value, onChange, id }: { value: string | null; onChange: (v: string | null) => void; id?: string }) {
  const [open, setOpen] = useState(false);
  const current = serviceMeta(value);
  const unknown = !!value && !current;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} className="h-10 w-full justify-between font-normal" data-testid="service-select">
          <span className={cn("truncate", !value && "text-muted-foreground")}>{current ? current.label : unknown ? `Unrecognised (${value})` : "Choose a service (optional)"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[18rem] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search services…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No service matches. Choose "Other service", or leave it empty.</CommandEmpty>
            {value && (
              <CommandGroup>
                <CommandItem value="__none" onSelect={() => { onChange(null); setOpen(false); }}><X className="mr-2 h-4 w-4" />No service</CommandItem>
              </CommandGroup>
            )}
            {SERVICE_GROUPS.map((g) => (
              <CommandGroup key={g.id} heading={g.label}>
                {g.services.map((s) => (
                  <CommandItem key={s.id} value={`${s.label} ${g.label} ${s.keywords ?? ""}`} onSelect={() => { onChange(s.id); setOpen(false); }}>
                    <Check className={cn("mr-2 h-4 w-4", value === s.id ? "opacity-100" : "opacity-0")} aria-hidden />{s.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* ── The model's details ─────────────────────────────────────────────────────────────── */

function Field({ id, label, hint, error, children, className }: { id: string; label: string; hint?: string; error?: string | null; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="block text-xs font-medium">{label}</Label>
      {children}
      {error ? <p className="text-xs font-medium text-destructive" role="alert">{error}</p> : hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T | undefined; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1">
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}
          className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition", value === o.id ? "bg-background text-primary shadow-sm ring-1 ring-primary/50" : "text-muted-foreground hover:text-foreground")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EngagementFields({ model, draft, onChange, currency, error }: {
  model: EngagementModel;
  draft: EngagementDraft;
  onChange: (next: EngagementDraft) => void;
  /** The workspace currency code, shown beside amounts (never converted). */
  currency: string;
  /** The field the last validation refused, and why. */
  error?: { field: string; message: string } | null;
}) {
  const kind = engagementModelMeta(model)!.kind;
  const set = (patch: Partial<EngagementDraft>) => onChange({ ...draft, ...patch });
  const err = (f: string) => (error?.field === f ? error.message : null);
  const money = (id: string, key: keyof EngagementDraft, label: string, hint?: string, errKey = key as string) => (
    <Field id={id} label={`${label} (${currency})`} hint={hint} error={err(errKey)}>
      <Input id={id} inputMode="decimal" value={(draft[key] as string) ?? ""} onChange={(e) => set({ [key]: e.target.value.replace(/[^\d.,]/g, "") } as Partial<EngagementDraft>)} placeholder="0" />
    </Field>
  );
  const date = (id: string, key: keyof EngagementDraft, label: string, hint?: string) => (
    <Field id={id} label={label} hint={hint} error={err(key)}>
      <Input id={id} type="date" value={(draft[key] as string) ?? ""} onChange={(e) => set({ [key]: e.target.value } as Partial<EngagementDraft>)} />
    </Field>
  );
  const text = (id: string, key: keyof EngagementDraft, label: string, placeholder: string, hint?: string) => (
    <Field id={id} label={label} hint={hint} error={err(key)}>
      <Input id={id} value={(draft[key] as string) ?? ""} onChange={(e) => set({ [key]: e.target.value } as Partial<EngagementDraft>)} placeholder={placeholder} maxLength={200} />
    </Field>
  );
  const frequency = (
    <Field id="eng-frequency" label="Billing frequency" error={err("billingFrequency")}>
      <Segmented label="Billing frequency" value={draft.billingFrequency} options={BILLING_FREQUENCIES.map((f) => ({ id: f.id, label: f.label }))} onChange={(v) => set({ billingFrequency: v })} />
    </Field>
  );
  const milestones = (required: boolean) => {
    const rows = draft.milestones ?? [];
    const setRow = (i: number, patch: Partial<NonNullable<EngagementDraft["milestones"]>[number]>) => set({ milestones: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
    return (
      <div className="space-y-2 sm:col-span-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Milestones{required ? "" : " (optional)"}</span>
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => set({ milestones: [...rows, { title: "", amount: "" }] })} disabled={rows.length >= 20}><Plus className="mr-1 h-3.5 w-3.5" />Add milestone</Button>
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_7.5rem_auto] gap-2 sm:grid-cols-[1fr_8rem_9.5rem_auto]">
            <Input aria-label={`Milestone ${i + 1} name`} value={r.title} onChange={(e) => setRow(i, { title: e.target.value })} placeholder={`Milestone ${i + 1}`} maxLength={120} />
            <Input aria-label={`Milestone ${i + 1} amount (${currency})`} inputMode="decimal" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value.replace(/[^\d.,]/g, "") })} placeholder={currency} />
            <Input aria-label={`Milestone ${i + 1} due date`} type="date" className="hidden sm:block" value={r.dueDate ?? ""} onChange={(e) => setRow(i, { dueDate: e.target.value })} />
            <Button type="button" variant="ghost" size="icon" className="h-10 w-9" aria-label={`Remove milestone ${i + 1}`} onClick={() => set({ milestones: rows.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        {err("milestones") && <p className="text-xs font-medium text-destructive" role="alert">{err("milestones")}</p>}
        <p className="text-[11px] text-muted-foreground">Payment status per milestone isn't tracked yet: invoices record what's paid.</p>
      </div>
    );
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2" data-testid="engagement-fields" data-kind={kind}>
      {kind === "recurring" && (<>
        {money("eng-recurring", "recurringAmount", "Recurring amount", undefined, "recurringAmountMinor")}
        {frequency}
        {date("eng-renewal", "renewalDate", "Renewal date (optional)", "When the next term starts, if it renews.")}
      </>)}
      {kind === "fixed" && milestones(false)}
      {kind === "hourly" && (<>
        {money("eng-rate", "hourlyRate", "Hourly rate", undefined, "hourlyRateMinor")}
        <Field id="eng-hours" label="Estimated hours (optional)" error={err("estimatedHours")}><Input id="eng-hours" inputMode="decimal" value={draft.estimatedHours ?? ""} onChange={(e) => set({ estimatedHours: e.target.value.replace(/[^\d.]/g, "") })} placeholder="e.g. 20" /></Field>
      </>)}
      {kind === "milestone" && milestones(true)}
      {kind === "one_time" && date("eng-due", "paymentDueDate", "Payment due date (optional)", "Or set payment terms below.")}
      {kind === "commission" && (<>
        <Field id="eng-comm-kind" label="Commission" error={err("commissionKind")}>
          <Segmented label="Commission type" value={draft.commissionKind} options={[{ id: "percent", label: "Percentage" }, { id: "fixed", label: "Fixed amount" }]} onChange={(v) => set({ commissionKind: v })} />
        </Field>
        {draft.commissionKind === "fixed"
          ? money("eng-comm-amount", "commissionAmount", "Commission amount", undefined, "commissionAmountMinor")
          : <Field id="eng-comm-pct" label="Commission rate (%)" error={err("commissionPercent")}><Input id="eng-comm-pct" inputMode="decimal" value={draft.commissionPercent ?? ""} onChange={(e) => set({ commissionPercent: e.target.value.replace(/[^\d.]/g, "") })} placeholder="e.g. 10" /></Field>}
        {text("eng-basis", "calculationBasis", "Calculated on", "e.g. revenue from closed deals you sourced")}
        {text("eng-trigger", "paymentTrigger", "Paid when (optional)", "e.g. 30 days after the client is invoiced")}
      </>)}
      {kind === "usage" && (<>
        {text("eng-unit", "unitLabel", "Billed per", "e.g. qualified lead, call, seat")}
        {money("eng-unit-price", "unitPrice", "Price per unit", undefined, "unitPriceMinor")}
        {frequency}
        <Field id="eng-usage" label="Estimated usage per period (optional)" error={err("estimatedUsage")}><Input id="eng-usage" inputMode="decimal" value={draft.estimatedUsage ?? ""} onChange={(e) => set({ estimatedUsage: e.target.value.replace(/[^\d.]/g, "") })} placeholder="e.g. 40" /></Field>
      </>)}
      {kind === "consulting" && (<>
        <Field id="eng-consult" label="Billing method" error={err("consultingBilling")}>
          <Segmented label="Billing method" value={draft.consultingBilling} options={[{ id: "fixed", label: "Fixed price" }, { id: "hourly", label: "Hourly" }]} onChange={(v) => set({ consultingBilling: v })} />
        </Field>
        {draft.consultingBilling === "hourly" && (<>
          {money("eng-c-rate", "hourlyRate", "Hourly rate", undefined, "hourlyRateMinor")}
          <Field id="eng-c-hours" label="Estimated hours (optional)"><Input id="eng-c-hours" inputMode="decimal" value={draft.estimatedHours ?? ""} onChange={(e) => set({ estimatedHours: e.target.value.replace(/[^\d.]/g, "") })} placeholder="e.g. 10" /></Field>
        </>)}
        <Field id="eng-scope" label="Consulting scope (optional)" className="sm:col-span-2" error={err("scope")}>
          <textarea id="eng-scope" value={draft.scope ?? ""} onChange={(e) => set({ scope: e.target.value })} maxLength={1000} rows={2} placeholder="What you'll advise on, and what's out of scope" className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
        </Field>
      </>)}
      {kind === "custom" && (<>
        <Field id="eng-desc" label="Description (optional)" className="sm:col-span-2" error={err("scope")}>
          <textarea id="eng-desc" value={draft.scope ?? ""} onChange={(e) => set({ scope: e.target.value })} maxLength={1000} rows={2} placeholder="What this deal is" className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
        </Field>
        {date("eng-close", "expectedCloseDate", "Expected close date (optional)")}
      </>)}
    </div>
  );
}

/* ── Read-only summary (deal details) ────────────────────────────────────────────────── */

/** The deal's stored details as label/value rows, for display. `money` formats minor units in the deal's currency. */
export function engagementDetailRows(model: string | null | undefined, t: EngagementTerms | null | undefined, money: (minor: number) => string): { label: string; value: string }[] {
  const kind = engagementModelMeta(model)?.kind;
  if (!kind || !t) return [];
  const freq = (f?: BillingFrequency) => BILLING_FREQUENCIES.find((x) => x.id === f);
  const rows: { label: string; value: string }[] = [];
  const add = (label: string, value: string | undefined | false) => { if (value) rows.push({ label, value }); };
  if (t.recurringAmountMinor && t.billingFrequency) add("Recurring fee", `${money(t.recurringAmountMinor)} / ${freq(t.billingFrequency)?.per ?? t.billingFrequency}`);
  else if (kind === "usage") add("Billed", freq(t.billingFrequency)?.label);
  add("Renews", t.renewalDate);
  if (kind === "consulting") add("Billing", t.consultingBilling === "hourly" ? "Hourly" : t.consultingBilling === "fixed" ? "Fixed price" : undefined);
  if (t.hourlyRateMinor) add("Hourly rate", `${money(t.hourlyRateMinor)} / hour`);
  if (t.estimatedHours) add("Estimated hours", String(t.estimatedHours));
  t.milestones?.forEach((m, i) => add(m.title || `Milestone ${i + 1}`, `${money(m.amountMinor)}${m.dueDate ? ` · due ${m.dueDate}` : ""}`));
  add("Payment due", t.paymentDueDate);
  if (t.commissionKind === "percent" && t.commissionPercent) add("Commission", `${t.commissionPercent}%`);
  if (t.commissionKind === "fixed" && t.commissionAmountMinor) add("Commission", money(t.commissionAmountMinor));
  add("Calculated on", t.calculationBasis);
  add("Paid when", t.paymentTrigger);
  if (t.unitLabel && t.unitPriceMinor) add("Price", `${money(t.unitPriceMinor)} per ${t.unitLabel}`);
  if (t.estimatedUsage) add("Estimated usage", `${t.estimatedUsage}${t.unitLabel ? ` ${t.unitLabel}` : ""} per period`);
  add(kind === "custom" ? "Description" : "Scope", t.scope);
  add("Expected close", t.expectedCloseDate);
  return rows;
}
