import { describe, expect, it } from "vitest";
import { analyticsPath } from "./analyticsPath";

describe("analyticsPath: route shapes only", () => {
  it("never sends a public document or invitation token", () => {
    expect(analyticsPath("/d/Zx9_kq2LmN-4pQrS8tUvWxYz01ab")).toBe("/d/:token");
    expect(analyticsPath("/s/abcdefghijklmnopqrstuvwx")).toBe("/s/:token"); // even a token with no digit
    expect(analyticsPath("/invite/9f1c2e")).toBe("/invite/:token");
  });
  it("replaces record ids, keeps the fixed words", () => {
    expect(analyticsPath("/deals/42/quote")).toBe("/deals/:id/quote");
    expect(analyticsPath("/deals/new")).toBe("/deals/new");
    expect(analyticsPath("/deals/import")).toBe("/deals/import");
    expect(analyticsPath("/contracts/17/export")).toBe("/contracts/:id/export");
    expect(analyticsPath("/leads/299")).toBe("/leads/:id");
    expect(analyticsPath("/brand-invoices/new")).toBe("/brand-invoices/new");
    expect(analyticsPath("/brand-invoices/8")).toBe("/brand-invoices/:id");
    expect(analyticsPath("/agent/4386d1cb-eab0-4b8b-befe-af53a7837f03")).toBe("/agent/:id");
  });
  it("drops query strings and fragments (a reset link carries the email and its token)", () => {
    expect(analyticsPath("/reset-password?email=a%40b.test&token=xyz")).toBe("/reset-password");
    expect(analyticsPath("/settings?gmail=connected#gmail-card")).toBe("/settings");
    expect(analyticsPath("/?error=google_auth_failed")).toBe("/");
  });
  it("leaves plain pages alone", () => {
    for (const p of ["/", "/dashboard", "/outbound", "/pricing", "/for-freelancers", "/tools/quotation-maker"]) expect(analyticsPath(p)).toBe(p);
    expect(analyticsPath("")).toBe("/");
  });
});
