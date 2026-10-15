/**
 * The SPA's cookie banner (option a): shown while there is no choice, reopened from "Cookie settings". Two equal
 * buttons, nothing pre-selected, not a modal (the page stays usable). Accepting loads Google Analytics and records
 * the current page; declining (or withdrawing later) keeps it off and deletes its cookies. See shared/consent-script.ts.
 */
import { useEffect, useRef, useState } from "react";
import { trackPageView } from "@/lib/analytics";
import { consentChoice, OPEN_CONSENT_EVENT, setConsent, type ConsentChoice } from "@/lib/consent";

export function CookieBanner() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<ConsentChoice | null>(null);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // No consent script (blocked or old page) means no banner: analytics can't load without it either.
    if (typeof window === "undefined" || !window.disConsent) return;
    const c = consentChoice();
    setCurrent(c);
    if (c === null) setOpen(true);
    const reopen = () => { setCurrent(consentChoice()); setOpen(true); setTimeout(() => first.current?.focus(), 0); };
    window.addEventListener(OPEN_CONSENT_EVENT, reopen);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, reopen);
  }, []);

  useEffect(() => {
    if (!open || current === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, current]);

  if (!open) return null;
  const choose = (c: ConsentChoice) => {
    setConsent(c);
    setCurrent(c);
    setOpen(false);
    if (c === "granted") trackPageView(window.location.pathname);
  };
  return (
    <div role="region" aria-label="Cookie choices" data-testid="cookie-banner"
      className="fixed inset-x-3 bottom-[5.5rem] z-[60] mx-auto max-w-xl rounded-2xl border border-neutral-700 bg-neutral-900 p-4 text-sm text-neutral-50 shadow-2xl lg:bottom-5">
      <p className="leading-relaxed">
        We'd like to use Google Analytics to understand how DealInSec is used. It sets cookies, and it stays off unless you accept.{" "}
        <a href="/cookies" className="font-semibold text-emerald-300 underline-offset-2 hover:underline">Cookie policy</a>
      </p>
      {current && <p className="mt-1 text-xs text-neutral-400" data-testid="cookie-current">Your current choice: analytics {current === "granted" ? "allowed" : "off"}.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button ref={first} type="button" onClick={() => choose("granted")} data-testid="cookie-accept"
          className="min-h-[44px] flex-1 rounded-xl bg-emerald-500 px-4 font-semibold text-emerald-950 hover:bg-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300">
          Accept analytics
        </button>
        <button type="button" onClick={() => choose("denied")} data-testid="cookie-decline"
          className="min-h-[44px] flex-1 rounded-xl border border-neutral-500 px-4 font-semibold text-neutral-50 hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300">
          Decline
        </button>
      </div>
    </div>
  );
}
