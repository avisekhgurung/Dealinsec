/**
 * Global upgrade modal — the single paywall surface for the subscription-first
 * model. Opened imperatively from anywhere via useUpgradeModal():
 *
 *   const { openUpgradeModal } = useUpgradeModal();
 *   openUpgradeModal({ feature: "agreements" });
 *
 * Two paths out:
 *   1. "Upgrade to Pro" (recommended) → /pricing (monthly & annual choices)
 *   2. "Deal Boost — ₹99" → inline Razorpay checkout (unlimited deals +
 *      quotations for 1 month). Hidden for Pro-only features — the boost
 *      never unlocks agreements/invoices/payment tracking.
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
import { Check, Crown, Loader2, Rocket, Sparkles } from "lucide-react";
import { useRazorpayCheckout } from "@/hooks/use-razorpay-checkout";
import { useToast } from "@/hooks/use-toast";
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
  payment_tracking: "Payment tracking is a Pro feature.",
};

const PRO_FEATURES = [
  "Unlimited deals & quotations",
  "Unlimited agreements & invoices",
  "Payment tracking & reminders",
  "Custom branding · Priority support",
];

export function UpgradeModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [feature, setFeature] = useState<UpgradeFeature>("deals");
  const [, setLocation] = useLocation();
  const { checkout, isLoading } = useRazorpayCheckout();
  const { toast } = useToast();

  const openUpgradeModal = useCallback((options: UpgradeModalOptions = {}) => {
    setFeature(options.feature ?? "deals");
    setOpen(true);
    trackEvent("upgrade_modal_shown", { feature: options.feature ?? "deals" });
  }, []);

  // The boost only lifts the deal/quotation limit — for Pro-only features it
  // would be a dead-end purchase, so it's only offered on the deal-limit path.
  const boostApplies = feature === "deals";

  const buyBoost = () =>
    checkout("deal_boost", {
      onSuccess: () => {
        setOpen(false);
        toast({
          title: "Deal Boost active 🚀",
          description: "Unlimited deals & quotations for the next month.",
          variant: "success" as any,
        });
      },
      onPendingVerification: () =>
        toast({
          title: "Verification pending",
          description: "Payment received — your Deal Boost will activate shortly.",
        }),
      onError: (message) =>
        toast({ title: "Payment failed", description: message, variant: "destructive" }),
    });

  return (
    <UpgradeModalContext.Provider value={{ openUpgradeModal }}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" data-testid="upgrade-modal">
          <DialogHeader>
            <div className="mx-auto w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center mb-2 shadow-lg shadow-violet-500/30">
              <Crown className="w-6 h-6 text-white" />
            </div>
            <DialogTitle className="text-center text-xl">
              Upgrade to Continue Closing Deals
            </DialogTitle>
            <DialogDescription className="text-center">
              {FEATURE_COPY[feature]} You've reached your free monthly limit or this
              feature requires a Pro subscription.
            </DialogDescription>
          </DialogHeader>

          <ul className="space-y-2 my-1">
            {PRO_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-sm">
                <div className="flex-shrink-0 w-5 h-5 rounded-full bg-violet-500/15 flex items-center justify-center mt-px">
                  <Check className="w-3 h-3 text-violet-600 dark:text-violet-400" strokeWidth={3} />
                </div>
                <span>{f}</span>
              </li>
            ))}
          </ul>

          <div className="space-y-2.5 mt-1">
            <Button
              className="w-full h-12 text-base font-bold rounded-xl text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 shadow-lg shadow-violet-500/30 relative"
              onClick={() => {
                setOpen(false);
                setLocation("/pricing");
              }}
              data-testid="upgrade-modal-pro"
            >
              <Crown className="w-4 h-4 mr-2" />
              Upgrade to Pro — ₹999/month
              <span className="absolute -top-2 right-3 px-1.5 py-0.5 rounded-full bg-amber-400 text-amber-950 text-[9px] font-black uppercase tracking-wide flex items-center gap-0.5">
                <Sparkles className="w-2.5 h-2.5" /> Recommended
              </span>
            </Button>

            {boostApplies ? (
              <Button
                variant="outline"
                className="w-full h-11 rounded-xl font-semibold"
                onClick={buyBoost}
                disabled={isLoading}
                data-testid="upgrade-modal-boost"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Rocket className="w-4 h-4 mr-2" />
                )}
                Deal Boost — ₹99: unlimited deals for 1 month
              </Button>
            ) : (
              <p className="text-[11px] text-center text-muted-foreground">
                The ₹99 Deal Boost covers deals &amp; quotations only — this feature
                needs Pro.
              </p>
            )}
          </div>

          <p className="text-[11px] text-center text-muted-foreground mt-1">
            One-time payments · no auto-debit · 7-day refund
          </p>
        </DialogContent>
      </Dialog>
    </UpgradeModalContext.Provider>
  );
}
