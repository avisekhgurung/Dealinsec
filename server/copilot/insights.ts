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
import { resolveLocaleSettings, type User, type Deal, type Contract, type BrandInvoice, type LocaleSettings } from "@shared/schema";
import { formatMoney } from "@shared/money";

const DAY = 86_400_000;

// Every amount crossing this module's boundary is MINOR units and says so in
// its name. The briefing is JSON on the wire: without the suffix the client
// would render 6_500_000 paise as "₹65,00,000" with nothing to warn it.
//
// NOT MODEL CONTEXT. The briefing and deal intel go to the browser, which
// formats them; nothing here is ever handed to the model. A tool or prompt
// that wants these figures must send the strings (health `detail`, next-action
// `action` — already formatted) or amountForModel() from ./voice, never these
// objects: a model reading `totalMinor: 6500000` quotes ₹65,00,000.
export interface MoneyRadar {
  overdue: { totalMinor: number; count: number; invoices: { id: number; brandName: string; amountMinor: number; daysOverdue: number; invoiceNumber: string }[] };
  dueThisWeek: { totalMinor: number; count: number; invoices: { id: number; brandName: string; amountMinor: number; dueDate: string; invoiceNumber: string }[] };
  readyToInvoice: { totalMinor: number; count: number; contracts: { id: number; dealId: number; brandName: string; remainingMinor: number; contractName: string }[] };
  collectibleMinor: number;
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
  /** The ORG's locale, not the reader's — these amounts are denominated in the
   *  currency the organisation stored them in. A member abroad reading the
   *  briefing sees the agency's money, correctly labelled. */
  settings: LocaleSettings;
}

async function loadOrg(user: User): Promise<OrgData> {
  const orgId = user.organizationId!;
  const [deals, contracts, invoices, org] = await Promise.all([
    storage.getDealsByOrg(orgId, user.id),
    storage.getContractsByOrg(orgId, user.id),
    storage.getBrandInvoicesByOrg(orgId, user.id),
    storage.getOrganization(orgId),
  ]);
  return { deals, contracts, invoices, settings: resolveLocaleSettings(org, user) };
}

import { analyzeDealProtections, type ProtectionReport } from "./riskcheck";

const signed = (c: Contract) => c.status === "Signed" || !!c.signedByBrand;
const invAmountMinor = (i: BrandInvoice) => i.dealAmountMinor || 0;

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
        .reduce((s, i) => s + invAmountMinor(i), 0);
      return { c, remainingMinor: c.contractValueMinor - invoiced };
    })
    .filter((x) => x.remainingMinor > 0);

  const radar: MoneyRadar = {
    overdue: {
      totalMinor: overdueInv.reduce((s, i) => s + invAmountMinor(i), 0),
      count: overdueInv.length,
      invoices: overdueInv.map((i) => ({
        id: i.id,
        brandName: i.brandName,
        amountMinor: invAmountMinor(i),
        daysOverdue: Math.max(1, Math.floor((now - new Date(i.dueDate as any).getTime()) / DAY)),
        invoiceNumber: i.invoiceNumber,
      })).sort((a, b) => b.daysOverdue - a.daysOverdue).slice(0, 10),
    },
    dueThisWeek: {
      totalMinor: dueWeekInv.reduce((s, i) => s + invAmountMinor(i), 0),
      count: dueWeekInv.length,
      invoices: dueWeekInv.map((i) => ({
        id: i.id, brandName: i.brandName, amountMinor: invAmountMinor(i),
        dueDate: String(i.dueDate), invoiceNumber: i.invoiceNumber,
      })).slice(0, 10),
    },
    readyToInvoice: {
      totalMinor: ready.reduce((s, x) => s + x.remainingMinor, 0),
      count: ready.length,
      contracts: ready.map((x) => ({
        id: x.c.id, dealId: x.c.dealId, brandName: x.c.brandName,
        remainingMinor: x.remainingMinor, contractName: x.c.contractName,
      })).slice(0, 10),
    },
    collectibleMinor: 0,
  };
  radar.collectibleMinor = radar.overdue.totalMinor + radar.dueThisWeek.totalMinor + radar.readyToInvoice.totalMinor;
  return radar;
}

