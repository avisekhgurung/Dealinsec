import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useUpgradeModal } from "@/components/upgrade-modal";
import { parseApiError, isUpgradeError } from "@/lib/api-error";
import { PlatformIcon } from "@/components/platform-icon";
import { TaxonomyCombobox } from "@/components/taxonomy-combobox";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Plus, Trash2, Loader2, FileText, ChevronRight, Pencil } from "lucide-react";
import {
  insertDealSchema,
  frequencyOptions,
  STANDARD_TERMS,
} from "@shared/schema";
import {
  dealTypeOptions,
  dealTypeMeta,
  TAXONOMY,
  getDeliverableLabels,
  type DealType,
} from "@shared/dealTypeTaxonomy";
import { trackEvent } from "@/lib/analytics";

const formSchema = insertDealSchema.omit({ userId: true }).extend({
  brandName: z.string().min(1, "Client / brand name is required"),
  dealTitle: z.string().min(1, "Deal title is required"),
  dealType: z.enum(dealTypeOptions).default("Real Estate"),
  dealAmount: z.coerce.number().min(1, "Deal amount must be positive"),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
  brandUserId: z.string().optional().nullable(),
  deliverableMode: z.enum(["all", "any_one"]).optional().default("all"),
  deliverables: z.array(z.object({
    id: z.string(),
    platform: z.string().min(1, "Category is required"),
    contentType: z.string().min(1, "Output type is required"),
    quantity: z.coerce.number().min(1, "Quantity must be at least 1"),
    frequency: z.string().min(1, "Frequency is required"),
    notes: z.string().optional(),
  })).min(1, "At least one deliverable is required"),
  standardTermIds: z.array(z.string()).optional().default([]),
  customTerms: z.string().optional().nullable(),
});

type BrandOption = { id: string; name: string };

type FormData = z.infer<typeof formSchema>;

// Static tint → class maps (Tailwind purges interpolated class names).
const TINT_CHIP: Record<string, string> = {
  emerald: "bg-emerald-500/10 border-emerald-500/20",
  teal: "bg-teal-500/10 border-teal-500/20",
  indigo: "bg-indigo-500/10 border-indigo-500/20",
  amber: "bg-amber-500/10 border-amber-500/20",
  slate: "bg-slate-500/10 border-slate-500/20",
};
const TINT_HOVER: Record<string, string> = {
  emerald: "hover:border-emerald-400/60",
  teal: "hover:border-teal-400/60",
  indigo: "hover:border-indigo-400/60",
  amber: "hover:border-amber-400/60",
  slate: "hover:border-slate-400/60",
};

// ?type=Freelance deep-links straight to the form with the type chosen —
// used by vertical landing pages and the Copilot.
function initialTypeFromUrl(): DealType | null {
  try {
    const t = new URLSearchParams(window.location.search).get("type");
    return t && (dealTypeOptions as readonly string[]).includes(t) ? (t as DealType) : null;
  } catch {
    return null;
  }
}

// "Remember and skip": an interiors studio shouldn't re-pick Interior Design
// on every deal. The last-used type is remembered per device and the picker
// is skipped on the next deal — the form banner's "Change" button is the
// always-one-tap-away escape, so this never locks anyone in.
const DEAL_TYPE_MEMORY_KEY = "dis_last_deal_type";

function rememberedDealType(): DealType | null {
  try {
    const t = localStorage.getItem(DEAL_TYPE_MEMORY_KEY);
    return t && (dealTypeOptions as readonly string[]).includes(t) ? (t as DealType) : null;
  } catch {
    return null;
  }
}

