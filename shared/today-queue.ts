/**
 * The dashboard's "Today" queue: what needs the person now, from their real records, in the order it matters.
 *
 * Pure: no React, no fetching. The dashboard loads each source and hands it in; a source that failed to load is
 * `null`, which is never read as "nothing there": it adds no items, its name goes into `unknown`, and the queue can
 * then never say "all clear". A source the person can't use (no access, or the module isn't set up on this server) is
 * switched off in `can` instead, and is left out entirely: it isn't theirs to check.
 *
 * Every rule reuses the one the rest of the product uses: overdue and due-soon are paymentState() (the invoice list's
 * rule), signed is isAgreementSigned(), follow-up dates are the server's own overdue / due-today split.
 *
 * Copy rule: plain and honest, no invented urgency. DealInSec does not send email and does not collect money: an
 * outreach message is sent by the person from their own email and then marked sent here; an invoice is marked paid
 * when the money arrives. A quotation's "accepted" is the client clicking Accept on the link, nothing more.
 */
import { isAgreementSigned } from "./agreement-lifecycle";
import { paymentState } from "./paymentState";

export type TodayUrgency = "now" | "soon" | "next";

/** The kinds, in priority order: this is the order items appear in. */
export const TODAY_KINDS = [
  "overdue_invoices",
  "follow_ups",
  "awaiting_signature",
  "ready_to_invoice",
  "due_soon_invoices",
  "approved_outreach",
  "quotes_awaiting",
  "deal_terms",
] as const;
export type TodayKind = (typeof TODAY_KINDS)[number];

/** Where the facts come from. The value is how the panel names a source it couldn't check. */
export const TODAY_SOURCES = {
  invoices: "invoices",
  agreements: "agreements",
  followUps: "follow-ups",
  outreach: "outreach messages",
  quotations: "quotations",
  protection: "deal terms",
} as const;
export type TodaySource = keyof typeof TODAY_SOURCES;

export interface TodayInvoice {
  id: number;
  invoiceNumber: string;
  brandName: string;
  status?: string | null;
  dueDate?: string | Date | null;
  amountMinor: number;
  /** ISO-4217 code the amount is in, frozen at issue. Mixed currencies are never summed. */
  currency?: string | null;
  dealId?: number | null;
  contractId?: number | null;
}

export interface TodayAgreement {
  id: number;
  dealId: number;
  contractName: string;
  brandName: string;
  status?: string | null;
  signedByBrand?: boolean | null;
  clientSignedAt?: string | Date | null;
  clientSharedAt?: string | Date | null;
  valueMinor: number;
  currency?: string | null;
}

export interface TodayFollowUp {
  id: number;
  title: string;
  /** YYYY-MM-DD, in the organisation's time zone (the server's split). */
  due: string;
  leadId: number;
  companyName: string;
}

export interface TodayFollowUps {
  /** The server's "today", YYYY-MM-DD in the organisation's time zone. */
  today: string;
  overdue: TodayFollowUp[];
  dueToday: TodayFollowUp[];
}

export interface TodayOutreach {
  id: number;
  status: string;
  leadId: number;
  companyName: string;
  /** On the do-not-contact list: it can't be sent, so it isn't waiting on anyone. */
  blocked?: boolean;
}

export interface TodayQuote {
  id: number;
  dealId: number;
  brandName: string;
  createdAt?: string | Date | null;
  shareToken?: string | null;
  sharedAt?: string | Date | null;
  shareRevokedAt?: string | Date | null;
  acceptedAt?: string | Date | null;
  /** The parent deal's status: only a deal still waiting for a yes ("Pending") needs a nudge. */
  dealStatus?: string | null;
}

/** null = the source didn't load. Never read as an empty list. */
export interface TodayFacts {
  invoices: TodayInvoice[] | null;
  agreements: TodayAgreement[] | null;
  followUps: TodayFollowUps | null;
  outreach: TodayOutreach[] | null;
  quotations: TodayQuote[] | null;
  /** Protection Check over pending deals (the briefing's rule-based count). Absent = not provided. */
  protection?: { withIssues: number; important: number } | null;
}

