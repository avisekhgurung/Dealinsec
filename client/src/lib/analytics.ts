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

/** Fire a `page_view` for the given SPA path. */
export function trackPageView(path: string): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  window.gtag("event", "page_view", {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title,
    send_to: GA_MEASUREMENT_ID,
  });
}

/** Fire a custom GA4 event (e.g. trackEvent("create_deal", { dealType: "Creator" })). */
export function trackEvent(name: string, params?: Record<string, unknown>): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  window.gtag("event", name, params);
}
