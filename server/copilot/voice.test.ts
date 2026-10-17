import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import { chatSystemPrompt } from "./voice";
import { resolveLocaleSettings } from "@shared/schema";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const IN = resolveLocaleSettings({ country: "IN" } as any);
const US = resolveLocaleSettings({ country: "US" } as any);

describe("the client-work Copilot prompt is exactly the one that shipped", () => {
  // Hashes of the client-work prompt. A wording edit changes these on purpose
  // and should be a decision. Last decided 2026-10-17: the audience line moved
  // from solo freelancers to founder-led agencies and consultants
  // (shared/product-facts.ts AUDIENCE_LINE); nothing else changed. Then 2026-10-17
  // (India launch): solo founders starting a B2B service business joined that line. Then 2026-10-17 (AI client
  // research positioning): the line names AI automation consultants and small AI agencies first; nothing else changed.
  // Then 2026-10-18 (Free/Pro ₹199 realignment): the line is freelancers, solo consultants and small B2B service
  // agencies, and the separate "plus freelancers" clause was dropped as a duplicate; nothing else changed.
  it("India", () => {
    expect(sha(chatSystemPrompt(IN))).toBe("8fe72d87f4bc2a0f14f4f28d398e412751c3759b69f0be8ff88a8f93dfd43628");
    expect(chatSystemPrompt(IN, "client_work")).toBe(chatSystemPrompt(IN));
  });
  it("the neutral voice", () => {
    expect(sha(chatSystemPrompt(US))).toBe("78c536c813889b27efc71bdd9c669408e9e7e10f73539993af3c8c1de7fe662d");
    expect(chatSystemPrompt(US, "client_work")).toBe(chatSystemPrompt(US));
  });
});

describe("who the assistants are told they serve", () => {
  it("freelancers, consultants and small B2B service agencies, never the old creative-freelancer list", () => {
    for (const p of [chatSystemPrompt(IN), chatSystemPrompt(US)]) {
      expect(p).toMatch(/freelancers, solo consultants and small B2B service agencies of about 1 to 10 people/);
      expect(p).not.toMatch(/India's freelancers|Solo professionals|video editors & photographers/);
    }
  });
});

describe("the brand-collaboration Copilot prompt", () => {
  const p = chatSystemPrompt(US, "brand_collaboration");

  it("offers the brand deal type first and asks for brand terms", () => {
    expect(p).toContain('exactly one of "Brand Collaboration", "Design"');
    expect(p).toContain("brandTerms {campaign, usageRights, usageDuration, exclusivity, approval}");
    expect(p).toContain("create_deal {brandName, dealTitle, dealType, dealAmount, startDate, endDate, deliverables, customTerms, brandTerms}");
  });

  it("forbids inventing a term the message does not state", () => {
    expect(p).toMatch(/OMIT that key entirely/);
    expect(p).toMatch(/never guess a duration/);
    expect(p).toMatch(/never assume the brand is offering or asking for exclusivity/);
  });

  it("keeps every hard rule of the client-work prompt", () => {
    const client = chatSystemPrompt(US);
    const rules = client.slice(client.indexOf("HARD RULES:"), client.indexOf("ACTIONS:"));
    expect(p).toContain(rules);
  });
});
