/**
 * The homepage's visible copy (the React sections, read as source) and the price every surface quotes: the promise
 * and CTA that shipped, human approval beside it, allowances and prices that come from the plan definition rather
 * than typed numbers, no invented outcomes or customer claims, example data labelled as such, and no in-page link
 * pointing at a section that isn't there. The crawler copy of the same page is checked in seo.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GLOBAL_PLANS } from "@shared/globalPlans";
import { PRICING } from "@shared/product-facts";
import { OUTBOUND_ALLOWANCE_DEFAULTS } from "@shared/outbound-plans";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const FILES = ["client/src/components/landing-redesign.tsx", "client/src/components/landing-try-demo.tsx", "client/src/pages/landing.tsx"];
const src = Object.fromEntries(FILES.map((f) => [f, read(f)]));
const all = Object.values(src).join("\n");
const sections = src["client/src/components/landing-redesign.tsx"];

describe("homepage copy", () => {
  it("leads with the brand promise, says who it's for and what Free includes, with human approval beside the CTA", () => {
    expect(sections).toContain("Find clients.<br />Win <span");
    expect(sections).toContain("For freelancers and service providers in India");
    expect(sections).toContain("DealInSec is a simple business workspace for Indian freelancers and service providers. Track leads and deals, prepare quotations and agreements, create invoices and follow up on payments, with AI coworkers to help along the way.");
    expect(sections).toContain('"Get started free"');
    expect(sections).toContain("See how it works");
    expect(sections).toContain("No credit card required");
    expect(sections).toContain("you approve every message and send it yourself. Nothing is sent automatically.");
    expect(sections).toMatch(/Free: \$\{PRICING\.freeMonthlyDeals\} new deals a month with quotations/);
  });

  it("walks the real five-stage workflow, each stage naming its plan", () => {
    for (const [stage, plan] of [["Research a potential client", "Free"], ["Save the prospect and manage the lead", "Free"], ["Create a deal and send a quotation", "Free"], ["Create an agreement and collect a signature", "Pro"], ["Generate an invoice and track payment", "Pro"]]) {
      expect(sections, stage).toContain(`label: "${stage}", plan: "${plan}"`);
    }
  });

  it("keeps every audience, freelancers included", () => {
    for (const a of ["Freelance web developers", "Designers and creatives", "Digital marketers and SEO consultants", "Independent consultants"]) expect(sections, a).toContain(a);
    // Small agencies stay named as the secondary audience.
    expect(sections).toContain("small agencies of up to about 10 people: web development, digital marketing, SEO, AI automation");
    expect(sections).toContain('href: "/for-freelancers"');
  });

  it("quotes AI search allowances and prices from the plan definition, never as typed numbers", () => {
    // e.g. "3 searches" or "₹199" written by hand would drift from shared/outbound-plans.ts and the billing code.
    // ("4 searches planned" in the labelled demonstration and the daily cap of 5 are not allowances.)
    expect(all).not.toMatch(/(^|[^{$\w])\d+\s+(AI\s+)?(prospect\s+|research\s+)?searches(?! planned| a day)/m);
    expect(all).not.toMatch(new RegExp(`₹${PRICING.proMonthlyInr}\\b`));
    expect(all).toMatch(/OUTBOUND_ALLOWANCE_DEFAULTS/);
    expect(all).toMatch(/every \$\{OUTBOUND_WINDOW_DAYS\} days/);
  });

  it("states the checkout terms the billing code implements: the listed price, no tax added, no auto-renewal", () => {
    const landing = src["client/src/pages/landing.tsx"];
    expect(landing).toContain("is charged at checkout, with no tax added on top");
    expect(landing).toMatch(/doesn&apos;t renew or charge automatically/);
  });

  it("promises no outcomes and invents no customers, reviews or numbers", () => {
    // Only a negated guarantee ("doesn't guarantee clients") may appear.
    expect(all).not.toMatch(/(?<!(n't|n&apos;t|not|never|no) )guarantee(s|d)? (you |more )?(clients|revenue|meetings|replies|results|leads)/i);
    expect(all).not.toMatch(/verified (emails?|contacts?|contact details)/i);
    expect(all).not.toMatch(/\b\d[\d,]*\+?\s+(happy\s+)?(customers|agencies use|users|teams trust)/i);
    expect(all).not.toMatch(/<Testimonial|TESTIMONIALS\s*=|aggregateRating|★★★★/);
  });

  it("labels example data and keeps inference apart from evidence", () => {
    expect(sections).toContain("Real DealInSec screens (Client Radar and The Nest), with example data.");
    expect(sections).toContain("Demonstration with example data.");
    expect(sections).toContain("Possible opportunity · inference");
    expect(sections).toMatch(/\.example/); // example domains use the reserved TLD, so no real company is implied
  });

  it("every in-page link points at a section that exists", () => {
    const ids = new Set([...all.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]));
    const hashes = new Set([...all.matchAll(/href[:=]\s*"#([\w-]+)"/g)].map((m) => m[1]));
    expect(hashes.size).toBeGreaterThan(3);
    for (const h of hashes) expect(ids.has(h), `#${h}`).toBe(true);
    for (const h of ["pricing", "faq"]) expect(ids.has(h), `#${h} (linked from llms.txt)`).toBe(true);
  });
});

describe("one price everywhere", () => {
  it("the plan definition, the server's checkout default and the client's fallback agree", async () => {
    const saved = process.env.PRO_MONTHLY_PRICE;
    delete process.env.PRO_MONTHLY_PRICE;
    try {
      const { getProMonthlyPrice } = await import("./razorpayClient");
      expect(getProMonthlyPrice()).toBe(GLOBAL_PLANS.INR.monthly!.amount);
    } finally {
      if (saved !== undefined) process.env.PRO_MONTHLY_PRICE = saved;
    }
    expect(PRICING.proMonthlyInr).toBe(GLOBAL_PLANS.INR.monthly!.amount);
    const hook = read("client/src/hooks/use-plan-prices.ts");
    expect(hook).toContain(`proMonthlyPrice: ${PRICING.proMonthlyInr},`);
    // The trial gets Pro's AI allowance; free is smaller.
    expect(OUTBOUND_ALLOWANCE_DEFAULTS.trial.monthlySearches).toBeLessThanOrEqual(OUTBOUND_ALLOWANCE_DEFAULTS.pro.monthlySearches);
    expect(OUTBOUND_ALLOWANCE_DEFAULTS.free.monthlySearches).toBeLessThan(OUTBOUND_ALLOWANCE_DEFAULTS.pro.monthlySearches);
  });
});

describe("no trial on the homepage, sign-up or pricing", () => {
  it("offers the free plan, never a trial", () => {
    const offer = /\b\d+-day (pro |free )?trial|free trial|start (your |the )?(free )?trial|\{PRICING\.trialDays\}|free for 7 days/i;
    for (const f of [...FILES, "client/src/pages/auth.tsx", "client/src/pages/pricing.tsx", "client/src/pages/onboarding.tsx", "client/src/pages/pitch.tsx"]) {
      const text = read(f).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
      expect(text, f).not.toMatch(offer);
    }
  });
});
