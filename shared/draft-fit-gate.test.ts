/**
 * The ideal client decides what happens to a draft. These are the cases the product promises, each written as the
 * kind of company a DealInSec user actually looks for, so a change of rule has to answer for a real scenario.
 *
 * Nothing here involves a model, a database or a network: the verdict is a rule over what the person typed and what
 * the company states about itself, and this file pins the rule to the behaviour.
 */
import { describe, expect, it } from "vitest";
import { draftFitGate, fitCaution } from "./draft-fit-gate";
import { EMPTY_IDEAL_CLIENT, assessFit, type FitLead, type IdealClient } from "./fit";

/** The founder's own profile, in the shape a small Indian agency-focused freelancer really saves it. */
const INDIA_AGENCIES: IdealClient = {
  ...EMPTY_IDEAL_CLIENT,
  about: "I build web and AI applications for small agencies.",
  services: ["Next.js development", "AI automation"],
  targetIndustries: ["marketing agencies", "web design agencies", "software development agencies", "freelance web developers"],
  targetLocations: ["India", "Bengaluru", "Mumbai", "Siliguri"],
  exclusions: ["gambling", "tobacco"],
  minEmployees: 1,
  maxEmployees: 10,
};

const gate = (profile: IdealClient | null, lead: FitLead) => draftFitGate(assessFit(profile, lead));
const sized = (n: string) => [{ field: "team_size", value: n }];

