/**
 * The ideal client as a gate on drafting, in the in-memory world: the real services, the real rules, a scripted model.
 *
 * shared/draft-fit-gate.test.ts pins the rule. This file pins the things only the running service can be wrong about:
 * that the gate is applied BEFORE anything is spent, that it reads THIS workspace's profile and the newest version of
 * it, that an AI coworker or a campaign cannot wave its own warning away, and that a person can.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../storage", async () => (await import("./world-mocks")).storageMock());
vi.mock("../../entitlements", async () => (await import("./world-mocks")).entitlementsMock());
vi.mock("../../emails", async () => (await import("./world-mocks")).emailsMock());
vi.mock("../../leads/profile-store", async () => (await import("./world-mocks")).profileStoreMock());
vi.mock("../../discovery/provider", async () => (await import("./world-mocks")).discoveryProviderMock());
vi.mock("../../documents/style-store", async () => (await import("./world-mocks")).documentStyleStoreMock());
vi.mock("../../knowledge/store", async () => (await import("./world-mocks")).knowledgeStoreMock());
vi.mock("../../knowledge/net-guard", async (orig) => (await import("./world-mocks")).netGuardMock(orig as () => Promise<any>));
vi.mock("../../leads/store", async () => (await import("./world-mocks")).leadsStoreMock());
vi.mock("../../sales/research-store", async () => (await import("./world-mocks")).researchStoreMock());
vi.mock("../../sales/message-store", async () => (await import("./world-mocks")).messageStoreMock());
vi.mock("../../llm/trace-store", async () => (await import("./world-mocks")).traceStoreMock());
vi.mock("../../routes", async () => (await import("./world-mocks")).routesMock());
vi.mock("../../copilot/provider", async (orig) => (await import("./world-mocks")).scriptedProviderMock(orig as () => Promise<any>));

import { draftOutreach, draftOutreachVariants, listMessages } from "../../sales/outreach";
import { addClaim } from "../../services/leads";
import { saveIdealClient } from "../../services/ideal-client";
import { useWorld } from "./world-mocks";
import { createWorld, seedLead, seedProfile, userRow, ORG1, ORG2, type World } from "./world";

const world = () => (globalThis as any).__world as World;
const user = (over: Record<string, any> = {}) => userRow(over) as any;

const SUBJECT = "A quick note about your studio";
const BODY = "Hello,\n\nI saw that your studio builds websites for local businesses in Bengaluru and has just taken on a second office. I build web and AI applications for small agencies, and I wondered whether that is something you are working on at the moment.\n\nWould a short reply or a quick chat be useful?\n\nBest,\nAsha Rao";
/** A body that claims nothing about the sender: what a draft must look like when no offer is described. */
const NEUTRAL_BODY = "Hello,\n\nI saw that your studio builds websites for local businesses and has just taken on a second office. I was curious how you decide which projects to take on at the moment, and whether anything about that has changed as you have grown.\n\nWould a short reply or a quick chat be useful?\n\nBest,\nAsha Rao";
let prompts: { role: string; content: string }[][] = [];

/** The profile a small Indian agency-focused freelancer really saves: small companies, in India, two exclusions. */
const SMALL_INDIAN_AGENCIES = {
  about: "I build web and AI applications for small agencies.",
  services: ["Next.js development", "AI automation"],
  targetIndustries: ["marketing agencies", "web design agencies", "software development agencies"],
  targetLocations: ["India", "Bengaluru", "Mumbai"],
  exclusions: ["gambling", "tobacco"],
  minEmployees: 1,
  maxEmployees: 10,
};

const lead = (over: Record<string, any> = {}) =>
  seedLead(world(), { companyName: "Bluebird Media", website: "https://bluebird.in", domain: "bluebird.in", industry: "Marketing agency", location: "Bengaluru, India", ...over });
const claim = (leadId: number, field: string, value: string, status = "confirmed", u = user()) =>
  addClaim(u, leadId, { field, value, status, ...(status === "confirmed" ? { evidenceUrl: "https://bluebird.in/about", evidenceSnippet: `${value} (as written on the page)` } : {}) }, { actor: "agent" });

/** A researched lead with an address, so the only thing that can stop a draft is the ideal client. */
const researched = async (over: Record<string, any> = {}, u = user()) => {
  const l = lead(over);
  await claim(l.id, "description", "Builds websites for local businesses", "confirmed", u);
  await claim(l.id, "business_email", "hello@bluebird.in", "confirmed", u);
  if (over.teamSize) await claim(l.id, "team_size", String(over.teamSize), "confirmed", u);
  return l;
};
const code = (r: any) => (r.ok ? "ok" : r.code);

