/**
 * The one product-led-growth surface in the app: a subtle line under every
 * public, no-account document (quotation, agreement). Not a banner, not a
 * popup — a client who scrolls past a real quotation should notice DealInSec
 * exists and, if curious, land on the product themselves. Opens in a new tab
 * so it never navigates the client away from the document they're reading.
 */
import { Sparkles } from "lucide-react";
import { trackEvent } from "@/lib/analytics";

export function PublicDocFooter() {
  return (
    <div className="mt-6 space-y-1.5">
      <p className="flex items-center justify-center gap-1.5 text-xs text-neutral-400">
        <Sparkles className="w-3.5 h-3.5" />
        Created with DealInSec
        <a
          href="/?ref=doc_footer"
          target="_blank"
          rel="noopener noreferrer"
          data-testid="link-public-doc-cta"
          onClick={() => trackEvent("plg_footer_click")}
          className="font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 underline underline-offset-2"
        >
          Create yours →
        </a>
      </p>
      {/* This page reads a name, an email when given, and (for a signed
          agreement) an IP address and signature — say where that's covered,
          without asserting more about it than the policy itself does. */}
      <p className="text-center text-[11px] text-neutral-400">
        See how this information is handled in our{" "}
        <a
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          data-testid="link-public-doc-privacy"
          className="underline underline-offset-2 hover:text-neutral-500"
        >
          privacy policy
        </a>
        .
      </p>
    </div>
  );
}
