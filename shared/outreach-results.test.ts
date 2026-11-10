/** Results beyond the funnel, the pure half: discovery stages, contact coverage, campaign numbers and their totals. */
import { describe, expect, it } from "vitest";
import { campaignResultsView, discoveryView, EMPTY_DISCOVERY, resultsDays, SMALL_BASE, type CampaignResultCounts } from "./outreach-results";

describe("what searches found", () => {
  it("each stage is a share of the one before, and coverage is a share of the companies with a real website", () => {
    const v = discoveryView({ discovered: 200, verified: 120, qualified: 60, ready: 15, researched: 80, leads: 12, person: 30, publicRoute: 90, verifiedEmail: 6 });
    expect(v.stages.map((s) => [s.key, s.count, s.fromPrevious])).toEqual([["discovered", 200, null], ["verified", 120, 60], ["qualified", 60, 50], ["ready", 15, 25]]);
    expect(v.coverage.map((c) => [c.key, c.count, c.share])).toEqual([["person", 30, 25], ["publicRoute", 90, 75], ["verifiedEmail", 6, 5]]);
    expect(v).toMatchObject({ coverageBase: 120, researched: 80, leads: 12 });
    expect(v.notes).toEqual(["40 real companies have not been researched in depth yet, so who to reach there and why now aren't known. A bulk list ends there on purpose."]);
  });
  it("with nothing found there are no percentages and no notes: unknown is not zero", () => {
    const v = discoveryView(EMPTY_DISCOVERY);
    expect(v.stages.map((s) => [s.count, s.fromPrevious])).toEqual([[0, null], [0, null], [0, null], [0, null]]);
    expect(v.coverage.map((c) => c.share)).toEqual([null, null, null]);
    expect(v.notes).toEqual([]);
  });
  it("says when there are too few to read, when nothing was researched, and when no email is verified", () => {
    const v = discoveryView({ ...EMPTY_DISCOVERY, discovered: 5, verified: 4, publicRoute: 2 });
    expect(v.notes).toEqual([
      "Only 5 companies found in this window: too few to read the percentages from.",
      "4 real companies have not been researched in depth yet, so who to reach there and why now aren't known. A bulk list ends there on purpose.",
      "No email address has been verified. That needs a contact provider connected to this server; without one, addresses are found on companies' own sites, not verified.",
    ]);
    expect(discoveryView({ ...EMPTY_DISCOVERY, discovered: 1, verified: 1, researched: 1 }).notes[0]).toBe("Only 1 company found in this window: too few to read the percentages from.");
    expect(discoveryView({ ...EMPTY_DISCOVERY, discovered: SMALL_BASE, verified: SMALL_BASE, researched: SMALL_BASE, verifiedEmail: 1 }).notes).toEqual([]);
  });
  it("a count that can't be true is brought inside the stage before it, never shown as more than 100%", () => {
    const v = discoveryView({ discovered: 10, verified: 12, qualified: 20, ready: 30, researched: 99, leads: 99, person: 50, publicRoute: 50, verifiedEmail: 50 });
    expect(v.stages.map((s) => s.count)).toEqual([10, 10, 10, 10]);
    expect(v.coverage.every((c) => c.count === 10 && c.share === 100)).toBe(true);
    expect([v.researched, v.leads]).toEqual([10, 10]);
    expect(discoveryView({ ...EMPTY_DISCOVERY, discovered: -3 }).stages[0].count).toBe(0);
  });
  it("the window is one of the three offered", () => {
    expect([resultsDays("30"), resultsDays(365), resultsDays("7"), resultsDays(undefined)]).toEqual([30, 365, 90, 90]);
  });
});

const camp = (over: Partial<CampaignResultCounts> = {}): CampaignResultCounts => ({ id: 1, name: "A", profileName: null, archived: false, createdAt: "2026-11-01T00:00:00.000Z", members: 0, sent: 0, replied: 0, interested: 0, bounced: 0, optedOut: 0, meeting: 0, proposal: 0, won: 0, wonValueMinor: 0, ...over });

