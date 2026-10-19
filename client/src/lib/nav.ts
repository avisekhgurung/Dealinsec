/**
 * Icons for the signed-in nav. The items themselves, their order, groups,
 * permission gating and active-route rules live in @shared/nav-model so they
 * stay unit-tested; this file only adds what React needs.
 */
import {
  Home,
  Radar,
  Target,
  Briefcase,
  FileText,
  FileCheck,
  Receipt,
  UserCircle,
  Settings,
  Bird,
  type LucideIcon,
} from "lucide-react";
import type { NavKey } from "@shared/nav-model";

export const NAV_ICONS: Record<NavKey, LucideIcon> = {
  home: Home,
  league: Bird,
  outbound: Radar,
  leads: Target,
  deals: Briefcase,
  quotations: FileText,
  agreements: FileCheck,
  invoices: Receipt,
  profile: UserCircle,
  settings: Settings,
};

export {
  NAV_ITEMS, NAV_GROUP_LABELS, navItem, canSeeNavItem, desktopNavSections, mobileBarItems, moreSheetSections, isMoreActive,
  type NavItem, type NavKey, type NavGroup, type NavSection,
} from "@shared/nav-model";
