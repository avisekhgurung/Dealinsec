import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useState, useEffect } from "react";
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
import { ArrowLeft, Plus, Trash2, Loader2, FileText, Pencil } from "lucide-react";
import {
  insertDealSchema,
  frequencyOptions,
  STANDARD_TERMS,
} from "@shared/schema";
import {
  dealTypeOptions,
  brandDealTypeOptions,
  dealTypeMeta,
  TAXONOMY,
  getDeliverableLabels,
  type DealType,
  type BrandDealType,
} from "@shared/dealTypeTaxonomy";
import { audienceForDealType, dealAudienceLabels, normalizeBrandTerms, type BrandTerms } from "@shared/audience";
import { useAudience } from "@/hooks/use-audience";
import { BrandTermsFields, emptyBrandTermsDraft, type BrandTermsDraft } from "@/components/brand-terms-fields";
import { trackEvent } from "@/lib/analytics";
import { DEAL_PREFILL_KEY } from "@/lib/deal-prefill";
import { MoneyCurrencyPendingError, useMoney } from "@/hooks/use-locale";
import { EngagementFields, EngagementModelPicker, ServiceSelect, draftForPick, draftToTerms, type EngagementDraft } from "@/components/deals/engagement-fields";
import {
  dealTypeForService, engagementModelMeta, isEngagementModel, isServiceCategory, suggestDealTitle, suggestedValueMinor, validateEngagement,
  type DealPreset, type EngagementModel,
} from "@shared/engagement";

// Every type the form can hold. The client-work list is the picker's default;
// Brand Collaboration is offered first to brand accounts (the picker's extra card).
type PickerType = DealType | BrandDealType;
const PICKABLE = [...brandDealTypeOptions, ...dealTypeOptions] as const;
const isPickable = (t: string | null | undefined): t is PickerType =>
  !!t && (PICKABLE as readonly string[]).includes(t);

