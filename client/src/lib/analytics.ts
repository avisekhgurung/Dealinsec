/**
 * Google Analytics (GA4) helpers.
 *
 * The gtag script + config is loaded once in `client/index.html`. We disable
 * the automatic first page_view there and fire all page_view events from React
 * instead, so SPA route changes are tracked accurately (one event per route).
 */

export const GA_MEASUREMENT_ID = "G-W3VTLRH79B";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

// Map a route to a GENERIC, privacy-safe page title. Some pages set
// `document.title` to a client- and invoice-specific string (e.g.
// "Invoice_Nykaa_BINV-123") so the browser's print/PDF filename is useful —
// but that string must never reach Google Analytics. We derive the GA title
// from the route shape alone, so no customer name or document number leaks.
function routeTitle(path: string): string {
  const rules: [RegExp, string][] = [
    [/^\/$/, "Home"],
    [/^\/dashboard/, "Dashboard"],
    [/^\/deals\/new/, "Create Deal"],
    [/^\/deals\/[^/]+\/quote/, "Quotation"],
    [/^\/deals\/[^/]+\/edit/, "Edit Deal"],
    [/^\/deals\/[^/]+\/contract/, "Create Agreement"],
    [/^\/deals\/[^/]+$/, "Deal Details"],
    [/^\/deals/, "Deals"],
    [/^\/contracts\/[^/]+\/export/, "Agreement PDF"],
    [/^\/contracts\/[^/]+$/, "Agreement Details"],
    [/^\/contracts/, "Agreements"],
    [/^\/invoices\/success/, "Payment Success"],
    [/^\/invoices\/[^/]+$/, "Invoice Details"],
    [/^\/invoices/, "Invoices"],
    [/^\/brand-invoices\/[^/]+$/, "Client Invoice"],
    [/^\/pricing/, "Pricing"],
    [/^\/profile/, "Profile"],
    [/^\/onboarding/, "Onboarding"],
    [/^\/pitch/, "Pitch"],
    [/^\/terms/, "Terms"],
    [/^\/privacy/, "Privacy"],
    [/^\/cookies/, "Cookies"],
    [/^\/refund/, "Refund Policy"],
  ];
  for (const [re, title] of rules) if (re.test(path)) return `DealInSec — ${title}`;
  return "DealInSec";
}

/** Fire a `page_view` for the given SPA path. */
export function trackPageView(path: string): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  // page_path is a route pattern with no ids; page_title is route-derived.
  // Neither carries a client name or document number.
  window.gtag("event", "page_view", {
    page_path: path,
    page_location: `${window.location.origin}${path}`,
    page_title: routeTitle(path),
    send_to: GA_MEASUREMENT_ID,
  });
}

/** Fire a custom GA4 event (e.g. trackEvent("create_deal", { dealType: "Creator" })). */
export function trackEvent(name: string, params?: Record<string, unknown>): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  window.gtag("event", name, params);
}
