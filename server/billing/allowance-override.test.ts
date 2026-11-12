import { afterEach, describe, expect, it } from "vitest";
import { OUTBOUND_ALLOWANCE_DEFAULTS } from "@shared/outbound-plans";
import { envAllowance, outboundAllowance } from "../outbound/limits";
import { applyBillingConfigRows, resetBillingConfigForTests } from "./config-cache";

afterEach(() => { resetBillingConfigForTests(); delete process.env.OUTBOUND_MONTHLY_DRAFTS_PRO; });

describe("allowance precedence: admin override > environment > code default", () => {
  it("is the shared default with nothing configured", () => {
    expect(outboundAllowance("pro")).toEqual(envAllowance("pro"));
    expect(outboundAllowance("pro").monthlySearches).toBe(OUTBOUND_ALLOWANCE_DEFAULTS.pro.monthlySearches);
  });
  it("an environment variable beats the code default", () => {
    process.env.OUTBOUND_MONTHLY_DRAFTS_PRO = "77";
    expect(outboundAllowance("pro").monthlyDrafts).toBe(77);
  });
  it("an admin override beats the environment, per plan, and only for the field it names", () => {
    process.env.OUTBOUND_MONTHLY_DRAFTS_PRO = "77";
    applyBillingConfigRows([{ key: "allowances", value: { pro: { monthlyDrafts: 120 }, free: { monthlySearches: 4 } } }]);
    expect(outboundAllowance("pro").monthlyDrafts).toBe(120);
    expect(outboundAllowance("pro").monthlySearches).toBe(OUTBOUND_ALLOWANCE_DEFAULTS.pro.monthlySearches);
    expect(outboundAllowance("free").monthlySearches).toBe(4);
    expect(outboundAllowance("free").monthlyDrafts).toBe(OUTBOUND_ALLOWANCE_DEFAULTS.free.monthlyDrafts);
  });
  it("never touches the unlimited grant or the legacy trial tier", () => {
    applyBillingConfigRows([{ key: "allowances", value: { pro: { monthlySearches: 3 } } }]);
    expect(outboundAllowance("unlimited")).toEqual(OUTBOUND_ALLOWANCE_DEFAULTS.unlimited);
    expect(outboundAllowance("trial").monthlySearches).toBe(OUTBOUND_ALLOWANCE_DEFAULTS.trial.monthlySearches);
  });
  it("an invalid stored override is ignored, not applied", () => {
    applyBillingConfigRows([{ key: "allowances", value: { pro: { monthlySearches: -5 } } }]);
    expect(outboundAllowance("pro").monthlySearches).toBe(OUTBOUND_ALLOWANCE_DEFAULTS.pro.monthlySearches);
  });
});
