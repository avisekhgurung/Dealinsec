import { describe, expect, it } from "vitest";
import { amountAppearsIn, buildDealDraft, confirmProposal, readAdvancePercent, readRevisions, registerProposal } from "./proposals";
import { resolveLocaleSettings } from "@shared/schema";

const settings = resolveLocaleSettings({ country: "IN" } as any);
const me = { id: "u1", organizationId: "o1" };

describe("amountAppearsIn — the model may not invent an amount", () => {
  it.each([
    ["Budget is ₹80,000 for the site", 80000],
    ["around 80000 rupees", 80000],
    ["₹80k total", 80000],
    ["1.5 lakh budget", 150000],
    ["Budget is $1,500. Need it in two weeks", 1500],
    ["2 crore project", 20000000],
  ])("finds %s", (text, n) => expect(amountAppearsIn(text, n)).toBe(true));

  it.each([
    ["I need a landing page in 2 weeks", 1500],
    ["Budget is $1,500", 15000],
    ["two revisions please", 2000],
  ])("does not find %s", (text, n) => expect(amountAppearsIn(text, n)).toBe(false));
});

describe("reading terms", () => {
  it("reads revision limits", () => {
    expect(readRevisions("Up to 2 rounds of revisions are included.")).toBe(2);
    expect(readRevisions("two revisions")).toBe(2);
    expect(readRevisions("no mention")).toBeNull();
  });
  it("reads the advance", () => {
    expect(readAdvancePercent("50% advance payment")).toBe(50);
    expect(readAdvancePercent("advance of 30%")).toBe(30);
    expect(readAdvancePercent("nothing")).toBeNull();
  });
});

const candidate = (customTerms?: string) => ({
  brandName: "Acme", dealTitle: "Landing page", dealType: "Development",
  dealAmountMinor: 150000, startDate: "2026-09-22", endDate: "2026-10-06",
  deliverables: [{ platform: "Design", contentType: "Landing page design", quantity: 1, frequency: "One-time", notes: "" }],
  customTerms,
});

describe("buildDealDraft", () => {
  it("flags missing protections and marks the money ones high priority", () => {
    const d = buildDealDraft(candidate("Up to 2 rounds of revisions are included."), 1500, settings, "Budget is $1,500");
    const ids = d.protection.flags.map((f) => f.id);
    expect(ids).toContain("no_advance");
    expect(ids).not.toContain("no_revision_limit");
    expect(d.protection.flags.find((f) => f.id === "no_balance_timeline")?.priority).toBe("high");
    expect(d.protection.flags.find((f) => f.id === "no_exclusions")?.priority).toBe("attention");
    expect(d.protection.passes).toContain("Revision limit is defined");
    expect(d.revisions).toBe(2);
    expect(d.timeline).toBe("2 weeks");
    expect(d.warnings).toEqual([]);
  });

  it("warns when the amount is not in the user's words", () => {
    const d = buildDealDraft(candidate(), 1500, settings, "I need a landing page");
    expect(d.warnings[0]).toMatch(/couldn't find this amount/i);
  });

  it("flags dangerous wording as high priority", () => {
    const d = buildDealDraft(candidate("Unlimited revisions included"), 1500, settings, "$1,500");
    expect(d.protection.flags.find((f) => f.id === "unlimited_revisions")?.priority).toBe("high");
  });
});

describe("buildDealDraft for a brand collaboration", () => {
  const brand = (customTerms?: string, brandTerms: object | null = null) => ({
    ...candidate(customTerms),
    brandName: "Glow Skincare",
    dealTitle: "Autumn launch",
    dealType: "Brand Collaboration",
    brandTerms,
    deliverables: [{ platform: "Instagram", contentType: "Reel", quantity: 2, frequency: "One-time", notes: "" }],
  });

  it("runs the creator checks and keeps them out of a client draft", () => {
    const d = buildDealDraft(brand("50% advance. Balance within 7 days."), 800, settings, "$800 for 2 Reels");
    expect(d.audience).toBe("brand_collaboration");
    const ids = d.protection.flags.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["no_usage_rights", "no_exclusivity_terms", "no_approval_process"]));
    const client = buildDealDraft(candidate("50% advance. Balance within 7 days."), 800, settings, "$800");
    expect(client.audience).toBe("client_work");
    expect(client.protection.flags.map((f) => f.id)).not.toContain("no_usage_rights");
  });

  it("marks usage rights important and carries the question to ask", () => {
    const d = buildDealDraft(brand(), 800, settings, "$800");
    const usage = d.protection.flags.find((f) => f.id === "no_usage_rights")!;
    expect(usage.level).toBe("important");
    expect(usage.ask).toMatch(/whether paid advertising is included/);
  });

  it("does not report a deadline the server defaulted", () => {
    const d = buildDealDraft(brand(), 800, settings, "$800");
    expect(d.protection.flags.map((f) => f.id)).not.toContain("no_deadline");
  });

  it("carries the brand terms to the card and to the edit form", () => {
    const terms = { usageRights: "Organic posts", usageDuration: "3 months" };
    const d = buildDealDraft(brand("", terms), 800, settings, "$800");
    expect(d.brandTerms).toEqual(terms);
    expect(d.prefill.brandTerms).toEqual(terms);
    expect(d.protection.flags.map((f) => f.id)).not.toContain("no_usage_rights");
    expect(d.protection.flags.map((f) => f.id)).not.toContain("no_usage_duration");
  });
});

describe("proposals run at most once", () => {
  it("replays the first result on a repeat, without running again", async () => {
    const id = registerProposal(me, "create_deal", { brandName: "Acme" }, "x");
    let runs = 0;
    const run = async () => { runs++; return { ok: true, message: "made", route: "/deals/1" }; };
    const a = await confirmProposal(id, me, run);
    const b = await confirmProposal(id, me, run);
    expect(runs).toBe(1);
    expect(a.body.replay).toBeUndefined();
    expect(b.body).toMatchObject({ ok: true, route: "/deals/1", replay: true });
  });

  it("refuses a second click while the first is still running", async () => {
    const id = registerProposal(me, "create_deal", {}, "x");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = confirmProposal(id, me, async () => { await gate; return { ok: true, message: "made" }; });
    const second = await confirmProposal(id, me, async () => ({ ok: true, message: "should not run" }));
    expect(second.status).toBe(409);
    release();
    expect((await first).status).toBe(200);
  });

  it("treats another user's id, or an unknown id, as not found", async () => {
    const id = registerProposal(me, "create_deal", {}, "x");
    const run = async () => ({ ok: true, message: "no" });
    expect((await confirmProposal(id, { id: "u2", organizationId: "o1" }, run)).status).toBe(404);
    expect((await confirmProposal(id, { id: "u1", organizationId: "o2" }, run)).status).toBe(404);
    expect((await confirmProposal("nope", me, run)).status).toBe(404);
    expect((await confirmProposal(undefined, me, run)).status).toBe(404);
  });

  it("reopens after a failed run so the user can retry", async () => {
    const id = registerProposal(me, "create_deal", {}, "x");
    const fail = await confirmProposal(id, me, async () => ({ ok: false, message: "no credits" }));
    expect(fail.status).toBe(403);
    const ok = await confirmProposal(id, me, async () => ({ ok: true, message: "made" }));
    expect(ok.status).toBe(200);
  });
});
