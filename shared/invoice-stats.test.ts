import { describe, expect, it } from "vitest";
import { invoiceStats, paidInvoicesSubline } from "./invoice-stats";

const NOW = new Date("2026-10-16T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString().slice(0, 10);

describe("invoiceStats: paid means recorded as paid, never merely issued", () => {
  it("no invoices: all zero, and the line says so", () => {
    const s = invoiceStats([], NOW);
    expect(s).toEqual({ total: 0, paid: 0, paidThisWeek: 0, unpaid: 0, overdue: 0, dueSoon: 0 });
    expect(paidInvoicesSubline(s)).toBe("none yet");
  });

  it("an issued, unpaid invoice is not paid, whatever its date", () => {
    const s = invoiceStats([{ status: "Unpaid", dueDate: inDays(30) }, { status: "Unpaid", dueDate: null }], NOW);
    expect(s).toMatchObject({ total: 2, paid: 0, unpaid: 2, overdue: 0 });
    expect(paidInvoicesSubline(s)).toBe("2 awaiting payment");
  });

  it("paid invoices count; 'this week' follows when the payment was recorded, not the invoice date", () => {
    const s = invoiceStats([
      { status: "Paid", dueDate: inDays(-40), paidAt: daysAgo(2) }, // old invoice, paid this week
      { status: "Paid", dueDate: inDays(-3), paidAt: daysAgo(10) }, // paid last month
      { status: "Paid", dueDate: null, paidAt: null }, // paid before paidAt existed: paid, not "this week"
    ], NOW);
    expect(s).toMatchObject({ total: 3, paid: 3, paidThisWeek: 1, unpaid: 0 });
    expect(paidInvoicesSubline(s)).toBe("1 this week");
  });

  it("overdue and due soon are unpaid, by the same rule as the invoice list; overdue leads the line", () => {
    const s = invoiceStats([
      { status: "Unpaid", dueDate: inDays(-1) },
      { status: "Unpaid", dueDate: inDays(3) },
      { status: "Paid", dueDate: inDays(-5), paidAt: daysAgo(1) },
    ], NOW);
    expect(s).toMatchObject({ total: 3, paid: 1, paidThisWeek: 1, unpaid: 2, overdue: 1, dueSoon: 1 });
    expect(paidInvoicesSubline(s)).toBe("1 overdue");
  });

  it("there are no partial payments: anything not marked Paid is unpaid (an unknown status included)", () => {
    const s = invoiceStats([{ status: "Partially paid" }, { status: null }, { status: "paid" }], NOW);
    expect(s).toMatchObject({ paid: 0, unpaid: 3 });
  });

  it("a paidAt in the future or unreadable never counts as this week", () => {
    const s = invoiceStats([{ status: "Paid", paidAt: "2099-01-01T00:00:00Z" }, { status: "Paid", paidAt: "not a date" }], NOW);
    expect(s).toMatchObject({ paid: 2, paidThisWeek: 0 });
    expect(paidInvoicesSubline(s)).toBe("all paid");
  });

  it("the 7-day window is rolling and inclusive at its start", () => {
    expect(invoiceStats([{ status: "Paid", paidAt: daysAgo(7) }], NOW).paidThisWeek).toBe(1);
    expect(invoiceStats([{ status: "Paid", paidAt: new Date(NOW.getTime() - 7 * 86_400_000 - 1).toISOString() }], NOW).paidThisWeek).toBe(0);
  });
});
