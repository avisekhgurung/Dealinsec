import { describe, expect, it } from "vitest";
import {
  CONVERTIBLE_FROM, LEAD_STATUSES, OPEN_STATUSES, allowedMoves, canConvertFrom, canMove, claimInputSchema,
  isLeadStatus, isOpen, leadFieldsSchema, normalizeDomain,
} from "./leads";

describe("the stage machine", () => {
  it("every stage has a defined set of moves, and none moves to itself or to an unknown stage", () => {
    for (const s of LEAD_STATUSES) {
      for (const to of allowedMoves(s)) {
        expect(to, `${s} → ${to}`).not.toBe(s);
        expect(isLeadStatus(to)).toBe(true);
      }
    }
  });

  it("'won' is reachable by NO plain move: a lead is won only by creating its deal", () => {
    for (const s of LEAD_STATUSES) expect(canMove(s, "won"), s).toBe(false);
  });

  it("won is terminal", () => {
    expect(allowedMoves("won")).toEqual([]);
    for (const s of LEAD_STATUSES) expect(canMove("won", s)).toBe(false);
  });

  it("every open stage can be marked lost, and lost can only be reopened to new", () => {
    for (const s of OPEN_STATUSES) expect(canMove(s, "lost"), s).toBe(true);
    expect(allowedMoves("lost")).toEqual(["new"]);
  });

  it("the funnel runs forward one stage at a time, with sensible steps back", () => {
    expect(canMove("new", "researching")).toBe(true);
    expect(canMove("researching", "qualified")).toBe(true);
    expect(canMove("qualified", "contacted")).toBe(true);
    expect(canMove("contacted", "replied")).toBe(true);
    expect(canMove("replied", "meeting")).toBe(true);
    expect(canMove("meeting", "proposal")).toBe(true);
    expect(canMove("proposal", "meeting")).toBe(true);
    // No skipping from the start to the end.
    expect(canMove("new", "proposal")).toBe(false);
    expect(canMove("new", "meeting")).toBe(false);
    expect(canMove("contacted", "proposal")).toBe(false);
  });

  it("every open stage is reachable from 'new' by plain moves", () => {
    const seen = new Set<string>(["new"]);
    const queue = ["new"] as (typeof LEAD_STATUSES[number])[];
    while (queue.length) for (const to of allowedMoves(queue.shift()!)) if (!seen.has(to)) { seen.add(to); queue.push(to); }
    for (const s of OPEN_STATUSES) expect(seen.has(s), s).toBe(true);
  });

  it("only qualified-and-later stages can be converted to a deal", () => {
    expect([...CONVERTIBLE_FROM]).toEqual(["qualified", "contacted", "replied", "meeting", "proposal"]);
    for (const s of ["new", "researching", "won", "lost"] as const) expect(canConvertFrom(s), s).toBe(false);
    for (const s of CONVERTIBLE_FROM) expect(isOpen(s)).toBe(true);
  });
});

describe("normalizeDomain", () => {
  it("reduces every way of writing a website to one comparable host", () => {
    for (const v of ["acme.com", "ACME.com", "https://www.Acme.com/about?x=1", "http://acme.com/", "www.acme.com", "  acme.com  ", "https://acme.com:8080/x"]) {
      expect(normalizeDomain(v), v).toBe("acme.com");
    }
    expect(normalizeDomain("https://blog.acme.co.uk/post")).toBe("blog.acme.co.uk");
  });
  it("rejects what isn't a hostname", () => {
    for (const v of ["", "   ", "not a domain", "localhost", "http://", "javascript:alert(1)", "acme", "a..com", `${"a".repeat(300)}.com`, 42, null, undefined, {}]) {
      expect(normalizeDomain(v as any), String(v)).toBeNull();
    }
  });
});

describe("claims: a confirmed fact must show where it was seen", () => {
  const base = { field: "uses_zendesk", value: "Uses Zendesk for support" };
  it("confirmed needs a URL and the words from the page", () => {
    expect(claimInputSchema.safeParse({ ...base, status: "confirmed" }).success).toBe(false);
    expect(claimInputSchema.safeParse({ ...base, status: "confirmed", evidenceUrl: "https://acme.com/support" }).success).toBe(false);
    expect(claimInputSchema.safeParse({ ...base, status: "confirmed", evidenceSnippet: "Contact our Zendesk help center" }).success).toBe(false);
    expect(claimInputSchema.safeParse({ ...base, status: "confirmed", evidenceUrl: "https://acme.com/support", evidenceSnippet: "Contact our Zendesk help center" }).success).toBe(true);
  });
  it("inferred, unknown and conflicting need no evidence", () => {
    for (const status of ["inferred", "unknown", "conflicting"] as const) expect(claimInputSchema.safeParse({ ...base, status }).success, status).toBe(true);
  });
  it("evidence must be an http(s) URL", () => {
    for (const evidenceUrl of ["javascript:alert(1)", "ftp://acme.com/x", "acme.com/support", "file:///etc/passwd"]) {
      expect(claimInputSchema.safeParse({ ...base, status: "confirmed", evidenceUrl, evidenceSnippet: "some words here" }).success, evidenceUrl).toBe(false);
    }
  });
});

describe("lead fields", () => {
  it("needs a company name, trims, and drops blanks", () => {
    expect(leadFieldsSchema.safeParse({ companyName: "   " }).success).toBe(false);
    const ok = leadFieldsSchema.parse({ companyName: "  Acme  ", industry: "  ", location: " Austin " });
    expect(ok).toMatchObject({ companyName: "Acme", location: "Austin" });
    expect(ok.industry).toBeUndefined();
  });
  it("a contact email must be a real address, and is lower-cased", () => {
    expect(leadFieldsSchema.safeParse({ companyName: "A", contactEmail: "not-an-email" }).success).toBe(false);
    expect(leadFieldsSchema.parse({ companyName: "A", contactEmail: "  Jane@Acme.COM " }).contactEmail).toBe("jane@acme.com");
  });
  it("caps lengths", () => {
    expect(leadFieldsSchema.safeParse({ companyName: "x".repeat(121) }).success).toBe(false);
    expect(leadFieldsSchema.safeParse({ companyName: "A", fitSummary: "x".repeat(1001) }).success).toBe(false);
  });
});