// The form collects MAJOR units from a human — `dealAmount`, what they type —
// and the stored column is `dealAmountMinor`. Omitting the minor field and
// adding the major one keeps the two from ever being confused: there is no
// point in this file where a value of the wrong unit would still typecheck.
const formSchema = insertDealSchema.omit({ userId: true, dealAmountMinor: true }).extend({
  brandName: z.string().min(1, "Enter the client or brand name"),
  dealTitle: z.string().min(1, "Enter a title for this deal"),
  dealType: z.enum(PICKABLE).default(dealTypeOptions[0]),
  dealAmount: z.coerce.number().positive("Enter a deal amount greater than zero"),
  startDate: z.string().min(1, "Choose a start date"),
  endDate: z.string().min(1, "Choose an end date"),
  brandUserId: z.string().optional().nullable(),
  deliverableMode: z.enum(["all", "any_one"]).optional().default("all"),
  deliverables: z.array(z.object({
    id: z.string(),
    platform: z.string().min(1, "Choose a category"),
    contentType: z.string().min(1, "Choose an output type"),
    quantity: z.coerce.number().min(1, "Quantity must be at least 1"),
    frequency: z.string().min(1, "Choose a frequency"),
    notes: z.string().optional(),
  })).min(1, "Add at least one deliverable"),
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

// ?type=Development deep-links straight to the form with the type chosen —
// used by vertical landing pages and the Copilot.
function initialTypeFromUrl(): PickerType | null {
  try {
    const t = new URLSearchParams(window.location.search).get("type");
    return isPickable(t) ? t : null;
  } catch {
    return null;
  }
}

// "Remember and skip": a video editor shouldn't re-pick Video & Photo on
// every deal. The last-used type is remembered per device and the picker
// is skipped on the next deal — the form banner's "Change" button is the
// always-one-tap-away escape, so this never locks anyone in.
const DEAL_TYPE_MEMORY_KEY = "dis_last_engagement";

// The engagement model (and service) is what's remembered now. Only a valid
// model id is trusted; anything else shows the picker again.
type Engagement = { model: EngagementModel | null; service: string | null };
function rememberedEngagement(): Engagement | null {
  try {
    const raw = JSON.parse(localStorage.getItem(DEAL_TYPE_MEMORY_KEY) ?? "null");
    if (!raw || typeof raw !== "object" || !isEngagementModel(raw.model)) return null;
    return { model: raw.model, service: isServiceCategory(raw.service) ? raw.service : null };
  } catch {
    return null;
  }
}
function rememberEngagement(e: Engagement) {
  try { localStorage.setItem(DEAL_TYPE_MEMORY_KEY, JSON.stringify(e)); } catch {}
}

// ?model=retainer&service=seo deep-links to the form with the engagement chosen.
function initialEngagementFromUrl(): Engagement | null {
  try {
    const q = new URLSearchParams(window.location.search);
    const model = q.get("model"), service = q.get("service");
    return isEngagementModel(model) ? { model, service: isServiceCategory(service) ? service : null } : null;
  } catch {
    return null;
  }
}

/** A draft handed over by the Copilot's Edit button (one read, then gone). The
 *  server validated these fields; the form still validates them again. */
interface DealPrefill {
  brandName?: string; dealTitle?: string; dealType?: string; dealAmount?: number;
  startDate?: string; endDate?: string; customTerms?: string;
  brandTerms?: BrandTerms | null;
  deliverables?: { platform: string; contentType: string; quantity: number; frequency: string; notes: string }[];
}
function takeDealPrefill(): DealPrefill | null {
  try {
    const raw = sessionStorage.getItem(DEAL_PREFILL_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(DEAL_PREFILL_KEY);
    const p = JSON.parse(raw);
    return p && typeof p === "object" ? p : null;
  } catch {
    return null;
  }
}

export default function CreateDealPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const fmt = useMoney();
  const { openUpgradeModal } = useUpgradeModal();

  // Two-step wizard: an app-like full-screen type picker, then the form.
  // Skip the picker when the type is already known: ?type= param (deep links)
  // wins, else the remembered last-used type. First-ever deal sees the picker.
  const [prefill] = useState<DealPrefill | null>(takeDealPrefill);
  // Fired once, only when a prefill was actually restored — never on an
  // ordinary "start from scratch" visit to this page.
  useEffect(() => {
    if (prefill) trackEvent("draft_restored_after_signup");
    trackEvent("deal_started", { source: prefill ? "draft" : "form" });
  }, []);
  const prefillType = isPickable(prefill?.dealType) ? prefill.dealType : null;
  // A legacy ?type= (or a Copilot draft) names the domain directly and goes
  // straight to the form with no engagement model: nothing is guessed for it.
  const [urlType] = useState<PickerType | null>(() => prefillType ?? initialTypeFromUrl());
  const [urlEngagement] = useState<Engagement | null>(() => (urlType ? null : initialEngagementFromUrl()));
  const [memory] = useState<Engagement | null>(() => (urlType || urlEngagement ? null : rememberedEngagement()));
  const account = useAudience();
  const startEngagement = urlEngagement ?? memory;
  const initialType: PickerType | null = urlType ?? (startEngagement ? dealTypeForService(startEngagement.service) : null);
  const [step, setStep] = useState<"type" | "form">(initialType ? "form" : "type");
  // True while the form shows a model the user didn't pick this visit.
  const [fromMemory, setFromMemory] = useState(!!memory);
  const [engagement, setEngagement] = useState<Engagement>(startEngagement ?? { model: null, service: null });
  const [draft, setDraft] = useState<EngagementDraft>(() => draftForPick(startEngagement?.model ?? null));
  const [engError, setEngError] = useState<{ field: string; message: string } | null>(null);
  const modelMeta = engagementModelMeta(engagement.model);

  const { data: brands = [] } = useQuery<BrandOption[]>({
    queryKey: ["/api/brands"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      brandName: prefill?.brandName ?? "",
      dealTitle: prefill?.dealTitle ?? "",
      dealType: initialType ?? dealTypeOptions[0],
      dealAmount: prefill?.dealAmount ?? 0,
      startDate: prefill?.startDate ?? "",
      endDate: prefill?.endDate ?? "",
      deliverableMode: "all" as const,
      deliverables: prefill?.deliverables?.length
        ? prefill.deliverables.map((d) => ({ id: crypto.randomUUID(), ...d }))
        : [
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
      customTerms: prefill?.customTerms ?? "",
    },
  });

  const dealType = (form.watch("dealType") as PickerType) || dealTypeOptions[0];
  const taxonomy = TAXONOMY[dealType];
  // A deal's own type decides its wording and whether the brand terms apply.
  const isBrandDeal = audienceForDealType(dealType) === "brand_collaboration";
  const party = dealAudienceLabels(dealType);
  const [brandTermsDraft, setBrandTermsDraft] = useState<BrandTermsDraft>(() => emptyBrandTermsDraft(prefill?.brandTerms));

  // Itemizable custom terms — stored as newline-joined string in form for
  // backward compat with the existing customTerms text field.
  const [customTermsList, setCustomTermsList] = useState<string[]>(() => {
    const lines = (prefill?.customTerms ?? "").split("\n").map((t) => t.trim()).filter(Boolean);
    return lines.length ? lines : [""];
  });
  const syncCustomTerms = (next: string[]) => {
    setCustomTermsList(next);
    form.setValue("customTerms", next.map(t => t.trim()).filter(Boolean).join("\n"));
  };

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "deliverables",
  });

  const createDeal = useMutation({
    mutationFn: async ({ data, eng }: { data: FormData; eng: Pick<CheckedEngagement, "engagementModel" | "serviceCategory" | "engagementTerms"> }) => {
      // The one place major units become minor. `dealAmount` never leaves.
      const { dealAmount, ...rest } = data;
      const res = await apiRequest("POST", "/api/deals", {
        ...rest,
        dealAmountMinor: fmt.minor(dealAmount),
        // How it's billed and what it's for. The server validates these again.
        engagementModel: eng.engagementModel,
        serviceCategory: eng.serviceCategory,
        engagementTerms: eng.engagementTerms,
        // Only a brand collaboration carries these; the server stores nothing
        // for any other type and drops blank fields either way.
        brandTerms: isBrandDeal ? normalizeBrandTerms(brandTermsDraft) : null,
        // The currency those minor units are IN. The server refuses the write
        // if the workspace has since moved to another one (CURRENCY_CHANGED),
        // rather than storing ₹65,000 as $65,000.
        currency: fmt.currency,
      });
      return res.json();
    },
    onSuccess: (deal) => {
      // create_deal is the long-standing name (GA key event); deal_created is
      // the same moment under the name the audience reports use.
      const dealAudience = audienceForDealType(deal?.dealType);
      // Ids only (never free text): the model and service the deal was made with.
      const kind = { engagement_model: deal?.engagementModel ?? "none", service_category: deal?.serviceCategory ?? "none" };
      trackEvent("create_deal", { deal_type: deal?.dealType, audience: dealAudience, ...kind });
      trackEvent("deal_created", { deal_type: deal?.dealType, audience: dealAudience, ...kind });
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      toast({
        title: "Deal created",
        description: "Your deal is saved. Next, prepare a quotation for it.",
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
      if (err instanceof MoneyCurrencyPendingError) {
        toast({ title: "Nothing was saved", description: err.message, variant: "destructive" });
        return;
      }
      const parsed = parseApiError(err);
      // The server refused the engagement details: show it on the field.
      if (parsed.status === 400 && parsed.field && parsed.error) {
        setEngError({ field: parsed.field, message: parsed.error });
        toast({ title: "Check the deal details", description: parsed.error, variant: "destructive" });
        return;
      }
      if (isUpgradeError(parsed)) {
        // Out of monthly Deal Credits — offer Pro.
        openUpgradeModal({ feature: "deals" });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        return;
      }
      toast({
        title: "Couldn't create the deal",
        description: "Nothing was saved. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FormData) => {
    // fmt.minor() throws until the org's currency is known, and a throw here
    // is an unhandled rejection inside handleSubmit: no save, no toast. The
    // button waits for `ready`; this catches the Enter key and a failed load.
    if (!fmt.ready) {
      toast({ title: "Nothing was saved", description: new MoneyCurrencyPendingError().message, variant: "destructive" });
      if (fmt.failed) fmt.retry();
      return;
    }
    // A sub-unit amount (₹0.004, and every amount at all in a 0-decimal
    // currency like JPY) rounds to zero minor units. Caught here rather than
    // at the server, where "positive" has already been satisfied by 0.004.
    if (fmt.minor(data.dealAmount) < 1) {
      form.setError("dealAmount", { message: "Enter a deal amount greater than zero" });
      return;
    }
    // The same rules the server applies, so a refusal shows on the field now.
    const checked = checkEngagement(fmt.minor(data.dealAmount));
    if (!checked.ok) {
      setEngError({ field: checked.field, message: checked.message });
      document.getElementById("engagement-details")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setEngError(null);
    createDeal.mutate({ data, eng: checked });
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
  // user picks from the new taxonomy (prevents stale Design values lingering
  // on a Writing deal, etc.)
  const handleDealTypeChange = (next: PickerType) => {
    form.setValue("dealType", next);
    const current = form.getValues("deliverables");
    form.setValue(
      "deliverables",
      current.map((d) => ({ ...d, platform: "", contentType: "" })),
    );
  };

  // Picker → form. Only reset taxonomy fields when the type actually changed
  // (returning via "Change" and re-picking the same type keeps filled rows).
  const pickType = (next: PickerType) => {
    if (next !== form.getValues("dealType")) handleDealTypeChange(next);
    setFromMemory(false);
    setStep("form");
    window.scrollTo({ top: 0 });
  };

  // A model (or one of the named deal types) picked. The service decides the
  // domain — deliverable categories and agreement wording — and with no
  // service it's Custom. Every explicit pick is remembered for the next deal.
  // Re-picking the same model keeps what was typed.
  const pickModel = (model: EngagementModel, preset?: DealPreset) => {
    const service = preset ? preset.service ?? null : engagement.service;
    if (model !== engagement.model || preset) setDraft(draftForPick(model, preset));
    setEngagement({ model, service });
    setEngError(null);
    rememberEngagement({ model, service });
    pickType(dealTypeForService(service));
  };
  const pickQuick = () => {
    setEngagement({ model: null, service: null });
    setDraft({});
    setEngError(null);
    pickType("Custom");
  };
  const changeService = (service: string | null) => {
    setEngagement((e) => ({ ...e, service }));
    if (engagement.model) rememberEngagement({ model: engagement.model, service });
    // A brand collaboration keeps its own type; a client deal follows its service.
    if (!isBrandDeal) {
      const next = dealTypeForService(service);
      if (next !== form.getValues("dealType")) handleDealTypeChange(next);
    }
  };

  // The engagement as it would be saved, checked by the shared rules.
  type CheckedEngagement = Extract<ReturnType<typeof validateEngagement>, { ok: true }>;
  const toTerms = () => (engagement.model && fmt.ready ? draftToTerms(draft, fmt.minor) : null);
  const checkEngagement = (dealAmountMinor: number) =>
    validateEngagement({ engagementModel: engagement.model, serviceCategory: engagement.service, engagementTerms: toTerms(), dealAmountMinor });

  // Offered, never applied: a value the details imply, and a deal name.
  const [watchStart, watchEnd, watchClient, watchTitle] = form.watch(["startDate", "endDate", "brandName", "dealTitle"]);
  let suggestedMinor: number | null = null;
  try { suggestedMinor = suggestedValueMinor(engagement.model, toTerms(), { start: watchStart, end: watchEnd }); } catch { suggestedMinor = null; }
  const watchAmount = form.watch("dealAmount");
  const suggestionDiffers = suggestedMinor !== null && suggestedMinor > 0 && (!fmt.ready || fmt.minor(Number(watchAmount) || 0) !== suggestedMinor);
  const titleSuggestion = !watchTitle?.trim() && watchClient?.trim() && !isBrandDeal
    ? suggestDealTitle(watchClient, engagement.model, engagement.service, toTerms())
    : null;
  const recurringKind = modelMeta?.kind === "recurring";

  const L = getDeliverableLabels(dealType);

  return (
    <div className="min-h-screen bg-background pb-8">
      <header className="glass-header sticky top-0 z-40">
        <div className="flex items-center gap-3 px-4 py-4 lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-3.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => (step === "form" ? setStep("type") : setLocation("/deals"))}
            aria-label={step === "form" ? "Back to deal type" : "Back to deals"}
            data-testid="button-back"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl lg:text-lg font-bold lg:font-semibold">
            {step === "type" ? "New deal" : "Create deal"}
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
              How is this deal billed?
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-sm lg:text-base text-muted-foreground mt-2 max-w-md mx-auto"
            >
              Pick the engagement model, or search for the kind of work. You can add the service next.
            </motion.p>
          </div>

          <EngagementModelPicker
            onPick={pickModel}
            onQuick={pickQuick}
            // Brand accounts keep their own path: a brand collaboration has its
            // own terms (usage rights, exclusivity) and no engagement model.
            extra={account.audience === "brand_collaboration" ? {
              label: dealTypeMeta["Brand Collaboration"].label,
              description: dealTypeMeta["Brand Collaboration"].description,
              onPick: () => { setEngagement({ model: null, service: null }); setDraft({}); pickType("Brand Collaboration"); },
            } : null}
          />
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
        {/* How it's billed and what it's for. "Change" returns to the picker. */}
        <section className="glass-card rounded-xl p-4 sm:p-5 space-y-4" id="engagement-details">
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-xl border flex items-center justify-center text-xl shrink-0 ${TINT_CHIP[dealTypeMeta[dealType].tint] ?? "bg-primary/10 border-primary/20"}`}>
              {dealTypeMeta[dealType].emoji}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-primary">{modelMeta ? "Engagement model" : "Deal type"}</div>
              <div className="text-sm font-semibold text-foreground leading-snug line-clamp-2" data-testid="text-engagement-model">
                {modelMeta ? modelMeta.label : isBrandDeal ? dealTypeMeta[dealType].label : urlType ? dealTypeMeta[dealType].label : "Quick deal"}
              </div>
              {fromMemory ? (
                <div className="text-[10px] text-muted-foreground mt-0.5">Remembered from your last deal</div>
              ) : !modelMeta && !isBrandDeal ? (
                <div className="text-[10px] text-muted-foreground mt-0.5">No engagement model. Add one any time with Change.</div>
              ) : null}
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

          {!isBrandDeal && (
            <div className="space-y-1.5 max-w-xl">
              <Label htmlFor="service-category" className="text-xs font-medium">Service (optional)</Label>
              <ServiceSelect id="service-category" value={engagement.service} onChange={changeService} />
              <p className="text-[11px] text-muted-foreground">For your reports and filters. It also picks the deliverable categories below.</p>
            </div>
          )}

          {engagement.model && (
            <div className="border-t border-border/60 pt-4">
              <EngagementFields model={engagement.model} draft={draft} onChange={(d) => { setDraft(d); if (engError) setEngError(null); }} currency={fmt.currency ?? ""} error={engError} />
            </div>
          )}
          {engError && !engagement.model && <p className="text-xs font-medium text-destructive" role="alert">{engError.message}</p>}
        </section>

        <section className="glass-card rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {party.party} Details
          </h2>

          <div className="space-y-4 lg:grid lg:grid-cols-2 lg:gap-x-5 lg:gap-y-4 lg:space-y-0">
            <div className="space-y-2">
              <Label htmlFor="brandName">{L.who}</Label>
              <Input
                id="brandName"
                placeholder={isBrandDeal ? "Brand name" : "Client / company name"}
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
                <Label>Assign to a brand account (optional)</Label>
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
                  The brand account you choose can view this deal.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="dealTitle">Deal title</Label>
              <Input
                id="dealTitle"
                placeholder={isBrandDeal ? "e.g., Autumn skincare launch — 2 Reels" : "e.g., Website redesign — 5 pages"}
                className="h-12"
                data-testid="input-deal-title"
                {...form.register("dealTitle")}
              />
              {form.formState.errors.dealTitle && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.dealTitle.message}
                </p>
              )}
              {titleSuggestion && (
                <button
                  type="button"
                  className="block max-w-full truncate text-left text-xs font-medium text-primary hover:underline"
                  onClick={() => form.setValue("dealTitle", titleSuggestion, { shouldValidate: true, shouldDirty: true })}
                  data-testid="button-use-suggested-title"
                >
                  Use "{titleSuggestion}"
                </button>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="dealAmount">{modelMeta ? modelMeta.valueLabel : "Deal amount"} ({fmt.symbol})</Label>
              <Input
                id="dealAmount"
                type="number"
                // One minor unit, not the default 1: a currency with decimals
                // must accept 1250.50, but not a third place that would be
                // silently rounded on save (see useMoney().inputStep).
                step={fmt.inputStep}
                placeholder="50000"
                className="h-12"
                data-testid="input-deal-amount"
                {...form.register("dealAmount")}
              />
              {form.formState.errors.dealAmount ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.dealAmount.message}
                </p>
              ) : modelMeta ? (
                <p className="text-[11px] text-muted-foreground">{modelMeta.valueHint}</p>
              ) : null}
              {suggestionDiffers && fmt.ready && (
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline"
                  onClick={() => form.setValue("dealAmount", fmt.major(suggestedMinor!), { shouldValidate: true, shouldDirty: true })}
                  data-testid="button-use-suggested-value"
                >
                  Use {fmt.money(suggestedMinor!)} from the details above
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">Start date</Label>
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
                <Label htmlFor="endDate">{recurringKind ? "End of first term" : "End date"}</Label>
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
                    <Label className="text-xs">Notes (optional)</Label>
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
              Add deliverable
            </Button>
          </div>

          {form.formState.errors.deliverables && (
            <p className="text-xs text-destructive">
              {form.formState.errors.deliverables.message}
            </p>
          )}
        </section>

        {isBrandDeal && <BrandTermsFields value={brandTermsDraft} onChange={setBrandTermsDraft} />}

        <section className="glass-card rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Terms and conditions
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
                Add as many clauses as you need: revision rounds, advance payment, usage rights, exclusivity and so on.
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
                      placeholder={i === 0 ? "e.g. 2 revision rounds included; extra rounds billed separately" : "Add another clause"}
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
            // Waits for the org's currency (useMoney().ready). A failed load
            // stays clickable: onSubmit retries it and says why nothing saved.
            disabled={createDeal.isPending || (!fmt.ready && !fmt.failed)}
            data-testid="button-submit-deal"
          >
            {createDeal.isPending ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Creating deal…
              </>
            ) : fmt.failed ? (
              "Couldn't load your currency. Try again"
            ) : !fmt.ready ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Loading currency…
              </>
            ) : (
              "Create deal"
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
