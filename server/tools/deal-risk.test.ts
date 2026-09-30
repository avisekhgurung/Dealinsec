/**
 * The Deal Risk Checker's rules, tested on the exact string the browser runs
 * (CORE_JS) — not a TypeScript copy of it.
 */
import { describe, expect, it } from "vitest";
import { CORE_JS, EXAMPLES } from "./deal-risk";
import { analyzeDealProtections } from "../copilot/riskcheck";
import { SHARED_FINDING_IDS, findingText } from "@shared/findingCopy";
import { resolveLocaleSettings } from "@shared/schema";

interface Finding { id: string; level: "important" | "attention" | "informational"; risk: boolean; title: string; why: string; ask: string }
interface Result {
  ok: boolean;
  error?: string;
  kind: "client" | "brand";
  guessed: boolean;
  summary: { label: string; value: string | null }[];
  missing: string[];
  findings: Finding[];
  questions: string[];
  nextStep: string;
  counts: { important: number; attention: number; informational: number };
}
const { drAnalyze, drGuessKind, drDraftMessage } = new Function(
  `${CORE_JS}; return { drAnalyze: drAnalyze, drGuessKind: drGuessKind, drDraftMessage: drDraftMessage };`,
)() as {
  drAnalyze: (text: unknown, kind?: string) => Result;
  drGuessKind: (text: string) => "client" | "brand";
  drDraftMessage: (q: string[]) => string;
};

const ids = (r: Result) => r.findings.map((f) => f.id);
const value = (r: Result, label: string) => r.summary.find((x) => x.label === label)?.value;

const CLIENT = EXAMPLES[0].text;
const BRAND = EXAMPLES[1].text;

