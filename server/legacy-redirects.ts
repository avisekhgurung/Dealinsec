/**
 * Permanent redirects for public pages retired in the freelancer-only pivot
 * (2026-09-12).
 *
 * These URLs may already be indexed by Google or linked from elsewhere, so
 * each one 301s to its closest surviving page instead of 404ing — the search
 * equity moves with it rather than being thrown away.
 *
 * Registered BEFORE the tool/blog/category pages and the SPA catch-all, so a
 * retired path can never fall through to a param route or the app shell. The
 * paths also stay in vite.config.ts navigateFallbackDenylist: the service
 * worker must never answer them with the SPA shell, or the redirect would
 * never reach the server.
 */
import type { Express } from "express";

// Profession invoice-format pages removed because they target businesses,
// not freelancers. All land on the general freelancer invoice format.
const REMOVED_PROFESSIONS = [
  "digital-marketing-agencies",
  "interior-designers",
  "architects",
  "real-estate-agents",
  "construction-contractors",
  "tour-operators",
  "caterers",
];

export const LEGACY_REDIRECTS: Record<string, string> = {
  "/interior-design-software": "/freelancer-invoice-software",
  "/blog/ra-bill-format": "/blog",
  ...Object.fromEntries(
    REMOVED_PROFESSIONS.map((slug) => [
      `/tools/invoice-format/for-${slug}`,
      "/tools/invoice-format/for-freelancers",
    ]),
  ),
};

export function registerLegacyRedirects(app: Express) {
  for (const [from, to] of Object.entries(LEGACY_REDIRECTS)) {
    app.get(from, (req, res) => {
      // Carry the query string across so UTM tags survive the hop.
      const q = req.originalUrl.indexOf("?");
      res.redirect(301, q === -1 ? to : to + req.originalUrl.slice(q));
    });
  }
}