describe("who gets written to, and how", () => {
  it("1. a small Indian digital marketing agency: strong fit, written normally", () => {
    const g = gate(INDIA_AGENCIES, { companyName: "Bluebird Media", industry: "Digital marketing agency", location: "Bengaluru, India", claims: sized("a team of 8") });
    expect(g.verdict).toBe("strong");
    expect(g.action).toBe("write");
    expect(fitCaution(g)).toBeNull(); // nothing limits what it may say beyond the usual rules
  });

  it("2. an Indian freelance React developer: strong fit", () => {
    const g = gate(INDIA_AGENCIES, { companyName: "Rohit Sharma", industry: "Freelance web developer", location: "Mumbai", claims: sized("1 person") });
    expect(g.verdict).toBe("strong");
    expect(g.action).toBe("write");
  });

  it("3. a small Indian software development agency: strong fit", () => {
    const g = gate(INDIA_AGENCIES, { companyName: "Nimbus Labs", industry: "Software development agency", location: "Siliguri", claims: sized("6 employees") });
    expect(g.verdict).toBe("strong");
    expect(g.action).toBe("write");
  });

  it("4. a 400-person agency in a target city: the size is the only mismatch, so it is a possible fit, written cautiously", () => {
    // This is the Socialpanga case. Industry and place match; the headcount it publishes does not.
    const g = gate(INDIA_AGENCIES, { companyName: "Socialpanga", industry: "Digital marketing agency", location: "Bengaluru, India", claims: sized("over 400 employees") });
    expect(g.verdict).toBe("partial");
    expect(g.action).toBe("write_cautiously");
    expect(g.signals.find((s) => s.key === "size")).toMatchObject({ status: "mismatch" });
    const caution = fitCaution(g)!;
    expect(caution).toContain("outside 1–10 people");
    expect(caution).toMatch(/do not assume they have the problem/);
  });

  it("4b. with no size set, that same 400-person agency is a strong fit: a blank field invents no requirement", () => {
    const g = gate({ ...INDIA_AGENCIES, minEmployees: null, maxEmployees: null }, { companyName: "Socialpanga", industry: "Digital marketing agency", location: "Bengaluru, India", claims: sized("over 400 employees") });
    expect(g.verdict).toBe("strong");
    expect(g.action).toBe("write");
  });

  it("5. outside the target geography: weak, so it asks before spending a draft", () => {
    const g = gate(INDIA_AGENCIES, { companyName: "Hudson Creative", industry: "Advertising", location: "Toronto, Canada", claims: sized("12 people") });
    expect(g.verdict).toBe("weak");
    expect(g.action).toBe("confirm_first");
    expect(g.message).toMatch(/doesn't match your ideal client/);
    expect(g.message).toMatch(/no AI draft was used/);
  });

  it("6. an excluded business: refused outright, with the exclusion named", () => {
    const g = gate(INDIA_AGENCIES, { companyName: "Royal Gambling", industry: "Gambling", location: "Mumbai" });
    expect(g.verdict).toBe("excluded");
    expect(g.action).toBe("refuse");
    expect(g.excludedBy).toEqual(["gambling"]);
    expect(g.message).toContain("gambling");
    expect(g.next).toMatch(/Shorten or remove that exclusion|archive the lead/);
  });

  it("6b. an exclusion only matches the company's own words, never a word inside another", () => {
    const g = gate({ ...EMPTY_IDEAL_CLIENT, exclusions: ["online gambling"] }, { companyName: "Northwind", industry: "Online retail" });
    expect(g.verdict).not.toBe("excluded");
  });

  it("6c. a short exclusion still fires when its words are split up or reordered", () => {
    const g = gate({ ...EMPTY_IDEAL_CLIENT, exclusions: ["bulk spam email"] }, { companyName: "Blastr", industry: "Marketing", fitSummary: "We send bulk email, including spam campaigns." });
    expect(g.verdict).toBe("excluded");
    expect(g.excludedBy).toEqual(["bulk spam email"]);
  });

  it("6d. an exclusion written as a sentence is reported, not silently ignored and not guessed at", () => {
    const wordy = "large enterprises requiring complex enterprise procurement or custom integrations";
    const g = gate({ ...INDIA_AGENCIES, exclusions: [wordy] }, { companyName: "Socialpanga", industry: "Digital marketing agency", location: "Bengaluru, India", claims: sized("over 400 employees") });
    expect(g.verdict).not.toBe("excluded"); // it is not matched against a company's words by guesswork
    expect(g.exclusionsNotCompared).toEqual([wordy]);
    expect(g.action).toBe("write_cautiously"); // the size criterion is what catches this company
  });

  it("7. a company that publishes no headcount is unknown, never a rejection", () => {
    const g = gate(INDIA_AGENCIES, { companyName: "Quiet Studio", industry: "Web design agency", location: "Pune, India" });
    expect(g.signals.find((s) => s.key === "size")).toMatchObject({ status: "unknown" });
    expect(g.verdict).toBe("partial"); // matched on two things; the size simply can't be checked
    expect(g.action).toBe("write_cautiously");
    expect(g.missing).toContain("how many people it has");
    expect(g.excludedBy).toEqual([]);
  });

  it("8. a blank ideal client fabricates no restriction: every lead is written to as before", () => {
    const g = gate(EMPTY_IDEAL_CLIENT, { companyName: "Anyone At All", industry: "Something", location: "Somewhere", claims: sized("4000 staff") });
    expect(g.verdict).toBe("no_profile");
    expect(g.action).toBe("write");
    expect(g.signals).toEqual([]);
    expect(g.next).toMatch(/Set your ideal client/);
  });

  it("8b. a profile with only an offer and no criteria is still no profile to compare with", () => {
    const g = gate({ ...EMPTY_IDEAL_CLIENT, about: "I build websites", services: ["Web design"] }, { companyName: "X", industry: "Gambling" });
    expect(g.action).toBe("write");
  });

  it("a size criterion alone is enough to compare against: silence elsewhere is not a profile-wide blank", () => {
    const g = gate({ ...EMPTY_IDEAL_CLIENT, maxEmployees: 10 }, { companyName: "Big Co", industry: "Marketing", claims: sized("900 employees") });
    expect(g.verdict).toBe("weak");
    expect(g.action).toBe("confirm_first");
  });

  it("the verdict never claims more than it compared: a match it could not check is not rounded up", () => {
    const g = gate({ ...INDIA_AGENCIES, maxEmployees: 10 }, { companyName: "Half Known", industry: "Marketing agency", location: null });
    expect(g.verdict).not.toBe("strong");
  });

  it("a cautious draft is told what not to claim, and told not to mention any of it in the email", () => {
    const g = gate(INDIA_AGENCIES, { companyName: "Socialpanga", industry: "Digital marketing agency", location: "Bengaluru, India", claims: sized("400+ employees") });
    const caution = fitCaution(g)!;
    expect(caution).toMatch(/matches only part of what the sender is looking for/);
    // Every "write" action carries no caution at all, so a strong fit's prompt is exactly what it always was.
    expect(fitCaution(gate(INDIA_AGENCIES, { companyName: "Bluebird", industry: "Marketing agency", location: "India", claims: sized("5 people") }))).toBeNull();
  });

  it("only confirmed facts are ever handed in: an inferred guess is the caller's job to filter, so the rule sees none", () => {
    // The services pass only confirmed claims (server/sales/outreach.ts, server/services/ideal-client.ts). The rule
    // itself takes whatever it is given, which is why that filter is tested where it is applied.
    const g = gate(INDIA_AGENCIES, { companyName: "Maybe Co", industry: "Marketing agency", location: "India", claims: [] });
    expect(g.signals.find((s) => s.key === "size")).toMatchObject({ status: "unknown" });
  });
});
