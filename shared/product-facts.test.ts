import { describe, expect, it } from "vitest";
import { CAPABILITIES, PRICING, PRICING_LINES, productFactsMarkdown, WORKFLOW } from "./product-facts";
import { GLOBAL_PLANS } from "./globalPlans";
import { PRO_INCLUDED_SEATS } from "./permissions";
import { TRIAL_DAYS, users } from "./schema";

describe("product facts agree with the code that charges and enforces them", () => {
  it("prices: the INR plans, the seat price and the free allowance", async () => {
    expect(PRICING.proMonthlyInr).toBe(GLOBAL_PLANS.INR.monthly!.amount);
    expect(PRICING.proYearlyInr).toBe(GLOBAL_PLANS.INR.yearly.amount);
    expect(PRICING.trialDays).toBe(TRIAL_DAYS);
    expect(PRICING.freeMonthlyDeals).toBe((users.monthlyDealCredits as any).default);
    const saved = { m: process.env.PRO_MONTHLY_PRICE, y: process.env.PRO_YEARLY_PRICE, s: process.env.EXTRA_SEAT_PRICE };
    delete process.env.PRO_MONTHLY_PRICE; delete process.env.PRO_YEARLY_PRICE; delete process.env.EXTRA_SEAT_PRICE;
    try {
      const rz = await import("../server/razorpayClient");
      expect(rz.getProMonthlyPrice()).toBe(PRICING.proMonthlyInr);
      expect(rz.getProYearlyPrice()).toBe(PRICING.proYearlyInr);
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

  it("seats and the workflow", () => {
    expect(CAPABILITIES.find((c) => c.key === "team")!.text).toContain(String(PRO_INCLUDED_SEATS));
    expect(WORKFLOW).toEqual(["Prospect", "Lead", "Deal", "Quotation", "Agreement", "Invoice", "Payment tracking"]);
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
