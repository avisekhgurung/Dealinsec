/**
 * Signed-in navigation model — the one list both bars read.
 *
 * TWO SIDES, DELIBERATELY APART (13 Nov 2026). Finding clients is the product and owns the bar: Home · The Nest
 * (Nibo, Mika, Zee) · Client Radar · Leads. The Deal Suite — Deals, Quotations, Agreements, Invoices — is a free
 * part of the product, not the product, and lives behind one menu of its own (DEAL_SUITE_GROUPS). Leads belongs to
 * the finding side and must never share a group with Deals: a reader who sees them together reads one funnel, and
 * the point of the split is that these are two things a person can use without the other.
 *
 * Account (Profile, Settings) sits outside both: on desktop in the bar's right-hand controls, on mobile in "More".
 *
 * Pure on purpose (no React, no icons) so the active-route rules and the
 * permission filtering are unit-tested; client/src/lib/nav.ts maps keys to
 * icons. Hiding an item is navigation, not authorisation — see
 * MODULE_PERMISSIONS in ./permissions.
 */
import { canSeeModule } from "./permissions";
import { DEAL_SUITE_HIDDEN } from "./flags";

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
  league: "The Nest",
  outbound: "Finding clients",
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
  def({ key: "league", label: "The Nest 🪺", shortLabel: "The Nest", href: "/ai-league", group: "league", module: "deals" }),
  def({ key: "outbound", label: "Client Radar 🔎", shortLabel: "Radar", href: "/outbound", group: "outbound", module: "deals" }),
  def({ key: "leads", label: "Leads", shortLabel: "Leads", href: "/leads", group: "outbound", module: "deals" }),
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

/** Mobile bar: four daily destinations, then "More" for the rest. Radar comes right after Home on phones (founder,
 *  12 Nov 2026): finding clients is what people open the app for. The Nest (Nibo, Mika, Zee) is in the bar itself;
 *  Deals moved into More, next to the documents and money it leads to. The desktop bar keeps its own order. */
export const MOBILE_BAR_KEYS: readonly NavKey[] = ["home", "outbound", "league", "leads"];
export function mobileBarItems(user: NavUser): NavItem[] {
  return MOBILE_BAR_KEYS.map(navItem).filter((i) => canSeeNavItem(user, i));
}

/** Desktop bar: finding clients IS the product (shared/flags.ts), so the bar holds the finding tabs. While the deal
 *  suite is hidden there is nothing behind them; with the suite visible, Deals, documents and money sit behind
 *  "Workspace" in the same segment (Profile and Settings are the bar's own account controls on the right). */
export const DESKTOP_BAR_KEYS: readonly NavKey[] = ["home", "league", "outbound", "leads"];
export function desktopBarItems(user: NavUser): NavItem[] {
  return DESKTOP_BAR_KEYS.map(navItem).filter((i) => canSeeNavItem(user, i));
}
/** The Deal Suite: the free, self-contained win-and-bill side. Nothing from the finding side belongs in here. */
export const DEAL_SUITE_GROUPS: readonly NavGroup[] = ["pipeline", "documents", "money"];
/** What the menu holding it is called, in both bars. One name, so the two sides read as two things. */
export const DEAL_SUITE_LABEL = "Deal Suite";
export const DESKTOP_MORE_GROUPS: readonly NavGroup[] = DEAL_SUITE_HIDDEN ? [] : DEAL_SUITE_GROUPS;
/** The Deal Suite menu. Pipeline shows only Deals here — Leads is a finding tab and is filtered out below. */
export function desktopMoreSections(user: NavUser): NavSection[] {
  return sections(user, DESKTOP_MORE_GROUPS)
    .map((s) => ({ ...s, items: s.items.filter((i) => !DESKTOP_BAR_KEYS.includes(i.key)) }))
    .filter((s) => s.items.length > 0);
}
/** The Workspace item behind which the current page sits on desktop, if any (so the menu can show its name and light up). */
export function desktopMoreActive(path: string): NavItem | null {
  return NAV_ITEMS.find((i) => DESKTOP_MORE_GROUPS.includes(i.group) && !DESKTOP_BAR_KEYS.includes(i.key) && i.isActive(path)) ?? null;
}

export const MORE_GROUPS: readonly NavGroup[] = DEAL_SUITE_HIDDEN ? ["account"] : [...DEAL_SUITE_GROUPS, "account"];
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
