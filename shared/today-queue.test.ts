import { describe, expect, it } from "vitest";
import {
  TODAY_KINDS, todayQueue, todaySummary,
  type TodayAccess, type TodayAgreement, type TodayFacts, type TodayInvoice, type TodayQuote,
} from "./today-queue";

const NOW = new Date("2026-10-16T12:00:00Z");
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();
const money = (minor: number, currency?: string | null) => `${currency ?? "INR"} ${minor / 100}`;

const ALL: TodayAccess = { invoices: true, agreements: true, leads: true, outbound: true, quotations: true };
const EMPTY: TodayFacts = { invoices: [], agreements: [], followUps: { today: "2026-10-16", overdue: [], dueToday: [] }, outreach: [], quotations: [] };

const inv = (id: number, over: Partial<TodayInvoice> = {}): TodayInvoice => ({
  id, invoiceNumber: `INV-${id}`, brandName: `Client ${id}`, status: "Unpaid", dueDate: null, amountMinor: 10_000, currency: "INR", dealId: 100 + id, contractId: null, ...over,
});
const agr = (id: number, over: Partial<TodayAgreement> = {}): TodayAgreement => ({
  id, dealId: 200 + id, contractName: `Agreement ${id}`, brandName: `Client ${id}`, status: "Draft", signedByBrand: false, clientSignedAt: null, clientSharedAt: null, valueMinor: 50_000, currency: "INR", ...over,
});
const quote = (id: number, over: Partial<TodayQuote> = {}): TodayQuote => ({
  id, dealId: 300 + id, brandName: `Client ${id}`, createdAt: at(-10), shareToken: `tok${id}`, sharedAt: at(-4), shareRevokedAt: null, acceptedAt: null, dealStatus: "Pending", ...over,
});

/** One of every kind, so ordering can be checked end to end. */
const FULL: TodayFacts = {
  invoices: [inv(1, { dueDate: at(-3) }), inv(2, { dueDate: at(3) })],
  agreements: [agr(1, { status: "Pending", clientSharedAt: at(-2) }), agr(2, { status: "Signed", signedByBrand: true })],
  followUps: { today: "2026-10-16", overdue: [{ id: 1, title: "Send proposal", due: "2026-10-14", leadId: 7, companyName: "Acme" }], dueToday: [] },
  outreach: [{ id: 1, status: "approved", leadId: 8, companyName: "Globex" }],
  quotations: [quote(1)],
};

describe("todayQueue: order", () => {
  it("lists every kind in priority order, now before soon before next", () => {
    const q = todayQueue({ ...FULL, protection: { withIssues: 1, important: 1 } }, NOW, { ...ALL, deals: true }, { money, cap: 10 });
    expect(q.items.map((i) => i.kind)).toEqual([...TODAY_KINDS]);
    expect(q.items.map((i) => i.urgency)).toEqual(["now", "now", "soon", "soon", "soon", "soon", "next", "next"]);
    expect(q.overflow).toEqual([]);
    expect(q.allClear).toBe(false);
    expect(q.unknown).toEqual([]);
  });

  it("caps the visible items and keeps the rest, in order, as overflow", () => {
    const q = todayQueue(FULL, NOW, ALL, { money });
    expect(q.items).toHaveLength(6);
    expect(q.overflow.map((i) => i.kind)).toEqual(["quotes_awaiting"]);
    expect(todaySummary(q)).toBe("7 things need you");
    const two = todayQueue(FULL, NOW, ALL, { money, cap: 2 });
    expect(two.items.map((i) => i.kind)).toEqual(["overdue_invoices", "follow_ups"]);
    expect(two.overflow).toHaveLength(5);
  });
});

