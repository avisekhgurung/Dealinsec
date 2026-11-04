import { describe, expect, it } from "vitest";
import { MAX_VARIANTS, OUTREACH_STRATEGIES, STRATEGY_LABEL, selectStrategies, type StrategyInput } from "./outreach-strategy";

const BARE: StrategyInput = { facts: [], angles: [], radar: null, offerDescribed: true, sampleAvailable: false };
const fact = (id: number, field: string, value = "x") => ({ id, field, value });
const strategies = (i: Partial<StrategyInput>) => selectStrategies({ ...BARE, ...i }).map((c) => c.strategy);

describe("direct is the floor", () => {
  it("with no evidence at all, direct is the only strategy", () => {
    expect(strategies({})).toEqual(["direct"]);
  });
  it("direct is always present and always last", () => {
    const all = selectStrategies({
      facts: [fact(1, "recent_news", "Opened Casa Alma Porto in September")],
      angles: [fact(2, "pain_point", "Bookings are phone-only"), fact(3, "opportunity", "No online booking")],
      radar: null, offerDescribed: true, sampleAvailable: true,
    });
    expect(all.map((c) => c.strategy)).toEqual(["trigger", "problem", "value", "direct"]);
    expect(all.length).toBeGreaterThan(MAX_VARIANTS); // callers take the first MAX_VARIANTS
  });
  it("without a described offer, direct explains why it only asks a question", () => {
    const [d] = selectStrategies({ ...BARE, offerDescribed: false });
    expect(d.reason).toMatch(/haven't described your offer/);
  });
});

describe("trigger-led needs something that just happened", () => {
  it.each(["recent_news", "launch", "hiring"])("a confirmed %s fact grounds it", (field) => {
    expect(strategies({ facts: [fact(7, field)] })).toEqual(["trigger", "direct"]);
  });
  it.each(["buying_signal", "timing"])("a %s guess grounds it", (field) => {
    expect(strategies({ angles: [fact(7, field)] })).toEqual(["trigger", "direct"]);
  });
  it("ordinary facts (description, industry, location) do not", () => {
    expect(strategies({ facts: [fact(1, "description"), fact(2, "industry"), fact(3, "location"), fact(4, "team_size")] })).toEqual(["direct"]);
  });
  it("it carries the ids of exactly the triggering claims", () => {
    const [t] = selectStrategies({ ...BARE, facts: [fact(1, "industry"), fact(2, "hiring")], angles: [fact(3, "timing"), fact(4, "pain_point")] });
    expect(t.strategy).toBe("trigger");
    expect(t.evidenceIds).toEqual([2, 3]);
  });
  it("the reason names what happened, in plain words", () => {
    const [t] = selectStrategies({ ...BARE, facts: [fact(1, "hiring", "3 open roles")] });
    expect(t.reason).toBe("Opens with that they're hiring.");
  });
  it("field names are normalized before matching", () => {
    expect(strategies({ facts: [fact(1, "Recent News")] })).toEqual(["trigger", "direct"]);
  });
});

describe("problem-led needs a possible problem", () => {
  it("a pain_point guess grounds it, with its claim ids", () => {
    const got = selectStrategies({ ...BARE, angles: [fact(9, "pain_point", "Bookings are phone-only")] });
    expect(got.map((c) => c.strategy)).toEqual(["problem", "direct"]);
    expect(got[0].evidenceIds).toEqual([9]);
  });
  it("a Client Radar problem grounds it too, but contributes no claim ids", () => {
    const got = selectStrategies({ ...BARE, radar: { problem: "Guests can't book online", opportunity: null } });
    expect(got[0].strategy).toBe("problem");
    expect(got[0].evidenceIds).toEqual([]);
    expect(got[0].reason).toMatch(/earlier research/);
  });
  it("a blank radar problem does not", () => {
    expect(strategies({ radar: { problem: "  ", opportunity: null } })).toEqual(["direct"]);
  });
});

describe("value-first needs an offer AND something concrete", () => {
  it("an opportunity guess with a described offer grounds it", () => {
    const got = selectStrategies({ ...BARE, angles: [fact(5, "opportunity", "No online booking")] });
    expect(got.map((c) => c.strategy)).toEqual(["value", "direct"]);
    expect(got[0].evidenceIds).toEqual([5]);
  });
  it("the sender's sample grounds it on its own", () => {
    const [v] = selectStrategies({ ...BARE, sampleAvailable: true });
    expect(v.strategy).toBe("value");
    expect(v.reason).toMatch(/sample/);
  });
  it("a Client Radar opportunity grounds it", () => {
    expect(strategies({ radar: { problem: null, opportunity: "A booking page would cut phone time" } })).toEqual(["value", "direct"]);
  });
  it("without a described offer there is no value version, whatever the evidence", () => {
    expect(strategies({ offerDescribed: false, sampleAvailable: true, angles: [fact(5, "opportunity")], radar: { problem: null, opportunity: "x" } })).toEqual(["direct"]);
  });
  it("an offer alone, with nothing concrete, is not enough", () => {
    expect(strategies({ offerDescribed: true })).toEqual(["direct"]);
  });
});

describe("the module is honest and stable", () => {
  it("the same input always gives the same choices", () => {
    const input: StrategyInput = {
      facts: [fact(1, "launch", "New spa wing")], angles: [fact(2, "pain_point", "Understaffed front desk")],
      radar: { problem: "p", opportunity: "o" }, offerDescribed: true, sampleAvailable: false,
    };
    expect(selectStrategies(input)).toEqual(selectStrategies(input));
  });
  it("every strategy has a label, and no reason promises a result", () => {
    for (const s of OUTREACH_STRATEGIES) expect(STRATEGY_LABEL[s]).toBeTruthy();
    const all = selectStrategies({
      facts: [fact(1, "recent_news", "n")], angles: [fact(2, "pain_point", "p"), fact(3, "opportunity", "o")],
      radar: null, offerDescribed: true, sampleAvailable: true,
    });
    for (const c of all) expect(c.reason).not.toMatch(/\b(?:reply rate|conversion|probabilit|guarantee|will respond|% )/i);
  });
});
