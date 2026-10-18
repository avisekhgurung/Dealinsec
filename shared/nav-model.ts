/**
 * Signed-in navigation model — the one list both bars read.
 *
 * The product has six areas, in workflow order: Home · AI League (Nibo, Mika, Zee) · AI Outbound ·
 * Pipeline (Leads, Deals) · Documents (Quotations, Agreements) · Money
 * (Invoices — payment status is tracked inside invoices). Account (Profile,
 * Settings) sits outside the five: on desktop it lives in the bar's right-hand
 * controls, on mobile in the "More" sheet.
 *
 * Pure on purpose (no React, no icons) so the active-route rules and the
 * permission filtering are unit-tested; client/src/lib/nav.ts maps keys to
 * icons. Hiding an item is navigation, not authorisation — see
 * MODULE_PERMISSIONS in ./permissions.
 */
import { canSeeModule } from "./permissions";

export type NavGroup = "home" | "league" | "outbound" | "pipeline" | "documents" | "money" | "account";
export type NavModule = "deals" | "quotations" | "agreements" | "invoices";
export type NavKey =
  | "home" | "league" | "outbound" | "leads" | "deals" | "quotations" | "agreements" | "invoices" | "profile" | "settings";

export interface NavItem {
  key: NavKey;
  label: string;
  /** Mobile bar (and the tight lg desktop bar) label. */
  shortLabel: string;
  href: string;
  group: NavGroup;
  /** Module key — hidden for custom roles with no permission in it. */
  module?: NavModule;
  isActive: (path: string) => boolean;
}

type NavUser = Parameters<typeof canSeeModule>[0];

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  home: "Home",
  league: "AI League",
  outbound: "AI Outbound",
  pipeline: "Pipeline",
  documents: "Documents",
  money: "Money",
  account: "Account",
};

/**
 * Routes that live under one section's URL but BELONG to another. Checked
 * before the prefix rule, and exclusive: the owner is the only item lit.
 */
function routeOwner(path: string): NavKey | null {
  // Quotation documents live at /deals/:id/quote but BELONG to Quotations.
  if (/^\/deals\/[^/]+\/quote/.test(path)) return "quotations";
  // Invoice documents and the composer live under /brand-invoices.
  if (path.startsWith("/brand-invoices")) return "invoices";
  return null;
}

/** Is `path` inside this section? An item is lit on its own route and every
 *  route below it (/deals/:id, /contracts/:id/export, /leads/:id …). */
export function isNavItemActive(item: Pick<NavItem, "key" | "href">, path: string): boolean {
  const owner = routeOwner(path);
  if (owner) return owner === item.key;
  return path === item.href || path.startsWith(item.href + "/");
}

const def = (item: Omit<NavItem, "isActive">): NavItem => ({
  ...item,
  isActive: (path) => isNavItemActive(item, path),
});

/** Every signed-in destination, in workflow order. */
export const NAV_ITEMS: readonly NavItem[] = [
  def({ key: "home", label: "Home", shortLabel: "Home", href: "/dashboard", group: "home" }),
  def({ key: "league", label: "AI League", shortLabel: "AI League", href: "/ai-league", group: "league", module: "deals" }),
  def({ key: "outbound", label: "AI Outbound", shortLabel: "Outbound", href: "/outbound", group: "outbound", module: "deals" }),
  def({ key: "leads", label: "Leads", shortLabel: "Leads", href: "/leads", group: "pipeline", module: "deals" }),
  def({ key: "deals", label: "Deals", shortLabel: "Deals", href: "/deals", group: "pipeline", module: "deals" }),
  def({ key: "quotations", label: "Quotations", shortLabel: "Quotes", href: "/quotations", group: "documents", module: "quotations" }),
  def({ key: "agreements", label: "Agreements", shortLabel: "Agreements", href: "/contracts", group: "documents", module: "agreements" }),
  def({ key: "invoices", label: "Invoices", shortLabel: "Invoices", href: "/invoices", group: "money", module: "invoices" }),
  def({ key: "profile", label: "Profile", shortLabel: "Profile", href: "/profile", group: "account" }),
  def({ key: "settings", label: "Settings", shortLabel: "Settings", href: "/settings", group: "account" }),
];

export function navItem(key: NavKey): NavItem {
  return NAV_ITEMS.find((i) => i.key === key)!;
}

/** Same rule both bars always used: ungated items always show; gated ones
 *  follow canSeeModule (which hides them while the user is still unknown). */
export function canSeeNavItem(user: NavUser, item: Pick<NavItem, "module">): boolean {
  return !item.module || canSeeModule(user, item.module);
}

export interface NavSection {
  group: NavGroup;
  label: string;
  items: NavItem[];
}

function sections(user: NavUser, groups: readonly NavGroup[]): NavSection[] {
  return groups
    .map((group) => ({
      group,
      label: NAV_GROUP_LABELS[group],
      items: NAV_ITEMS.filter((i) => i.group === group && canSeeNavItem(user, i)),
    }))
    // A group a custom role can't see anything in loses its heading too.
    .filter((s) => s.items.length > 0);
}

/** Desktop tabs: the five areas, one click each. Account stays on the right. */
export const DESKTOP_GROUPS: readonly NavGroup[] = ["home", "league", "outbound", "pipeline", "documents", "money"];
export function desktopNavSections(user: NavUser): NavSection[] {
  return sections(user, DESKTOP_GROUPS);
}

/** Mobile bar: four daily destinations, then "More" for the rest. AI League (Nibo, Mika, Zee) is in the bar itself;
 *  Deals moved into More, next to the documents and money it leads to. */
export const MOBILE_BAR_KEYS: readonly NavKey[] = ["home", "league", "outbound", "leads"];
export function mobileBarItems(user: NavUser): NavItem[] {
  return MOBILE_BAR_KEYS.map(navItem).filter((i) => canSeeNavItem(user, i));
}

export const MORE_GROUPS: readonly NavGroup[] = ["pipeline", "documents", "money", "account"];
/** The More sheet: everything not already in the bar (Pipeline shows Deals; Leads is in the bar). */
export function moreSheetSections(user: NavUser): NavSection[] {
  return sections(user, MORE_GROUPS)
    .map((s) => ({ ...s, items: s.items.filter((i) => !MOBILE_BAR_KEYS.includes(i.key)) }))
    .filter((s) => s.items.length > 0);
}

/** "More" is lit when the current route belongs to anything inside it —
 *  regardless of gating, so a deep link never leaves the bar with nothing lit
 *  for a reason the user can't see. A page whose tab is in the bar lights that tab, not More. */
export function isMoreActive(path: string): boolean {
  return NAV_ITEMS.some((i) => MORE_GROUPS.includes(i.group) && !MOBILE_BAR_KEYS.includes(i.key) && i.isActive(path));
}