describe("what campaigns sent and got back", () => {
  it("rates are a share of what was sent, per campaign and in total", () => {
    const v = campaignResultsView([
      camp({ id: 1, name: "A", profileName: "Brands", members: 30, sent: 20, replied: 5, interested: 2, bounced: 1, optedOut: 1, meeting: 2, proposal: 1, won: 1, wonValueMinor: 5_000_000 }),
      camp({ id: 2, name: "B", profileName: "Brands", members: 10, sent: 10, replied: 1 }),
      camp({ id: 3, name: "C", members: 8, sent: 10 /* more than its members: capped */, replied: 4, interested: 4 }),
    ]);
    expect(v.rows.map((r) => [r.name, r.sent, r.replyRate, r.interestedRate, r.bounceRate])).toEqual([["A", 20, 25, 10, 5], ["B", 10, 10, 0, 0], ["C", 8, 50, 50, 0]]);
    expect(v.totals).toEqual({ campaigns: 3, sent: 38, replied: 10, interested: 6, bounced: 1, optedOut: 1, meeting: 2, proposal: 1, won: 1, wonValueMinor: 5_000_000, replyRate: 26, interestedRate: 16, bounceRate: 3 });
    expect(v.byProfile).toEqual([
      { profileName: "Brands", campaigns: 2, sent: 30, replied: 6, interested: 2, bounced: 1, meeting: 2, proposal: 1, won: 1, wonValueMinor: 5_000_000, replyRate: 20, interestedRate: 7 },
      { profileName: null, campaigns: 1, sent: 8, replied: 4, interested: 4, bounced: 0, meeting: 0, proposal: 0, won: 0, wonValueMinor: 0, replyRate: 50, interestedRate: 50 },
    ]);
    expect(v.notes).toEqual(["Meetings, proposals and wins are leads that reached that stage after a campaign's message was sent to them. They followed the message; that doesn't prove the message caused them."]);
  });
  it("nothing sent means no rates, said in words", () => {
    const v = campaignResultsView([camp({ members: 12 })]);
    expect(v.rows[0]).toMatchObject({ sent: 0, replyRate: null, interestedRate: null, bounceRate: null });
    expect(v.totals).toMatchObject({ sent: 0, replyRate: null, bounceRate: null });
    expect(v.notes).toContain("Nothing has been sent from these campaigns yet, so there are no rates.");
    expect(v.byProfile).toEqual([]); // one campaign: a breakdown would only repeat it
  });
  it("a few sends are flagged as too few to read", () => {
    const v = campaignResultsView([camp({ members: 5, sent: 3, replied: 1 })]);
    expect(v.rows[0].replyRate).toBe(33);
    expect(v.notes).toContain("Only 3 messages sent across these campaigns: too few to read rates from.");
    expect(campaignResultsView([camp({ members: 1, sent: 1 })]).notes).toContain("Only 1 message sent across these campaigns: too few to read rates from.");
  });
  it("nothing can come back from more than was sent, and a later stage sits inside the earlier one", () => {
    const [r] = campaignResultsView([camp({ members: 10, sent: 4, replied: 9, interested: 9, bounced: 9, optedOut: 9, meeting: 9, proposal: 9, won: 9, wonValueMinor: 100 })]).rows;
    expect(r).toMatchObject({ sent: 4, replied: 4, interested: 4, bounced: 4, optedOut: 4, meeting: 4, proposal: 4, won: 4, replyRate: 100 });
    const [none] = campaignResultsView([camp({ members: 10, sent: 4, won: 0, wonValueMinor: 999 })]).rows;
    expect(none.wonValueMinor).toBe(0); // no won lead, no won value
    const [chain] = campaignResultsView([camp({ members: 10, sent: 10, meeting: 2, proposal: 5, won: 7 })]).rows;
    expect([chain.meeting, chain.proposal, chain.won]).toEqual([2, 2, 2]);
  });
  it("no campaigns is an empty table with no notes", () => {
    expect(campaignResultsView([])).toEqual({ rows: [], byProfile: [], totals: { campaigns: 0, sent: 0, replied: 0, interested: 0, bounced: 0, optedOut: 0, meeting: 0, proposal: 0, won: 0, wonValueMinor: 0, replyRate: null, interestedRate: null, bounceRate: null }, notes: [] });
  });
});
