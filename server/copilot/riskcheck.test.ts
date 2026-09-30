import { describe, expect, it } from "vitest";
import { analyzeDealProtections, flagPriority, protectionPasses, summarizeProtection } from "./riskcheck";
import { resolveLocaleSettings } from "@shared/schema";

const settings = resolveLocaleSettings({ country: "IN" } as any);

const GOOD_CLIENT_TERMS = [
  "50% advance payment before work starts.",
  "The balance is due within 7 days of final delivery.",
  "Up to 2 rounds of revisions are included.",
  "Anything not listed is excluded and quoted separately.",
  "Late payment may pause work.",
  "If the project is cancelled, the advance is non-refundable.",
  "Ownership of the final work passes to the client on full payment.",
  "Work is accepted once the client approves it.",
].join(" ");

// The usage and approval sentences deliberately avoid the money words the
// payment checks look for.
const GOOD_BRAND_TERMS = [
  "50% advance payment before work starts.",
  "The balance is due within 7 days of posting.",
  "Up to 2 rounds of revisions are included.",
  "Anything not listed is excluded.",
  "Late payment may pause work.",
  "If the campaign is cancelled, the advance is non-refundable.",
  "The creator keeps ownership of the content.",
].join(" ");

const ids = (r: { flags: { id: string }[] }) => r.flags.map((f) => f.id);
const clientDeal = (customTerms = "", extra: object = {}) =>
  ({ dealType: "Design", customTerms, standardTermIds: [], ...extra }) as any;
const brandDeal = (customTerms = "", brandTerms: object | null = null, extra: object = {}) =>
  ({ dealType: "Brand Collaboration", customTerms, standardTermIds: [], brandTerms, ...extra }) as any;

describe("client-work checks", () => {
  it("raises every gap for a deal with no terms", () => {
    const r = analyzeDealProtections(clientDeal(), settings);
    expect(r.audience).toBe("client_work");
    expect(ids(r)).toEqual(
      expect.arrayContaining([
        "no_advance", "no_balance_timeline", "no_revision_limit", "no_exclusions",
        "no_late_protection", "no_cancellation", "no_ownership", "no_acceptance",
      ]),
    );
    expect(r.gaps).toBe(8);
  });

  it("raises nothing for complete terms", () => {
    const r = analyzeDealProtections(clientDeal(GOOD_CLIENT_TERMS), settings);
    expect(r.flags).toEqual([]);
    expect(protectionPasses(r)).toContain("Cancellation is covered");
    expect(protectionPasses(r)).toContain("Acceptance step is defined");
  });

  it("never runs a brand check on a client deal, so no false 'usage rights' pass", () => {
    const r = analyzeDealProtections(clientDeal(GOOD_CLIENT_TERMS), settings);
    expect(r.checked).not.toContain("no_usage_rights");
    expect(protectionPasses(r).join(" ")).not.toMatch(/usage|exclusivity is specified|approval process/i);
  });

  it("treats a missing deal type as client work, as the demo and draft shapes do", () => {
    const r = analyzeDealProtections({ customTerms: "", standardTermIds: [] } as any, settings);
    expect(r.audience).toBe("client_work");
    // No dates or deliverables were supplied, so those checks did not run.
    expect(r.checked).not.toContain("no_deadline");
    expect(r.checked).not.toContain("no_deliverables");
  });

  it("keeps the existing wording for client work exactly", () => {
    const r = analyzeDealProtections(clientDeal("Unlimited revisions. Payment within 7 days, then within 30 days."), settings);
    const unlimited = r.flags.find((f) => f.id === "unlimited_revisions")!;
    expect(unlimited.title).toBe("Unlimited revisions promised");
    expect(unlimited.detail).toBe(
      "Unlimited changes means the project ends when the client feels like it. Cap revisions and price the rest.",
    );
    expect(r.flags.find((f) => f.id === "conflicting_figures")!.detail).toContain("whichever suits the client");
    expect(r.flags.find((f) => f.id === "no_advance")!.detail).toBe(
      "Starting without an advance means you carry all the risk — and the awkward conversation happens after the work.",
    );
  });

  it("keeps the flag priorities the first surfaces rely on", () => {
    const r = analyzeDealProtections(clientDeal("Unlimited revisions"), settings);
    const by = (id: string) => r.flags.find((f) => f.id === id)!;
    expect(flagPriority(by("unlimited_revisions"))).toBe("high");
    expect(flagPriority(by("no_advance"))).toBe("high");
    expect(flagPriority(by("no_balance_timeline"))).toBe("high");
    expect(flagPriority(by("no_exclusions"))).toBe("attention");
  });

  it("flags an empty deliverables list and a blank deadline only when the deal has those fields", () => {
    const r = analyzeDealProtections(clientDeal(GOOD_CLIENT_TERMS, { deliverables: [], endDate: "" }), settings);
    expect(ids(r)).toEqual(expect.arrayContaining(["no_deliverables", "no_deadline"]));
    const ok = analyzeDealProtections(
      clientDeal(GOOD_CLIENT_TERMS, { deliverables: [{ id: "1" }], endDate: "2026-11-01" }),
      settings,
    );
    expect(ok.flags).toEqual([]);
    expect(protectionPasses(ok)).toEqual(expect.arrayContaining(["Deliverables are listed", "A deadline is set"]));
  });
});