/** What the person can use. false = left out entirely (no access, or not set up here), not "unknown". */
export interface TodayAccess {
  invoices: boolean;
  agreements: boolean;
  leads: boolean;
  outbound: boolean;
  quotations: boolean;
  /** Deals module (Protection Check findings). Absent = not shown. */
  deals?: boolean;
}

export interface TodayItem {
  id: string;
  kind: TodayKind;
  urgency: TodayUrgency;
  title: string;
  detail: string;
  href: string;
  /** The link's words, e.g. "Open invoices". */
  action: string;
  /** How many records the item stands for, when more than one. */
  count?: number;
}

export interface TodayQueue {
  /** The first `cap` items, in priority order. */
  items: TodayItem[];
  /** Items past the cap, still in order: the panel offers them behind "Show N more". */
  overflow: TodayItem[];
  /** Nothing needs the person, and every source they can use was checked. */
  allClear: boolean;
  /** Names of the sources that couldn't be checked (TODAY_SOURCES values). */
  unknown: string[];
}

export interface TodayOptions {
  /** Formats MINOR units in the given currency (the record's own, when it has one). */
  money?: (minor: number, currency?: string | null) => string;
  /** "client" / "brand": the other party, lower case. */
  party?: string;
  /** How many items show before "Show N more". */
  cap?: number;
}

export const TODAY_CAP = 6;

const DAY_MS = 86_400_000;

/** Which sources each kind reads and what it needs the person to be able to use. */
const KIND_RULES: Record<TodayKind, { sources: TodaySource[]; allowed: (can: TodayAccess) => boolean }> = {
  overdue_invoices: { sources: ["invoices"], allowed: (c) => c.invoices },
  follow_ups: { sources: ["followUps"], allowed: (c) => c.leads },
  awaiting_signature: { sources: ["agreements"], allowed: (c) => c.agreements },
  // Raising the invoice is invoicing work; knowing "nothing invoiced yet" needs both lists.
  ready_to_invoice: { sources: ["agreements", "invoices"], allowed: (c) => c.invoices },
  due_soon_invoices: { sources: ["invoices"], allowed: (c) => c.invoices },
  approved_outreach: { sources: ["outreach"], allowed: (c) => c.outbound },
  quotes_awaiting: { sources: ["quotations"], allowed: (c) => c.quotations },
  deal_terms: { sources: ["protection"], allowed: (c) => !!c.deals },
};

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
const days = (n: number) => `${n} ${plural(n, "day")}`;
const time = (v: string | Date | null | undefined): number => (v ? new Date(v).getTime() : NaN);
/** Whole days between two YYYY-MM-DD strings (b - a). */
const dateDiff = (a: string, b: string): number => {
  const pa = Date.parse(`${a}T00:00:00Z`), pb = Date.parse(`${b}T00:00:00Z`);
  return Number.isFinite(pa) && Number.isFinite(pb) ? Math.round((pb - pa) / DAY_MS) : 0;
};
const defaultMoney = (minor: number, currency?: string | null) => `${currency ? `${currency} ` : ""}${(minor / 100).toFixed(2)}`;

/** A sum, but only when every amount is in the same currency: adding rupees to dollars is a made-up number. */
function total(rows: { amountMinor: number; currency?: string | null }[], money: NonNullable<TodayOptions["money"]>): string | null {
  if (!rows.length) return null;
  const cur = rows[0].currency ?? null;
  if (rows.some((r) => (r.currency ?? null) !== cur)) return null;
  return money(rows.reduce((s, r) => s + Number(r.amountMinor || 0), 0), cur);
}

