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
import { Check, Crown, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { usePlanPrices, formatRupees } from "@/hooks/use-plan-prices";
import { hasLapsedTrial } from "@shared/schema";
import { trackEvent } from "@/lib/analytics";

export type UpgradeFeature = "deals" | "agreements" | "invoices" | "payment_tracking";

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
  agreements: "Creating signed agreements is a Pro feature.",
  invoices: "Generating invoices is a Pro feature.",
  payment_tracking: "Payment tracking — recording payments and marking invoices Paid — is a Pro feature.",
};

// Only what ships today — reminders and custom branding are still "coming
// soon" on /pricing, so they're not promised here.
const PRO_FEATURES = [
  "Unlimited deals & quotations",
  "Unlimited e-signed agreements & GST-ready invoices",
  "Payment tracking — see which client owes you what",
  "Priority email support",
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
  const { proMonthlyPrice, proYearlyPrice } = usePlanPrices({ enabled: open });

  const openUpgradeModal = useCallback((options: UpgradeModalOptions = {}) => {
    setFeature(options.feature ?? "deals");
    setOpen(true);
    trackEvent("upgrade_modal_shown", { feature: options.feature ?? "deals" });
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
            {PRO_FEATURES.map((f) => (
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
              Upgrade to Pro — {formatRupees(proMonthlyPrice)}/month
              <span className="absolute -top-2 right-3 px-1.5 py-0.5 rounded-full bg-amber-400 text-amber-950 text-[9px] font-black uppercase tracking-wide flex items-center gap-0.5">
                <Sparkles className="w-2.5 h-2.5" /> Recommended
              </span>
            </Button>

            <p className="text-[11px] text-center text-muted-foreground">
              Or {formatRupees(proYearlyPrice)}/year on Pro Annual — one payment for the whole year.
            </p>
          </div>

          <p className="text-[11px] text-center text-muted-foreground mt-1">
            One-time payments · no auto-debit · 7-day refund
          </p>
        </DialogContent>
      </Dialog>
    </UpgradeModalContext.Provider>
  );
}
