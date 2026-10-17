/** New trials are off: finishing onboarding grants nothing unless PRO_TRIAL_ENABLED=true; the database isn't even asked. */
import { describe, expect, it, vi } from "vitest";

const { update } = vi.hoisted(() => ({ update: vi.fn(() => ({ set: () => ({ where: () => ({ returning: async () => [{ id: "u1", trialEndsAt: new Date() }] }) }) })) }));
vi.mock("./db", () => ({ db: { update } }));
import { maybeStartTrial, trialGrantsEnabled } from "./trial";

describe("the Pro trial", () => {
  it("is not granted by default, and no write is attempted", async () => {
    expect(trialGrantsEnabled({})).toBe(false);
    expect(trialGrantsEnabled({ PRO_TRIAL_ENABLED: "1" })).toBe(false); // only the exact word switches it on
    expect(await maybeStartTrial("u1", {})).toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  it("can only be switched back on explicitly (a rollback switch), and then uses the one guarded UPDATE", async () => {
    expect(await maybeStartTrial("u1", { PRO_TRIAL_ENABLED: "true" })).toMatchObject({ id: "u1" });
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe("existing trials keep their access until they end", () => {
  it("an unexpired trial still counts as Pro access; an expired one doesn't", async () => {
    const { hasActiveTrial, hasProAccess, getSubscriptionStatus } = await import("@shared/schema");
    const live = { trialStartedAt: new Date(Date.now() - 2 * 86_400_000), trialEndsAt: new Date(Date.now() + 86_400_000) };
    const over = { trialStartedAt: new Date(Date.now() - 9 * 86_400_000), trialEndsAt: new Date(Date.now() - 2 * 86_400_000) };
    expect(hasActiveTrial(live)).toBe(true);
    expect(hasProAccess(live)).toBe(true);
    expect(hasProAccess(over)).toBe(false);
    expect(getSubscriptionStatus({ plan: "pro", planExpiresAt: new Date(Date.now() + 86_400_000), ...over })).toBe("ACTIVE"); // paid Pro is untouched
  });
});