function overdueInvoices(list: TodayInvoice[], now: Date, money: NonNullable<TodayOptions["money"]>): TodayItem | null {
  const rows = list
    .filter((i) => paymentState(i, now) === "overdue")
    .sort((a, b) => time(a.dueDate) - time(b.dueDate));
  if (!rows.length) return null;
  const oldest = rows[0];
  const late = Math.floor((now.getTime() - time(oldest.dueDate)) / DAY_MS);
  const lateText = late < 1 ? "was due today" : `${days(late)} overdue`;
  if (rows.length === 1) {
    return {
      id: `overdue_invoices:${oldest.id}`, kind: "overdue_invoices", urgency: "now",
      title: `Invoice ${oldest.invoiceNumber} to ${oldest.brandName} is overdue`,
      detail: `${money(oldest.amountMinor, oldest.currency)}, ${lateText}. Follow up, and mark it paid when the money arrives.`,
      href: `/brand-invoices/${oldest.id}`, action: "Open invoice",
    };
  }
  const sum = total(rows, money);
  return {
    id: "overdue_invoices", kind: "overdue_invoices", urgency: "now", count: rows.length,
    title: `${rows.length} invoices are overdue`,
    detail: `${sum ? `${sum} in total. ` : ""}Oldest: ${oldest.invoiceNumber} to ${oldest.brandName}, ${lateText}.`,
    href: "/invoices", action: "Open invoices",
  };
}

function followUps(f: TodayFollowUps): TodayItem | null {
  const rows = [...f.overdue, ...f.dueToday];
  if (!rows.length) return null;
  const when = (x: TodayFollowUp) => {
    const late = dateDiff(x.due, f.today);
    return late > 0 ? `${days(late)} overdue` : "due today";
  };
  if (rows.length === 1) {
    const x = rows[0];
    return {
      id: `follow_ups:${x.id}`, kind: "follow_ups", urgency: "now",
      title: `${x.companyName}: ${x.title}`,
      detail: `Follow-up ${when(x)}.`,
      href: `/leads/${x.leadId}`, action: "Open lead",
    };
  }
  const parts = [
    f.overdue.length ? `${f.overdue.length} overdue` : "",
    f.dueToday.length ? `${f.dueToday.length} due today` : "",
  ].filter(Boolean).join(", ");
  const first = rows[0];
  const oneLead = rows.every((x) => x.leadId === first.leadId);
  return {
    id: "follow_ups", kind: "follow_ups", urgency: "now", count: rows.length,
    title: oneLead ? `${rows.length} follow-ups for ${first.companyName}` : `${rows.length} follow-ups are due`,
    detail: `${parts}. First: ${first.title}${oneLead ? "" : ` (${first.companyName})`}.`,
    href: oneLead ? `/leads/${first.leadId}` : "/leads", action: oneLead ? "Open lead" : "Open leads",
  };
}

function awaitingSignature(list: TodayAgreement[], now: Date, party: string): TodayItem | null {
  const rows = list
    .filter((c) => c.status === "Pending" && !isAgreementSigned(c))
    .sort((a, b) => (time(a.clientSharedAt) || Infinity) - (time(b.clientSharedAt) || Infinity) || a.id - b.id);
  if (!rows.length) return null;
  const sharedAgo = (c: TodayAgreement) => {
    const t = time(c.clientSharedAt);
    if (!Number.isFinite(t)) return "";
    const d = Math.floor((now.getTime() - t) / DAY_MS);
    return d < 1 ? "shared today" : `shared ${days(d)} ago`;
  };
  if (rows.length === 1) {
    const c = rows[0];
    const ago = sharedAgo(c);
    return {
      id: `awaiting_signature:${c.id}`, kind: "awaiting_signature", urgency: "soon",
      title: `Waiting for ${c.brandName} to sign`,
      detail: `${c.contractName}${ago ? `, ${ago}` : ""}. Remind your ${party}, or upload a signed copy.`,
      href: `/contracts/${c.id}`, action: "Open agreement",
    };
  }
  const oldest = rows[0];
  const ago = sharedAgo(oldest);
  return {
    id: "awaiting_signature", kind: "awaiting_signature", urgency: "soon", count: rows.length,
    title: `${rows.length} agreements are waiting for a signature`,
    detail: `Oldest: ${oldest.brandName} (${oldest.contractName})${ago ? `, ${ago}` : ""}.`,
    href: "/contracts", action: "Open agreements",
  };
}

