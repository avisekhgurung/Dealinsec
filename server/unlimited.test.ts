import { describe, expect, it, vi } from "vitest";

// outboundTier reads the billing owner; a listed workspace never needs it.
const billing = vi.fn(async () => ({ plan: "free", planExpiresAt: null }));
vi.mock("./entitlements", () => ({ getBillingUser: (...a: unknown[]) => billing(...(a as [])) }));

const { isUnlimitedOrg, unlimitedOrgIds, UNLIMITED } = await import("./unlimited");
const { outboundAllowance, workspaceMonthlySpendMicroUsd, dailyRunLimit, dailySearchLimit, dailyContactLimit } = await import("./outbound/limits");
const { outboundTier } = await import("./outbound/plan");
const { leagueAllowance } = await import("./ai-league/limits");

describe("UNLIMITED_ORG_IDS", () => {
  it("is an exact, comma-separated list of workspace ids; nothing else matches", () => {
    const env = { UNLIMITED_ORG_IDS: " org-a ,org-b,, " };
    expect([...unlimitedOrgIds(env)]).toEqual(["org-a", "org-b"]);
    expect(isUnlimitedOrg("org-a", env)).toBe(true);
    expect(isUnlimitedOrg("org-ab", env)).toBe(false);
    expect(isUnlimitedOrg("", env)).toBe(false);
    expect(isUnlimitedOrg(null, env)).toBe(false);
    expect(isUnlimitedOrg("org-a", {})).toBe(false);
  });

  it("a listed workspace gets the Unlimited tier whatever its owner pays; others keep their plan", async () => {
    vi.stubEnv("UNLIMITED_ORG_IDS", "org-founder");
    try {
      expect(await outboundTier({ id: "u1", organizationId: "org-founder" } as any)).toBe("unlimited");
      expect(await outboundTier({ id: "u2", organizationId: "org-other" } as any)).toBe("free");
      const a = outboundAllowance("unlimited");
      expect(a.monthlySearches).toBeGreaterThanOrEqual(UNLIMITED);
      expect(a.monthlyDrafts).toBeGreaterThanOrEqual(UNLIMITED);
      expect(a.monthlySends).toBeGreaterThanOrEqual(UNLIMITED);
      expect(a.maxCompanies).toBe(outboundAllowance("pro").maxCompanies);   // one search stays one search
      expect(leagueAllowance("unlimited").monthlyRuns).toBeGreaterThanOrEqual(UNLIMITED);
      expect(leagueAllowance("pro").monthlyRuns).toBeLessThan(1000);
    } finally { vi.unstubAllEnvs(); }
  });

  it("lifts the daily limits and the spend ceiling for a listed workspace only", () => {
    vi.stubEnv("UNLIMITED_ORG_IDS", "org-founder");
    try {
      expect(dailyRunLimit("org-founder")).toBe(UNLIMITED);
      expect(dailySearchLimit("org-founder")).toBe(UNLIMITED);
      expect(dailyContactLimit("org-founder")).toBe(UNLIMITED);
      expect(dailyRunLimit("org-other")).toBe(5);
      expect(dailyRunLimit()).toBe(5);
      expect(workspaceMonthlySpendMicroUsd(process.env, "org-founder")).toBeGreaterThan(1e12);
      expect(workspaceMonthlySpendMicroUsd(process.env, "org-other")).toBe(1_500_000);
    } finally { vi.unstubAllEnvs(); }
  });
});
