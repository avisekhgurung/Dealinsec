import { describe, expect, it } from "vitest";
import {
  NAV_ITEMS, desktopBarItems, desktopMoreActive, desktopMoreSections, desktopNavSections, isMoreActive, isNavItemActive, mobileBarItems, moreSheetSections, navItem,
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

  it("lights More only for routes inside the sheet (the deal suite is hidden: shared/flags.ts)", () => {
    for (const p of ["/profile", "/settings"]) {
      expect(isMoreActive(p)).toBe(true);
    }
    // Deal-suite routes still work by URL but no longer live in the sheet, so they light nothing.
    for (const p of ["/dashboard", "/ai-league", "/ai-league/mika", "/outbound", "/leads/abc", "/pricing", "/", "/quotations", "/deals", "/deals/abc/quote", "/contracts/abc", "/invoices", "/brand-invoices/new"]) {
      expect(isMoreActive(p)).toBe(false);
    }
  });
});

describe("desktop sections", () => {
  it("shows every area in workflow order for built-in roles", () => {
    const s = desktopNavSections(OWNER);
    expect(s.map((x) => x.label)).toEqual(["Home", "The Nest", "Client Radar", "Pipeline", "Documents", "Money"]);
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
  it("bar is Home, The Nest, Radar, Leads (More is added by the component)", () => {
    expect(keys(mobileBarItems(OWNER))).toEqual(["home", "league", "outbound", "leads"]);
    expect(mobileBarItems(OWNER).map((i) => i.shortLabel)).toEqual(["Home", "The Nest", "Radar", "Leads"]);
  });

  it("sheet holds only Account while the deal suite is hidden, never repeating a bar item", () => {
    const s = moreSheetSections(OWNER);
    expect(s.map((x) => x.label)).toEqual(["Account"]);
    expect(s.map((x) => keys(x.items))).toEqual([["profile", "settings"]]);
    const inBar = new Set(keys(mobileBarItems(OWNER)));
    expect(s.flatMap((x) => keys(x.items)).filter((k) => inBar.has(k))).toEqual([]);
  });

  it("More lights for account pages only; a page whose tab is in the bar lights that tab", () => {
    expect(isMoreActive("/settings")).toBe(true);
    expect(isMoreActive("/profile")).toBe(true);
    expect(isMoreActive("/leads/4")).toBe(false);
    expect(isMoreActive("/ai-league/nibo")).toBe(false);
  });

  it("an invoices-only custom role keeps Home and Account (Money is hidden with the suite)", () => {
    const u = custom("payments.manage");
    expect(keys(mobileBarItems(u))).toEqual(["home"]);
    expect(moreSheetSections(u).map((x) => x.group)).toEqual(["account"]);
  });

  it("deal permissions keep the finding bar; the sheet stays Account-only while the suite is hidden", () => {
    const u = custom("deals.create");
    expect(keys(mobileBarItems(u))).toEqual(["home", "league", "outbound", "leads"]);
    expect(moreSheetSections(u).map((x) => keys(x.items))).toEqual([["profile", "settings"]]);
  });

  it("Settings and Profile are always reachable", () => {
    for (const u of [OWNER, custom(), custom("invoices.create"), null]) {
      const account = moreSheetSections(u).find((x) => x.group === "account")!;
      expect(keys(account.items)).toEqual(["profile", "settings"]);
    }
  });
});

describe("desktop bar: the finding tabs are the whole bar while the deal suite is hidden", () => {
  it("shows Home, The Nest, Client Radar and Leads as tabs, and no Workspace menu at all", () => {
    expect(desktopBarItems(OWNER).map((i) => i.key)).toEqual(["home", "league", "outbound", "leads"]);
    expect(desktopMoreSections(OWNER)).toEqual([]);
  });
  it("nothing lights the (absent) menu, whatever the URL", () => {
    for (const p of ["/invoices", "/brand-invoices/12", "/deals/5/quote", "/contracts/9", "/deals/5", "/leads"]) {
      expect(desktopMoreActive(p)).toBeNull();
    }
  });
});
