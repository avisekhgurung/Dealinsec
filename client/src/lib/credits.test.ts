import { describe, expect, it } from "vitest";
import { expiryNote, featureStatus, usedPercent } from "./credits";

const a = (used: number, limit: number) => ({ used, limit, remaining: Math.max(0, limit - used), nextFreesAt: null });
const warn = { percent: 80, warn: true, exhausted: true };

describe("featureStatus: plan first, purchased credits second", () => {
  it("is ok below the threshold and warns at 80% (the configured percent)", () => {
    expect(featureStatus(a(7, 10), null, warn)?.state).toBe("ok");
    expect(featureStatus(a(8, 10), null, warn)?.state).toBe("warn");
    expect(featureStatus(a(8, 10), null, { ...warn, percent: 90 })?.state).toBe("ok");
    expect(featureStatus(a(9, 10), null, { ...warn, percent: 90 })?.state).toBe("warn");
  });
  it("never warns when the admin has switched the warning off, but still reports out", () => {
    expect(featureStatus(a(9, 10), null, { ...warn, warn: false })?.state).toBe("ok");
    expect(featureStatus(a(10, 10), null, { ...warn, warn: false })?.state).toBe("out");
  });
  it("at 100% with no credits only THAT feature is out", () => {
    expect(featureStatus(a(10, 10), { balance: 0, cost: 1, nextExpiry: null }, warn)).toMatchObject({ state: "out", percent: 100 });
  });
  it("at 100% with enough purchased credits the feature keeps working, and says what it will cost", () => {
    expect(featureStatus(a(10, 10), { balance: 3, cost: 1, nextExpiry: null }, warn)).toMatchObject({ state: "credits", balance: 3, cost: 1 });
  });
  it("credits that don't cover one action's cost are not enough", () => {
    expect(featureStatus(a(10, 10), { balance: 1, cost: 2, nextExpiry: null }, warn)?.state).toBe("out");
  });
  it("says nothing when the numbers can't be read", () => {
    expect(featureStatus(null, null, warn)).toBeNull();
    expect(featureStatus(a(1, 0), null, warn)).toBeNull();
  });
});

describe("usedPercent / expiryNote", () => {
  it("rounds down and treats an unreadable limit as full", () => {
    expect(usedPercent({ used: 79, limit: 100 })).toBe(79);
    expect(usedPercent({ used: 5, limit: 0 })).toBe(100);
  });
  it("names when the soonest credits expire, and stays silent when none do", () => {
    expect(expiryNote(null)).toBe("");
    expect(expiryNote({ units: 1, at: "2027-11-12T00:00:00.000Z" })).toMatch(/1 of them expires on/);
    expect(expiryNote({ units: 4, at: "2027-11-12T00:00:00.000Z" })).toMatch(/4 of them expire on/);
  });
});
