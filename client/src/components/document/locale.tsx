/**
 * The locale a document is printing in, carried down the document tree.
 *
 * `TotalBlock` and friends render deep inside PagedDocument's pagination, far
 * from the page that knows whose deal this is, so the currency has to reach
 * them somehow. It travels as context rather than as a module-level global for
 * one reason: a global is shared between every document open in the tab, and
 * the moment two documents belong to different organizations, the second one
 * prints the first one's currency. Context is per-document by construction.
 *
 * PagedDocument requires the settings as a prop and provides them here, so
 * there is no way to render a document without stating its locale, and no
 * default to fall back to silently.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { LocaleSettings } from "@shared/schema";
import { makeFormatters, type Formatters } from "@/lib/format";

const DocLocaleContext = createContext<Formatters | null>(null);

export function DocLocaleProvider({
  settings,
  children,
}: {
  settings: LocaleSettings;
  children: ReactNode;
}) {
  // Keyed on the values, not the object: the pages rebuild the settings object
  // on every render, and re-deriving formatters would rebuild every cached
  // Intl instance behind them on every keystroke of a live preview.
  const value = useMemo(
    () => makeFormatters(settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.country, settings.currency, settings.locale, settings.timezone],
  );
  return <DocLocaleContext.Provider value={value}>{children}</DocLocaleContext.Provider>;
}

/**
 * The current document's formatters. Throws outside a document.
 *
 * Failing loudly is the deliberate choice, and the same one the boot migration
 * made: the alternative is defaulting to India, which means a component used
 * outside a provider prints ₹ on a document bound for a client who is paying
 * in dollars. A blank screen in development is a bug report; a rupee glyph on
 * a $12,000 invoice is a dispute with someone's client.
 */
export function useDocFormat(): Formatters {
  const f = useContext(DocLocaleContext);
  if (!f) {
    throw new Error(
      "useDocFormat() outside a document — render this inside <PagedDocument locale={…}> " +
        "or wrap it in <DocLocaleProvider settings={…}>.",
    );
  }
  return f;
}
