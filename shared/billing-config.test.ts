import { describe, expect, it } from "vitest";
import { applyAllowanceOverrides, BILLING_CONFIG_DEFAULTS, configFromRows, usedPercent, validateConfigValue } from "./billing-config";
import { OUTBOUND_ALLOWANCE_DEFAULTS } from "./outbound-plans";

describe("billing config validation", () => {
  it("accepts whole-number allowance overrides for free and pro only, and rejects everything else", () => {
    expect(validateConfigValue("allowances", { pro: { monthlySearches: 25 }, free: { monthlyDrafts: 8 } })).toEqual({ ok: true, value: { pro: { monthlySearches: 25 }, free: { monthlyDrafts: 8 } } });
    expect(validateConfigValue("allowances", { unlimited: { monthlySearches: 5 } })).toMatchObject({ ok: false });
    expect(validateConfigValue("allowances", { pro: { monthlySearches: 0 } })).toMatchObject({ ok: false });
    expect(validateConfigValue("allowances", { pro: { monthlySearches: 1.5 } })).toMatchObject({ ok: false });
    expect(validateConfigValue("allowances", { pro: { maxCompanies: 5 } })).toMatchObject({ ok: false });
    expect(validateConfigValue("allowances", "x")).toMatchObject({ ok: false });
  });
  it("a cleared field (null) falls back instead of being stored", () => {
    expect(validateConfigValue("allowances", { pro: { monthlySearches: null } })).toEqual({ ok: true, value: { pro: {} } });
  });
  it("bounds the warning threshold, credit costs, headroom and expiry", () => {
    expect(validateConfigValue("warn_percent", 80)).toMatchObject({ ok: true });
    expect(validateConfigValue("warn_percent", 100)).toMatchObject({ ok: false });
    expect(validateConfigValue("warn_percent", 49)).toMatchObject({ ok: false });
    expect(validateConfigValue("credit_cost", { search: 2, draft: 1 })).toMatchObject({ ok: true });
    expect(validateConfigValue("credit_cost", { search: 0, draft: 1 })).toMatchObject({ ok: false });
    expect(validateConfigValue("credit_cost", { search: 6, draft: 1 })).toMatchObject({ ok: false });
    expect(validateConfigValue("spend_headroom_usd", { search: 0.3, draft: 0.01 })).toMatchObject({ ok: true });
    expect(validateConfigValue("spend_headroom_usd", { search: -1, draft: 0 })).toMatchObject({ ok: false });
    expect(validateConfigValue("default_expiry_months", null)).toMatchObject({ ok: true });
    expect(validateConfigValue("default_expiry_months", 12)).toMatchObject({ ok: true });
    expect(validateConfigValue("default_expiry_months", 0)).toMatchObject({ ok: false });
    expect(validateConfigValue("notify", { warn: true, exhausted: false })).toMatchObject({ ok: true });
    expect(validateConfigValue("notify", { warn: "yes" })).toMatchObject({ ok: false });
  });
});

describe("the effective config", () => {
  it("is the defaults with no rows, and an unreadable row keeps its default", () => {
    expect(configFromRows([])).toEqual(BILLING_CONFIG_DEFAULTS);
    const cfg = configFromRows([{ key: "warn_percent", value: "lots" }, { key: "credit_cost", value: { search: 2, draft: 1 } }, { key: "nope", value: 1 }]);
    expect(cfg.warnPercent).toBe(80);
    expect(cfg.creditCost).toEqual({ search: 2, draft: 1 });
  });
  it("does not mutate the shared defaults", () => {
    configFromRows([{ key: "credit_cost", value: { search: 3, draft: 3 } }]);
    expect(BILLING_CONFIG_DEFAULTS.creditCost).toEqual({ search: 1, draft: 1 });
  });
});

describe("allowance overrides", () => {
  const pro = OUTBOUND_ALLOWANCE_DEFAULTS.pro;
  it("replace only the fields given and leave maxCompanies alone", () => {
    const next = applyAllowanceOverrides(pro, { monthlySearches: pro.monthlySearches + 5 });
    expect(next.monthlySearches).toBe(pro.monthlySearches + 5);
    expect(next.monthlyDrafts).toBe(pro.monthlyDrafts);
    expect(next.maxCompanies).toBe(pro.maxCompanies);
  });
  it("ignore a value that isn't a whole number in range, and no override is the base", () => {
    expect(applyAllowanceOverrides(pro, { monthlySearches: -3 as number })).toEqual(pro);
    expect(applyAllowanceOverrides(pro, undefined)).toBe(pro);
  });
});

describe("usedPercent", () => {
  it("rounds down, caps at 100, and reads a zero or unreadable limit as full", () => {
    expect(usedPercent(8, 10)).toBe(80);
    expect(usedPercent(79, 100)).toBe(79);
    expect(usedPercent(12, 10)).toBe(100);
    expect(usedPercent(0, 0)).toBe(100);
    expect(usedPercent(NaN, 10)).toBe(100);
  });
});
