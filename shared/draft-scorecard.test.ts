import { describe, expect, it } from "vitest";
import { WORD_BAND, scoreDraft, type Scorecard, type ScorecardContext } from "./draft-scorecard";

const CTX: ScorecardContext = {
  greetName: "Marta Silva",
  factValues: ["Runs boutique hotels in Lisbon", "Opened Casa Alma Porto in September"],
  evidenceValues: ["Opened Casa Alma Porto in September"],
};
const GOOD = {
  subject: "A question about Casa Alma Porto",
  body: "Hi Marta,\n\nI read that you opened Casa Alma Porto in September, alongside the boutique hotels you run in Lisbon. Opening a second property usually means the booking side gets busier, and I was curious how you're handling that between the two locations right now.\n\nIf that's something you're working on at the moment, would a short chat this week be useful to you?\n\nBest regards,\nUna",
};
const component = (card: Scorecard, key: string) => card.components.find((c) => c.key === key);
const points = (draft: { subject: string; body: string }, key: string, ctx = CTX) => component(scoreDraft(draft, ctx), key)?.points;

describe("the card itself", () => {
  it("a careful draft scores full marks, and total/max add up", () => {
    const card = scoreDraft(GOOD, CTX);
    expect(card.total).toBe(card.max);
    expect(card.total).toBe(card.components.reduce((a, c) => a + c.points, 0));
    expect(card.max).toBe(card.components.reduce((a, c) => a + c.max, 0));
    for (const c of card.components) {
      expect(c.points).toBeGreaterThanOrEqual(0);
      expect(c.points).toBeLessThanOrEqual(c.max);
      expect(c.reason).toBeTruthy();
    }
  });
  it("the same draft always gets the same card", () => {
    expect(scoreDraft(GOOD, CTX)).toEqual(scoreDraft(GOOD, CTX));
  });
  it("it never speaks of reply rates or probabilities", () => {
    const text = JSON.stringify(scoreDraft(GOOD, CTX));
    expect(text).not.toMatch(/reply rate|conversion|probabilit|predicted|likely to respond/i);
  });
});

describe("what cannot be measured is left off the card, not scored zero", () => {
  it("no name to greet: no greeting component, and max shrinks", () => {
    const card = scoreDraft(GOOD, { ...CTX, greetName: null });
    expect(component(card, "greeting")).toBeUndefined();
    expect(card.max).toBe(scoreDraft(GOOD, CTX).max - 1);
  });
  it("no strategy evidence (a direct version): no grounding component", () => {
    expect(component(scoreDraft(GOOD, { ...CTX, evidenceValues: [] }), "grounding")).toBeUndefined();
  });
  it("no facts given: no facts component", () => {
    expect(component(scoreDraft(GOOD, { ...CTX, factValues: [] }), "facts")).toBeUndefined();
  });
});

describe("greeting", () => {
  it("greeting by first name on the first line earns the point", () => {
    expect(points(GOOD, "greeting")).toBe(1);
  });
  it("a draft that greets no one loses it", () => {
    expect(points({ ...GOOD, body: `Hello,\n${GOOD.body.split("\n").slice(1).join("\n")}` }, "greeting")).toBe(0);
  });
  it("the name later in the body doesn't count as a greeting", () => {
    expect(points({ ...GOOD, body: `Hello,\n\nI wanted to reach Marta about the hotel.\n\nWould a chat help?\nUna` }, "greeting")).toBe(0);
  });
});

