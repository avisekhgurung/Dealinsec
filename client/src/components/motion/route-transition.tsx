/**
 * The page transition: a short fade as a new screen arrives. Keyed by the route's SHAPE (shared/analyticsPath:
 * /deals/:id), so moving between two records of the same kind, or changing a query string, never remounts the page
 * or refetches its data. Enter only, no exit: the next page never waits for the last one to leave.
 *
 * A CSS animation (`.dis-route-in` in index.css), deliberately not a JS one: it wraps every screen, so it must finish
 * even where the browser runs no animation frames (a background tab, a non-painting preview), never leaving a page
 * invisible. Opacity only: a transform would make position:fixed elements inside a page lay out against this wrapper.
 * Reduced motion and print/full-bleed views get no fade.
 */
import type { ReactNode } from "react";
import { analyticsPath } from "@shared/analyticsPath";

export function RouteTransition({ location, disabled, children }: { location: string; disabled?: boolean; children: ReactNode }) {
  if (disabled) return <>{children}</>;
  return <div key={analyticsPath(location)} className="dis-route-in" data-testid="route-transition">{children}</div>;
}