/** Explainable health score — every point traces to a visible signal. */
export function computeDealHealth(deal: Deal, data: OrgData): DealHealth {
  const now = Date.now();
  const money = (minor: number) => formatMoney(minor, data.settings.currency, data.settings.locale);
  const contract = data.contracts.find((c) => c.dealId === deal.id) ?? null;
  const dealInvoices = data.invoices.filter((i) => i.dealId === deal.id);
  const invoicedTotal = dealInvoices.reduce((s, i) => s + invAmountMinor(i), 0);
  const paidTotal = dealInvoices.filter((i) => i.status === "Paid").reduce((s, i) => s + invAmountMinor(i), 0);
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
    } else if (invoicedTotal < deal.dealAmountMinor) {
      signals.push({ label: "Invoicing", state: "warn", detail: `${money(deal.dealAmountMinor - invoicedTotal)} not yet invoiced` });
      score -= 8;
    } else {
      signals.push({ label: "Invoicing", state: "good", detail: "Fully invoiced" });
    }
  }

  if (overdue.length) {
    const amt = overdue.reduce((s, i) => s + invAmountMinor(i), 0);
    const worst = Math.max(...overdue.map((i) => Math.floor((now - new Date(i.dueDate as any).getTime()) / DAY)));
    signals.push({ label: "Payment risk", state: worst > 14 ? "bad" : "warn", detail: `${money(amt)} overdue (${worst} day${worst !== 1 ? "s" : ""})` });
    score -= worst > 14 ? 30 : 15;
  } else if (invoicedTotal > 0 && paidTotal >= invoicedTotal) {
    signals.push({ label: "Payments", state: "good", detail: "All invoices paid" });
  } else if (invoicedTotal > 0) {
    signals.push({ label: "Payments", state: "warn", detail: `${money(invoicedTotal - paidTotal)} awaiting payment (not overdue)` });
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
  const money = (minor: number) => formatMoney(minor, data.settings.currency, data.settings.locale);
  const contract = data.contracts.find((c) => c.dealId === deal.id) ?? null;
  const dealInvoices = data.invoices.filter((i) => i.dealId === deal.id);
  const overdue = dealInvoices.find((i) => i.status !== "Paid" && i.dueDate && new Date(i.dueDate as any).getTime() < now);
  const base = { dealId: deal.id, dealTitle: deal.dealTitle, brandName: deal.brandName };

  if (overdue) {
    return { ...base, action: `Follow up on ${money(invAmountMinor(overdue))} overdue`, route: `/brand-invoices/${overdue.id}`, urgency: "red" };
  }
  if (!contract) {
    return { ...base, action: "Get the agreement signed", route: `/deals/${deal.id}/contract`, urgency: "yellow" };
  }
  if (!signed(contract)) {
    return { ...base, action: "Upload the signed proof", route: `/contracts/${contract.id}`, urgency: "yellow" };
  }
  const invoicedTotal = dealInvoices.reduce((s, i) => s + invAmountMinor(i), 0);
  if (invoicedTotal < contract.contractValueMinor) {
    const remaining = contract.contractValueMinor - invoicedTotal;
    return { ...base, action: `Invoice the remaining ${money(remaining)}`, route: `/contracts/${contract.id}`, urgency: "green" };
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

export async function computeDealIntel(dealId: number, user: User): Promise<{ health: DealHealth; nextAction: NextBestAction | null; protection: ProtectionReport; dealStatus: string } | null> {
  const data = await loadOrg(user);
  const deal = data.deals.find((d) => d.id === dealId);
  if (!deal) return null;
  return {
    health: computeDealHealth(deal, data),
    nextAction: computeNextBestAction(deal, data),
    protection: analyzeDealProtections(deal, data.settings),
    dealStatus: deal.status,
  };
}