describe("todayQueue: unknown is never all clear", () => {
  it("nothing due anywhere and everything checked: all clear", () => {
    const q = todayQueue(EMPTY, NOW, ALL, { money });
    expect(q).toEqual({ items: [], overflow: [], allClear: true, unknown: [] });
    expect(todaySummary(q)).toBe("All clear: nothing needs you today");
  });

  it("a source that failed adds nothing, is named, and blocks all clear", () => {
    const q = todayQueue({ ...EMPTY, invoices: null }, NOW, ALL, { money });
    expect(q.items).toEqual([]);
    expect(q.allClear).toBe(false);
    expect(q.unknown).toEqual(["invoices"]);
    expect(todaySummary(q)).not.toMatch(/all clear/i);
  });

  it("every source failed: every one named, never all clear", () => {
    const q = todayQueue({ invoices: null, agreements: null, followUps: null, outreach: null, quotations: null }, NOW, ALL, { money });
    expect(q.allClear).toBe(false);
    expect(q.unknown).toEqual(["invoices", "agreements", "follow-ups", "outreach messages", "quotations"]);
  });

  it("other sources still report while one is unknown", () => {
    const q = todayQueue({ ...FULL, followUps: null }, NOW, ALL, { money, cap: 10 });
    expect(q.items.map((i) => i.kind)).not.toContain("follow_ups");
    expect(q.items[0].kind).toBe("overdue_invoices");
    expect(q.unknown).toEqual(["follow-ups"]);
  });

  it("ready to invoice needs both lists: unknown invoices means no 'nothing invoiced' claim", () => {
    const q = todayQueue({ ...EMPTY, agreements: [agr(2, { status: "Signed" })], invoices: null }, NOW, ALL, { money });
    expect(q.items).toEqual([]);
    expect(q.unknown).toEqual(["invoices"]);
  });

  it("no sources the person can use: no verdict at all", () => {
    const none: TodayAccess = { invoices: false, agreements: false, leads: false, outbound: false, quotations: false };
    const q = todayQueue(EMPTY, NOW, none, { money });
    expect(q).toEqual({ items: [], overflow: [], allClear: false, unknown: [] });
  });
});

describe("todayQueue: permissions", () => {
  it("no invoices module: no invoice items, and invoices are not 'unknown'", () => {
    const can = { ...ALL, invoices: false };
    const q = todayQueue(FULL, NOW, can, { money, cap: 10 });
    const kinds = q.items.map((i) => i.kind);
    expect(kinds).not.toContain("overdue_invoices");
    expect(kinds).not.toContain("due_soon_invoices");
    expect(kinds).not.toContain("ready_to_invoice");
    expect(kinds).toContain("awaiting_signature");
    // A failed invoices read doesn't matter to someone who can't use invoices.
    expect(todayQueue({ ...EMPTY, invoices: null }, NOW, can, { money }).unknown).toEqual([]);
    expect(todayQueue({ ...EMPTY, invoices: null }, NOW, can, { money }).allClear).toBe(true);
  });

  it("each module gates its own kinds", () => {
    const kinds = (can: Partial<TodayAccess>) => todayQueue(FULL, NOW, { ...ALL, ...can }, { money, cap: 10 }).items.map((i) => i.kind);
    expect(kinds({ leads: false })).not.toContain("follow_ups");
    expect(kinds({ agreements: false })).not.toContain("awaiting_signature");
    expect(kinds({ agreements: false })).toContain("ready_to_invoice"); // invoicing work, read from the agreements list
    expect(kinds({ outbound: false })).not.toContain("approved_outreach");
    expect(kinds({ quotations: false })).not.toContain("quotes_awaiting");
  });
});

