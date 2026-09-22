/**
 * The one product-led-growth surface in the app: a subtle line under every
 * public, no-account document (quotation, agreement). Not a banner, not a
 * popup — a client who scrolls past a real quotation should notice DealInSec
 * exists and, if curious, land on the product themselves. Opens in a new tab
 * so it never navigates the client away from the document they're reading.
 */
import { Sparkles } from "lucide-react";

export function PublicDocFooter() {
  return (
    <p className="flex items-center justify-center gap-1.5 text-xs text-neutral-400 mt-6">
      <Sparkles className="w-3.5 h-3.5" />
      Created with DealInSec
      <a
        href="/?ref=doc_footer"
        target="_blank"
        rel="noopener noreferrer"
        data-testid="link-public-doc-cta"
        className="font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 underline underline-offset-2"
      >
        Create yours →
      </a>
    </p>
  );
}
