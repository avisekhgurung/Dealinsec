import { describe, expect, it } from "vitest";
import { KNOWN_BIG_CAP, bigCompanyIn, classifyHiring, knownBigApplies, outsideHelpIn } from "./opportunity-signals";

describe("when the known-big rule applies (option B: only a small-team ICP)", () => {
  it("a cap of 20 or fewer switches it on; a bigger cap or no cap leaves every company alone", () => {
    expect(knownBigApplies({ employeeMax: 5 })).toBe(true);
    expect(knownBigApplies({ employeeMax: KNOWN_BIG_CAP })).toBe(true);
    expect(knownBigApplies({ employeeMax: 21 })).toBe(false);
    expect(knownBigApplies({ employeeMax: 200 })).toBe(false);
    expect(knownBigApplies({ employeeMax: null })).toBe(false);
  });
});

describe("outside-help wording (the override, and a buying signal in itself)", () => {
  it("recognises the ways a business asks for outside help", () => {
    for (const t of [
      "We're looking for a freelance Next.js developer for a client project",
      "Seeking a white-label development partner for our agency",
      "Contract basis, remote, 3 months",
      "We outsource all our design work",
      "Looking for an agency to rebuild our store",
      "Hire a freelancer to automate this",
    ]) expect(outsideHelpIn(t), t).toBeTruthy();
  });
  it("says nothing about ordinary company copy", () => {
    for (const t of [
      "We are hiring a Senior SEO Strategist to join our SaaS team",
      "A full-service digital marketing agency in Austin",
      "Our team of 12 serves ecommerce brands",
      null, "",
    ]) expect(outsideHelpIn(t), String(t)).toBeNull();
  });
});

describe("big-company wording", () => {
  it("recognises disclosed funding and accelerator badges", () => {
    for (const t of [
      "We raised our Series A to grow the team",
      "Backed by Sequoia and Accel",
      "Y Combinator W24 batch",
      "We closed a $4 million seed round",
      "venture-backed startup scaling fast",
      "Techstars alumni",
    ]) expect(bigCompanyIn(t), t).toBeTruthy();
  });
  it("never reads plain copy as funding", () => {
    for (const t of [
      "A series of workshops for founders",
      "We run a webinar series about growth",
      "Raised in Mumbai, our founder started in 2019",
      "Our seed-to-table restaurant",
      null, "",
    ]) expect(bigCompanyIn(t), String(t)).toBeNull();
  });
});

describe("what a hiring notice means for a freelancer", () => {
  it("an ask for a freelancer / contractor / white-label partner is outside help, even when full-time words appear too", () => {
    expect(classifyHiring("Freelance designer wanted, full-time hours possible")).toBe("outside_help");
    expect(classifyHiring("Hiring a contractor for a 3-month rebuild")).toBe("outside_help");
    expect(classifyHiring("White label SEO partner wanted")).toBe("outside_help");
  });
  it("a plain full-time opening is full_time", () => {
    expect(classifyHiring("Hiring a full-time software engineer, benefits include health insurance")).toBe("full_time");
    expect(classifyHiring("Permanent role: in-house designer, salaried")).toBe("full_time");
    expect(classifyHiring("Join our team as a growth marketer")).toBe("full_time");
  });
  it("wording that says neither stays unclear (and changes nothing downstream)", () => {
    expect(classifyHiring("We are hiring a Senior SEO Strategist")).toBe("unclear");
    expect(classifyHiring("")).toBe("unclear");
    expect(classifyHiring(null)).toBe("unclear");
  });
});
