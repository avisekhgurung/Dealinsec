import { describe, expect, it } from "vitest";
import { DUE_SOON_DAYS, PAYMENT_STATE_LABEL, paymentState } from "./paymentState";

const now = new Date("2026-09-30T12:00:00Z");
const days = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString();

describe("paymentState", () => {
  it("is paid whenever the invoice is paid, whatever its due date", () => {
    expect(paymentState({ status: "Paid", dueDate: days(-30) }, now)).toBe("paid");
    expect(paymentState({ status: "Paid", dueDate: null }, now)).toBe("paid");
  });

  it("is pending with no due date", () => {
    expect(paymentState({ status: "Unpaid", dueDate: null }, now)).toBe("pending");
    expect(paymentState({ status: "Unpaid" }, now)).toBe("pending");
    expect(paymentState({ status: "Unpaid", dueDate: "not a date" }, now)).toBe("pending");
  });

  it("is overdue once the due date has passed", () => {
    expect(paymentState({ status: "Unpaid", dueDate: days(-1) }, now)).toBe("overdue");
    expect(paymentState({ status: "Unpaid", dueDate: days(-90) }, now)).toBe("overdue");
  });

  it("is due soon within the next week, and pending after that", () => {
    expect(paymentState({ status: "Unpaid", dueDate: days(0) }, now)).toBe("due_soon");
    expect(paymentState({ status: "Unpaid", dueDate: days(DUE_SOON_DAYS) }, now)).toBe("due_soon");
    expect(paymentState({ status: "Unpaid", dueDate: days(DUE_SOON_DAYS + 1) }, now)).toBe("pending");
  });

  it("accepts a Date as well as a string", () => {
    expect(paymentState({ status: "Unpaid", dueDate: new Date(days(-2)) }, now)).toBe("overdue");
  });

  it("has a label for every state", () => {
    expect(PAYMENT_STATE_LABEL).toEqual({ pending: "Pending", due_soon: "Due soon", overdue: "Overdue", paid: "Paid" });
  });
});
