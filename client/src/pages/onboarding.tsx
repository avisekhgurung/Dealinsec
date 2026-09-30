import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Loader2, Rocket, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DealinsecLogo } from "@/components/dealinsec-logo";
import { AudiencePicker, DESCRIBES_YOU } from "@/components/audience-picker";
import type { Audience } from "@shared/audience";
import { cn } from "@/lib/utils";
import { readAudienceIntent } from "@/lib/audience-intent";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { parseApiError } from "@/lib/api-error";
import { RegionFields, browserRegion } from "@/components/region-fields";
import { countryName, dialCodeForCountry } from "@shared/region";
import { getLocaleSettings, type LocaleFields, type LocaleSettings } from "@shared/schema";
import { sameRegion } from "@shared/region";
import { useLocation } from "wouter";
import { postAuthDestination, hasPendingDealPrefill } from "@/lib/deal-prefill";
import { trackEvent } from "@/lib/analytics";

/**
 * What the chosen country changes on this screen. Data, not a branch: a country
 * without a row gets the international rules, and giving a country its own is
 * adding a row.
 */
interface CountryFormRules {
  /** Tested against the number after `normalizePhone`. */
  phonePattern: RegExp;
  phoneMaxLength: number;
  phonePlaceholder: string;
  phoneInvalid: string;
  /** `dial` is the country's calling code, e.g. "+44" ("" when unknown). */
  normalizePhone: (raw: string, dial: string) => string;
  addressPlaceholder: string;
  /** What the profile's tax registration is called in the copy. A label only:
   *  which registrations a country requires is not decided here. */
  taxIdLabel: string;
}

const INTERNATIONAL_FORM_RULES: CountryFormRules = {
  // E.164 caps a number at 15 digits. The floor of 6 catches a half-typed
  // number without pretending to know every country's numbering plan.
  phonePattern: /^\+?\d{6,15}$/,
  phoneMaxLength: 20,
  phonePlaceholder: "7700 900123",
  phoneInvalid: "Enter your phone number",
  // Spaces and punctuation go. The field shows the country's calling code as a
  // prefix, so a number typed without one is completed here rather than being
  // stored as a national number nobody outside that country can dial.
  normalizePhone: (raw, dial) => {
    const cleaned = raw.trim().replace(/[\s().-]/g, "");
    if (!cleaned) return cleaned;
    if (cleaned.startsWith("+")) return cleaned;
    return dial ? `${dial}${cleaned.replace(/^0+/, "")}` : cleaned;
  },
  addressPlaceholder: "Street, city, postcode (you can add this later)",
  taxIdLabel: "tax ID",
};

const FORM_RULES_BY_COUNTRY: Record<string, CountryFormRules> = {
  IN: {
    phonePattern: /^[6-9]\d{9}$/,
    phoneMaxLength: 10,
    phonePlaceholder: "9876543210",
    phoneInvalid: "Enter a valid 10-digit Indian mobile number",
    // India stores the bare 10 digits, exactly as it always has.
    normalizePhone: (raw) => raw.replace(/\D/g, ""),
    addressPlaceholder: "Street, city, state, PIN (you can add this later)",
    taxIdLabel: "PAN",
  },
};

const STEPS = [
  { key: "role", label: "Role & Profile" },
  { key: "personal", label: "Personal Info" },
  { key: "regional", label: "Regional & Billing" },
] as const;

/** Step content: slides in from the side it was navigated from and fades. The
 *  children share the parent's variant names, so `item` staggers each field in. */