describe("todayQueue: invoices", () => {
  it("overdue starts the moment the due date passes (paymentState), not before", () => {
    const due = (dueDate: string) => todayQueue({ ...EMPTY, invoices: [inv(1, { dueDate })] }, NOW, ALL, { money }).items[0]?.kind;
    expect(due(new Date(NOW.getTime() - 1).toISOString())).toBe("overdue_invoices");
    expect(due(NOW.toISOString())).toBe("due_soon_invoices");
    expect(due(at(7))).toBe("due_soon_invoices");
    expect(due(at(8))).toBeUndefined();
  });

  it("one overdue invoice links to it, with its amount and how late it is", () => {
    const [item] = todayQueue({ ...EMPTY, invoices: [inv(4, { dueDate: at(-12), amountMinor: 5_000_000, brandName: "Acme" })] }, NOW, ALL, { money }).items;
    expect(item).toMatchObject({
      kind: "overdue_invoices", urgency: "now", href: "/brand-invoices/4", action: "Open invoice",
      title: "Invoice INV-4 to Acme is overdue",
      detail: "INR 50000, 12 days overdue. Follow up, and mark it paid when the money arrives.",
    });
    expect(item.count).toBeUndefined();
  });

  it("several overdue: one summary, the count, the total and the oldest; paid and undated are left out", () => {
    const q = todayQueue({
      ...EMPTY,
      invoices: [
        inv(1, { dueDate: at(-2) }), inv(2, { dueDate: at(-30), brandName: "Oldco" }), inv(3, { dueDate: at(-5) }),
        inv(4, { dueDate: at(-40), status: "Paid" }), inv(5, { dueDate: null }),
      ],
    }, NOW, ALL, { money });
    expect(q.items).toHaveLength(1);
    expect(q.items[0]).toMatchObject({
      count: 3, href: "/invoices", action: "Open invoices",
      title: "3 invoices are overdue",
      detail: "INR 300 in total. Oldest: INV-2 to Oldco, 30 days overdue.",
    });
  });

  it("never adds amounts in different currencies", () => {
    const [item] = todayQueue({ ...EMPTY, invoices: [inv(1, { dueDate: at(-2) }), inv(2, { dueDate: at(-3), currency: "USD" })] }, NOW, ALL, { money }).items;
    expect(item.detail).toBe("Oldest: INV-2 to Client 2, 3 days overdue.");
  });

  it("due within 7 days reads as soon, nearest first", () => {
    const one = todayQueue({ ...EMPTY, invoices: [inv(1, { dueDate: at(1) })] }, NOW, ALL, { money }).items[0];
    expect(one).toMatchObject({ urgency: "soon", title: "Invoice INV-1 to Client 1 is due tomorrow", href: "/brand-invoices/1" });
    const many = todayQueue({ ...EMPTY, invoices: [inv(1, { dueDate: at(6) }), inv(2, { dueDate: at(2.5) })] }, NOW, ALL, { money }).items[0];
    expect(many).toMatchObject({ count: 2, title: "2 invoices are due in the next 7 days", detail: "INR 200 in total. Next: INV-2 to Client 2, due in 3 days." });
  });
});

describe("todayQueue: follow-ups", () => {
  it("one follow-up links its lead", () => {
    const q = todayQueue({ ...EMPTY, followUps: { today: "2026-10-16", overdue: [], dueToday: [{ id: 3, title: "Call back", due: "2026-10-16", leadId: 9, companyName: "Acme" }] } }, NOW, ALL);
    expect(q.items[0]).toMatchObject({ kind: "follow_ups", urgency: "now", title: "Acme: Call back", detail: "Follow-up due today.", href: "/leads/9", action: "Open lead" });
  });

  it("several across leads link the pipeline; upcoming ones are not today's work", () => {
    const q = todayQueue({
      ...EMPTY,
      followUps: {
        today: "2026-10-16",
        overdue: [{ id: 1, title: "Send proposal", due: "2026-10-13", leadId: 1, companyName: "Acme" }],
        dueToday: [{ id: 2, title: "Call", due: "2026-10-16", leadId: 2, companyName: "Globex" }],
      },
    }, NOW, ALL);
    expect(q.items[0]).toMatchObject({ count: 2, title: "2 follow-ups are due", detail: "1 overdue, 1 due today. First: Send proposal (Acme).", href: "/leads", action: "Open leads" });
  });

  it("several for one lead still link that lead", () => {
    const f = (id: number) => ({ id, title: `Step ${id}`, due: "2026-10-15", leadId: 5, companyName: "Acme" });
    const q = todayQueue({ ...EMPTY, followUps: { today: "2026-10-16", overdue: [f(1), f(2)], dueToday: [] } }, NOW, ALL);
    expect(q.items[0]).toMatchObject({ title: "2 follow-ups for Acme", href: "/leads/5", action: "Open lead" });
  });
});

