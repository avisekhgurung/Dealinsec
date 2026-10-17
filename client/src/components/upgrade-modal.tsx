/**
 * Global upgrade modal — the single paywall surface for the subscription-first
 * model. Opened imperatively from anywhere via useUpgradeModal():
 *
 *   const { openUpgradeModal } = useUpgradeModal();
 *   openUpgradeModal({ feature: "agreements" });
 *
 * One path out: "Upgrade to Pro" → /pricing (monthly & annual choices). The
 * prices shown are the live ones from /api/payments/config. Deal Boost is no
 * longer sold anywhere in the UI (the server SKU remains for existing boosts).
 */
import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Crown, Globe, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { usePlanPrices, formatRupees, usePlanCheckoutAvailable } from "@/hooks/use-plan-prices";
import { hasLapsedTrial } from "@shared/schema";
import { trackEvent } from "@/lib/analytics";
import { OUTBOUND_ALLOWANCE_DEFAULTS } from "@shared/outbound-plans";

export type UpgradeFeature = "deals" | "agreements" | "invoices" | "payment_tracking" | "outbound" | "seats";

export interface UpgradeModalOptions {
  feature?: UpgradeFeature;
}

interface UpgradeModalContextValue {
  openUpgradeModal: (options?: UpgradeModalOptions) => void;
}

const UpgradeModalContext = createContext<UpgradeModalContextValue | null>(null);

export function useUpgradeModal(): UpgradeModalContextValue {
  const ctx = useContext(UpgradeModalContext);
  if (!ctx) throw new Error("useUpgradeModal must be used within <UpgradeModalProvider>");
  return ctx;
}

const FEATURE_COPY: Record<UpgradeFeature, string> = {
  deals: "Your free plan covers 4 deals a month — you've used them all.",
  agreements: "Your quotation is ready to become a signed agreement — that's where Pro comes in.",
  invoices: "Your agreement is signed — create the invoice and track payment with Pro.",
  payment_tracking: "Track who's paid and who still owes you — part of Pro.",
  outbound: `You've used this month's AI Outbound searches on the free plan. Pro includes ${OUTBOUND_ALLOWANCE_DEFAULTS.pro.monthlySearches} a month.`,
  seats: "Extra team seats are an add-on for DealInSec Pro.",
};

// Only what ships today. In-app invoices print your tax IDs but don't calculate tax, so they are never called
// "GST-ready" (see shared/product-facts.ts).
const proFeatures = (_india: boolean) => [
  `AI Outbound: ${OUTBOUND_ALLOWANCE_DEFAULTS.pro.monthlySearches} prospect searches a month, in any country`,
  "Unlimited deals & quotations",
  "Agreements your client signs online, invoices and payment tracking",
  "Up to 5 team members — one plan, no separate CRM or AI fee",
];

export function UpgradeModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [feature, setFeature] = useState<UpgradeFeature>("deals");
  const [, setLocation] = useLocation();
  // Lapsed trialists get their own framing: they've SEEN the full workflow,
  // so the modal speaks to what they're losing, not what they'd gain.
  const { user } = useAuth();
  const trialEnded = hasLapsedTrial(user);
  // Fetched only once the modal opens; the defaults are the list prices.
  const { proMonthlyPrice } = usePlanPrices({ enabled: open });
  // Plans can only be bought from India until international checkout is live
  // (see usePlanCheckoutAvailable). Elsewhere the button still leads to
  // /pricing, which explains that, but it does not quote a rupee price nothing
  // can charge. Always true for an Indian account, so India sees the modal
  // exactly as before.
  const checkoutAvailable = usePlanCheckoutAvailable();

  const openUpgradeModal = useCallback((options: UpgradeModalOptions = {}) => {
    const feature = options.feature ?? "deals";
    setFeature(feature);
    setOpen(true);
    trackEvent("upgrade_modal_shown", { feature });
    // Named separately from the generic event above so the two highest-value
    // workflow moments (Step 5 B/C) are queryable on their own.
    if (feature === "agreements") trackEvent("agreement_upgrade_clicked");
    if (feature === "invoices") trackEvent("invoice_upgrade_clicked");
  }, []);

  return (
    <UpgradeModalContext.Provider value={{ openUpgradeModal }}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" data-testid="upgrade-modal">
          <DialogHeader>
            <div className="mx-auto w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mb-2 shadow-lg shadow-emerald-500/30">
              <Crown className="w-6 h-6 text-amber-300" />
            </div>
            <DialogTitle className="text-center text-xl">
              {trialEnded ? "Your 7-day trial has ended" : "Upgrade to Continue Closing Deals"}
            </DialogTitle>
            <DialogDescription className="text-center">
              {trialEnded
                ? `${FEATURE_COPY[feature]} Your deals and documents are safe — upgrade to keep the full workflow you've been using.`
                : `${FEATURE_COPY[feature]} You've reached your free monthly limit or this feature requires a Pro subscription.`}
            </DialogDescription>
          </DialogHeader>

          <ul className="space-y-2 my-1">
            {proFeatures(checkoutAvailable).map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-sm">
                <div className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500/15 flex items-center justify-center mt-px">
                  <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" strokeWidth={3} />
                </div>
                <span>{f}</span>
              </li>
            ))}
          </ul>

          <div className="space-y-2.5 mt-1">
            <Button
              className="w-full h-12 text-base font-bold rounded-xl text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-lg shadow-emerald-500/30 relative"
              onClick={() => {
                setOpen(false);
                setLocation("/pricing");
              }}
              data-testid="upgrade-modal-pro"
            >
              <Crown className="w-4 h-4 mr-2 text-amber-300" />
              {checkoutAvailable ? <>Upgrade to Pro — {formatRupees(proMonthlyPrice)}/month</> : <>See Pro plans</>}
              {checkoutAvailable && (
                <span className="absolute -top-2 right-3 px-1.5 py-0.5 rounded-full bg-amber-400 text-amber-950 text-[9px] font-black uppercase tracking-wide flex items-center gap-0.5">
                  <Sparkles className="w-2.5 h-2.5" /> Recommended
                </span>
              )}
            </Button>

            {checkoutAvailable ? (
              <p className="text-[11px] text-center text-muted-foreground">
                Paid monthly in India. It doesn&apos;t renew or charge automatically.
              </p>
            ) : (
              <p className="text-[11px] text-center text-muted-foreground flex items-center justify-center gap-1.5" data-testid="upgrade-modal-intl-soon">
                <Globe className="w-3 h-3" /> Paid plans aren't available in your country yet
              </p>
            )}
          </div>

          {checkoutAvailable && (
            <p className="text-[11px] text-center text-muted-foreground mt-1">
              One-time payments · no auto-debit · 7-day refund
            </p>
          )}
        </DialogContent>
      </Dialog>
    </UpgradeModalContext.Provider>
  );
}
