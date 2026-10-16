import { describe, expect, it } from "vitest";
import { contentProblem } from "../mail/provider";
import { followupText } from "./followup-text";

describe("follow-up drafts (a template from the lead, no model)", () => {
  it("greets by first name, names the original topic, and offers a plain way to stop", () => {
    const t = followupText({ step: 1, greetName: "Jo Bloggs", company: "Acme Foods", subject: "A quick idea for Acme", sender: "Ana Silva" });
    expect(t.subject).toBe("Re: A quick idea for Acme");
    expect(t.body).toMatch(/^Hi Jo,\n/);
    expect(t.body).toContain("A quick idea for Acme");
    expect(t.body).toMatch(/won't follow up again/);
    expect(t.body.endsWith("Ana Silva")).toBe(true);
    expect(contentProblem(t.subject, t.body)).toBeNull(); // sendable as approved text
  });
  it("the second is the last, says so, and never doubles \"Re:\"", () => {
    const t = followupText({ step: 2, greetName: null, company: "Acme", subject: "Re: A quick idea", sender: "Ana" });
    expect(t.subject).toBe("Re: A quick idea");
    expect(t.body).toMatch(/^Hello,\n/);
    expect(t.body).toMatch(/One last note/);
  });
});
