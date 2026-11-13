/**
 * The product's two modes, and the one thing that joins them.
 *
 *   "find"   Client Search: Client Radar, The Nest, and the leads it produces. This is the product.
 *   "suite"  The Deal Suite: deals, quotations, agreements, invoices. Free, and a part of the product, not the
 *            product itself.
 *
 * They are never mixed. A person reads one mode's numbers at a time, because adding a deal count to a reply rate
 * describes a funnel that does not exist: each side is usable without the other (13 Nov 2026, founder).
 *
 * LEADS IS THE BRIDGE, and the only one. It belongs to both modes and so is owned by neither: a lead is where
 * finding a client ends and where work you have won begins. Nothing else may cross — if a second connection ever
 * seems necessary, it is a sign the two sides are being merged again.
 *
 * Route ownership is read from NAV_ITEMS so there is one list of paths, not two that drift.
 */
import { NAV_ITEMS, type NavGroup } from "./nav-model";

export type WorkMode = "find" | "suite";
export const WORK_MODES: readonly WorkMode[] = ["find", "suite"];

/** Client Search is the default: a new or undecided account should land on the product, not on the paperwork. */
export const DEFAULT_WORK_MODE: WorkMode = "find";

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  find: "Client Search",
  suite: "Deal Suite",
};

export const WORK_MODE_HINTS: Record<WorkMode, string> = {
  find: "Research companies that fit, and the outreach you approve",
  suite: "Work you have already won: deals, quotations, agreements and invoices",
};

const MODE_OF_GROUP: Partial<Record<NavGroup, WorkMode>> = {
  league: "find",
  outbound: "find",
  pipeline: "suite",
  documents: "suite",
  money: "suite",
};

export const isWorkMode = (x: unknown): x is WorkMode => x === "find" || x === "suite";

/**
 * The mode a path belongs to, or null when it belongs to both or to neither — Leads (the bridge), the dashboard,
 * and the account pages. A null here means "don't change the person's mode because of where they are".
 */
export function modeForPath(path: string): WorkMode | null {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  const item = NAV_ITEMS.find((i) => i.key !== "leads" && i.isActive(path));
  return item ? MODE_OF_GROUP[item.group] ?? null : null;
}

/**
 * Which mode to show: where the person is, if that says; otherwise what they last chose; otherwise the default.
 * Pure so the precedence is tested rather than tangled into a component.
 */
export function resolveWorkMode(path: string, remembered: unknown): WorkMode {
  return modeForPath(path) ?? (isWorkMode(remembered) ? remembered : DEFAULT_WORK_MODE);
}
