/**
 * Buying extra Client Radar searches or AI drafts. Packs, prices and expiry come from the server's credit_packs rows
 * (GET /api/credits/packs): nothing here knows a quantity or a price. Payment is the same one-time Razorpay checkout as
 * the plan (no renewal); credits are added only after the server has confirmed the payment, never from this page.
 *
 *   <TopUpPacks kind="search" />      the pack cards (used in the dialog and on the wallet)
 *   <TopUpPrompt kind="draft" />      a small "Buy extra AI drafts" button that opens them
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useRazorpayCheckout } from "@/hooks/use-razorpay-checkout";
import { formatRupees, usePlanCheckoutAvailable } from "@/hooks/use-plan-prices";
import { memberCan } from "@shared/permissions";
import { PACKS_URL, refreshCreditViews } from "@/lib/credit-keys";
import { creditNoun, type CreditKind } from "@/lib/credits";

export interface Pack { id: number; kind: CreditKind; units: number; priceRupees: number; expiryMonths: number | null; label: string; expiry: string }

const eachPrice = (p: Pack) => { const e = p.priceRupees / p.units; return e >= 10 ? Math.round(e) : Math.round(e * 10) / 10; };

export function TopUpPacks({ kind, onPurchased }: { kind: CreditKind; onPurchased?: () => void }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const checkoutAvailable = usePlanCheckoutAvailable();
  const { data: config } = useQuery<{ razorpayEnabled?: boolean }>({ queryKey: ["/api/payments/config"], staleTime: 10 * 60 * 1000 });
  const { data, isLoading, isError } = useQuery<{ packs: Pack[] }>({ queryKey: [PACKS_URL], staleTime: 60_000 });
  const { checkout } = useRazorpayCheckout();
  const [buying, setBuying] = useState<number | null>(null);
  const packs = (data?.packs ?? []).filter((p) => p.kind === kind);
  const canBuy = !!user && memberCan(user as any, "billing.manage");
  const noun = kind === "search" ? "Client Radar searches" : "AI drafts";

  if (isLoading) return <p className="text-sm text-muted-foreground" data-testid="topup-loading"><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />Loading packs…</p>;
  if (isError || !packs.length) return <p className="text-sm text-muted-foreground" data-testid="topup-none">Extra {noun} aren&apos;t on sale right now. Your allowance frees up as earlier uses pass 30 days.</p>;

  const buy = (p: Pack) => {
    setBuying(p.id);
    checkout("credit_pack", {
      onSuccess: () => {
        setBuying(null);
        toast({ title: "Credits added", description: `${p.units} ${creditNoun(kind, p.units)} are ready to use.`, variant: "success" as any });
        void refreshCreditViews();
        onPurchased?.();
      },
      onPendingVerification: () => {
        setBuying(null);
        toast({ title: "Payment received", description: "We're confirming it with Razorpay. Your credits appear automatically within a few minutes." });
        // The webhook grants it; look again a couple of times rather than asking the person to refresh.
        for (const ms of [4000, 12000, 30000]) setTimeout(() => void refreshCreditViews(), ms);
      },
      onError: (message) => { setBuying(null); toast({ title: "Payment didn't go through", description: message, variant: "destructive" }); },
      onDismiss: () => setBuying(null),
    }, { packId: p.id });
  };

  return (
    <div className="space-y-3" data-testid={`topup-${kind}`}>
      <div className="grid gap-2 sm:grid-cols-2">
        {packs.map((p) => (
          <div key={p.id} className="flex flex-col justify-between rounded-xl border border-border/60 p-3" data-testid={`pack-${p.id}`}>
            <div>
              <p className="text-base font-bold">{p.units} {creditNoun(kind, p.units)}</p>
              <p className="text-xs text-muted-foreground">{formatRupees(p.priceRupees)} one-time · about {formatRupees(eachPrice(p))} each</p>
            </div>
            {canBuy && checkoutAvailable && config?.razorpayEnabled !== false && (
              <Button size="sm" className="mt-2 gradient-btn text-white" disabled={buying !== null} onClick={() => buy(p)} data-testid={`button-buy-pack-${p.id}`}>
                {buying === p.id ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Opening…</> : <>Buy for {formatRupees(p.priceRupees)}</>}
              </Button>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground" data-testid="topup-expiry">
        {packs[0].expiry} One-time payment: nothing renews. Credits are used after your plan&apos;s own {kind === "search" ? "searches" : "drafts"}, and stay yours if your plan ends.
      </p>
      {!checkoutAvailable ? (
        <p className="text-xs text-amber-800 dark:text-amber-300">Extra credits can&apos;t be bought from outside India yet.</p>
      ) : !canBuy ? (
        <p className="text-xs text-muted-foreground">Only the workspace owner can buy credits. Ask them, or wait: your allowance frees up as earlier uses pass 30 days.</p>
      ) : config?.razorpayEnabled === false ? (
        <p className="text-xs text-amber-800 dark:text-amber-300">Payments aren&apos;t switched on yet.</p>
      ) : null}
      <p className="text-xs"><Link href="/wallet#boosters" className="font-semibold text-primary hover:underline" data-testid="topup-wallet-link">Your credits and history</Link></p>
    </div>
  );
}

/** A small button beside a blocked or nearly-used feature that opens the packs for it. */
export function TopUpPrompt({ kind, label }: { kind: CreditKind; label?: string }) {
  const [open, setOpen] = useState(false);
  const noun = kind === "search" ? "Client Radar searches" : "AI drafts";
  return (
    <>
      <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => setOpen(true)} data-testid={`button-topup-${kind}`}>
        <ShoppingCart className="h-3 w-3" aria-hidden />{label ?? `Booster: extra ${noun}`}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Booster pack: extra {noun}</DialogTitle>
            <DialogDescription>Only this feature needs credits: everything else, and all your saved leads, research and drafts, keeps working.</DialogDescription>
          </DialogHeader>
          <TopUpPacks kind={kind} onPurchased={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
