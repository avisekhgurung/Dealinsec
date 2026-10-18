import { describe, expect, it } from "vitest";
import {
  NAV_ITEMS, desktopNavSections, isMoreActive, isNavItemActive, mobileBarItems, moreSheetSections, navItem,
  type NavKey,
} from "./nav-model";

/** The keys lit for a route — at most one, except none at all. */
const lit = (path: string): NavKey[] => NAV_ITEMS.filter((i) => i.isActive(path)).map((i) => i.key);

const OWNER = { orgRole: "OWNER", customPermissions: null };
const custom = (...perms: string[]) => ({ orgRole: "CUSTOM", customPermissions: perms });
const keys = (items: { key: NavKey }[]) => items.map((i) => i.key);

describe("active route", () => {
  it("lights each section on its own route", () => {
    expect(lit("/dashboard")).toEqual(["home"]);
    expect(lit("/outbound")).toEqual(["outbound"]);
    expect(lit("/leads")).toEqual(["leads"]);
    expect(lit("/deals")).toEqual(["deals"]);
    expect(lit("/quotations")).toEqual(["quotations"]);
    expect(lit("/contracts")).toEqual(["agreements"]);
    expect(lit("/invoices")).toEqual(["invoices"]);
    expect(lit("/profile")).toEqual(["profile"]);
    expect(lit("/settings")).toEqual(["settings"]);
  });

  it("keeps sub-routes in their section", () => {
    expect(lit("/leads/abc")).toEqual(["leads"]);
    for (const p of ["/deals/new", "/deals/import", "/deals/abc", "/deals/abc/edit", "/deals/abc/contract"]) {
      expect(lit(p)).toEqual(["deals"]);
    }
    expect(lit("/contracts/abc")).toEqual(["agreements"]);
    expect(lit("/contracts/abc/export")).toEqual(["agreements"]);
  });

  it("gives a deal's quote document to Quotations, not Deals", () => {
    expect(lit("/deals/abc/quote")).toEqual(["quotations"]);
    expect(isNavItemActive(navItem("deals"), "/deals/abc/quote")).toBe(false);
  });

  it("gives /brand-invoices/* to Invoices", () => {
    expect(lit("/brand-invoices/new")).toEqual(["invoices"]);
    expect(lit("/brand-invoices/abc")).toEqual(["invoices"]);
  });

  it("matches whole segments only", () => {
    expect(lit("/dealsx")).toEqual([]);
    expect(lit("/leadsboard")).toEqual([]);
    expect(lit("/contractsabc")).toEqual([]);
  });

  it("lights nothing on routes outside the nav", () => {
    for (const p of ["/", "/agent", "/agent/abc", "/pricing", "/terms", "/invite/tok"]) expect(lit(p)).toEqual([]);
  });

  it("lights More only for routes inside the sheet", () => {
    // Deals lives in More on the phone bar (AI League took its place in the bar).
    for (const p of ["/quotations", "/deals", "/deals/abc", "/deals/abc/quote", "/contracts/abc", "/invoices", "/brand-invoices/new", "/profile", "/settings"]) {
      expect(isMoreActive(p)).toBe(true);
    }
    for (const p of ["/dashboard", "/ai-league", "/ai-league/mika", "/outbound", "/leads/abc", "/pricing", "/"]) {
      expect(isMoreActive(p)).toBe(false);
    }
  });
});

describe("desktop sections", () => {
  it("shows every area in workflow order for built-in roles", () => {
    const s = desktopNavSections(OWNER);
    expect(s.map((x) => x.label)).toEqual(["Home", "AI League", "AI Outbound", "Pipeline", "Documents", "Money"]);
    expect(s.flatMap((x) => keys(x.items))).toEqual(["home", "league", "outbound", "leads", "deals", "quotations", "agreements", "invoices"]);
  });

  it("drops modules a custom role can't see, and empty groups with them", () => {
    const s = desktopNavSections(custom("invoices.create"));
    expect(s.map((x) => x.group)).toEqual(["home", "money"]);
    expect(s.flatMap((x) => keys(x.items))).toEqual(["home", "invoices"]);
  });

  it("keeps a partly visible group", () => {
    const s = desktopNavSections(custom("agreements.create"));
    expect(s.find((x) => x.group === "documents")!.items.map((i) => i.key)).toEqual(["agreements"]);
    expect(s.some((x) => x.group === "pipeline")).toBe(false);
  });

  it("shows only ungated items while the user is unknown", () => {
    expect(desktopNavSections(null).flatMap((x) => keys(x.items))).toEqual(["home"]);
  });
});

describe("mobile bar and More sheet", () => {
  it("bar is Home, AI League, Outbound, Leads (More is added by the component)", () => {
    expect(keys(mobileBarItems(OWNER))).toEqual(["home", "league", "outbound", "leads"]);
    expect(mobileBarItems(OWNER).map((i) => i.shortLabel)).toEqual(["Home", "AI League", "Outbound", "Leads"]);
  });

  it("sheet groups Pipeline (Deals), Documents, Money and Account, never repeating a bar item", () => {
    const s = moreSheetSections(OWNER);
    expect(s.map((x) => x.label)).toEqual(["Pipeline", "Documents", "Money", "Account"]);
    expect(s.map((x) => keys(x.items))).toEqual([["deals"], ["quotations", "agreements"], ["invoices"], ["profile", "settings"]]);
    const inBar = new Set(keys(mobileBarItems(OWNER)));
    expect(s.flatMap((x) => keys(x.items)).filter((k) => inBar.has(k))).toEqual([]);
  });

  it("More lights for deals, documents and account pages, not for a page whose tab is in the bar", () => {
    expect(isMoreActive("/deals/12")).toBe(true);
    expect(isMoreActive("/contracts")).toBe(true);
    expect(isMoreActive("/settings")).toBe(true);
    expect(isMoreActive("/leads/4")).toBe(false);
    expect(isMoreActive("/ai-league/nibo")).toBe(false);
  });

  it("an invoices-only custom role keeps Home, Money and Account", () => {
    const u = custom("payments.manage");
    expect(keys(mobileBarItems(u))).toEqual(["home"]);
    expect(moreSheetSections(u).map((x) => x.group)).toEqual(["money", "account"]);
  });

  it("deal permissions light Pipeline and Quotations (same gate as today)", () => {
    const u = custom("deals.create");
    expect(keys(mobileBarItems(u))).toEqual(["home", "league", "outbound", "leads"]);
    expect(moreSheetSections(u).map((x) => keys(x.items))).toEqual([["deals"], ["quotations"], ["profile", "settings"]]);
  });

  it("Settings and Profile are always reachable", () => {
    for (const u of [OWNER, custom(), custom("invoices.create"), null]) {
      const account = moreSheetSections(u).find((x) => x.group === "account")!;
      expect(keys(account.items)).toEqual(["profile", "settings"]);
    }
  });
});
