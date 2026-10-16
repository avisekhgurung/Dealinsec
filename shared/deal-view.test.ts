import { describe, expect, it } from "vitest";
import {
  BOARD_STATUSES,
  WORKFLOW_DONE,
  WORKFLOW_STEPS,
  groupDealsByStatus,
  indexDealDocuments,
  parseDealsView,
  workflowPosition,
  workflowPositions,
  type WorkflowFacts,
} from "./deal-view";

const now = new Date("2026-10-16T12:00:00Z");
const days = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString();
const facts = (over: Partial<WorkflowFacts> = {}): WorkflowFacts => ({ dealAmountMinor: 100_000, quote: null, agreement: null, invoices: [], ...over });

describe("workflow steps", () => {
  it("are Deal → Quotation → Agreement → Invoice → Paid, numbered 1–5", () => {
    expect(WORKFLOW_STEPS.map((s) => s.label)).toEqual(["Deal", "Quotation", "Agreement", "Invoice", "Paid"]);
    expect(WORKFLOW_STEPS.map((s) => s.step)).toEqual([1, 2, 3, 4, 5]);
    expect(WORKFLOW_DONE).toBe(6);
  });
});

describe("workflowPosition", () => {
  it("a deal with nothing yet is waiting on a quotation", () => {
    expect(workflowPosition(facts(), now)).toEqual({ step: 2, key: "quote", label: "No quote yet", tone: "todo" });
  });

  it("a current (draft) quotation moves it to the agreement step", () => {
    expect(workflowPosition(facts({ quote: { status: "draft" } }), now)).toMatchObject({ step: 3, key: "agreement", label: "Quote ready" });
  });

  it("a revised quotation is outdated, not current — the same rule the deal page uses", () => {
    expect(workflowPosition(facts({ quote: { status: "revised" } }), now)).toMatchObject({ step: 2, key: "quote", label: "Quote outdated", tone: "attention" });
  });

  it("an unknown quotation status is never read as a current quote", () => {
    expect(workflowPosition(facts({ quote: { status: "something-else" } }), now)).toMatchObject({ step: 2, label: "No quote yet" });
  });

  it("an unsigned agreement is awaiting signature, whatever the quotation says", () => {
    for (const status of ["Draft", "Pending", "Active"]) {
      expect(workflowPosition(facts({ quote: { status: "revised" }, agreement: { status, signedByBrand: false } }), now))
        .toMatchObject({ step: 3, key: "agreement", label: "Awaiting signature", tone: "waiting" });
    }
  });

  it("uses the one definition of signed: status Signed or an owner-attested copy", () => {
    expect(workflowPosition(facts({ agreement: { status: "Signed" } }), now)).toMatchObject({ step: 4, key: "invoice", label: "Ready to invoice" });
    expect(workflowPosition(facts({ agreement: { status: "Pending", signedByBrand: true } }), now)).toMatchObject({ step: 4 });
    // A sign time alone isn't the stored "signed" rule (storage sets status with it); mirror isAgreementSigned exactly.
    expect(workflowPosition(facts({ agreement: { status: "Pending", clientSignedAt: days(-1) } }), now)).toMatchObject({ step: 3 });
  });

  it("an unpaid invoice is awaiting payment; an overdue one needs attention", () => {
    expect(workflowPosition(facts({ agreement: { status: "Signed" }, invoices: [{ status: "Unpaid", dueDate: days(10), amountMinor: 100_000 }] }), now))
      .toMatchObject({ step: 5, key: "paid", label: "Awaiting payment", tone: "waiting" });
    expect(workflowPosition(facts({ invoices: [{ status: "Unpaid", dueDate: days(-2), amountMinor: 50_000 }, { status: "Paid", amountMinor: 50_000 }] }), now))
      .toMatchObject({ step: 5, label: "Payment overdue", tone: "attention" });
  });

  it("is done only when every invoice is paid and they cover the deal value", () => {
    expect(workflowPosition(facts({ invoices: [{ status: "Paid", amountMinor: 40_000 }, { status: "Paid", amountMinor: 60_000 }] }), now))
      .toEqual({ step: WORKFLOW_DONE, key: "done", label: "Paid in full", tone: "done" });
    expect(workflowPosition(facts({ invoices: [{ status: "Paid", amountMinor: 50_000 }] }), now))
      .toMatchObject({ step: 5, key: "paid", label: "Part invoiced", tone: "todo" });
  });

  it("a deal-only invoice (no agreement) still counts: invoices are furthest along", () => {
    expect(workflowPosition(facts({ invoices: [{ status: "Unpaid", amountMinor: 100_000 }] }), now)).toMatchObject({ step: 5 });
  });
});

