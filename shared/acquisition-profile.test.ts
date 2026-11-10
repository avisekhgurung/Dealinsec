/**
 * Client profiles, the pure half: what may be saved, the built-in starting points, a profile as a search, and a
 * company judged against a profile. No network, no model, no database.
 */
import { describe, expect, it } from "vitest";
import { acquisitionProfileSchema, icpFromProfile, profileMatch, PROFILE_TEMPLATES, templateFor, type MatchCard } from "./acquisition-profile";
import { icpSchema, searchStrategies } from "./icp";
import { REQUIREMENT_KEYS, WANTED_SIGNALS } from "./profile-keys";
import { SIGNAL_TYPES, isEventSignal, readiness, type FindingLike } from "./prospect";

const base = { name: "  Brands   that need growth ", industries: ["D2C brand"] };

describe("what a profile may hold", () => {
  it("needs a name and at least one kind of company, and tidies what it is given", () => {
    const p = acquisitionProfileSchema.parse({ ...base, services: ["SEO", "seo", " Paid  ads "], countries: ["in", "IN"], keywords: [] });
    expect(p.name).toBe("Brands that need growth");
    expect(p.services).toEqual(["SEO", "Paid ads"]);
    expect(p.countries).toEqual(["IN"]);
    expect(p).toMatchObject({ kind: "custom", signals: [], requirements: [], roles: [], employeeMin: null, employeeMax: null, outreach: { channels: ["email"], tone: "friendly", note: "" } });
    expect(acquisitionProfileSchema.safeParse({ name: "x", industries: [] }).success).toBe(false);
    expect(acquisitionProfileSchema.safeParse({ name: " ", industries: ["a"] }).success).toBe(false);
  });
  it("refuses a size range that is upside down, and a requirement nothing could meet", () => {
    expect(acquisitionProfileSchema.safeParse({ ...base, employeeMin: 50, employeeMax: 5 }).success).toBe(false);
    const r = acquisitionProfileSchema.safeParse({ ...base, requirements: ["wanted_signal"], signals: [] });
    expect(r.success).toBe(false);
    expect(acquisitionProfileSchema.safeParse({ ...base, requirements: ["wanted_signal"], signals: ["FUNDING"] }).success).toBe(true);
  });
  it("refuses values it doesn't know and lists that are too long", () => {
    expect(acquisitionProfileSchema.safeParse({ ...base, signals: ["MADE_UP"] }).success).toBe(false);
    expect(acquisitionProfileSchema.safeParse({ ...base, requirements: ["be_rich"] }).success).toBe(false);
    expect(acquisitionProfileSchema.safeParse({ ...base, countries: ["India"] }).success).toBe(false);
    expect(acquisitionProfileSchema.safeParse({ ...base, industries: Array.from({ length: 9 }, (_, i) => `kind ${i}`) }).success).toBe(false);
    expect(acquisitionProfileSchema.safeParse({ ...base, outreach: { channels: ["sms"] } }).success).toBe(false);
    expect(acquisitionProfileSchema.safeParse({ ...base, outreach: { note: "x".repeat(281) } }).success).toBe(false);
  });
  it("the buying signals are real signal types, and every one is a concrete event", () => {
    for (const s of WANTED_SIGNALS) { expect(SIGNAL_TYPES as readonly string[]).toContain(s); expect(isEventSignal(s)).toBe(true); }
  });
});

describe("the starting points", () => {
  it("there is one each for a freelancer, a marketing agency and a software agency, all valid and India first", () => {
    expect(PROFILE_TEMPLATES.map((t) => t.kind)).toEqual(["freelancer", "marketing_agency", "dev_agency"]);
    for (const t of PROFILE_TEMPLATES) {
      expect(acquisitionProfileSchema.safeParse(t.profile).success, t.kind).toBe(true);
      expect(t.profile.countries[0], t.kind).toBe("IN");
      expect(t.profile.services, t.kind).toEqual([]); // only the person knows what they sell
      expect(t.profile.signals.length, t.kind).toBeGreaterThan(0);
      expect(t.profile.roles.length, t.kind).toBeGreaterThan(0);
      // Each one can start a search for every kind of company it names.
      for (const kind of t.profile.industries) expect(icpFromProfile(t.profile, kind)?.industry, `${t.kind}/${kind}`).toBe(kind);
    }
    expect(templateFor("dev_agency")?.label).toBe("Software agency");
    expect(templateFor("custom")).toBeNull();
    expect(templateFor("nope")).toBeNull();
  });
});

