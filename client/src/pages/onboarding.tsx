import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { parseApiError } from "@/lib/api-error";
import { RegionFields, browserRegion } from "@/components/region-fields";
import { dialCodeForCountry } from "@shared/region";
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

export default function OnboardingPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  // Pre-filled from the browser, so an Indian signup is already on India / INR
  // and presses Continue exactly as before. Nothing is stored until submit.
  const [region, setRegion] = useState<LocaleSettings>(browserRegion);

  const rules = FORM_RULES_BY_COUNTRY[region.country] ?? INTERNATIONAL_FORM_RULES;
  const dialCode = dialCodeForCountry(region.country);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!fullName.trim()) {
      toast({ title: "Full name is required", variant: "destructive" });
      return;
    }
    if (!rules.phonePattern.test(rules.normalizePhone(phone, dialCode))) {
      toast({ title: rules.phoneInvalid, variant: "destructive" });
      return;
    }
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
        if (!sameRegion(getLocaleSettings(org), region)) {
          try {
            await apiRequest("PATCH", "/api/org", region);
          } catch (error) {
            toast({
              title: "Couldn't save your country and currency",
              description: parseApiError(error).error || "Please try again.",
              variant: "destructive",
            });
            return;
          }
          await queryClient.invalidateQueries({ queryKey: ["/api/org"] });
        }
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted flex items-center justify-center px-4 py-8">
      <Card className="glass-card w-full max-w-md border-0 animate-fade-in">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Welcome to Dealinsec</CardTitle>
          <CardDescription>
            A few quick details to start. We'll ask for the rest right when you need them.
          </CardDescription>
          <div className="mx-auto mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              Finishing this starts your 7-day Pro trial — everything unlocked
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name *</Label>
              <Input
                id="fullName"
                type="text"
                placeholder="Enter your full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                data-testid="input-fullname"
              />
            </div>

            {/* Before the phone field, because the country decides what a
                valid phone number looks like. */}
            <RegionFields value={region} onChange={setRegion} idPrefix="onboarding-region" />

            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number *</Label>
              <div className="relative">
                {dialCode && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground tabular-nums"
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
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={rules.phoneMaxLength}
                  required
                  data-testid="input-phone"
                  style={dialCode ? { paddingLeft: `${2.1 + dialCode.length * 0.52}rem` } : undefined}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="billingAddress">Billing Address</Label>
                <span className="text-[11px] text-muted-foreground font-medium">Optional · for invoices</span>
              </div>
              <Textarea
                id="billingAddress"
                placeholder={rules.addressPlaceholder}
                value={billingAddress}
                onChange={(e) => setBillingAddress(e.target.value)}
                rows={3}
                data-testid="input-billing-address"
              />
            </div>

            <div className="rounded-xl bg-primary/5 border border-primary/15 p-3.5 flex gap-2.5">
              <Sparkles className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="font-semibold text-foreground">Billing address, {rules.taxIdLabel} &amp; signature</span> are collected right before your first agreement.{" "}
                <span className="font-semibold text-foreground">Bank details</span> are collected right before your first invoice. No mid-flow surprises.
              </p>
            </div>

            <Button type="submit" className="gradient-btn w-full h-11" disabled={isLoading} data-testid="button-complete-profile">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
