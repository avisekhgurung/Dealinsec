import { describe, expect, it } from "vitest";
import { invoiceDetailsSchema, isEmpty, myDetailsSchema, workspaceProfileSchema } from "./workspace";

describe("workspace edits", () => {
  it("accepts only real dates", () => {
    expect(invoiceDetailsSchema.safeParse({ invoiceId: 1, dueDate: "2026-10-31" }).success).toBe(true);
    for (const d of ["2026-02-30", "31/10/2026", "2026-13-01", "tomorrow", "2026-10-3"]) {
      expect(invoiceDetailsSchema.safeParse({ invoiceId: 1, dueDate: d }).success, d).toBe(false);
    }
  });
  it("refuses fields it does not list, including money and bank details", () => {
    for (const extra of [{ dealAmountMinor: 5 }, { status: "Paid" }, { invoiceNumber: "X" }]) {
      expect(invoiceDetailsSchema.safeParse({ invoiceId: 1, ...extra }).success).toBe(false);
    }
    for (const extra of [{ accountNumber: "1" }, { ifscCode: "X" }, { digitalSignature: "x" }, { password: "x" }, { email: "a@b.co" }, { currency: "USD" }]) {
      expect(myDetailsSchema.safeParse({ firstName: "A", ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
    for (const extra of [{ currency: "USD" }, { country: "US" }, { plan: "pro" }]) {
      expect(workspaceProfileSchema.safeParse({ name: "A", ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
  });
  it("trims, caps lengths and keeps ids to safe characters", () => {
    expect(workspaceProfileSchema.parse({ name: "  Una Studio  " }).name).toBe("Una Studio");
    expect(workspaceProfileSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
    expect(workspaceProfileSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(myDetailsSchema.safeParse({ gstNumber: "29ABCDE1234F1Z5" }).success).toBe(true);
    expect(myDetailsSchema.safeParse({ gstNumber: "<script>" }).success).toBe(false);
    expect(myDetailsSchema.safeParse({ phone: "+91 98765-43210" }).success).toBe(true);
  });
  it("only the two work types are accepted", () => {
    expect(workspaceProfileSchema.safeParse({ audience: "client_work" }).success).toBe(true);
    expect(workspaceProfileSchema.safeParse({ audience: "enterprise" }).success).toBe(false);
  });
  it("knows when an edit says nothing", () => {
    expect(isEmpty({}, ["name", "industry"])).toBe(true);
    expect(isEmpty({ industry: "" }, ["name", "industry"])).toBe(false);
  });
});