describe("indexDealDocuments", () => {
  it("is null when any source is unknown, so a position is never guessed from partial facts", () => {
    expect(indexDealDocuments({ quotes: null, agreements: [], invoices: [] })).toBeNull();
    expect(indexDealDocuments({ quotes: [], agreements: undefined, invoices: [] })).toBeNull();
    expect(indexDealDocuments({ quotes: [], agreements: [], invoices: null })).toBeNull();
  });

  it("keeps the latest quotation per deal (newest createdAt, then highest id)", () => {
    const idx = indexDealDocuments({
      quotes: [
        { id: 1, dealId: 7, status: "revised", createdAt: "2026-10-01T00:00:00Z" },
        { id: 3, dealId: 7, status: "draft", createdAt: "2026-10-05T00:00:00Z" },
        { id: 2, dealId: 7, status: "revised", createdAt: "2026-10-03T00:00:00Z" },
        { id: 4, dealId: 8, status: "revised", createdAt: "2026-10-05T00:00:00Z" },
        { id: 5, dealId: 8, status: "draft", createdAt: "2026-10-05T00:00:00Z" },
      ],
      agreements: [],
      invoices: [],
    })!;
    expect(idx.get(7)!.quote!.id).toBe(3);
    expect(idx.get(8)!.quote!.id).toBe(5);
  });

  it("keeps the first agreement per deal and every invoice", () => {
    const idx = indexDealDocuments({
      quotes: [],
      agreements: [{ dealId: 1, status: "Draft" }, { dealId: 1, status: "Signed" }],
      invoices: [{ dealId: 1 }, { dealId: 1 }, { dealId: 2 }],
    })!;
    expect(idx.get(1)!.agreement!.status).toBe("Draft");
    expect(idx.get(1)!.invoices).toHaveLength(2);
    expect(idx.get(2)!.invoices).toHaveLength(1);
  });
});

describe("workflowPositions", () => {
  const deals = [{ id: 1, dealAmountMinor: 100 }, { id: 2, dealAmountMinor: 100 }, { id: 3, dealAmountMinor: 100 }];

  it("derives every deal's position from the three lists in one pass", () => {
    const pos = workflowPositions(deals, {
      quotes: [{ dealId: 1, status: "draft" }],
      agreements: [{ dealId: 2, status: "Signed" }],
      invoices: [{ dealId: 2, status: "Paid", dealAmountMinor: 100 }],
    }, now)!;
    expect(pos.get(1)!.label).toBe("Quote ready");
    expect(pos.get(2)!.label).toBe("Paid in full");
    expect(pos.get(3)!.label).toBe("No quote yet");
  });

  it("is null when a list couldn't be read", () => {
    expect(workflowPositions(deals, { quotes: [], agreements: null, invoices: [] }, now)).toBeNull();
  });
});

describe("groupDealsByStatus", () => {
  it("always has Pending, Active and Completed columns, in that order, empty or not", () => {
    expect(groupDealsByStatus([]).map((c) => [c.status, c.deals.length])).toEqual([["Pending", 0], ["Active", 0], ["Completed", 0]]);
    expect(BOARD_STATUSES).toEqual(["Pending", "Active", "Completed"]);
  });

  it("groups by stored status, keeping list order inside each column", () => {
    const cols = groupDealsByStatus([
      { id: 1, status: "Active" }, { id: 2, status: "Pending" }, { id: 3, status: "Active" }, { id: 4, status: "Completed" },
    ]);
    expect(cols.map((c) => c.deals.map((d) => d.id))).toEqual([[2], [1, 3], [4]]);
  });

  it("never drops a deal: an unexpected status gets its own column after the known ones", () => {
    const cols = groupDealsByStatus([{ id: 1, status: "Archived" }, { id: 2, status: "Pending" }]);
    expect(cols.map((c) => c.status)).toEqual(["Pending", "Active", "Completed", "Archived"]);
    expect(cols.reduce((n, c) => n + c.deals.length, 0)).toBe(2);
  });
});

describe("parseDealsView", () => {
  it("reads back board, and anything else as the list", () => {
    expect(parseDealsView("board")).toBe("board");
    expect(parseDealsView("list")).toBe("list");
    expect(parseDealsView(null)).toBe("list");
    expect(parseDealsView("kanban")).toBe("list");
  });
});
