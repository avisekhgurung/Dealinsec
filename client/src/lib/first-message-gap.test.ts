import { describe, expect, it } from "vitest";
import { canWriteOwn, gapNote, ownMessageProblem } from "./first-message-gap";

describe("what the page says before the click when a first message can't be written", () => {
  it("says nothing when nothing is missing, or when an older server names no gap", () => {
    expect(gapNote(null, true)).toBeNull();
    expect(gapNote(undefined, false)).toBeNull();
    expect(gapNote("something_new" as any, true)).toBeNull();
  });

  it("no address: says so, and always offers adding one", () => {
    for (const site of [true, false]) {
      const n = gapNote("address", site)!;
      expect(n.why).toMatch(/no email address/);
      expect(n.fix).toMatch(/Add a contact email/);
    }
  });

  it("research is only suggested for a lead that has a website to read", () => {
    expect(gapNote("address", true)!.fix).toMatch(/Researching their website/);
    expect(gapNote("address", false)!.fix).not.toMatch(/esearch/);
    expect(gapNote("facts", true)!.fix).toMatch(/^Research the lead first/);
    expect(gapNote("facts", false)!.fix).toMatch(/^Add the company's website/);
  });
});

describe("writing the first message yourself", () => {
  it("is open whenever there is somewhere to send it: verified facts are the model's need, not the person's", () => {
    expect(canWriteOwn(null)).toBe(true);
    expect(canWriteOwn(undefined)).toBe(true);
    expect(canWriteOwn("facts")).toBe(true);
    expect(canWriteOwn("address")).toBe(false);
  });

  const L = { subjectMin: 3, subjectMax: 120, bodyMin: 40, bodyMax: 1500 };
  const BODY = "Hello, I run a small studio nearby and wanted to introduce myself.";
  it("says nothing while nothing is typed, and nothing can be saved", () => {
    expect(ownMessageProblem("", "", L)).toBe("");
    expect(ownMessageProblem("  ", "\n", L)).toBe("");
  });
  it("names the one thing to fix, the subject first", () => {
    expect(ownMessageProblem("", BODY, L)).toMatch(/Add a subject/);
    expect(ownMessageProblem("Hi", BODY, L)).toMatch(/Add a subject/);
    expect(ownMessageProblem("Hello there", "Too short.", L)).toMatch(/at least 40 characters \(10 so far\)/);
    expect(ownMessageProblem("x".repeat(121), BODY, L)).toMatch(/subject is too long/);
    expect(ownMessageProblem("Hello there", "y".repeat(1501), L)).toMatch(/message is too long/);
  });
  it("is satisfied by a real subject and message, spaces around them aside", () => {
    expect(ownMessageProblem("  Hello there ", `  ${BODY}  `, L)).toBeNull();
    expect(ownMessageProblem("abc", "z".repeat(40), L)).toBeNull();
  });
});
