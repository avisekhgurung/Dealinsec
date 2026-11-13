import { describe, expect, it } from "vitest";
import { CAPABILITIES, PRICING, PRICING_LINES, NEVER_CLAIM, productFactsMarkdown, WORKFLOW } from "./product-facts";
import { GLOBAL_PLANS } from "./globalPlans";
import { PRO_INCLUDED_SEATS } from "./permissions";
import { users } from "./schema";

describe("product facts agree with the code that charges and enforces them", () => {
  it("prices: the INR plans, the seat price and the free allowance", async () => {
    expect(PRICING.proMonthlyInr).toBe(GLOBAL_PLANS.INR.monthly!.amount);
    expect(PRICING.proMonthlyInr).toBe(299); // from 12 Nov 2026 (₹199 from 18 Oct)
    expect("proYearlyInr" in PRICING).toBe(false); // one plan, monthly: no annual plan is sold
    expect("trialDays" in PRICING).toBe(false); // there is no trial (server/trial.ts)
    // No free-plan deal cap since 13 Nov 2026: the deal-to-invoice flow is free and unmetered, so the facts
    // must not quote a monthly deal allowance at all. users.monthlyDealCredits survives with its old default,
    // but nothing spends it (POST /api/deals).
    expect("freeMonthlyDeals" in PRICING).toBe(false);
    const saved = { m: process.env.PRO_MONTHLY_PRICE, y: process.env.PRO_YEARLY_PRICE, s: process.env.EXTRA_SEAT_PRICE };
    delete process.env.PRO_MONTHLY_PRICE; delete process.env.PRO_YEARLY_PRICE; delete process.env.EXTRA_SEAT_PRICE;
    try {
      const rz = await import("../server/razorpayClient");
      expect(rz.getProMonthlyPrice()).toBe(PRICING.proMonthlyInr);
      expect(rz.getExtraSeatPrice()).toBe(PRICING.extraSeatInr);
    } finally {
      if (saved.m !== undefined) process.env.PRO_MONTHLY_PRICE = saved.m;
      if (saved.y !== undefined) process.env.PRO_YEARLY_PRICE = saved.y;
      if (saved.s !== undefined) process.env.EXTRA_SEAT_PRICE = saved.s;
    }
  });

  it("checkout is India-only, as the order route enforces", () => {
    expect(PRICING.checkout).toMatch(/India only/);
    expect(PRICING_LINES.join(" ")).toMatch(/Outside India, including the United States, paid plans can't be bought yet/);
  });

  it("one subscription: Client Radar allowances come from the shared plan definition, never unlimited, no separate CRM/AI plan", async () => {
    const { OUTBOUND_ALLOWANCE_DEFAULTS } = await import("./outbound-plans");
    const text = productFactsMarkdown().split("## Never say")[0]; // the "never claim" list names these on purpose
    const ob = CAPABILITIES.find((c) => c.key === "ai_outbound")!.text;
    for (const t of ["free", "trial", "pro"] as const) expect(ob).toContain(String(OUTBOUND_ALLOWANCE_DEFAULTS[t].monthlySearches));
    expect(ob).toMatch(/the US, the UK, Canada, Australia, the UAE, India and others, or worldwide/);
    expect(PRICING_LINES.join(" ")).toMatch(/There is no separate plan for Client Radar or the CRM, and no annual plan/);
    expect(text).not.toMatch(/unlimited (AI|research|searches|sending|prospect)/i);
    expect(text).not.toMatch(/₹999|a year/);
  });

  it("local business search: from Google Maps, shown for the search and not kept, and a missing website proves nothing", async () => {
    const { LANDING_FAQS } = await import("./landing-faqs");
    const ob = CAPABILITIES.find((c) => c.key === "ai_outbound")!.text;
    expect(ob).toMatch(/local businesses.*from Google Maps/);
    expect(ob).toMatch(/shown for that search and not kept/);
    expect(ob).toMatch(/doesn't mean the business has no website or needs one/);
    expect(NEVER_CLAIM.join(" ")).toMatch(/business directory/);
    const faq = LANDING_FAQS.find((f) => /local businesses in my city/.test(f.q))!;
    expect(faq.a).toMatch(/not kept in DealInSec/);
    expect(faq.a).toMatch(/One local search uses one Client Radar search/);
  });

  it("no trial: new accounts start on the free plan, and no public answer offers a trial", async () => {
    const { LANDING_FAQS } = await import("./landing-faqs");
    const { ASK_CTA_TEXT } = await import("./ask-dealinsec");
    const offered = /\b\d+-day (pro |free )?trial|free trial|start (your|the) (free )?trial|trial (with|needs) no card/i;
    expect(productFactsMarkdown().split("## Never say")[0]).not.toMatch(/trial/i);
    expect(PRICING_LINES.join(" ")).not.toMatch(/trial/i);
    for (const f of LANDING_FAQS) expect(`${f.q} ${f.a}`, f.q).not.toMatch(offered);
    expect(ASK_CTA_TEXT).not.toMatch(offered);
    expect(NEVER_CLAIM.join(" ")).toMatch(/free trial of Pro/);
  });

  it("seats and the workflow", () => {
    expect(CAPABILITIES.find((c) => c.key === "team")!.text).toContain(String(PRO_INCLUDED_SEATS));
    expect(WORKFLOW).toEqual(["Prospect", "Lead", "Deal", "Quotation", "Agreement", "Invoice", "Payment tracking"]);
  });

  /**
   * The public README is a GEO surface, not just developer docs: answer engines cite the repo when they describe
   * DealInSec, and a wrong line there outlives the live site in their caches. So it is held to the same rules as the
   * marketing pages — and especially to the one server/site-head.test.ts enforces on page copy: no ₹ figure that
   * cannot be charged. A superseded price is still a number a crawler can lift out as the price, even where the
   * sentence around it says the figure is wrong, so the README's "out of date" note names no old price at all.
   */
  it("the public README claims only what is true, and quotes no price that can't be charged", async () => {
    const { readFileSync } = await import("node:fs");
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

    expect(readme).toContain(`₹${PRICING.proMonthlyInr}`);
    // Every rupee figure must be the Pro price or a seeded credit-pack price (script/migrate-credits.ts); packs are
    // database-driven, so a changed pack price belongs in both places.
    const chargeable = new Set([PRICING.proMonthlyInr, 49, 89, 129, 149, 229, 299, 349]);
    for (const m of readme.matchAll(/₹\s?([\d,]+)/g)) {
      expect(chargeable, `₹${m[1]} in README.md can't be charged`).toContain(Number(m[1]!.replace(/,/g, "")));
    }

    // The "out of date" note quotes the wrong descriptions in order to refute them, so the bans below are applied to
    // the rest of the file. The note itself may name no price at all, refuted or not.
    const heading = "## Note on out-of-date descriptions";
    const start = readme.indexOf(heading);
    expect(start, heading).toBeGreaterThan(0);
    const end = readme.indexOf("\n## ", start + heading.length);
    const note = readme.slice(start, end === -1 ? undefined : end);
    const body = readme.slice(0, start) + (end === -1 ? "" : readme.slice(end));

    expect(note).toMatch(/out of date/);
    expect(note).not.toMatch(/₹/);
    expect(body).not.toMatch(/deal-management OS|quote-to-cash|per signed contract|per-deal/i);
    expect(body).not.toMatch(/\d+\+?\s*(early |active |paying )?(users|customers|freelancers|agencies)\b/i);
    expect(body).not.toMatch(/\bStripe\b|\bPayU\b|\bInflideal\b/); // Razorpay only; the old repo name is dead
    expect(body).toMatch(/There is no free trial/); // stated, never offered
    expect(body).not.toMatch(/start (your|the) (free )?trial|\d+-day (free )?trial/i);
  });

  it("states the limits plainly: Gmail limited, no auto-send, no payment collection, no AI on Gmail", () => {
    const by = (k: string) => CAPABILITIES.find((c) => c.key === k)!;
    expect(by("gmail").status).toBe("limited");
    expect(by("gmail").text).toMatch(/never sends Gmail content to an AI model/);
    expect(by("auto_send").status).toBe("not_available");
    expect(by("payment_collection").status).toBe("not_available");
    // Nothing unbuilt is described with a date or "coming soon".
    expect(productFactsMarkdown()).not.toMatch(/coming soon|next (week|month|quarter)|in 20\d\d/i);
  });
});
