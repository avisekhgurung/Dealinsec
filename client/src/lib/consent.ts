/**
 * The visitor's analytics choice, read through window.disConsent (defined by the consent script in index.html,
 * shared/consent-script.ts). Option a: Google Analytics loads only after "granted". If the script didn't run
 * (blocked, or an old cached page), everything here reads as "no choice" and nothing is tracked.
 */
export type ConsentChoice = "granted" | "denied";

declare global {
  interface Window {
    disConsent?: { get: () => ConsentChoice | null; set: (a: ConsentChoice) => void; load: () => void };
  }
}

export const OPEN_CONSENT_EVENT = "dis:open-consent";

export function consentChoice(): ConsentChoice | null {
  try { return typeof window !== "undefined" && window.disConsent ? window.disConsent.get() : null; } catch { return null; }
}
export const analyticsAllowed = (): boolean => consentChoice() === "granted";
export function setConsent(choice: ConsentChoice): void {
  try { window.disConsent?.set(choice); } catch { /* the banner just closes */ }
}
/** Reopens the cookie banner (Settings, footer, cookie policy). */
export function openConsentSettings(): void {
  try { window.dispatchEvent(new Event(OPEN_CONSENT_EVENT)); } catch { /* old browsers: nothing to reopen */ }
}