describe("facts and grounding", () => {
  it("mentioning two known facts earns both points, one fact one point", () => {
    expect(points(GOOD, "facts")).toBe(2);
    const oneFact = { ...GOOD, body: "Hi Marta,\n\nI read that you opened Casa Alma Porto in September and had a thought about how guests find you. It seemed worth asking about directly, since this sort of thing is often easier to talk through than to write about at length here.\n\nWould a short chat this week be useful?\n\nBest,\nUna" };
    expect(points(oneFact, "facts")).toBe(1);
  });
  it("a draft that uses none of the facts gets zero and a plain reason", () => {
    const vague = { ...GOOD, body: "Hi Marta,\n\nI came across your company and wanted to introduce myself, since I work with businesses of a similar shape and often see the same patterns come up for them as they grow and take on more than before.\n\nWould a short chat this week be useful?\n\nBest,\nUna" };
    expect(points(vague, "facts")).toBe(0);
    expect(component(scoreDraft(vague, CTX), "facts")?.reason).toMatch(/none of the known facts/i);
  });
  it("grounding measures the strategy's own evidence, not any fact", () => {
    const offEvidence = { ...CTX, evidenceValues: ["Hiring three front-desk staff for the winter season"] };
    expect(points(GOOD, "grounding", offEvidence)).toBe(0);
  });
  it("touching the evidence with a single word is only partial grounding", () => {
    const touch = { ...CTX, evidenceValues: ["New September spa packages for returning guests"] };
    expect(points(GOOD, "grounding", touch)).toBe(1);
  });
});

describe("length, subject and ask", () => {
  it("inside the word band is 2, the outer band 1, beyond it 0", () => {
    const inBand = scoreDraft(GOOD, CTX);
    expect(component(inBand, "length")?.points).toBe(2);
    const short = { ...GOOD, body: "Hi Marta,\n\nI saw you opened Casa Alma Porto in September. How is booking going across the two hotels now that there are two of them to look after? Happy to compare notes if that would be useful — it seemed worth one short and honest question.\n\nBest,\nUna" };
    expect(points(short, "length")).toBe(1);
    expect(points({ ...GOOD, body: "Hi Marta, would a chat help?" }, "length")).toBe(0);
    expect(points({ ...GOOD, body: Array(WORD_BAND.outerMax + 20).fill("word").join(" ") + "?" }, "length")).toBe(0);
  });
  it("a subject of 3–8 words earns the point; one word doesn't", () => {
    expect(points(GOOD, "subject")).toBe(1);
    expect(points({ ...GOOD, subject: "Hello" }, "subject")).toBe(0);
    expect(points({ ...GOOD, subject: "A short question about bookings at Casa Alma Porto and Lisbon" }, "subject")).toBe(0);
  });
  it("exactly one question is the clear ask; none or a pile of them is not", () => {
    expect(points(GOOD, "ask")).toBe(2);
    expect(points({ ...GOOD, body: GOOD.body.replace(/\?/g, ".") }, "ask")).toBe(0);
    expect(points({ ...GOOD, body: `${GOOD.body}\n\nAlso, who handles this?` }, "ask")).toBe(1);
    expect(points({ ...GOOD, body: `${GOOD.body}\n\nWho handles it? Since when? And why?` }, "ask")).toBe(0);
  });
});

describe("readability and tired phrases", () => {
  it("one run-on sentence loses the readability point, and the reason says how long it ran", () => {
    const runOn = { ...GOOD, body: `Hi Marta,\n\n${Array(40).fill("word").join(" ")} and that is why I am writing to you today about the hotel\n\nWould a chat help?\n\nUna` };
    expect(points(runOn, "readability")).toBe(0);
    expect(component(scoreDraft(runOn, CTX), "readability")?.reason).toMatch(/\d+ words/);
  });
  it.each(["I hope this email finds you well.", "Just a quick question.", "Just checking in.", "We offer a cutting-edge platform.", "Our game-changing approach."])("a cliché costs the freshness point: %s", (s) => {
    expect(points({ ...GOOD, body: `${s}\n${GOOD.body}` }, "fresh")).toBe(0);
  });
  it("the freshness reason quotes the tired phrase", () => {
    const card = scoreDraft({ ...GOOD, body: `I hope this finds you well.\n${GOOD.body}` }, CTX);
    expect(component(card, "fresh")?.reason).toContain("hope this finds you well");
  });
});
