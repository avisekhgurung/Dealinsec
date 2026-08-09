/**
 * DealInSec deal intelligence — the DETERMINISTIC engine.
 *
 * Every number here is computed from real rows with plain arithmetic. The
 * AI layer may EXPLAIN these results and draft messages around them; it
 * never invents them (trust rule: deterministic logic owns the numbers).
 *
 * Powers: the Copilot daily briefing, Money Radar, Deal Health scores,
 * and Next Best Action.
 */
import { storage } from "../storage";
import type { User, Deal, Contract, BrandInvoice } from "@shared/schema";

const DAY = 86_400_000;

export interface MoneyRadar {
  overdue: { total: number; count: number; invoices: { id: number; brandName: string; amount: number; daysOverdue: number; invoiceNumber: string }[] };
  dueThisWeek: { total: number; count: number; invoices: { id: number; brandName: string; amount: number; dueDate: string; invoiceNumber: string }[] };
  readyToInvoice: { total: number; count: number; contracts: { id: number; dealId: number; brandName: string; remaining: number; contractName: string }[] };
  collectible: number;
}

export interface HealthSignal {
  label: string;
  state: "good" | "warn" | "bad";
  detail: string;
}

export interface DealHealth {
  dealId: number;
  score: number;
  grade: "Healthy" | "Needs attention" | "At risk";
  signals: HealthSignal[];
}

export interface NextBestAction {
  dealId: number;
  dealTitle: string;
  brandName: string;
  action: string;
  route: string;
  urgency: "red" | "yellow" | "green";
}

interface OrgData {
  deals: Deal[];
  contracts: Contract[];
  invoices: BrandInvoice[];
}

async function loadOrg(user: User): Promise<OrgData> {
  const orgId = user.organizationId!;
  const [deals, contracts, invoices] = await Promise.all([
    storage.getDealsByOrg(orgId, user.id),
    storage.getContractsByOrg(orgId, user.id),
    storage.getBrandInvoicesByOrg(orgId, user.id),
  ]);
  return { deals, contracts, invoices };
}

const signed = (c: Contract) => c.status === "Signed" || !!c.signedByBrand;
const invAmount = (i: BrandInvoice) => Number(i.dealAmount || 0);

export function computeMoneyRadar(data: OrgData): MoneyRadar {
  const now = Date.now();
  const weekAhead = now + 7 * DAY;

  const overdueInv = data.invoices.filter((i) => {
    if (i.status === "Paid" || !i.dueDate) return false;
    const t = new Date(i.dueDate as any).getTime();
    return Number.isFinite(t) && t < now;
  });
  const dueWeekInv = data.invoices.filter((i) => {
    if (i.status === "Paid" || !i.dueDate) return false;
    const t = new Date(i.dueDate as any).getTime();
    return Number.isFinite(t) && t >= now && t <= weekAhead;
  });

  // Ready to invoice = signed agreements whose value isn't fully invoiced yet.
  const ready = data.contracts
    .filter(signed)
    .map((c) => {
      const invoiced = data.invoices
        .filter((i) => i.contractId === c.id || i.dealId === c.dealId)
        .reduce((s, i) => s + invAmount(i), 0);
      return { c, remaining: Number(c.contractValue) - invoiced };
    })
    .filter((x) => x.remaining > 0);

  const radar: MoneyRadar = {
    overdue: {
      total: overdueInv.reduce((s, i) => s + invAmount(i), 0),
      count: overdueInv.length,
      invoices: overdueInv.map((i) => ({
        id: i.id,
        brandName: i.brandName,
        amount: invAmount(i),
        daysOverdue: Math.max(1, Math.floor((now - new Date(i.dueDate as any).getTime()) / DAY)),
        invoiceNumber: i.invoiceNumber,
      })).sort((a, b) => b.daysOverdue - a.daysOverdue).slice(0, 10),
    },
    dueThisWeek: {
      total: dueWeekInv.reduce((s, i) => s + invAmount(i), 0),
      count: dueWeekInv.length,
      invoices: dueWeekInv.map((i) => ({
        id: i.id, brandName: i.brandName, amount: invAmount(i),
        dueDate: String(i.dueDate), invoiceNumber: i.invoiceNumber,
      })).slice(0, 10),
    },
    readyToInvoice: {
      total: ready.reduce((s, x) => s + x.remaining, 0),
      count: ready.length,
      contracts: ready.map((x) => ({
        id: x.c.id, dealId: x.c.dealId, brandName: x.c.brandName,
        remaining: x.remaining, contractName: x.c.contractName,
      })).slice(0, 10),
    },
    collectible: 0,
  };
  radar.collectible = radar.overdue.total + radar.dueThisWeek.total + radar.readyToInvoice.total;
  return radar;
}