describe("brand-collaboration checks", () => {
  it("raises the creator gaps for a brand deal with no terms", () => {
    const r = analyzeDealProtections(brandDeal(), settings);
    expect(r.audience).toBe("brand_collaboration");
    expect(ids(r)).toEqual(
      expect.arrayContaining(["no_usage_rights", "no_exclusivity_terms", "no_approval_process", "no_ownership"]),
    );
    // Not raised: usage duration only makes sense once usage is stated at all.
    expect(ids(r)).not.toContain("no_usage_duration");
    // The client-only acceptance check does not apply.
    expect(ids(r)).not.toContain("no_acceptance");
  });

  it("puts the usage-rights finding first among the gaps, worded as a question to ask", () => {
    const r = analyzeDealProtections(brandDeal(), settings);
    const usage = r.flags.find((f) => f.id === "no_usage_rights")!;
    expect(usage.level).toBe("important");
    expect(usage.title).toBe("Usage rights aren't specified");
    expect(usage.ask).toBe("Ask the brand how long they can use the content and whether paid advertising is included.");
    expect(r.flags.findIndex((f) => f.id === "no_usage_rights")).toBeLessThan(
      r.flags.findIndex((f) => f.id === "no_approval_process"),
    );
  });

  it("asks for a duration once usage is stated without one", () => {
    const r = analyzeDealProtections(brandDeal(GOOD_BRAND_TERMS, { usageRights: "Organic posts and paid ads" }), settings);
    expect(ids(r)).toContain("no_usage_duration");
    expect(ids(r)).not.toContain("no_usage_rights");
  });

  it("accepts a duration written in the brand terms or in the free text", () => {
    const a = analyzeDealProtections(
      brandDeal(GOOD_BRAND_TERMS, { usageRights: "Organic posts", usageDuration: "6 months" }),
      settings,
    );
    expect(ids(a)).not.toContain("no_usage_duration");
    const b = analyzeDealProtections(brandDeal(`${GOOD_BRAND_TERMS} Usage rights are limited to 3 months.`), settings);
    expect(ids(b)).not.toContain("no_usage_duration");
    expect(ids(b)).not.toContain("no_usage_rights");
  });

  it("does not mistake a payment deadline for a usage duration", () => {
    const r = analyzeDealProtections(brandDeal("Usage rights: organic posts. Balance within 30 days."), settings);
    expect(ids(r)).toContain("no_usage_duration");
  });

  it("flags open-ended usage as an important risk", () => {
    for (const wording of ["Usage rights in perpetuity.", "The brand may use the content in all media.", "Unlimited usage."]) {
      const r = analyzeDealProtections(brandDeal(wording), settings);
      const f = r.flags.find((x) => x.id === "open_ended_usage");
      expect(f, wording).toBeDefined();
      expect(f!.severity).toBe("risk");
      expect(f!.level).toBe("important");
    }
  });

  it("is satisfied by complete brand terms", () => {
    const r = analyzeDealProtections(
      brandDeal(GOOD_BRAND_TERMS, {
        campaign: "Autumn launch",
        usageRights: "Organic posts on the brand's own channels",
        usageDuration: "6 months",
        exclusivity: "No exclusivity",
        approval: "One approval round, reply within 2 working days",
      }),
      settings,
    );
    expect(r.flags).toEqual([]);
    expect(protectionPasses(r)).toEqual(
      expect.arrayContaining([
        "Usage rights are specified", "Usage duration is specified",
        "Exclusivity is specified", "Approval process is specified",
      ]),
    );
  });

  it("treats the retired Creator type as a brand deal", () => {
    expect(analyzeDealProtections({ ...brandDeal(), dealType: "Creator" }, settings).audience).toBe("brand_collaboration");
  });

  it("uses brand wording where the finding names the other party", () => {
    const r = analyzeDealProtections(brandDeal("Unlimited revisions."), settings);
    expect(r.flags.find((f) => f.id === "unlimited_revisions")!.detail).toContain("when the brand feels like it");
    expect(r.flags.find((f) => f.id === "no_late_protection")!.detail).toContain("costs the brand nothing");
  });

  it("names the campaign deadline for a brand deal with no end date", () => {
    const r = analyzeDealProtections(brandDeal(GOOD_BRAND_TERMS, null, { endDate: " " }), settings);
    expect(r.flags.find((f) => f.id === "no_deadline")!.title).toBe("Campaign deadline isn't specified");
  });
});

