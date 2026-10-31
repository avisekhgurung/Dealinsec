import { describe, expect, it } from "vitest";
import {
  FIRST_GOALS, FIRST_GOAL_META, checklistFor, checklistState, destinationFor, isFirstGoal,
  type ChecklistAccess, type Facts,
} from "./getting-started";

const ZERO: Facts = {
  outboundRuns: 0, leads: 0, contactedLeads: 0, deals: 0, quotations: 0, agreements: 0, invoices: 0, paidInvoices: 0,
};
const ALL: ChecklistAccess = { outbound: true, leads: true, deals: true, agreements: true, invoices: true };
const ids = (goal: Parameters<typeof checklistFor>[0], facts = ZERO, can = ALL) => checklistFor(goal, facts, can).map((s) => s.id);

describe("isFirstGoal", () => {
  it("accepts exactly the three goals", () => {
    for (const g of FIRST_GOALS) expect(isFirstGoal(g)).toBe(true);
  });
  it("rejects junk", () => {
    for (const x of ["", "FIND_CLIENTS", "get paid", "none", null, undefined, 1, {}, ["get_paid"]]) expect(isFirstGoal(x)).toBe(false);
  });
});

describe("checklistFor ordering", () => {
  it("find_clients starts from research and ends by revealing the deal-to-payment side", () => {
    expect(ids("find_clients")).toEqual(["run_search", "add_lead", "first_message", "first_deal", "quote_flow"]);
    const last = checklistFor("find_clients", ZERO, ALL).at(-1)!;
    expect(last.discovery).toBe(true);
    expect(last.href).toBe("/deals");
  });
  it("manage_deals starts from the pipeline", () => {
    expect(ids("manage_deals")).toEqual(["add_pipeline", "first_deal", "send_quote", "run_search"]);
  });
  it("get_paid runs deal → quote → agreement → invoice → payment, then suggests outbound", () => {
    expect(ids("get_paid")).toEqual(["first_deal", "send_quote", "agreement", "invoice", "record_payment", "run_search"]);
    expect(checklistFor("get_paid", ZERO, ALL).map((s) => s.discovery)).toEqual([false, false, false, false, false, true]);
  });
  it("no goal falls back to find_clients: finding clients is the product's face", () => {
    expect(ids(null)).toEqual(ids("find_clients"));
  });
});

describe("checklistFor done flags", () => {
  it("derives done from real counts", () => {
    const steps = checklistFor("get_paid", { ...ZERO, deals: 2, quotations: 1 }, ALL);
    expect(Object.fromEntries(steps.map((s) => [s.id, s.done]))).toEqual({
      first_deal: true, send_quote: true, agreement: false, invoice: false, record_payment: false, run_search: false,
    });
  });
  it("first_message is done only by contacted leads, not by leads alone", () => {
    const steps = checklistFor("find_clients", { ...ZERO, leads: 3 }, ALL);
    expect(steps.find((s) => s.id === "add_lead")!.done).toBe(true);
    expect(steps.find((s) => s.id === "first_message")!.done).toBe(false);
  });
  it("add_pipeline is done by a lead or a deal", () => {
    const pipeline = (f: Partial<Facts>) => checklistFor("manage_deals", { ...ZERO, ...f }, ALL)[0].done;
    expect(pipeline({})).toBe(false);
    expect(pipeline({ leads: 1 })).toBe(true);
    expect(pipeline({ deals: 1 })).toBe(true);
    expect(pipeline({ leads: null, deals: 1 })).toBe(true);
    expect(pipeline({ leads: null, deals: 0 })).toBe(null);
  });
});

describe("permissions", () => {
  it("drops steps whose module the person can't reach", () => {
    const invoicesOnly: ChecklistAccess = { outbound: false, leads: false, deals: false, agreements: false, invoices: true };
    expect(ids("get_paid", ZERO, invoicesOnly)).toEqual(["invoice", "record_payment"]);
    expect(ids("find_clients", ZERO, invoicesOnly)).toEqual([]);
  });
  it("hides outbound and leads steps without access", () => {
    expect(ids("find_clients", ZERO, { ...ALL, outbound: false, leads: false })).toEqual(["first_deal", "quote_flow"]);
  });
  it("quotation steps follow deals unless quotations is given", () => {
    expect(ids("manage_deals", ZERO, { ...ALL, deals: false })).toEqual(["add_pipeline", "run_search"]);
    expect(ids("manage_deals", ZERO, { ...ALL, deals: false, quotations: true })).toEqual(["add_pipeline", "send_quote", "run_search"]);
  });
  it("an empty list counts as complete, so nothing is shown", () => {
    const none: ChecklistAccess = { outbound: false, leads: false, deals: false, agreements: false, invoices: false };
    expect(checklistState(checklistFor("get_paid", ZERO, none))).toEqual({ total: 0, done: 0, complete: true, anyUnknown: false });
  });
});

describe("unknown facts", () => {
  const unknown: Facts = {
    outboundRuns: null, leads: null, contactedLeads: null, deals: null, quotations: null, agreements: null, invoices: null, paidInvoices: null,
  };
  it("returns done = null, never false", () => {
    for (const g of [...FIRST_GOALS, null]) {
      for (const s of checklistFor(g, unknown, ALL)) expect(s.done).toBe(null);
    }
  });
  it("is never complete while anything is unknown", () => {
    const everythingElseDone: Facts = { outboundRuns: 1, leads: 1, contactedLeads: 1, deals: 1, quotations: 1, agreements: 1, invoices: 1, paidInvoices: null };
    const state = checklistState(checklistFor("get_paid", everythingElseDone, ALL));
    expect(state).toEqual({ total: 6, done: 5, complete: false, anyUnknown: true });
  });
  it("is complete when every step is known and done", () => {
    const all: Facts = { outboundRuns: 1, leads: 1, contactedLeads: 1, deals: 1, quotations: 1, agreements: 1, invoices: 1, paidInvoices: 1 };
    for (const g of [...FIRST_GOALS, null]) expect(checklistState(checklistFor(g, all, ALL)).complete).toBe(true);
  });
});

describe("destinationFor", () => {
  it("lands each goal where its first step is", () => {
    expect(destinationFor("find_clients")).toBe("/outbound");
    expect(destinationFor("get_paid")).toBe("/deals/new");
    expect(destinationFor("manage_deals")).toBe("/leads");
    expect(destinationFor(null)).toBe("/outbound"); // no goal lands on the product's promise: finding clients
  });
});

describe("copy", () => {
  it("never claims DealInSec sends email or collects payments", () => {
    const text = [...FIRST_GOALS, null]
      .flatMap((g) => checklistFor(g, ZERO, ALL))
      .map((s) => `${s.title} ${s.detail}`)
      .concat(Object.values(FIRST_GOAL_META).map((m) => `${m.label} ${m.description}`))
      .join("\n");
    expect(text).not.toMatch(/we('ll| will)? (send|email|collect)/i);
    expect(text).not.toMatch(/DealInSec (sends|emails|collects)/i);
    const message = checklistFor("find_clients", ZERO, ALL).find((s) => s.id === "first_message")!;
    expect(message.detail).toMatch(/your own email app/);
    const payment = checklistFor("get_paid", ZERO, ALL).find((s) => s.id === "record_payment")!;
    expect(payment.detail).toMatch(/your client pays you directly/);
  });
});
