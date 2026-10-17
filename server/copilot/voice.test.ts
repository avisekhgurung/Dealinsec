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
  // (shared/product-facts.ts AUDIENCE_LINE); nothing else changed.
  it("India", () => {
    expect(sha(chatSystemPrompt(IN))).toBe("5f676506e0ecfb888ab03d53e061425647bb1eadbb6865d9d4e8a60ec43889bc");
    expect(chatSystemPrompt(IN, "client_work")).toBe(chatSystemPrompt(IN));
  });
  it("the neutral voice", () => {
    expect(sha(chatSystemPrompt(US))).toBe("2755bd081b1a6053cc5273b03069af924835d9f712ff8876c54e13019b026b12");
    expect(chatSystemPrompt(US, "client_work")).toBe(chatSystemPrompt(US));
  });
});

describe("who the assistants are told they serve", () => {
  it("agencies and consultants first, never 'solo professionals' or India's freelancers", () => {
    for (const p of [chatSystemPrompt(IN), chatSystemPrompt(US)]) {
      expect(p).toMatch(/founder-led B2B service businesses of about 1 to 10 people/);
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
