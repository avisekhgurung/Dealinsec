import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
import { PlatformIcon } from "@/components/platform-icon";
import { TaxonomyCombobox } from "@/components/taxonomy-combobox";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Plus, Trash2, Loader2, FileText } from "lucide-react";
import {
  insertDealSchema,
  frequencyOptions,
  STANDARD_TERMS,
} from "@shared/schema";
import {
  dealTypeOptions,
  dealTypeMeta,
  TAXONOMY,
  type DealType,
} from "@shared/dealTypeTaxonomy";

const formSchema = insertDealSchema.omit({ userId: true }).extend({
  brandName: z.string().min(1, "Client / brand name is required"),
  dealTitle: z.string().min(1, "Deal title is required"),
  dealType: z.enum(dealTypeOptions).default("Creator"),
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

export default function CreateDealPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: brands = [] } = useQuery<BrandOption[]>({
    queryKey: ["/api/brands"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      brandName: "",
      dealTitle: "",
      dealType: "Creator",
      dealAmount: 0,
      startDate: "",
      endDate: "",
      deliverableMode: "all" as const,
      deliverables: [
        {
          id: crypto.randomUUID(),
          platform: "Instagram",
          contentType: "Reel",
          quantity: 1,
          frequency: "One-time",
          notes: "",
        },
      ],
      standardTermIds: STANDARD_TERMS.map((t) => t.id),
      customTerms: "",
    },
  });

  const dealType = (form.watch("dealType") as DealType) || "Creator";
  const taxonomy = TAXONOMY[dealType];

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
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      toast({
        title: "Deal created",
        description: "Your deal has been created successfully.",
      });
      setLocation(`/deals/${deal.id}`);
    },
    onError: () => {
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

  const labels = {
    Creator: { category: "Platform", type: "Content Type", who: "Brand Name" },
    Freelance: { category: "Category", type: "Output", who: "Client Name" },
    Consulting: { category: "Practice Area", type: "Format", who: "Client Name" },
    "Service Vendor": { category: "Service", type: "Output", who: "Client Name" },
    Custom: { category: "Category", type: "Output", who: "Client / Brand" },
  } as const;
  const L = labels[dealType];

  return (
    <div className="min-h-screen bg-background pb-8">
      <header className="glass-header sticky top-0 z-40">
        <div className="flex items-center gap-3 px-4 py-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/deals")}
            data-testid="button-back"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-bold">Create Deal</h1>
        </div>
      </header>

      <form onSubmit={form.handleSubmit(onSubmit)} className="px-4 py-6 space-y-6 animate-fade-in">
        {/* Deal Type — first step, drives downstream taxonomy */}
        <section className="glass-card rounded-xl p-5 sm:p-6 space-y-5">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-primary mb-1">
                Step 1
              </div>
              <h2 className="text-base font-semibold text-foreground">Choose deal type</h2>
            </div>
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Tailors deliverable options
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
            {dealTypeOptions.map((dt) => {
              const meta = dealTypeMeta[dt];
              const selected = dealType === dt;
              return (
                <button
                  key={dt}
                  type="button"
                  onClick={() => handleDealTypeChange(dt)}
                  className={`group relative rounded-xl border p-4 text-left transition-all duration-150 ${
                    selected
                      ? "border-primary/70 bg-gradient-to-br from-primary/[0.07] to-primary/[0.02] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(16,185,129,0.18)]"
                      : "border-input/60 hover:border-primary/40 hover:bg-muted/40 bg-background/60"
                  }`}
                  data-testid={`select-deal-type-${dt}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className={`text-2xl leading-none transition-transform ${selected ? "scale-110" : "group-hover:scale-105"}`}>
                      {meta.emoji}
                    </div>
                    <div
                      className={`w-4 h-4 rounded-full border-2 transition-all flex items-center justify-center ${
                        selected
                          ? "border-primary bg-primary"
                          : "border-input/60 group-hover:border-primary/40"
                      }`}
                    >
                      {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                  </div>
                  <div className={`text-sm font-semibold leading-tight ${selected ? "text-primary" : "text-foreground"}`}>
                    {meta.label}
                  </div>
                  <div className="text-[11px] text-muted-foreground/90 mt-1 leading-snug line-clamp-2">
                    {meta.description}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="glass-card rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {dealType === "Creator" ? "Brand Details" : "Client Details"}
          </h2>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="brandName">{L.who}</Label>
              <Input
                id="brandName"
                placeholder={
                  dealType === "Creator"
                    ? "e.g., Nike, Adidas, Mamaearth"
                    : "Client / company name"
                }
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
                      {dealType === "Creator" ? (
                        <PlatformIcon
                          platform={form.watch(`deliverables.${index}.platform`) || "Instagram"}
                          size={18}
                        />
                      ) : (
                        <span className="text-lg">{dealTypeMeta[dealType].emoji}</span>
                      )}
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

          <div className="space-y-2 pt-2 border-t border-border/60">
            <Label htmlFor="customTerms" className="text-xs font-semibold">
              Your own terms (optional)
            </Label>
            <Textarea
              id="customTerms"
              placeholder="Add any custom clauses — usage rights, exclusivity, posting schedule, etc."
              rows={4}
              className="resize-none"
              data-testid="textarea-custom-terms"
              {...form.register("customTerms")}
            />
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
    </div>
  );
}
