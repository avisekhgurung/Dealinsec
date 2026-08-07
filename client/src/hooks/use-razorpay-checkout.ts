/**
 * Shared Razorpay Checkout flow: load script → create order → open Checkout →
 * verify on our server → invalidate user/credit queries.
 *
 * Used by the pricing page and the UpgradeModal. One-time payments only
 * (pro_monthly / pro_yearly / deal_boost — non-auto-renewing terms).
 */
import { useState, useCallback } from "react";
import { queryClient } from "@/lib/queryClient";
import { trackEvent } from "@/lib/analytics";

const RAZORPAY_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

declare global {
  interface Window {
    Razorpay?: any;
  }
}

// Lazily inject the Razorpay Checkout script once.
function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const existing = document.querySelector(`script[src="${RAZORPAY_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(true));
      existing.addEventListener("error", () => resolve(false));
      return;
    }
    const script = document.createElement("script");
    script.src = RAZORPAY_SCRIPT;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export type CheckoutPlan = "pro_monthly" | "pro_yearly" | "deal_boost";

export interface CheckoutCallbacks {
  onSuccess?: () => void;
  /** Payment failed or couldn't start — message is user-presentable. */
  onError?: (message: string) => void;
  /** Payment captured but our verify call failed — grant lands via webhook. */
  onPendingVerification?: () => void;
  /** User closed the Razorpay modal without paying. */
  onDismiss?: () => void;
}

export function useRazorpayCheckout() {
  const [isLoading, setIsLoading] = useState(false);
  const [activePlan, setActivePlan] = useState<CheckoutPlan | null>(null);

  const checkout = useCallback(async (plan: CheckoutPlan, cbs: CheckoutCallbacks = {}) => {
    setActivePlan(plan);
    setIsLoading(true);
    try {
      const ok = await loadRazorpayScript();
      if (!ok || !window.Razorpay) {
        throw new Error("Could not load payment gateway. Check your connection and retry.");
      }

      const res = await fetch("/api/payments/razorpay/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || error.error || "Failed to initiate payment");
      }
      const order = await res.json();

      const rzp = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: order.name,
        description: order.description,
        image: "/icon-192.png",
        prefill: order.prefill,
        theme: { color: "#0E8C5A" },
        handler: async (response: any) => {
          try {
            const verifyRes = await fetch("/api/payments/razorpay/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });
            if (!verifyRes.ok) throw new Error("Verification failed");

            // GA4 ecommerce purchase — key conversion event.
            trackEvent("purchase", {
              currency: "INR",
              value: order.amount / 100,
              item: plan,
            });

            await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
            await queryClient.invalidateQueries({ queryKey: ["/api/credits/balance"] });
            cbs.onSuccess?.();
          } catch {
            cbs.onPendingVerification?.();
          } finally {
            setIsLoading(false);
          }
        },
        modal: {
          ondismiss: () => {
            setIsLoading(false);
            cbs.onDismiss?.();
          },
        },
      });

      rzp.on("payment.failed", (resp: any) => {
        setIsLoading(false);
        cbs.onError?.(
          resp?.error?.description ||
            "Your payment couldn't be processed. No money was deducted — please try again.",
        );
      });

      rzp.open();
    } catch (error: any) {
      setIsLoading(false);
      cbs.onError?.(error.message || "Could not start the payment. Please try again.");
    }
  }, []);

  return { checkout, isLoading, activePlan };
}
