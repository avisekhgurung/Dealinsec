import { describe, expect, it } from "vitest";
import { TOOL_READS, narrowToReadable, readDenial } from "./readAccess";

const custom = (...perms: string[]) => ({ orgRole: "CUSTOM", customPermissions: perms });

describe("readDenial — the chat tools follow the same module-read rules as the REST routes", () => {
  it("built-in roles and the owner keep every tool", () => {
    for (const role of ["OWNER", "ADMIN", "SALES", "ACCOUNTS"]) {
      for (const tool of Object.keys(TOOL_READS).filter((t) => t !== "get_recent_activity")) {
        expect(readDenial(tool, { orgRole: role }), `${role}/${tool}`).toBeNull();
      }
    }
  });

  it("an invoices-only custom member can't list deals, quotations or agreements through chat", () => {
    const m = custom("invoices.create");
    expect(readDenial("search_invoices", m)).toBeNull();
    expect(readDenial("search_deals", m)).toMatch(/viewing deals/);
    expect(readDenial("search_quotations", m)).toMatch(/quotations/);
    expect(readDenial("run_protection_check", m)).toMatch(/deals/);
    expect(readDenial("get_pending_work", m)).toMatch(/deals/);
  });

  it("agreements are readable by invoice permissions, as in the REST routes", () => {
    expect(readDenial("search_agreements", custom("invoices.create"))).toBeNull();
    expect(readDenial("get_money_radar", custom("invoices.create"))).toBeNull();
  });

  it("a custom member with no permissions can read nothing but the account status", () => {
    const m = custom();
    for (const t of ["search_deals", "search_quotations", "search_agreements", "search_invoices", "get_pending_work", "get_money_radar", "get_deal_health", "run_protection_check", "get_workflow_status"]) {
      expect(readDenial(t, m), t).not.toBeNull();
    }
    expect(readDenial("get_account_status", m)).toBeNull();
  });

  it("the activity log needs activity.view", () => {
    expect(readDenial("get_recent_activity", { orgRole: "OWNER" })).toBeNull();
    expect(readDenial("get_recent_activity", custom("deals.create"))).toMatch(/activity log/);
  });

  it("an unknown tool is denied", () => {
    expect(readDenial("drop_tables", { orgRole: "OWNER" })).toMatch(/unknown tool/);
  });
});

describe("narrowToReadable — the briefing only aggregates what the member may read", () => {
  const data = { deals: [1, 2], contracts: ["a"], invoices: [true, false] };
  it("built-in roles keep everything", () => {
    expect(narrowToReadable({ orgRole: "SALES" }, data)).toEqual(data);
    expect(narrowToReadable({ orgRole: "OWNER" }, data)).toEqual(data);
  });
  it("an invoices-only custom member sees no deals, but their invoices and agreements", () => {
    expect(narrowToReadable(custom("invoices.create"), data)).toEqual({ deals: [], contracts: ["a"], invoices: [true, false] });
  });
  it("a custom member with no permissions sees nothing", () => {
    expect(narrowToReadable(custom(), data)).toEqual({ deals: [], contracts: [], invoices: [] });
  });
});