export default function CreateDealPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { openUpgradeModal } = useUpgradeModal();

  // Two-step wizard: an app-like full-screen type picker, then the form.
  // Skip the picker when the type is already known: ?type= param (deep links)
  // wins, else the remembered last-used type. First-ever deal sees the picker.
  const [urlType] = useState<DealType | null>(initialTypeFromUrl);
  const [memoryType] = useState<DealType | null>(() => (urlType ? null : rememberedDealType()));
  const initialType = urlType ?? memoryType;
  const [step, setStep] = useState<"type" | "form">(initialType ? "form" : "type");
  // True while the form shows a type the user didn't pick this visit.
  const [fromMemory, setFromMemory] = useState(!!memoryType);

  const { data: brands = [] } = useQuery<BrandOption[]>({
    queryKey: ["/api/brands"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      brandName: "",
      dealTitle: "",
      dealType: initialType ?? "Real Estate",
      dealAmount: 0,
      startDate: "",
      endDate: "",
      deliverableMode: "all" as const,
      deliverables: [
        {
          id: crypto.randomUUID(),
          platform: "",
          contentType: "",
          quantity: 1,
          frequency: "One-time",
          notes: "",
        },
      ],
      standardTermIds: STANDARD_TERMS.map((t) => t.id),
      customTerms: "",
    },
  });

  const dealType = (form.watch("dealType") as DealType) || "Real Estate";
  const taxonomy = TAXONOMY[dealType];

  // Itemizable custom terms — stored as newline-joined string in form for
  // backward compat with the existing customTerms text field.
  const [customTermsList, setCustomTermsList] = useState<string[]>([""]);
  const syncCustomTerms = (next: string[]) => {
    setCustomTermsList(next);
    form.setValue("customTerms", next.map(t => t.trim()).filter(Boolean).join("\n"));
  };

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "deliverables",
  });

  const createDeal = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await apiRequest("POST", "/api/deals", data);
      return res.json();
    },
    onSuccess: (deal) => {
      trackEvent("create_deal", { deal_type: deal?.dealType });
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      toast({
        title: "Deal created",
        description: "Your deal has been created successfully.",
      });
      // Journey continuation: when the user arrived from a "New quotation /
      // New agreement" picker, don't park them on deal details — carry them
      // into the step they actually set out to do.
      const next = new URLSearchParams(window.location.search).get("next");
      if (next === "agreement") setLocation(`/deals/${deal.id}/contract`);
      else if (next === "quotation" || next === "quote") setLocation(`/deals/${deal.id}?generate=quote`);
      else setLocation(`/deals/${deal.id}`);
    },
    onError: (err) => {
      const parsed = parseApiError(err);
      if (isUpgradeError(parsed)) {
        // Out of monthly Deal Credits — offer Pro or the ₹99 Deal Boost.
        openUpgradeModal({ feature: "deals" });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        return;
      }
      toast({
        title: "Error",
        description: "Failed to create deal. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FormData) => {
    createDeal.mutate(data);
  };

  const addDeliverable = () => {
    append({
      id: crypto.randomUUID(),
      platform: "",
      contentType: "",
      quantity: 1,
      frequency: "One-time",
      notes: "",
    });
  };

  // When dealType changes, reset all deliverable category/type fields so the
  // user picks from the new taxonomy (prevents stale Creator values lingering
  // on a Freelance deal, etc.)
  const handleDealTypeChange = (next: DealType) => {
    form.setValue("dealType", next);
    const current = form.getValues("deliverables");
    form.setValue(
      "deliverables",
      current.map((d) => ({ ...d, platform: "", contentType: "" })),
    );
  };

  // Picker → form. Only reset taxonomy fields when the type actually changed
  // (returning via "Change" and re-picking the same type keeps filled rows).
  // Every explicit pick is remembered so the NEXT deal skips the picker.
  const pickType = (next: DealType) => {
    if (next !== form.getValues("dealType")) handleDealTypeChange(next);
    try { localStorage.setItem(DEAL_TYPE_MEMORY_KEY, next); } catch {}
    setFromMemory(false);
    setStep("form");
    window.scrollTo({ top: 0 });
  };

  const L = getDeliverableLabels(dealType);

  return (
    <div className="min-h-screen bg-background pb-8">
      <header className="glass-header sticky top-0 z-40">
        <div className="flex items-center gap-3 px-4 py-4 lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-3.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => (step === "form" ? setStep("type") : setLocation("/deals"))}
            data-testid="button-back"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl lg:text-lg font-bold lg:font-semibold">
            {step === "type" ? "New Deal" : "Create Deal"}
          </h1>
        </div>
      </header>

      <AnimatePresence mode="wait">
      {step === "type" ? (
        /* ── Step 1: full-screen deal-type picker ─────────────────────── */
        <motion.div
          key="type"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.18 }}
          className="px-4 py-8 lg:max-w-5xl lg:mx-auto lg:px-8 lg:py-12"
        >
          <div className="text-center mb-8 lg:mb-10">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary mb-2"
            >
              Step 1 of 2
            </motion.div>
            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="text-2xl lg:text-3xl font-bold tracking-tight text-foreground"
            >
              What kind of deal is this?
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-sm lg:text-base text-muted-foreground mt-2 max-w-md mx-auto"
            >
              This tailors your deliverables, agreement wording and documents.
            </motion.p>
          </div>

          <motion.div
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.045 } } }}
            className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4"
          >
            {dealTypeOptions.map((dt) => {
              const meta = dealTypeMeta[dt];
              return (
                <motion.button
                  key={dt}
                  type="button"
                  variants={{ hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0 } }}
                  whileHover={{ y: -4 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => pickType(dt)}
                  className={`group relative rounded-2xl border border-input/60 bg-card/80 p-4 lg:p-5 text-left shadow-sm hover:shadow-lg transition-shadow ${TINT_HOVER[meta.tint] ?? "hover:border-primary/40"}`}
                  data-testid={`select-deal-type-${dt}`}
                >
                  <div
                    className={`w-12 h-12 lg:w-14 lg:h-14 rounded-2xl border flex items-center justify-center text-2xl lg:text-[28px] mb-3 transition-transform group-hover:scale-105 ${TINT_CHIP[meta.tint] ?? "bg-primary/10 border-primary/20"}`}
                  >
                    {meta.emoji}
                  </div>
                  <div className="text-sm lg:text-[15px] font-semibold leading-tight text-foreground flex items-center gap-1">
                    {meta.label}
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/0 group-hover:text-primary transition-colors" />
                  </div>
                  <div className="text-[11px] lg:text-xs text-muted-foreground/90 mt-1 leading-snug line-clamp-2">
                    {meta.description}
                  </div>
                </motion.button>
              );
            })}
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-center text-xs text-muted-foreground mt-8"
          >
            Not sure? Pick <button type="button" className="font-semibold text-primary hover:underline" onClick={() => pickType("Custom")}>Custom</button> — you can describe anything.
          </motion.p>
        </motion.div>
      ) : (
        /* ── Step 2: the deal form ────────────────────────────────────── */
        <motion.div
          key="form"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
      <form onSubmit={form.handleSubmit(onSubmit)} className="px-4 py-6 space-y-6 lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-7 lg:space-y-5">
        {/* Selected type — compact banner; "Change" returns to the picker */}
        <section className="glass-card rounded-xl p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-xl border flex items-center justify-center text-xl shrink-0 ${TINT_CHIP[dealTypeMeta[dealType].tint] ?? "bg-primary/10 border-primary/20"}`}>
              {dealTypeMeta[dealType].emoji}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-primary">Deal type</div>
              <div className="text-sm font-semibold text-foreground truncate">{dealTypeMeta[dealType].label}</div>
              {fromMemory && (
                <div className="text-[10px] text-muted-foreground mt-0.5">Remembered from your last deal</div>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs shrink-0"
              onClick={() => setStep("type")}
              data-testid="button-change-deal-type"
            >
              <Pencil className="w-3 h-3 mr-1.5" />
              Change
            </Button>
          </div>
        </section>

        <section className="glass-card rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Client Details
          </h2>

          <div className="space-y-4 lg:grid lg:grid-cols-2 lg:gap-x-5 lg:gap-y-4 lg:space-y-0">
            <div className="space-y-2">
              <Label htmlFor="brandName">{L.who}</Label>
              <Input
                id="brandName"
                placeholder="Client / company name"
                className="h-12"
                data-testid="input-brand-name"
                {...form.register("brandName")}
              />
              {form.formState.errors.brandName && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.brandName.message}
                </p>
              )}
            </div>

            {brands.length > 0 && (
              <div className="space-y-2">
                <Label>Assign to Brand Account (Optional)</Label>
                <Select
                  value={form.watch("brandUserId") || ""}
                  onValueChange={(value) => form.setValue("brandUserId", value === "none" ? undefined : value)}
                >
                  <SelectTrigger className="h-12" data-testid="select-brand-user">
                    <SelectValue placeholder="Select a brand account" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No brand account</SelectItem>
                    {brands.map((brand) => (
                      <SelectItem key={brand.id} value={brand.id}>
                        {brand.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Assigning a brand account lets them view this deal
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="dealTitle">Deal Title</Label>
              <Input
                id="dealTitle"
                placeholder="e.g., Summer Campaign 2024"
                className="h-12"
                data-testid="input-deal-title"
                {...form.register("dealTitle")}
              />
              {form.formState.errors.dealTitle && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.dealTitle.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="dealAmount">Deal Amount (₹)</Label>
              <Input
                id="dealAmount"
                type="number"
                placeholder="50000"
                className="h-12"
                data-testid="input-deal-amount"
                {...form.register("dealAmount")}
              />
              {form.formState.errors.dealAmount && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.dealAmount.message}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">Start Date</Label>
                <Input
                  id="startDate"
                  type="date"
                  className="h-12"
                  data-testid="input-start-date"
                  {...form.register("startDate")}
                />
                {form.formState.errors.startDate && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.startDate.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="endDate">End Date</Label>
                <Input
                  id="endDate"
                  type="date"
                  className="h-12"
                  data-testid="input-end-date"
                  {...form.register("endDate")}
                />
                {form.formState.errors.endDate && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.endDate.message}
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Deliverables
            </h2>
            <span className="text-xs text-muted-foreground">
              {fields.length} item{fields.length !== 1 ? "s" : ""}
            </span>
          </div>


          <div className="space-y-4">
            {fields.map((field, index) => (
              <Card key={field.id} className="glass-card border-0">
                <CardContent className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{dealTypeMeta[dealType].emoji}</span>
                      <span className="font-medium text-sm">Deliverable {index + 1}</span>
                    </div>
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => remove(index)}
                        data-testid={`button-remove-deliverable-${index}`}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label className="text-xs">{L.category}</Label>
                      <TaxonomyCombobox
                        groups={taxonomy.categories}
                        value={form.watch(`deliverables.${index}.platform`) || ""}
                        onChange={(v) => form.setValue(`deliverables.${index}.platform`, v, { shouldValidate: true })}
                        placeholder={`Choose ${L.category.toLowerCase()}`}
                        testId={`select-platform-${index}`}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs">{L.type}</Label>
                      <TaxonomyCombobox
                        groups={taxonomy.outputs}
                        value={form.watch(`deliverables.${index}.contentType`) || ""}
                        onChange={(v) => form.setValue(`deliverables.${index}.contentType`, v, { shouldValidate: true })}
                        placeholder={`Choose ${L.type.toLowerCase()}`}
                        testId={`select-content-type-${index}`}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label className="text-xs">Quantity</Label>
                      <Input
                        type="number"
                        min={1}
                        className="h-11"
                        data-testid={`input-quantity-${index}`}
                        {...form.register(`deliverables.${index}.quantity`)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs">Frequency</Label>
                      <Select
                        value={form.watch(`deliverables.${index}.frequency`)}
                        onValueChange={(value) =>
                          form.setValue(`deliverables.${index}.frequency`, value)
                        }
                      >
                        <SelectTrigger
                          className="h-11"
                          data-testid={`select-frequency-${index}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {frequencyOptions.map((freq) => (
                            <SelectItem key={freq} value={freq}>{freq}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">Notes (Optional)</Label>
                    <Textarea
                      placeholder="Any specific requirements..."
                      className="min-h-[80px] resize-none"
                      data-testid={`textarea-notes-${index}`}
                      {...form.register(`deliverables.${index}.notes`)}
                    />
                  </div>
                </CardContent>
              </Card>
            ))}

            <Button
              type="button"
              variant="outline"
              className="w-full h-12"
              onClick={addDeliverable}
              data-testid="button-add-deliverable"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Deliverable
            </Button>
          </div>

          {form.formState.errors.deliverables && (
            <p className="text-xs text-destructive">
              {form.formState.errors.deliverables.message}
            </p>
          )}
        </section>

        <section className="glass-card rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Terms &amp; Conditions
            </h2>
          </div>

          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Standard terms (uncheck any you don't want)
            </p>
            <div className="space-y-2.5">
              {STANDARD_TERMS.map((t) => {
                const selected = form.watch("standardTermIds") || [];
                const checked = selected.includes(t.id);
                return (
                  <label
                    key={t.id}
                    htmlFor={`term-${t.id}`}
                    className="flex items-start gap-3 p-3 rounded-lg border border-border/60 bg-background/60 hover:border-primary/40 transition-colors cursor-pointer"
                  >
                    <Checkbox
                      id={`term-${t.id}`}
                      checked={checked}
                      onCheckedChange={(next) => {
                        const current = form.getValues("standardTermIds") || [];
                        if (next) {
                          form.setValue("standardTermIds", Array.from(new Set([...current, t.id])));
                        } else {
                          form.setValue(
                            "standardTermIds",
                            current.filter((id) => id !== t.id),
                          );
                        }
                      }}
                      className="mt-0.5"
                      data-testid={`checkbox-term-${t.id}`}
                    />
                    <span className="text-sm leading-relaxed">{t.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="space-y-3 pt-2 border-t border-border/60">
            <div>
              <Label className="text-xs font-semibold">
                Your own terms (optional)
              </Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Add as many clauses as you need — exclusivity, usage rights, posting schedule, revisions, etc.
              </p>
            </div>

            <div className="space-y-2">
              {customTermsList.map((term, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <span className="flex-shrink-0 w-6 h-9 flex items-center justify-center text-xs font-semibold text-muted-foreground tabular-nums">
                    {i + 1}.
                  </span>
                  <div className="flex-1">
                    <Input
                      value={term}
                      onChange={(e) => syncCustomTerms(customTermsList.map((t, j) => j === i ? e.target.value : t))}
                      placeholder={i === 0 ? "e.g. Content must be posted by 5pm IST" : "Add another clause"}
                      className="h-9"
                      data-testid={`input-custom-term-${i}`}
                    />
                  </div>
                  {customTermsList.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 flex-shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => syncCustomTerms(customTermsList.filter((_, j) => j !== i))}
                      data-testid={`button-remove-custom-term-${i}`}
                      aria-label={`Remove term ${i + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full h-9 border-dashed"
              onClick={() => syncCustomTerms([...customTermsList, ""])}
              data-testid="button-add-custom-term"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add another term
            </Button>
          </div>
        </section>

        <div className="pt-4">
          <Button
            type="submit"
            className="w-full h-14 text-base font-semibold rounded-xl gradient-btn text-white"
            disabled={createDeal.isPending}
            data-testid="button-submit-deal"
          >
            {createDeal.isPending ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              "Create Deal"
            )}
          </Button>
        </div>
      </form>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}
