import { describe, expect, it } from "vitest";
import { gapNote } from "./first-message-gap";

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
