/**
 * Observable website signals from a company's own home page: what its markup shows, stated as an observation with its
 * source and date, never as proof that the company needs a new website or intends to buy one. Deterministic: no model.
 *
 *   no_viewport     the home page has no mobile viewport tag (often a sign the layout wasn't built for phones; not proof)
 *   old_copyright   the latest year in its copyright notice is at least OLD_COPYRIGHT_YEARS behind (a hint the site
 *                   may not have been updated recently; many current sites never change that line)
 *
 * Not observed, and so never claimed: whether the site uses HTTPS (the reader only fetches over HTTPS, so a plain-HTTP
 * site shows as unreachable), page speed, accessibility or design quality.
 */
export const OLD_COPYRIGHT_YEARS = 3;
export type SiteSignalKind = "no_viewport" | "old_copyright";
export interface SiteSignal { signal: SiteSignalKind; value: string; year?: number; quote?: string | null }

export function siteSignals(markup: { viewport: boolean; copyrightYear: number | null; copyrightText?: string | null } | undefined, now: Date): SiteSignal[] {
  if (!markup) return [];
  const out: SiteSignal[] = [];
  if (!markup.viewport) out.push({ signal: "no_viewport", value: "The home page has no mobile viewport tag" });
  const y = markup.copyrightYear;
  if (y !== null && now.getUTCFullYear() - y >= OLD_COPYRIGHT_YEARS) out.push({ signal: "old_copyright", value: `The home page's copyright notice reads ${y}`, year: y, quote: markup.copyrightText ?? null });
  return out;
}

/** How the app labels them: an observation, with what it may and may not mean. */
export const SITE_SIGNAL_NOTE = "Observed on their home page. A hint worth checking, not proof they need a new website.";