function readyToInvoice(agreements: TodayAgreement[], invoices: TodayInvoice[], money: NonNullable<TodayOptions["money"]>): TodayItem | null {
  const invoicedContracts = new Set(invoices.map((i) => i.contractId).filter((x): x is number => x != null));
  const invoicedDeals = new Set(invoices.map((i) => i.dealId).filter((x): x is number => x != null));
  const rows = agreements
    .filter((c) => isAgreementSigned(c) && !invoicedContracts.has(c.id) && !invoicedDeals.has(c.dealId))
    .sort((a, b) => a.id - b.id);
  if (!rows.length) return null;
  if (rows.length === 1) {
    const c = rows[0];
    return {
      id: `ready_to_invoice:${c.id}`, kind: "ready_to_invoice", urgency: "soon",
      title: `Ready to invoice: ${c.brandName}`,
      detail: `${c.contractName} is signed (${money(c.valueMinor, c.currency)}) and nothing has been invoiced for it yet.`,
      href: `/contracts/${c.id}`, action: "Open agreement",
    };
  }
  const sum = total(rows.map((c) => ({ amountMinor: c.valueMinor, currency: c.currency })), money);
  return {
    id: "ready_to_invoice", kind: "ready_to_invoice", urgency: "soon", count: rows.length,
    title: `${rows.length} signed agreements have nothing invoiced yet`,
    detail: `${sum ? `${sum} agreed in total. ` : ""}Oldest: ${rows[0].brandName} (${rows[0].contractName}).`,
    href: "/contracts", action: "Open agreements",
  };
}

function dueSoonInvoices(list: TodayInvoice[], now: Date, money: NonNullable<TodayOptions["money"]>): TodayItem | null {
  const rows = list
    .filter((i) => paymentState(i, now) === "due_soon")
    .sort((a, b) => time(a.dueDate) - time(b.dueDate));
  if (!rows.length) return null;
  const inText = (i: TodayInvoice) => {
    const d = Math.ceil((time(i.dueDate) - now.getTime()) / DAY_MS);
    return d < 1 ? "due today" : d === 1 ? "due tomorrow" : `due in ${days(d)}`;
  };
  const first = rows[0];
  if (rows.length === 1) {
    return {
      id: `due_soon_invoices:${first.id}`, kind: "due_soon_invoices", urgency: "soon",
      title: `Invoice ${first.invoiceNumber} to ${first.brandName} is ${inText(first)}`,
      detail: `${money(first.amountMinor, first.currency)}. Mark it paid when the money arrives.`,
      href: `/brand-invoices/${first.id}`, action: "Open invoice",
    };
  }
  const sum = total(rows, money);
  return {
    id: "due_soon_invoices", kind: "due_soon_invoices", urgency: "soon", count: rows.length,
    title: `${rows.length} invoices are due in the next 7 days`,
    detail: `${sum ? `${sum} in total. ` : ""}Next: ${first.invoiceNumber} to ${first.brandName}, ${inText(first)}.`,
    href: "/invoices", action: "Open invoices",
  };
}

function approvedOutreach(list: TodayOutreach[]): TodayItem | null {
  const rows = list.filter((m) => m.status === "approved" && !m.blocked);
  if (!rows.length) return null;
  const one = rows.length === 1;
  return {
    id: "approved_outreach", kind: "approved_outreach", urgency: "soon", ...(one ? {} : { count: rows.length }),
    title: one ? `An approved message to ${rows[0].companyName} is waiting to be sent` : `${rows.length} approved messages are waiting to be sent`,
    detail: one
      ? "Send it from your own email, then mark it sent here. DealInSec doesn't send it for you."
      : "Send them from your own email, then mark each one sent here. DealInSec doesn't send them for you.",
    href: "/outbound?view=outreach", action: "Open outreach",
  };
}

