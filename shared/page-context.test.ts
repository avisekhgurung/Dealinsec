import { describe, expect, it } from "vitest";
import { contextPrompts, pageContext } from "./page-context";

describe("pageContext", () => {
  it("knows a deal, an agreement and an invoice by their routes, with the id", () => {
    expect(pageContext("/deals/47")).toEqual({ page: "deal-details", route: "/deals/47", entityType: "deal", entityId: 47 });
    expect(pageContext("/deals/47/quote")).toMatchObject({ entityType: "deal", entityId: 47 });
    expect(pageContext("/contracts/9")).toMatchObject({ page: "agreement-details", entityType: "contract", entityId: 9 });
    expect(pageContext("/brand-invoices/12")).toMatchObject({ page: "invoice-details", entityType: "invoice", entityId: 12 });
  });
  it("any other page is just its section, and the root is the dashboard", () => {
    expect(pageContext("/leads")).toEqual({ page: "leads", route: "/leads" });
    expect(pageContext("/")).toEqual({ page: "dashboard", route: "/" });
    expect(pageContext("/settings")).not.toHaveProperty("entityId");
  });
  it("does not mistake a list or a new-deal page for a deal", () => {
    for (const r of ["/deals", "/deals/new", "/deals/abc", "/contracts", "/dealsx/1"]) expect(pageContext(r).entityType, r).toBeUndefined();
  });
  it("offers questions only where there is something specific to ask about", () => {
    expect(contextPrompts(pageContext("/deals/1"))).toHaveLength(3);
    expect(contextPrompts(pageContext("/brand-invoices/1"))).toHaveLength(2);
    expect(contextPrompts(pageContext("/leads"))).toEqual([]);
  });
});