describe("the client example from the brief", () => {
  const r = drAnalyze(CLIENT, "client");

  it("reads the fee and the deadline, and the deliverable", () => {
    expect(r.ok).toBe(true);
    expect(value(r, "Fee")).toBe("$1,500");
    expect(value(r, "Deadline")).toMatch(/by October 20/i);
    expect(value(r, "Deliverables")).toMatch(/website/i);
  });

  it("lists what the message leaves out as Not specified", () => {
    expect(value(r, "Payment timing")).toBeNull();
    expect(value(r, "Revision limit")).toBeNull();
    expect(r.missing).toEqual(expect.arrayContaining(["Payment timing", "Revision limit"]));
    expect(r.missing).not.toContain("Fee");
    expect(r.missing).not.toContain("Deadline");
  });

  it("raises the client checks, most important first", () => {
    expect(ids(r)).toEqual(expect.arrayContaining(["no_payment_timing", "no_revision_limit", "no_cancellation", "no_ownership", "no_acceptance"]));
    expect(r.findings[0].level).toBe("important");
    const rank = { important: 0, attention: 1, informational: 2 };
    const ranks = r.findings.map((f) => rank[f.level]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("does not flag what the message does state, and never a brand check", () => {
    expect(ids(r)).not.toContain("no_fee");
    expect(ids(r)).not.toContain("no_deadline");
    for (const brandOnly of ["no_usage_rights", "ads_usage", "no_exclusivity_terms", "no_approval_process", "no_platform"]) {
      expect(ids(r), brandOnly).not.toContain(brandOnly);
    }
  });
});

describe("the brand example from the brief", () => {
  const r = drAnalyze(BRAND, "brand");

  it("reads the fee, the platform, the quantities and the ad use", () => {
    expect(value(r, "Fee")).toBe("$800");
    expect(value(r, "Platform")).toMatch(/instagram/i);
    // Every piece of content it asks for, not just the first.
    expect(value(r, "Deliverables")).toMatch(/2 Instagram Reels/i);
    expect(value(r, "Deliverables")).toMatch(/3 stories/i);
    expect(value(r, "Usage rights")).toMatch(/ads/i);
  });

  it("makes the ad use an important finding, with the question to ask", () => {
    const f = r.findings.find((x) => x.id === "ads_usage")!;
    expect(f.level).toBe("important");
    expect(f.ask).toMatch(/which ad channels, for how long/i);
  });

  it("asks about the things it does not say", () => {
    expect(ids(r)).toEqual(expect.arrayContaining(["no_payment_timing", "no_exclusivity_terms", "no_approval_process", "no_revision_limit"]));
    expect(r.missing).toEqual(expect.arrayContaining(["Payment timing", "Usage duration", "Exclusivity", "Approval process"]));
  });

  it("does not raise both 'no usage duration' and the ad finding for the same gap", () => {
    expect(ids(r)).not.toContain("no_usage_duration");
    expect(ids(r)).not.toContain("no_usage_rights");
  });

  it("never raises a client-only check", () => {
    expect(ids(r)).not.toContain("no_acceptance");
  });
});

describe("kind detection", () => {
  it("reads creator wording as a brand deal", () => {
    for (const t of [BRAND, "We're a skincare brand looking for a UGC creator for TikTok", "Need an influencer for a sponsored post"]) {
      expect(drGuessKind(t), t).toBe("brand");
    }
  });
  it("reads project wording as client work", () => {
    for (const t of [CLIENT, "Can you redesign our logo and business cards? Budget is 500 EUR.", "Need a WordPress site built in 3 weeks"]) {
      expect(drGuessKind(t), t).toBe("client");
    }
  });
  it("guesses only when the kind is not given, and says so", () => {
    expect(drAnalyze(BRAND, "").guessed).toBe(true);
    expect(drAnalyze(BRAND, "").kind).toBe("brand");
    expect(drAnalyze(BRAND, "client").guessed).toBe(false);
    expect(drAnalyze(BRAND, "client").kind).toBe("client");
  });
});

describe("usage rights", () => {
  const brand = (text: string) => drAnalyze(`Hi, we'd like 2 Instagram Reels for $500. ${text}`, "brand");

  it("asks about usage rights when the message says nothing about usage", () => {
    expect(ids(brand(""))).toContain("no_usage_rights");
  });

  it("asks for a duration when organic use is stated without one", () => {
    const r = brand("We would repost the content on our page.");
    expect(ids(r)).toContain("no_usage_duration");
    expect(ids(r)).not.toContain("no_usage_rights");
  });

  it("accepts a stated duration, so neither the duration nor the ad finding is raised", () => {
    const r = brand("We'd use the content for ads for 3 months.");
    expect(ids(r)).not.toContain("no_usage_duration");
    expect(ids(r)).not.toContain("ads_usage");
    expect(ids(r)).not.toContain("no_usage_rights");
  });

  it("does not mistake a payment period for a usage duration", () => {
    const r = brand("We'd use the content for ads. Payment within 30 days.");
    expect(ids(r)).toContain("ads_usage");
  });

  it("flags open-ended wording as an important risk", () => {
    for (const wording of ["We want usage rights in perpetuity.", "The content may be used in all media.", "Unlimited usage rights."]) {
      const f = brand(wording).findings.find((x) => x.id === "open_ended_usage");
      expect(f, wording).toBeDefined();
      expect(f!.risk).toBe(true);
      expect(f!.level).toBe("important");
    }
  });

  it("asks for an exclusivity period when exclusivity is mentioned without one", () => {
    expect(ids(brand("We'd need exclusivity."))).toContain("exclusivity_no_period");
    expect(ids(brand("We'd need exclusivity for 30 days."))).not.toContain("exclusivity_no_period");
    expect(ids(brand("We'd need exclusivity."))).not.toContain("no_exclusivity_terms");
  });
});

describe("a message that covers the points", () => {
  const full =
    "We'd like 3 Instagram Reels for $2,000 by 15 November. 50% advance, the balance within 7 days of posting. " +
    "Up to 2 revisions included, and the brand approves each Reel before posting. Usage rights: organic posts on our channels for 3 months. " +
    "No exclusivity. The creator keeps ownership of the content. If the campaign is cancelled, the advance is non-refundable.";
  const r = drAnalyze(full, "brand");

  it("raises no important findings", () => {
    expect(r.counts.important).toBe(0);
  });

  it("says nothing is missing from what it looks for", () => {
    expect(r.missing).toEqual([]);
  });

  it("still tells the truth about its limits in the next step", () => {
    expect(r.nextStep).toMatch(/quotation and an agreement/i);
    expect(r.nextStep).not.toMatch(/safe|protected|guarantee|compliant/i);
  });
});

describe("risky wording in the message", () => {
  it("flags vague scope and unlimited revisions as risks", () => {
    const r = drAnalyze("Need a website, blog, shop etc. for $2,000 by Friday. Unlimited revisions.", "client");
    const vague = r.findings.find((f) => f.id === "vague_scope")!;
    const unl = r.findings.find((f) => f.id === "unlimited_revisions")!;
    expect(vague.risk).toBe(true);
    expect(unl.risk).toBe(true);
    expect(unl.title).toBe("Unlimited revisions promised");
    // Unlimited revisions are not also reported as "no revision limit".
    expect(ids(r)).not.toContain("no_revision_limit");
  });
});

describe("the wording is the in-app Protection Check's", () => {
  const settings = resolveLocaleSettings({ country: "US" } as any);
  const deal = (dealType: string, customTerms = "", extra: object = {}) =>
    ({ dealType, customTerms, standardTermIds: [], ...extra }) as any;

  it("has a shared text for every id the tool marks as shared", () => {
    const shared = drAnalyze("hi", "client");
    expect(shared.ok).toBe(false);
    // Every finding id the tool can raise that exists in the shared table uses its text.
    for (const kind of ["client", "brand"] as const) {
      const r = drAnalyze("Some words that mention almost nothing useful about the deal at all.", kind);
      for (const f of r.findings) {
        if (SHARED_FINDING_IDS.includes(f.id)) {
          const t = findingText(f.id, kind);
          expect([f.title, f.why, f.ask], `${kind}/${f.id}`).toEqual([t.title, t.why, t.ask]);
        }
      }
    }
  });

  it("the in-app check raises the same words for the same finding", () => {
    const cases: [string, ReturnType<typeof analyzeDealProtections>][] = [
      ["client", analyzeDealProtections(deal("Design", "Unlimited revisions.", { endDate: "" }), settings)],
      ["brand", analyzeDealProtections(deal("Brand Collaboration", "Usage rights in perpetuity in all media.", { endDate: "" }), settings)],
      ["brand", analyzeDealProtections(deal("Brand Collaboration", "Usage: organic posts.", { brandTerms: { usageRights: "Organic posts" } }), settings)],
    ];
    let compared = 0;
    for (const [kind, report] of cases) {
      for (const f of report.flags) {
        if (SHARED_FINDING_IDS.includes(f.id)) {
          const t = findingText(f.id, kind as "client" | "brand");
          expect([f.title, f.why, f.ask], `${kind}/${f.id}`).toEqual([t.title, t.why, t.ask]);
          compared++;
        }
      }
    }
    // The comparison actually ran over a spread of the shared findings.
    expect(compared).toBeGreaterThan(12);
  });

  it("covers every shared id in at least one of the two checks", () => {
    const fromApp = new Set<string>();
    for (const report of [
      analyzeDealProtections(deal("Design", "Unlimited revisions.", { endDate: "" }), settings),
      analyzeDealProtections(deal("Brand Collaboration", "Usage rights in perpetuity in all media.", { endDate: "" }), settings),
      analyzeDealProtections(deal("Brand Collaboration", "Usage: organic posts.", { brandTerms: { usageRights: "Organic posts" } }), settings),
    ]) for (const f of report.flags) fromApp.add(f.id);
    const fromTool = new Set<string>();
    for (const kind of ["client", "brand"]) for (const f of drAnalyze("Some words that say very little about the deal itself.", kind).findings) fromTool.add(f.id);
    for (const id of SHARED_FINDING_IDS) expect(fromApp.has(id) || fromTool.has(id), id).toBe(true);
  });
});

describe("what the checker says is safe to show", () => {
  const banned = /\b(legally binding|legal advice|guarantee[ds]?|lawyer|compliant|compliance|enforceable|safe|protected)\b/i;
  const samples = [
    drAnalyze(CLIENT, "client"),
    drAnalyze(BRAND, "brand"),
    drAnalyze("We want everything etc. in perpetuity in all media, unlimited revisions, exclusivity.", "brand"),
  ];

  it("claims no legal outcome, guarantee or safety in any finding or next step", () => {
    for (const r of samples) {
      for (const f of r.findings) expect(`${f.title} ${f.why} ${f.ask}`, f.id).not.toMatch(banned);
      expect(r.nextStep).not.toMatch(banned);
    }
  });

  it("gives every finding a level, a title, why and a question", () => {
    for (const r of samples) {
      for (const f of r.findings) {
        expect(["important", "attention", "informational"]).toContain(f.level);
        expect(f.title && f.why && f.ask, f.id).toBeTruthy();
      }
    }
  });
});

describe("questions and the draft message", () => {
  const r = drAnalyze(BRAND, "brand");

  it("collects the questions to ask, without repeats, capped", () => {
    expect(r.questions.length).toBeGreaterThan(0);
    expect(r.questions.length).toBeLessThanOrEqual(8);
    expect(new Set(r.questions).size).toBe(r.questions.length);
    expect(r.questions[0]).toBe(r.findings[0].ask);
  });

  it("drafts a short numbered message to send back", () => {
    const m = drDraftMessage(r.questions);
    expect(m).toMatch(/^Hi, thanks for reaching out\./);
    expect(m).toContain(`1. ${r.questions[0]}`);
    expect(m).toContain(`${r.questions.length}. ${r.questions[r.questions.length - 1]}`);
    expect(m).toMatch(/I'll send a quote and an agreement/);
  });
});

describe("input handling", () => {
  it("rejects text that is too short to read", () => {
    for (const t of ["", "   ", "hi", null, undefined, 42]) expect(drAnalyze(t, "client")).toEqual({ ok: false, error: "short" });
  });

  it("treats an unknown kind as 'guess'", () => {
    expect(drAnalyze(CLIENT, "nonsense").guessed).toBe(true);
  });

  it("stays fast on long and pathological input", () => {
    const inputs = [
      "a".repeat(6000),
      "usage ".repeat(1000),
      ("exclusive " + "x".repeat(40) + " ").repeat(120),
      "by " + "1 ".repeat(3000),
      "$".repeat(3000),
      "in perpetuity ".repeat(400),
    ];
    for (const kind of ["client", "brand"]) {
      for (const text of inputs) {
        const t0 = Date.now();
        drAnalyze(text, kind);
        expect(Date.now() - t0, `${kind}: ${text.slice(0, 20)}`).toBeLessThan(500);
      }
    }
  });

  it("does not execute or echo markup: results are plain data the page escapes", () => {
    const r = drAnalyze("<script>alert(1)</script> We'd like 2 Reels for $500 <img src=x onerror=alert(1)>", "brand");
    expect(r.ok).toBe(true);
    // The checker returns matched wording as data; escaping is the page's job (see PAGE_JS esc()).
    expect(typeof r.summary[0].label).toBe("string");
  });
});