function quotesAwaiting(list: TodayQuote[], now: Date): TodayItem | null {
  // Only a deal's latest quotation counts: an older version's link is history.
  const latest = new Map<number, TodayQuote>();
  for (const q of list) {
    const cur = latest.get(q.dealId);
    if (!cur || time(q.createdAt) > time(cur.createdAt) || (time(q.createdAt) === time(cur.createdAt) && q.id > cur.id)) latest.set(q.dealId, q);
  }
  const rows = Array.from(latest.values())
    .filter((q) => q.shareToken && !q.shareRevokedAt && Number.isFinite(time(q.sharedAt)) && !q.acceptedAt && q.dealStatus === "Pending")
    .sort((a, b) => time(a.sharedAt) - time(b.sharedAt));
  if (!rows.length) return null;
  const ago = (q: TodayQuote) => {
    const d = Math.floor((now.getTime() - time(q.sharedAt)) / DAY_MS);
    return d < 1 ? "shared today" : `shared ${days(d)} ago`;
  };
  const oldest = rows[0];
  if (rows.length === 1) {
    return {
      id: `quotes_awaiting:${oldest.id}`, kind: "quotes_awaiting", urgency: "next",
      title: `${oldest.brandName} hasn't accepted the quotation yet`,
      detail: `The link was ${ago(oldest)} and hasn't been accepted on it yet.`,
      href: `/deals/${oldest.dealId}/quote`, action: "Open quotation",
    };
  }
  return {
    id: "quotes_awaiting", kind: "quotes_awaiting", urgency: "next", count: rows.length,
    title: `${rows.length} shared quotations haven't been accepted yet`,
    detail: `Oldest: ${oldest.brandName}, ${ago(oldest)}.`,
    href: "/quotations", action: "Open quotations",
  };
}

/** Pending deals whose terms Protection Check flagged: worth settling before the quotation goes out. */
function dealTerms(p: { withIssues: number; important: number }): TodayItem | null {
  const n = Math.max(0, Math.floor(Number(p.withIssues) || 0));
  if (!n) return null;
  const important = Math.max(0, Math.floor(Number(p.important) || 0));
  return {
    id: "deal_terms", kind: "deal_terms", urgency: "next", ...(n > 1 ? { count: n } : {}),
    title: n === 1 ? "1 pending deal has terms worth clarifying" : `${n} pending deals have terms worth clarifying`,
    detail: `Protection Check found ${important ? `${important} important ${plural(important, "point")}` : "points"} to settle before you send the quotation. Nothing is changed unless you approve it.`,
    href: "/deals", action: "Review deals",
  };
}

export function todayQueue(facts: TodayFacts, now: Date, can: TodayAccess, opts: TodayOptions = {}): TodayQueue {
  const money = opts.money ?? defaultMoney;
  const party = (opts.party || "client").toLowerCase();
  const cap = Math.max(0, opts.cap ?? TODAY_CAP);

  const relevant = new Set<TodaySource>();
  const items: TodayItem[] = [];
  for (const kind of TODAY_KINDS) {
    const rule = KIND_RULES[kind];
    if (!rule.allowed(can)) continue;
    rule.sources.forEach((s) => relevant.add(s));
    // A kind with any source missing says nothing: not zero, not "all clear".
    if (rule.sources.some((s) => facts[s] == null)) continue;
    const item =
      kind === "overdue_invoices" ? overdueInvoices(facts.invoices!, now, money)
      : kind === "follow_ups" ? followUps(facts.followUps!)
      : kind === "awaiting_signature" ? awaitingSignature(facts.agreements!, now, party)
      : kind === "ready_to_invoice" ? readyToInvoice(facts.agreements!, facts.invoices!, money)
      : kind === "due_soon_invoices" ? dueSoonInvoices(facts.invoices!, now, money)
      : kind === "approved_outreach" ? approvedOutreach(facts.outreach!)
      : kind === "quotes_awaiting" ? quotesAwaiting(facts.quotations!, now)
      : dealTerms(facts.protection!);
    if (item) items.push(item);
  }

  const unknown = (Object.keys(TODAY_SOURCES) as TodaySource[])
    .filter((s) => relevant.has(s) && facts[s] == null)
    .map((s) => TODAY_SOURCES[s]);

  return {
    items: items.slice(0, cap),
    overflow: items.slice(cap),
    // Nothing checked is not "all clear": a person with no sources at all gets no verdict.
    allClear: relevant.size > 0 && items.length === 0 && unknown.length === 0,
    unknown,
  };
}

/** The one-line summary under the panel's title. */
export function todaySummary(q: TodayQueue): string {
  const n = q.items.length + q.overflow.length;
  if (n > 0) return `${n} ${plural(n, "thing needs", "things need")} you`;
  if (q.allClear) return "All clear: nothing needs you today";
  return "Nothing found in what could be checked";
}