/** Explainable health score — every point traces to a visible signal. */
export function computeDealHealth(deal: Deal, data: OrgData): DealHealth {
  const now = Date.now();
  const contract = data.contracts.find((c) => c.dealId === deal.id) ?? null;
  const dealInvoices = data.invoices.filter((i) => i.dealId === deal.id);
  const invoicedTotal = dealInvoices.reduce((s, i) => s + invAmount(i), 0);
  const paidTotal = dealInvoices.filter((i) => i.status === "Paid").reduce((s, i) => s + invAmount(i), 0);
  const overdue = dealInvoices.filter((i) => i.status !== "Paid" && i.dueDate && new Date(i.dueDate as any).getTime() < now);
  const ended = new Date(deal.endDate).getTime() < now;

  const signals: HealthSignal[] = [];
  let score = 100;

  if (!contract) {
    if (deal.status === "Pending") {
      signals.push({ label: "Agreement", state: "warn", detail: "Not created yet" });
      score -= 15;
    } else {
      signals.push({ label: "Agreement", state: "bad", detail: "Active deal without a signed agreement" });
      score -= 30;
    }
  } else if (!signed(contract)) {
    signals.push({ label: "Agreement", state: "warn", detail: "Created — awaiting signed proof" });
    score -= 12;
  } else {
    signals.push({ label: "Agreement", state: "good", detail: "Signed" });
  }

  if (contract && signed(contract)) {
    if (invoicedTotal === 0) {
      signals.push({ label: "Invoicing", state: ended ? "bad" : "warn", detail: ended ? "Deal ended with nothing invoiced" : "Nothing invoiced yet" });
      score -= ended ? 25 : 10;
    } else if (invoicedTotal < Number(deal.dealAmount)) {
      signals.push({ label: "Invoicing", state: "warn", detail: `₹${(Number(deal.dealAmount) - invoicedTotal).toLocaleString("en-IN")} not yet invoiced` });
      score -= 8;
    } else {
      signals.push({ label: "Invoicing", state: "good", detail: "Fully invoiced" });
    }
  }

  if (overdue.length) {
    const amt = overdue.reduce((s, i) => s + invAmount(i), 0);
    const worst = Math.max(...overdue.map((i) => Math.floor((now - new Date(i.dueDate as any).getTime()) / DAY)));
    signals.push({ label: "Payment risk", state: worst > 14 ? "bad" : "warn", detail: `₹${amt.toLocaleString("en-IN")} overdue (${worst} day${worst !== 1 ? "s" : ""})` });
    score -= worst > 14 ? 30 : 15;
  } else if (invoicedTotal > 0 && paidTotal >= invoicedTotal) {
    signals.push({ label: "Payments", state: "good", detail: "All invoices paid" });
  } else if (invoicedTotal > 0) {
    signals.push({ label: "Payments", state: "warn", detail: `₹${(invoicedTotal - paidTotal).toLocaleString("en-IN")} awaiting payment (not overdue)` });
    score -= 5;
  }

  if (ended && deal.status !== "Completed") {
    signals.push({ label: "Timeline", state: "warn", detail: "Past end date but not marked completed" });
    score -= 8;
  } else {
    signals.push({ label: "Timeline", state: "good", detail: ended ? "Completed on time" : "On schedule" });
  }

  score = Math.max(5, Math.min(100, score));
  return {
    dealId: deal.id,
    score,
    grade: score >= 80 ? "Healthy" : score >= 55 ? "Needs attention" : "At risk",
    signals,
  };
}

export function computeNextBestAction(deal: Deal, data: OrgData): NextBestAction | null {
  if (deal.status === "Completed") return null;
  const now = Date.now();
  const contract = data.contracts.find((c) => c.dealId === deal.id) ?? null;
  const dealInvoices = data.invoices.filter((i) => i.dealId === deal.id);
  const overdue = dealInvoices.find((i) => i.status !== "Paid" && i.dueDate && new Date(i.dueDate as any).getTime() < now);
  const base = { dealId: deal.id, dealTitle: deal.dealTitle, brandName: deal.brandName };

  if (overdue) {
    return { ...base, action: `Follow up on ₹${invAmount(overdue).toLocaleString("en-IN")} overdue`, route: `/brand-invoices/${overdue.id}`, urgency: "red" };
  }
  if (!contract) {
    return { ...base, action: "Get the agreement signed", route: `/deals/${deal.id}/contract`, urgency: "yellow" };
  }
  if (!signed(contract)) {
    return { ...base, action: "Upload the signed proof", route: `/contracts/${contract.id}`, urgency: "yellow" };
  }
  const invoicedTotal = dealInvoices.reduce((s, i) => s + invAmount(i), 0);
  if (invoicedTotal < Number(contract.contractValue)) {
    const remaining = Number(contract.contractValue) - invoicedTotal;
    return { ...base, action: `Invoice the remaining ₹${remaining.toLocaleString("en-IN")}`, route: `/contracts/${contract.id}`, urgency: "green" };
  }
  const unpaid = dealInvoices.find((i) => i.status !== "Paid");
  if (unpaid) {
    return { ...base, action: "Record payment when it arrives", route: `/brand-invoices/${unpaid.id}`, urgency: "green" };
  }
  return { ...base, action: "Mark the deal completed", route: `/deals/${deal.id}`, urgency: "green" };
}

export interface Briefing {
  greetingName: string;
  attentionCount: number;
  radar: MoneyRadar;
  nextActions: NextBestAction[];
  generatedAt: string;
}

export async function computeBriefing(user: User): Promise<Briefing> {
  const data = await loadOrg(user);
  const radar = computeMoneyRadar(data);
  const nextActions = data.deals
    .map((d) => computeNextBestAction(d, data))
    .filter((a): a is NextBestAction => !!a)
    .sort((a, b) => ({ red: 0, yellow: 1, green: 2 }[a.urgency] - { red: 0, yellow: 1, green: 2 }[b.urgency]))
    .slice(0, 5);
  const attentionCount =
    (radar.overdue.count ? 1 : 0) + (radar.readyToInvoice.count ? 1 : 0) + (radar.dueThisWeek.count ? 1 : 0);
  return {
    greetingName: user.firstName || "there",
    attentionCount,
    radar,
    nextActions,
    generatedAt: new Date().toISOString(),
  };
}

export async function computeDealIntel(dealId: number, user: User): Promise<{ health: DealHealth; nextAction: NextBestAction | null } | null> {
  const data = await loadOrg(user);
  const deal = data.deals.find((d) => d.id === dealId);
  if (!deal) return null;
  return { health: computeDealHealth(deal, data), nextAction: computeNextBestAction(deal, data) };
}