beforeEach(() => {
  useWorld(createWorld());
  seedProfile(world(), SMALL_INDIAN_AGENCIES);
  prompts = [];
  world().llm = async (m) => { prompts.push(m); return { content: JSON.stringify({ subject: SUBJECT, body: BODY }), toolCalls: [], usage: { inputTokens: 900, outputTokens: 180 } }; };
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe("an excluded lead is never written to", () => {
  it("refuses before the model is called, and spends no draft", async () => {
    const l = await researched({ companyName: "Royal Gambling", industry: "Gambling" });
    const r = await draftOutreach(user(), l.id);
    expect(code(r)).toBe("fit_excluded");
    expect((r as any).fit).toMatchObject({ action: "refuse", verdict: "excluded", excludedBy: ["gambling"] });
    expect((r as any).message).toContain("gambling");
    expect(prompts).toHaveLength(0);   // nothing was asked of the model
    expect(world().messages).toHaveLength(0);
  });

  it("the person's own confirmation cannot lift an exclusion", async () => {
    const l = await researched({ companyName: "Royal Gambling", industry: "Gambling" });
    expect(code(await draftOutreach(user(), l.id, { by: "user", confirmFit: true }))).toBe("fit_excluded");
    expect(prompts).toHaveLength(0);
  });

  it("the three-versions route is gated by exactly the same rule", async () => {
    const l = await researched({ companyName: "Royal Gambling", industry: "Gambling" });
    expect(code(await draftOutreachVariants(user(), l.id))).toBe("fit_excluded");
    expect(prompts).toHaveLength(0);
  });
});

describe("a lead that doesn't match asks first", () => {
  it("refuses once, without spending a draft, and says what didn't match", async () => {
    const l = await researched({ companyName: "Hudson Creative", industry: "Advertising", location: "Toronto, Canada" });
    const r = await draftOutreach(user(), l.id);
    expect(code(r)).toBe("fit_weak");
    expect((r as any).fit).toMatchObject({ action: "confirm_first", verdict: "weak" });
    expect((r as any).fit.signals.some((s: any) => s.key === "location" && s.status === "mismatch")).toBe(true);
    expect(prompts).toHaveLength(0);
    expect(world().messages).toHaveLength(0);
  });

  it("writes it when the person confirms, and the draft still goes through every other check", async () => {
    const l = await researched({ companyName: "Hudson Creative", industry: "Advertising", location: "Toronto, Canada" });
    const r = await draftOutreach(user(), l.id, { by: "user", confirmFit: true });
    expect(r.ok).toBe(true);
    expect(world().messages).toHaveLength(1);
    expect((r as any).fit.verdict).toBe("weak");
  });

  it("an AI coworker's task cannot confirm on the person's behalf: the lead is reported, not written", async () => {
    const l = await researched({ companyName: "Hudson Creative", industry: "Advertising", location: "Toronto, Canada" });
    expect(code(await draftOutreach(user(), l.id, { by: "agent", confirmFit: true }))).toBe("fit_weak");
    expect(prompts).toHaveLength(0);
    expect(world().messages).toHaveLength(0);
  });
});

describe("a partial match is written, cautiously", () => {
  it("the 400-person agency in a target city: the draft is written, and the model is told what not to assume", async () => {
    const l = await researched({ companyName: "Socialpanga", teamSize: "over 400 employees" });
    const r = await draftOutreach(user(), l.id);
    expect(r.ok).toBe(true);
    expect((r as any).fit).toMatchObject({ action: "write_cautiously", verdict: "partial" });
    const [system] = prompts[0];
    expect(system.content).toContain("matches only part of what the sender is looking for");
    expect(system.content).toContain("outside 1–10 people");
    expect(system.content).toMatch(/do not mention any of this in the text/);
  });

  it("a strong fit is written with no caution at all: the prompt is what it always was", async () => {
    const l = await researched({ teamSize: "a team of 8" });
    const r = await draftOutreach(user(), l.id);
    expect(r.ok).toBe(true);
    expect((r as any).fit).toMatchObject({ action: "write", verdict: "strong" });
    expect(prompts[0][0].content).not.toContain("matches only part of what the sender is looking for");
  });

  it("a headcount the company only hints at is never used: an inferred fact leaves the size unknown", async () => {
    const l = await researched();
    await claim(l.id, "team_size", "over 400 employees", "inferred");
    const r = await draftOutreach(user(), l.id);
    expect(r.ok).toBe(true);
    expect((r as any).fit.signals.find((s: any) => s.key === "size")).toMatchObject({ status: "unknown" });
  });
});

describe("it is always THIS workspace's current profile", () => {
  it("another workspace's ideal client never reaches this one's draft", async () => {
    // ORG2 excludes exactly the kind of company ORG1 is writing to. ORG1's draft must be untouched by that.
    seedProfile(world(), { ...SMALL_INDIAN_AGENCIES, exclusions: ["marketing"] }, ORG2);
    const l = await researched({ teamSize: "a team of 8" });
    const r = await draftOutreach(user(), l.id);
    expect(r.ok).toBe(true);
    expect((r as any).fit.verdict).toBe("strong");
  });

  it("a workspace with no ideal client at all keeps the behaviour it had before the gate existed", async () => {
    world().profiles.delete(ORG1);
    // With nothing saved, a draft may say nothing about the sender either (the offer rule), so the scripted reply
    // asks a question instead. That refusal is the old behaviour, and it is the one that must still apply.
    world().llm = async (m) => { prompts.push(m); return { content: JSON.stringify({ subject: "A question about your studio", body: NEUTRAL_BODY }), toolCalls: [], usage: { inputTokens: 900, outputTokens: 180 } }; };
    const l = await researched({ companyName: "Royal Gambling", industry: "Gambling", location: "Toronto, Canada" });
    const r = await draftOutreach(user(), l.id);
    expect(r.ok).toBe(true);
    expect((r as any).fit).toMatchObject({ action: "write", verdict: "no_profile" });
  });

  it("the profile is re-read for every draft: an exclusion added now stops the next one", async () => {
    const first = await researched({ teamSize: "a team of 8" });
    expect((await draftOutreach(user(), first.id)).ok).toBe(true);

    const saved = await saveIdealClient(user(), { exclusions: ["marketing agency"] });
    expect(saved.ok).toBe(true);
    const second = await researched({ companyName: "Second Studio", industry: "Marketing agency", teamSize: "a team of 6" });
    expect(code(await draftOutreach(user(), second.id))).toBe("fit_excluded");
  });

  it("raising the size cap now lets through what it refused a moment ago", async () => {
    const l = await researched({ companyName: "Socialpanga", teamSize: "over 400 employees" });
    expect((await draftOutreach(user(), l.id) as any).fit.verdict).toBe("partial");

    expect((await saveIdealClient(user(), { maxEmployees: 1000 })).ok).toBe(true);
    const other = await researched({ companyName: "Socialpanga Two", teamSize: "over 400 employees" });
    expect((await draftOutreach(user(), other.id) as any).fit).toMatchObject({ verdict: "strong", action: "write" });
  });
});

describe("the lead's page says what will happen before the click", () => {
  it("listMessages carries the same verdict the gate will apply", async () => {
    const l = await researched({ companyName: "Royal Gambling", industry: "Gambling" });
    const r = await listMessages(user(), l.id);
    expect(r.ok).toBe(true);
    expect((r as any).fit).toMatchObject({ action: "refuse", verdict: "excluded" });
    expect((r as any).fitStale).toBe(false);
  });

  it("a draft written before the ideal client was last changed is flagged, never rewritten or discarded", async () => {
    const l = await researched({ teamSize: "a team of 8" });
    const written = await draftOutreach(user(), l.id);
    expect(written.ok).toBe(true);
    // The draft was written a minute ago; the profile is edited now. (In a test everything else shares one millisecond.)
    world().messages[0].createdAt = new Date(Date.now() - 60_000);

    // The person edits their ideal client afterwards.
    expect((await saveIdealClient(user(), { targetLocations: ["India", "Bengaluru", "Mumbai", "Pune"] })).ok).toBe(true);
    const r = await listMessages(user(), l.id);
    expect(r.ok).toBe(true);
    expect((r as any).fitStale).toBe(true);
    expect((r as any).messages).toHaveLength(1); // the draft is still there, word for word
    expect((r as any).messages[0].body).toBe(BODY);
  });
});

describe("Mika's background task is wired as an agent, which is what makes the gate unskippable for her", () => {
  it("mika.first_messages passes by: \"agent\" to draftOutreach", async () => {
    // The task calls the real draftOutreach through server/ai-league/wiring.ts. `by: "agent"` is the one thing that
    // stops a coworker confirming its own warning, so it is checked at the wiring itself rather than only in a mock.
    const { readFileSync } = await import("node:fs");
    const wiring = readFileSync(new URL("../../ai-league/wiring.ts", import.meta.url), "utf8");
    const handler = wiring.slice(wiring.indexOf('"mika.first_messages"'), wiring.indexOf('"zee.briefing"'));
    expect(handler).toContain("draftOutreach");
    expect(handler).toMatch(/by:\s*"agent"/);
    expect(handler).not.toMatch(/confirmFit/);
  });
});
