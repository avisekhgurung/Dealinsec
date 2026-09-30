import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import { chatSystemPrompt } from "./voice";
import { resolveLocaleSettings } from "@shared/schema";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const IN = resolveLocaleSettings({ country: "IN" } as any);
const US = resolveLocaleSettings({ country: "US" } as any);

describe("the client-work Copilot prompt is exactly the one that shipped", () => {
  // Hashes of the prompt as it was before the audience change (checked against
  // the previous revision for IN, US, GB, AE and DE). A wording edit to the
  // client-work prompt changes these on purpose and should be a decision.
  it("India", () => {
    expect(sha(chatSystemPrompt(IN))).toBe("8660344257df0284ce44766e97e4f8be185ac215593b4d45b22d6271f375a264");
    expect(chatSystemPrompt(IN, "client_work")).toBe(chatSystemPrompt(IN));
  });
  it("the neutral voice", () => {
    expect(sha(chatSystemPrompt(US))).toBe("b0135c06fb12dd9185546e671badf19c88444c5595361a62a71d47102af7ef88");
    expect(chatSystemPrompt(US, "client_work")).toBe(chatSystemPrompt(US));
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