describe("todayQueue: agreements", () => {
  it("waiting for a signature: Pending and not signed; a signed Pending row is not waiting", () => {
    const q = todayQueue({
      ...EMPTY,
      agreements: [agr(1, { status: "Pending", clientSharedAt: at(-3) }), agr(2, { status: "Pending", signedByBrand: true }), agr(3, { status: "Draft" })],
      invoices: [inv(9, { contractId: 2 })],
    }, NOW, ALL, { money, party: "Brand" });
    expect(q.items).toHaveLength(1);
    expect(q.items[0]).toMatchObject({
      kind: "awaiting_signature", urgency: "soon", href: "/contracts/1", action: "Open agreement",
      title: "Waiting for Client 1 to sign",
      detail: "Agreement 1, shared 3 days ago. Remind your brand, or upload a signed copy.",
    });
  });

  it("ready to invoice: signed with nothing invoiced against the agreement or its deal", () => {
    const q = todayQueue({
      ...EMPTY,
      agreements: [agr(1, { status: "Signed" }), agr(2, { signedByBrand: true, status: "Active" }), agr(3, { status: "Signed" }), agr(4, { status: "Signed" })],
      invoices: [inv(1, { contractId: 3 }), inv(2, { dealId: 204, contractId: null })],
    }, NOW, ALL, { money });
    expect(q.items[0]).toMatchObject({
      kind: "ready_to_invoice", count: 2, href: "/contracts",
      title: "2 signed agreements have nothing invoiced yet",
      detail: "INR 1000 agreed in total. Oldest: Client 1 (Agreement 1).",
    });
    const one = todayQueue({ ...EMPTY, agreements: [agr(5, { status: "Signed" })] }, NOW, ALL, { money }).items[0];
    expect(one).toMatchObject({ title: "Ready to invoice: Client 5", href: "/contracts/5", detail: "Agreement 5 is signed (INR 500) and nothing has been invoiced for it yet." });
  });
});

describe("todayQueue: outreach and quotations", () => {
  it("approved, unsent messages: says they go from the person's own email; drafts, sent and blocked don't count", () => {
    const q = todayQueue({
      ...EMPTY,
      outreach: [
        { id: 1, status: "approved", leadId: 1, companyName: "Acme" },
        { id: 2, status: "approved", leadId: 2, companyName: "Globex" },
        { id: 3, status: "approved", leadId: 3, companyName: "Blocked", blocked: true },
        { id: 4, status: "draft", leadId: 4, companyName: "Draft" },
        { id: 5, status: "sending", leadId: 5, companyName: "Sending" },
      ],
    }, NOW, ALL);
    expect(q.items[0]).toMatchObject({
      kind: "approved_outreach", urgency: "soon", count: 2, href: "/outbound?view=outreach", action: "Open outreach",
      title: "2 approved messages are waiting to be sent",
      detail: "Send them from your own email, then mark each one sent here. DealInSec doesn't send them for you.",
    });
  });

  it("shared quotations not accepted: latest per deal, live link, deal still pending", () => {
    const q = todayQueue({
      ...EMPTY,
      quotations: [
        quote(1, { sharedAt: at(-9) }),
        quote(2, { acceptedAt: at(-1) }),
        quote(3, { shareRevokedAt: at(-1) }),
        quote(4, { shareToken: null, sharedAt: null }),
        quote(5, { dealStatus: "Active" }),
        // An older, shared version of deal 306 is history once a newer, unshared version exists.
        quote(6, { createdAt: at(-20) }), quote(7, { dealId: 306, createdAt: at(-1), shareToken: null, sharedAt: null }),
      ],
    }, NOW, ALL);
    expect(q.items).toHaveLength(1);
    expect(q.items[0]).toMatchObject({
      kind: "quotes_awaiting", urgency: "next", href: "/deals/301/quote", action: "Open quotation",
      title: "Client 1 hasn't accepted the quotation yet",
      detail: "The link was shared 9 days ago and hasn't been accepted on it yet.",
    });
  });
});

describe("deal terms (Protection Check)", () => {
  const can = { ...ALL, deals: true };
  it("lists pending deals with terms to settle, after everything more urgent, and only with deals access", () => {
    const q = todayQueue({ ...EMPTY, protection: { withIssues: 2, important: 3 } }, NOW, can, { money });
    expect(q.items.map((i) => i.kind)).toEqual(["deal_terms"]);
    expect(q.items[0]).toMatchObject({ urgency: "next", count: 2, title: "2 pending deals have terms worth clarifying", href: "/deals" });
    expect(q.items[0].detail).toContain("3 important points");
    expect(todayQueue({ ...EMPTY, protection: { withIssues: 2, important: 3 } }, NOW, ALL, { money }).items).toEqual([]);
  });
  it("none flagged is nothing to do; an unreadable briefing is unknown, never all clear", () => {
    expect(todayQueue({ ...EMPTY, protection: { withIssues: 0, important: 0 } }, NOW, can, { money }).allClear).toBe(true);
    const q = todayQueue({ ...EMPTY, protection: null }, NOW, can, { money });
    expect(q.allClear).toBe(false);
    expect(q.unknown).toEqual(["deal terms"]);
  });
});