const stepVariants: Variants = {
  enter: (d: number) => ({ opacity: 0, x: d * 32 }),
  center: { opacity: 1, x: 0, transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
  exit: (d: number) => ({ opacity: 0, x: d * -32, transition: { duration: 0.16 } }),
};
const itemVariants: Variants = {
  enter: { opacity: 0, y: 10 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
};

type FieldErrors = { audience?: string; name?: string; phone?: string };

export default function OnboardingPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const reduceMotion = useReducedMotion();
  const [isLoading, setIsLoading] = useState(false);

  const [step, setStep] = useState(0);
  // +1 moving forward, -1 back: which side the next step slides in from.
  const [dir, setDir] = useState(1);
  const [errors, setErrors] = useState<FieldErrors>({});
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  // Nothing is preselected by default: the work type shapes the wording of the
  // whole app, so it is an answer, not a default. The one exception is a choice
  // the person already made on the way in (a homepage card, the demo's selector
  // or the Deal Risk Checker), which they can still change here.
  const [audience, setAudience] = useState<Audience | null>(readAudienceIntent);
  const [describes, setDescribes] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  // Pre-filled from the browser, so an Indian signup is already on India / INR
  // and presses Continue exactly as before. Nothing is stored until submit.
  const [region, setRegion] = useState<LocaleSettings>(browserRegion);

  const rules = FORM_RULES_BY_COUNTRY[region.country] ?? INTERNATIONAL_FORM_RULES;
  const dialCode = dialCodeForCountry(region.country);

  // A new step starts at the top with its heading focused, so a screen reader
  // announces where the person is and the keyboard continues from there.
  useEffect(() => {
    if (firstRender.current) {
      // Arriving from the sign-up screen must not keep its scroll position.
      firstRender.current = false;
      window.scrollTo({ top: 0 });
      return;
    }
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    headingRef.current?.focus({ preventScroll: true });
  }, [step, reduceMotion]);

  const validate = (which: number): FieldErrors => {
    const e: FieldErrors = {};
    if (which >= 0 && !audience) e.audience = "Choose the kind of work you do";
    if (which >= 1) {
      if (!fullName.trim()) e.name = "Full name is required";
      if (!rules.phonePattern.test(rules.normalizePhone(phone, dialCode))) e.phone = rules.phoneInvalid;
    }
    return e;
  };

  const go = (to: number) => {
    setDir(to > step ? 1 : -1);
    setErrors({});
    setStep(to);
  };

  const next = (e: React.FormEvent) => {
    e.preventDefault();
    // Only what this step asks for; the earlier steps were checked when left.
    const found = step === 0 ? { audience: validate(0).audience } : { name: validate(1).name, phone: validate(1).phone };
    const clean = Object.fromEntries(Object.entries(found).filter(([, v]) => v)) as FieldErrors;
    if (Object.keys(clean).length) {
      setErrors(clean);
      // Keyboard and screen-reader users land on the first field to fix.
      const first = clean.name ? "fullName" : clean.phone ? "phone" : null;
      if (first) requestAnimationFrame(() => document.getElementById(first)?.focus());
      return;
    }
    trackEvent("onboarding_step_completed", { step: step + 1 });
    go(step + 1);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    // The phone rules follow the country chosen on THIS step, so the number is
    // checked again against the final country and the person sent back to fix it.
    const all = validate(1);
    if (all.name) { setErrors({ name: all.name }); go(1); return; }
    if (all.phone) {
      setErrors({ phone: all.phone });
      toast({ title: "Check your phone number", description: `It doesn't look right for ${countryName(region.country)}.`, variant: "destructive" });
      go(1);
      return;
    }
    if (!audience) { setErrors({ audience: "Choose the kind of work you do" }); go(0); return; }
    // Billing address is OPTIONAL during onboarding — collected later when
    // the user generates an invoice or contract (progressive profile pattern).

    setIsLoading(true);
    try {
      // Documents print in the ORGANIZATION's region, not the member's (see
      // resolveLocaleSettings), so the workspace has to carry the choice too,
      // or a freelancer in Berlin issues their first invoice in rupees. This is
      // the one moment it is safe to set: onboarding is reached only by the
      // owner of a brand-new workspace (invitees are marked onboarded when they
      // accept), and a new workspace holds no amounts a currency change could
      // relabel. Skipped when nothing differs, so an Indian signup never writes
      // to its workspace at all.
      //
      // Deliberately BEFORE the profile write. That write finishes onboarding
      // and starts the trial; were the workspace write to fail after it, the
      // person would be let in with every document in the wrong currency, and
      // once their first deal exists the region is locked.
      if (user?.organizationId && user.orgRole === "OWNER") {
        const org = await queryClient
          .ensureQueryData<LocaleFields>({ queryKey: ["/api/org"] })
          .catch(() => undefined);
        // One write for everything the workspace records at signup. The region
        // is included only when it differs (an Indian signup sends none), but the
        // work type is always saved: it is what the person just chose.
        const orgUpdates: Record<string, unknown> = { audience };
        if (describes) orgUpdates.industry = describes;
        if (businessName.trim()) orgUpdates.name = businessName.trim();
        if (!sameRegion(getLocaleSettings(org), region)) Object.assign(orgUpdates, region);
        try {
          await apiRequest("PATCH", "/api/org", orgUpdates);
        } catch (error) {
          toast({
            title: "Couldn't save your details",
            description: parseApiError(error).error || "Please try again.",
            variant: "destructive",
          });
          return;
        }
        await queryClient.invalidateQueries({ queryKey: ["/api/org"] });
        trackEvent("audience_selected", { audience });
      }

      const nameParts = fullName.trim().split(" ");
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(" ") || null;

      const profileRes = await apiRequest("PATCH", "/api/profile", {
        firstName,
        lastName,
        phone: rules.normalizePhone(phone, dialCode),
        billingAddress: billingAddress.trim() || undefined,
        // The person's own row drives their personal screens (dates in their
        // activity feed) and is the issuer profile, so it records the same
        // choice the workspace does.
        country: region.country,
        currency: region.currency,
        locale: region.locale,
        timezone: region.timezone,
        onboardingComplete: true,
      });
      // Onboarding is the trial's one-shot grant point (server/trial.ts) —
      // this is the only place that can ever observe the moment it starts.
      if (!user?.trialStartedAt) {
        const updated = await profileRes.json().catch(() => null);
        if (updated?.trialStartedAt) trackEvent("pro_trial_started");
      }
      trackEvent("onboarding_step_completed", { step: 3 });

      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      const restoring = hasPendingDealPrefill();
      toast({
        title: "You're in!",
        description: restoring
          ? "Picking up right where you left off."
          : `We'll ask for ${rules.taxIdLabel}, bank & signature only when you need them.`,
      });
      setLocation(postAuthDestination());
    } catch (error: any) {
      toast({
        title: "Failed to save profile",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const spring = reduceMotion ? { duration: 0 } : { type: "spring" as const, stiffness: 520, damping: 26 };

  const errorText = (id: string, msg?: string) =>
    msg ? (
      <motion.p
        id={id}
        role="alert"
        initial={reduceMotion ? false : { opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-xs font-medium text-destructive"
      >
        {msg}
      </motion.p>
    ) : null;

  const trialChip = (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
      <Sparkles className="h-3.5 w-3.5" aria-hidden /> 7-day Pro trial starts when you finish
    </span>
  );

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background to-muted">
      {/* Header: brand, the three-step progress, and the trial note. */}
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <DealinsecLogo size="md" withText />

          <nav aria-label="Setup progress" className="hidden sm:block">
            <ol className="flex items-center gap-3">
              {STEPS.map((s, i) => {
                const state = i < step ? "done" : i === step ? "current" : "todo";
                return (
                  <li key={s.key} className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={state !== "done" || isLoading}
                      onClick={() => go(i)}
                      aria-current={state === "current" ? "step" : undefined}
                      className="flex items-center gap-2 rounded-md text-sm disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                    >
                      <motion.span
                        key={state}
                        initial={reduceMotion ? false : { scale: 0.7 }}
                        animate={{ scale: 1 }}
                        transition={spring}
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-bold",
                          state === "done" && "border-emerald-600 bg-emerald-600 text-white",
                          state === "current" && "border-emerald-600 text-emerald-700 dark:text-emerald-300",
                          state === "todo" && "border-border text-muted-foreground",
                        )}
                      >
                        {state === "done" ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden /> : i + 1}
                      </motion.span>
                      <span className={cn("font-medium", state === "todo" ? "text-muted-foreground" : "text-foreground")}>
                        {s.label}
                      </span>
                    </button>
                    {i < STEPS.length - 1 && (
                      <span className="relative h-px w-10 overflow-hidden bg-border" aria-hidden>
                        <motion.span
                          className="absolute inset-y-0 left-0 bg-emerald-500"
                          initial={false}
                          animate={{ width: i < step ? "100%" : "0%" }}
                          transition={{ duration: reduceMotion ? 0 : 0.4, ease: "easeOut" }}
                        />
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>

          <div className="hidden md:block">{trialChip}</div>
        </div>
        {/* Phone: a thin bar instead of the labelled steps. */}
        <div className="h-1 bg-border/60 sm:hidden" aria-hidden>
          <motion.div
            className="h-full bg-emerald-500"
            initial={false}
            animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            transition={{ duration: reduceMotion ? 0 : 0.4, ease: "easeOut" }}
          />
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center sm:py-12">
        <div className="w-full max-w-[520px]">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:hidden">
            Step {step + 1} of {STEPS.length} · {STEPS[step].label}
          </p>
          <div className="mb-4 flex justify-center md:hidden">{trialChip}</div>

          <div className="overflow-hidden rounded-2xl border border-border/70 bg-card p-6 shadow-lg shadow-emerald-900/5 sm:p-8">
            <AnimatePresence mode="wait" custom={dir} initial={false}>
              {step === 0 && (
                <motion.form
                  key="role"
                  custom={dir}
                  variants={stepVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: reduceMotion ? 0 : 0.26, ease: [0.22, 1, 0.36, 1] }}
                  onSubmit={next}
                  noValidate
                  className="space-y-6"
                >
                  <motion.div variants={itemVariants} className="text-center">
                    <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight outline-none">
                      What kind of work do you do?
                    </h1>
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      This sets the wording and where you start. You can change it any time in Settings.
                    </p>
                  </motion.div>

                  <motion.div variants={itemVariants} className="space-y-2">
                    <AudiencePicker value={audience} onChange={(a) => { setAudience(a); setErrors({}); }} idPrefix="onboarding-audience" />
                    {errorText("audience-error", errors.audience)}
                  </motion.div>

                  <motion.div variants={itemVariants} className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <Label>What best describes you?</Label>
                      <span className="text-[11px] font-medium text-muted-foreground">Optional</span>
                    </div>
                    <div className="flex flex-wrap gap-2" role="group" aria-label="What best describes you?">
                      {DESCRIBES_YOU.map((label) => {
                        const on = describes === label;
                        return (
                          <motion.button
                            key={label}
                            type="button"
                            aria-pressed={on}
                            whileTap={reduceMotion ? undefined : { scale: 0.94 }}
                            onClick={() => setDescribes(on ? null : label)}
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
                              on
                                ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                                : "border-border bg-background text-muted-foreground hover:border-emerald-300",
                            )}
                          >
                            {label}
                          </motion.button>
                        );
                      })}
                    </div>
                  </motion.div>

                  <motion.div variants={itemVariants}>
                    <Button type="submit" className="gradient-btn h-11 w-full" data-testid="button-onboarding-next">
                      Continue <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
                    </Button>
                  </motion.div>
                </motion.form>
              )}

              {step === 1 && (
                <motion.form
                  key="personal"
                  custom={dir}
                  variants={stepVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: reduceMotion ? 0 : 0.26, ease: [0.22, 1, 0.36, 1] }}
                  onSubmit={next}
                  noValidate
                  className="space-y-5"
                >
                  <motion.div variants={itemVariants} className="text-center">
                    <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight outline-none">
                      Let&apos;s get you set up
                    </h1>
                    <p className="mt-1.5 text-sm text-muted-foreground">Enter the details that appear on your documents.</p>
                  </motion.div>

                  <motion.div variants={itemVariants} className="space-y-2">
                    <Label htmlFor="fullName">Full Name *</Label>
                    <Input
                      id="fullName"
                      type="text"
                      autoComplete="name"
                      placeholder="Enter your full name"
                      value={fullName}
                      onChange={(e) => { setFullName(e.target.value); if (errors.name) setErrors((x) => ({ ...x, name: undefined })); }}
                      aria-invalid={!!errors.name}
                      aria-describedby={errors.name ? "name-error" : undefined}
                      className="h-11"
                      data-testid="input-fullname"
                      autoFocus
                    />
                    {errorText("name-error", errors.name)}
                  </motion.div>

                  <motion.div variants={itemVariants} className="space-y-2">
                    <Label htmlFor="phone">Phone Number *</Label>
                    <div className="relative">
                      {dialCode && (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium tabular-nums text-muted-foreground"
                        >
                          {dialCode}
                        </span>
                      )}
                      <Input
                        id="phone"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel-national"
                        placeholder={rules.phonePlaceholder}
                        value={phone}
                        onChange={(e) => { setPhone(e.target.value); if (errors.phone) setErrors((x) => ({ ...x, phone: undefined })); }}
                        maxLength={rules.phoneMaxLength}
                        aria-invalid={!!errors.phone}
                        aria-describedby={errors.phone ? "phone-error" : "phone-hint"}
                        className="h-11"
                        data-testid="input-phone"
                        style={dialCode ? { paddingLeft: `${2.1 + dialCode.length * 0.52}rem` } : undefined}
                      />
                    </div>
                    {errorText("phone-error", errors.phone)}
                    {!errors.phone && (
                      <p id="phone-hint" className="text-xs text-muted-foreground">
                        Using the {countryName(region.country)} number format. You choose your country on the next step.
                      </p>
                    )}
                  </motion.div>

                  <motion.div variants={itemVariants} className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <Label htmlFor="businessName">Professional / Business Name</Label>
                      <span className="text-[11px] font-medium text-muted-foreground">Optional</span>
                    </div>
                    <Input
                      id="businessName"
                      type="text"
                      autoComplete="organization"
                      maxLength={80}
                      placeholder="e.g. Studio Doe or Freelance Consulting"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      className="h-11"
                      data-testid="input-business-name"
                    />
                    <p className="text-xs text-muted-foreground">Names your workspace. Leave it blank to use your own name.</p>
                  </motion.div>

                  <motion.div variants={itemVariants} className="rounded-xl border border-primary/15 bg-primary/5 p-3.5 text-xs leading-relaxed text-muted-foreground">
                    Your phone number appears on the quotations, agreements and invoices you send. You can change it any time in your profile.
                  </motion.div>

                  <motion.div variants={itemVariants} className="flex items-center justify-between gap-3">
                    <Button type="button" variant="outline" className="h-11" onClick={() => go(0)} data-testid="button-onboarding-back">
                      <ArrowLeft className="mr-2 h-4 w-4" aria-hidden /> Back
                    </Button>
                    <span className="text-xs text-muted-foreground">Step 2 of 3</span>
                    <Button type="submit" className="gradient-btn h-11 px-6" data-testid="button-onboarding-next">
                      Continue <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
                    </Button>
                  </motion.div>
                </motion.form>
              )}

              {step === 2 && (
                <motion.form
                  key="regional"
                  custom={dir}
                  variants={stepVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: reduceMotion ? 0 : 0.26, ease: [0.22, 1, 0.36, 1] }}
                  onSubmit={submit}
                  noValidate
                  className="space-y-5"
                >
                  <motion.div variants={itemVariants} className="text-center">
                    <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight outline-none">
                      Regional &amp; Billing Preferences
                    </h1>
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      Set your country and currency. Your documents follow its money, dates and tax.
                    </p>
                  </motion.div>

                  <motion.div variants={itemVariants}>
                    <RegionFields value={region} onChange={setRegion} idPrefix="onboarding-region" />
                  </motion.div>

                  <motion.div variants={itemVariants} className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <Label htmlFor="billingAddress">Billing Address</Label>
                      <span className="text-[11px] font-medium text-muted-foreground">Optional · for invoices</span>
                    </div>
                    <Textarea
                      id="billingAddress"
                      placeholder={rules.addressPlaceholder}
                      value={billingAddress}
                      onChange={(e) => setBillingAddress(e.target.value)}
                      rows={3}
                      data-testid="input-billing-address"
                    />
                  </motion.div>

                  <motion.div variants={itemVariants} className="flex gap-2.5 rounded-xl border border-primary/15 bg-primary/5 p-3.5">
                    <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" aria-hidden />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      <span className="font-semibold text-foreground">Billing address, {rules.taxIdLabel} &amp; signature</span> are collected right before your first agreement.{" "}
                      <span className="font-semibold text-foreground">Bank details</span> are collected right before your first invoice. No mid-flow surprises.
                    </p>
                  </motion.div>

                  {/* Phone: the long primary button gets the full width, Back sits under it. */}
                  <motion.div variants={itemVariants} className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
                    <Button type="button" variant="outline" className="h-11 w-full sm:w-auto" disabled={isLoading} onClick={() => go(1)} data-testid="button-onboarding-back">
                      <ArrowLeft className="mr-2 h-4 w-4" aria-hidden /> Back
                    </Button>
                    <Button type="submit" className="gradient-btn h-11 w-full sm:flex-1" disabled={isLoading} data-testid="button-complete-profile">
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-label="Saving" />
                      ) : (
                        <>Complete Setup &amp; Start Free Trial <Rocket className="ml-2 h-4 w-4" aria-hidden /></>
                      )}
                    </Button>
                  </motion.div>
                </motion.form>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      <footer className="border-t border-border/60 py-5 text-center text-xs text-muted-foreground">
        Questions? <a href="mailto:support@dealinsec.com" className="font-medium text-foreground hover:underline">support@dealinsec.com</a>
      </footer>
    </div>
  );
}