describe("a profile as a search", () => {
  const p = acquisitionProfileSchema.parse({
    name: "Brands", industries: ["D2C brand", "edtech company"], keywords: ["consumer brand"], services: ["performance marketing"], countries: ["IN"], locations: ["Bengaluru"],
    employeeMin: 5, employeeMax: 200, exclusions: ["gambling"], signals: ["FUNDING", "HIRING"], requirements: ["decision_maker"], roles: ["CMO", "Founder"],
  });
  it("carries everything across by rules, for one kind of company at a time", () => {
    const icp = icpFromProfile({ ...p, id: 7 })!;
    expect(icp).toMatchObject({
      industry: "D2C brand", keywords: ["consumer brand"], services: ["performance marketing"], countries: ["IN"], locations: ["Bengaluru"], employeeMin: 5, employeeMax: 200,
      exclusions: ["gambling"], roles: ["CMO", "Founder"], signals: ["FUNDING", "HIRING"], requirements: ["decision_maker"], profile: { id: 7, name: "Brands" },
    });
    // The other kind is a different company, not another word for this one.
    expect(icp.keywords).not.toContain("edtech company");
    expect(icpFromProfile(p, "EdTech Company")?.industry).toBe("edtech company");
    expect(icpFromProfile(p, "something else")?.industry).toBe("D2C brand");
  });
  it("is a search Client Radar accepts as it is, and plans real searches", () => {
    const icp = icpFromProfile({ ...p, id: 7 })!;
    const again = icpSchema.parse(icp);
    expect(again).toEqual(icp);
    const q = searchStrategies(icp);
    expect(q.length).toBeGreaterThan(0);
    expect(q.join(" | ")).toContain("D2C brand");
    expect(q.join(" | ")).toContain("Bengaluru");
  });
  it("with no roles saved, the search keeps its own default roles; an unsaved profile names no profile", () => {
    const icp = icpFromProfile(acquisitionProfileSchema.parse(base))!;
    expect(icp.roles.length).toBeGreaterThan(0);
    expect(icp.profile).toBeUndefined();
  });
  it("a search that names no profile is exactly what it was before profiles existed", () => {
    const plain = icpSchema.parse({ industry: "digital agency" });
    expect("signals" in plain).toBe(false);
    expect("requirements" in plain).toBe(false);
    expect("profile" in plain).toBe(false);
  });
});

describe("a company against a profile", () => {
  const card = (over: Partial<MatchCard> = {}): MatchCard => ({ contact: "none", hasDecisionMaker: false, timing: "none", signalTypes: [], ...over });
  it("a profile that asks for nothing excludes nothing", () => {
    expect(profileMatch({}, card())).toEqual({ requirements: [], met: 0, total: 0, meetsAll: true, signalsFound: [] });
    expect(profileMatch({ signals: null, requirements: null }, card()).meetsAll).toBe(true);
  });
  it("each requirement is its own rule", () => {
    const all = { requirements: [...REQUIREMENT_KEYS], signals: ["FUNDING"] };
    const none = profileMatch(all, card());
    expect(none).toMatchObject({ met: 0, total: 5, meetsAll: false });
    expect(profileMatch(all, card({ contact: "public" })).requirements.filter((r) => r.met).map((r) => r.key)).toEqual(["contact_route"]);
    expect(profileMatch(all, card({ hasDecisionMaker: true })).requirements.filter((r) => r.met).map((r) => r.key)).toEqual(["contact_route", "decision_maker"]);
    expect(profileMatch(all, card({ contact: "verified" })).requirements.filter((r) => r.met).map((r) => r.key)).toEqual(["contact_route", "verified_email"]);
    for (const t of ["strong", "context"]) expect(profileMatch(all, card({ timing: t })).requirements.find((r) => r.key === "recent_signal")?.met, t).toBe(true);
    for (const t of ["stale", "undated", "none"]) expect(profileMatch(all, card({ timing: t })).requirements.find((r) => r.key === "recent_signal")?.met, t).toBe(false);
    const full = profileMatch(all, card({ contact: "verified", hasDecisionMaker: true, timing: "strong", signalTypes: ["FUNDING"] }));
    expect(full).toMatchObject({ met: 5, total: 5, meetsAll: true, signalsFound: ["FUNDING"] });
  });
  it("only the signals the profile asked for count, whatever else was found", () => {
    const m = profileMatch({ signals: ["FUNDING", "HIRING"], requirements: ["wanted_signal"] }, card({ signalTypes: ["CONTENT_ACTIVITY", "PARTNERSHIP"] }));
    expect(m).toMatchObject({ signalsFound: [], meetsAll: false });
    expect(profileMatch({ signals: ["FUNDING", "HIRING"], requirements: ["wanted_signal"] }, card({ signalTypes: ["HIRING", "PARTNERSHIP"] }))).toMatchObject({ signalsFound: ["HIRING"], meetsAll: true });
  });
  it("ignores a requirement or a signal it doesn't know (an older or newer search)", () => {
    expect(profileMatch({ requirements: ["be_rich", "decision_maker"], signals: ["MADE_UP"] }, card({ hasDecisionMaker: true, signalTypes: ["MADE_UP"] }))).toMatchObject({ total: 1, met: 1, signalsFound: [] });
  });
  it("never touches the rule for Ready: a profile's requirements are a second, separate question", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    const findings: FindingLike[] = [
      { id: 1, kind: "signal", type: "FUNDING", value: "Raised a seed round", status: "confirmed", observedAt: new Date("2026-11-01T00:00:00Z"), meta: { datePrecision: "day" } },
      { id: 2, kind: "decision_maker", type: "CEO", value: "Jane Doe, CEO", status: "confirmed", meta: { title: "CEO" } },
    ];
    const r = readiness({ verified: true, fitVerdict: "strong", findings, now });
    expect(r.ready).toBe(true);
    // The same company fails a profile that wants a verified email, and is still Ready.
    expect(profileMatch({ requirements: ["verified_email"] }, card({ contact: "none", hasDecisionMaker: true, timing: r.timing, signalTypes: ["FUNDING"] })).meetsAll).toBe(false);
  });
});