describe("every finding is complete and safe to show", () => {
  const worst = [
    analyzeDealProtections(clientDeal("Unlimited revisions, as per requirement, back to back, retention, to be decided later. Within 7 days and within 30 days."), settings),
    analyzeDealProtections(brandDeal("Usage rights in perpetuity in all media. Unlimited revisions."), settings),
    analyzeDealProtections(brandDeal(), settings),
    analyzeDealProtections(clientDeal(), settings),
  ];

  it("gives each finding a title, why, ask and a level", () => {
    for (const r of worst) {
      for (const f of r.flags) {
        expect(f.title, f.id).toBeTruthy();
        expect(f.why, f.id).toBeTruthy();
        expect(f.detail, f.id).toBe(f.why);
        expect(f.ask, f.id).toBeTruthy();
        expect(["important", "attention", "informational"], f.id).toContain(f.level);
      }
    }
  });

  it("orders findings most important first", () => {
    const rank = { important: 0, attention: 1, informational: 2 };
    for (const r of worst) {
      const ranks = r.flags.map((f) => rank[f.level]);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  it("claims no legal outcome, guarantee or compliance", () => {
    const banned = /\b(legally binding|legal advice|guarantee[ds]?|lawyer|compliant|compliance|enforceable)\b/i;
    for (const r of worst) {
      for (const f of r.flags) {
        expect(`${f.title} ${f.why} ${f.ask} ${f.suggestedTerm ?? ""}`, f.id).not.toMatch(banned);
      }
    }
  });

  it("offers a ready-to-use term for every gap and none for a risk", () => {
    for (const r of worst) {
      for (const f of r.flags) {
        if (f.severity === "risk") expect(f.suggestedTerm, f.id).toBeUndefined();
      }
    }
    const gaps = analyzeDealProtections(brandDeal(), settings).flags.filter((f) => f.severity === "gap");
    for (const f of gaps) expect(f.suggestedTerm, f.id).toBeTruthy();
  });

  it("reports counts that match the flags", () => {
    for (const r of worst) {
      expect(r.risks + r.gaps).toBe(r.flags.length);
    }
  });
});


describe("summarizeProtection — the dashboard's figures", () => {
  const report = (deal: any) => analyzeDealProtections(deal, settings);

  it("counts real deals, and is all zeros for none", () => {
    expect(summarizeProtection([])).toEqual({ checked: 0, withIssues: 0, important: 0, usageRights: 0, exclusivity: 0 });
  });

  it("counts a deal with only informational findings as clean", () => {
    // Everything present except the two informational checks.
    const almost = report(clientDeal(GOOD_CLIENT_TERMS.replace("Anything not listed is excluded and quoted separately. ", "").replace("Late payment may pause work. ", "")));
    expect(almost.flags.every((f) => f.level === "informational")).toBe(true);
    expect(summarizeProtection([almost]).withIssues).toBe(0);
  });

  it("separates issues, important issues, usage-rights and exclusivity counts", () => {
    const summary = summarizeProtection([
      report(clientDeal(GOOD_CLIENT_TERMS)),            // clean
      report(clientDeal("")),                           // client: important + attention
      report(brandDeal(GOOD_BRAND_TERMS)),              // brand: no usage rights (important), no exclusivity
      report(brandDeal(GOOD_BRAND_TERMS, { usageRights: "Organic", usageDuration: "3 months", exclusivity: "None", approval: "Once" })), // brand: fine
    ]);
    expect(summary.checked).toBe(4);
    expect(summary.withIssues).toBe(2);
    expect(summary.important).toBe(2);
    expect(summary.usageRights).toBe(1);
    expect(summary.exclusivity).toBe(1);
  });

  it("never counts a brand check against a client deal", () => {
    const s = summarizeProtection([report(clientDeal(""))]);
    expect(s.usageRights).toBe(0);
    expect(s.exclusivity).toBe(0);
  });
});
