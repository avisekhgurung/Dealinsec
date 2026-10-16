import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS_TAB, SETTINGS_TABS, SETTINGS_TAB_META, nextTabIndex, normalizeSettingsTab, pickSettingsTab,
  requestedSettingsTab, resolveSettingsTab, settingsTabSearch, visibleSettingsTabs,
} from "./settings-tabs";

const ALL = visibleSettingsTabs({ canViewActivity: true });
const NO_LOG = visibleSettingsTabs({ canViewActivity: false });

describe("visibleSettingsTabs", () => {
  it("lists every tab in display order when the activity log is permitted", () => {
    expect(ALL).toEqual(["organization", "team", "integrations", "subscription", "preferences", "activity"]);
  });
  it("hides only the activity log without activity.view", () => {
    expect(NO_LOG).toEqual(["organization", "team", "integrations", "subscription", "preferences"]);
  });
  it("labels every tab", () => {
    for (const t of SETTINGS_TABS) expect(SETTINGS_TAB_META[t].label).toBeTruthy();
    expect(SETTINGS_TAB_META.integrations.label).toBe("Integrations");
  });
});

describe("normalizeSettingsTab", () => {
  it("accepts keys and friendly aliases, any case", () => {
    expect(normalizeSettingsTab("team")).toBe("team");
    expect(normalizeSettingsTab(" Integrations ")).toBe("integrations");
    expect(normalizeSettingsTab("billing")).toBe("subscription");
    expect(normalizeSettingsTab("business")).toBe("organization");
    expect(normalizeSettingsTab("gmail")).toBe("integrations");
  });
  it("rejects unknown, empty and oversized values", () => {
    expect(normalizeSettingsTab("nope")).toBeNull();
    expect(normalizeSettingsTab("")).toBeNull();
    expect(normalizeSettingsTab(null)).toBeNull();
    expect(normalizeSettingsTab("x".repeat(100))).toBeNull();
    expect(normalizeSettingsTab("__proto__")).toBeNull();
    expect(normalizeSettingsTab("constructor")).toBeNull();
  });
});

describe("requestedSettingsTab / resolveSettingsTab", () => {
  it("opens the tab named in ?tab", () => {
    expect(resolveSettingsTab("?tab=preferences", ALL)).toBe("preferences");
    expect(resolveSettingsTab("tab=team", ALL)).toBe("team");
  });
  it("opens Integrations on the return from Google, whatever the outcome", () => {
    expect(resolveSettingsTab("?gmail=connected", ALL)).toBe("integrations");
    expect(resolveSettingsTab("?gmail=denied", NO_LOG)).toBe("integrations");
    expect(resolveSettingsTab("?gmail=something-unknown", ALL)).toBe("integrations");
  });
  it("lets the Gmail return win over a ?tab that would hide the Gmail card", () => {
    expect(resolveSettingsTab("?tab=team&gmail=connected", ALL)).toBe("integrations");
  });
  it("ignores an empty ?gmail", () => {
    expect(requestedSettingsTab("?gmail=")).toBeNull();
    expect(resolveSettingsTab("?gmail=&tab=team", ALL)).toBe("team");
  });
  it("falls back to Business profile for nothing, unknown keys and tabs this member can't see", () => {
    expect(resolveSettingsTab("", ALL)).toBe(DEFAULT_SETTINGS_TAB);
    expect(resolveSettingsTab("?tab=wat", ALL)).toBe("organization");
    expect(resolveSettingsTab("?tab=activity", NO_LOG)).toBe("organization");
    expect(resolveSettingsTab("?tab=activity", ALL)).toBe("activity");
  });
  it("keeps the request apart from permissions, so a late-loading role can still open it", () => {
    const requested = requestedSettingsTab("?tab=activity");
    expect(pickSettingsTab(requested, NO_LOG)).toBe("organization");
    expect(pickSettingsTab(requested, ALL)).toBe("activity");
    expect(pickSettingsTab(null, ALL)).toBe("organization");
  });
});

describe("settingsTabSearch", () => {
  it("records the tab and keeps other parameters", () => {
    expect(settingsTabSearch("", "team")).toBe("?tab=team");
    expect(settingsTabSearch("?tab=team", "integrations")).toBe("?tab=integrations");
    expect(settingsTabSearch("?gmail=connected", "integrations")).toBe("?gmail=connected&tab=integrations");
    expect(settingsTabSearch("?utm_source=x&tab=team", "preferences")).toBe("?utm_source=x&tab=preferences");
  });
  it("drops ?tab for the default tab", () => {
    expect(settingsTabSearch("?tab=team", "organization")).toBe("");
    expect(settingsTabSearch("?a=1&tab=team", "organization")).toBe("?a=1");
  });
  it("round-trips through resolveSettingsTab", () => {
    for (const t of ALL) expect(resolveSettingsTab(settingsTabSearch("", t), ALL)).toBe(t);
  });
});

describe("nextTabIndex", () => {
  it("moves with either arrow axis and wraps", () => {
    expect(nextTabIndex(0, "ArrowDown", 5)).toBe(1);
    expect(nextTabIndex(0, "ArrowRight", 5)).toBe(1);
    expect(nextTabIndex(4, "ArrowDown", 5)).toBe(0);
    expect(nextTabIndex(0, "ArrowUp", 5)).toBe(4);
    expect(nextTabIndex(2, "ArrowLeft", 5)).toBe(1);
  });
  it("jumps with Home and End, ignores other keys", () => {
    expect(nextTabIndex(3, "Home", 5)).toBe(0);
    expect(nextTabIndex(1, "End", 5)).toBe(4);
    expect(nextTabIndex(1, "Enter", 5)).toBeNull();
    expect(nextTabIndex(0, "ArrowDown", 0)).toBeNull();
  });
});
