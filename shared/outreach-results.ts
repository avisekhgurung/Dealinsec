/**
 * Results beyond the research-to-revenue funnel (shared/sales-funnel.ts), for one window: what searches FOUND and how
 * reachable it is, and what each outreach campaign sent and got back. Pure: the server counts, this shapes.
 *
 * Three rules:
 *   - every number is a count of companies or of sent messages, taken from the rows. Nothing is estimated;
 *   - a share is "unknown" (null), never 0, while its base is 0 — and the page says when a base is too small to read;
 *   - "followed by" is not "caused by": a meeting after a campaign's message is reported as having followed it.
 * Costs are NOT here. They are the platform's, reported to the operator by script/sales-engine-report.mts.
 */
import { FUNNEL_WINDOWS, funnelDays } from "./sales-funnel";

export const RESULTS_WINDOWS = FUNNEL_WINDOWS;
export const resultsDays = funnelDays;
/** Below this many, a percentage says more about chance than about the search. */
export const SMALL_BASE = 20;

const pct = (n: number, of: number): number | null => (of > 0 ? Math.round((100 * n) / of) : null);
const cap = (n: number, max: number) => Math.max(0, Math.min(n, max));

/* ── discovery ──────────────────────────────────────────────────────────── */

export interface DiscoveryCounts {
  /** Companies first found in the window (a bulk list finds many and researches none). */
  discovered: number;
  /** Their own website was reached and is a real company's. */
  verified: number;
  /** Judged a fit on evidence (strong or partial). */
  qualified: number;
  /** A fit, with a way in and a dated reason to get in touch. */
  ready: number;
  researched: number; leads: number;
  /** Of the verified: a person named, a public way in (a business email or a confirmed contact form), an email a provider verified. */
  person: number; publicRoute: number; verifiedEmail: number;
}
export const EMPTY_DISCOVERY: DiscoveryCounts = { discovered: 0, verified: 0, qualified: 0, ready: 0, researched: 0, leads: 0, person: 0, publicRoute: 0, verifiedEmail: 0 };

export const DISCOVERY_STAGES = ["discovered", "verified", "qualified", "ready"] as const;
export type DiscoveryStage = (typeof DISCOVERY_STAGES)[number];
export const DISCOVERY_LABEL: Record<DiscoveryStage, string> = { discovered: "Found", verified: "Real, reachable website", qualified: "Fits what you asked for", ready: "Ready to contact" };
export const COVERAGE_KEYS = ["person", "publicRoute", "verifiedEmail"] as const;
export type CoverageKey = (typeof COVERAGE_KEYS)[number];
export const COVERAGE_LABEL: Record<CoverageKey, string> = { person: "A named person", publicRoute: "A public way in (business email or contact form)", verifiedEmail: "A verified email address" };

export interface DiscoveryView {
  stages: { key: DiscoveryStage; label: string; count: number; fromPrevious: number | null }[];
  researched: number; leads: number;
  /** Shares of the companies with a real website. */
  coverage: { key: CoverageKey; label: string; count: number; share: number | null }[];
  coverageBase: number;
  notes: string[];
}

export function discoveryView(c: DiscoveryCounts): DiscoveryView {
  // Each stage is a subset of the one before; a row that says otherwise (a company set aside after it was scored) is capped.
  let prev: number | null = null;
  const stages = DISCOVERY_STAGES.map((key) => {
    const count: number = prev === null ? Math.max(0, c[key]) : cap(c[key], prev);
    const fromPrevious = prev === null ? null : pct(count, prev);
    prev = count;
    return { key, label: DISCOVERY_LABEL[key], count, fromPrevious };
  });
  const base = stages[1].count;
  const coverage = COVERAGE_KEYS.map((key) => { const count = cap(c[key], base); return { key, label: COVERAGE_LABEL[key], count, share: pct(count, base) }; });
  const notes: string[] = [];
  if (stages[0].count > 0 && stages[0].count < SMALL_BASE) notes.push(`Only ${stages[0].count} compan${stages[0].count === 1 ? "y" : "ies"} found in this window: too few to read the percentages from.`);
  const unresearched = stages[1].count - cap(c.researched, stages[1].count);
  if (unresearched > 0) notes.push(`${unresearched} real compan${unresearched === 1 ? "y has" : "ies have"} not been researched in depth yet, so who to reach there and why now aren't known. A bulk list ends there on purpose.`);
  if (base > 0 && coverage[2].count === 0) notes.push("No email address has been verified. That needs a contact provider connected to this server; without one, addresses are found on companies' own sites, not verified.");
  return { stages, researched: cap(c.researched, stages[0].count), leads: cap(c.leads, stages[0].count), coverage, coverageBase: base, notes };
}

/* ── campaigns ──────────────────────────────────────────────────────────── */

export interface CampaignResultCounts {
  id: number; name: string; profileName: string | null; archived: boolean; createdAt: string;
  members: number; sent: number; replied: number; interested: number; bounced: number; optedOut: number;
  /** Of the leads a message was sent to: how many later reached each stage. */
  meeting: number; proposal: number; won: number;
  /** Value of the won deals, in the workspace's currency (minor units). */
  wonValueMinor: number;
}
export interface CampaignResultRow extends CampaignResultCounts {
  /** Shares of what was sent, 0–100, or null while nothing was sent. */
  replyRate: number | null; interestedRate: number | null; bounceRate: number | null;
}
export interface ProfileResultRow { profileName: string | null; campaigns: number; sent: number; replied: number; interested: number; bounced: number; meeting: number; proposal: number; won: number; wonValueMinor: number; replyRate: number | null; interestedRate: number | null }
export interface CampaignResultsView {
  rows: CampaignResultRow[];
  /** The same numbers added up per client profile; one entry (null) for campaigns made without a profile. Only when there is more than one campaign. */
  byProfile: ProfileResultRow[];
  totals: { campaigns: number; sent: number; replied: number; interested: number; bounced: number; optedOut: number; meeting: number; proposal: number; won: number; wonValueMinor: number; replyRate: number | null; interestedRate: number | null; bounceRate: number | null };
  notes: string[];
}

/** One campaign's numbers, kept consistent: nothing can come back from more than was sent, and a later stage is inside the earlier one. */
function tidy(c: CampaignResultCounts): CampaignResultRow {
  const sent = cap(c.sent, Math.max(0, c.members));
  const replied = cap(c.replied, sent), meeting = cap(c.meeting, sent), proposal = cap(c.proposal, meeting), won = cap(c.won, proposal);
  const row = { ...c, sent, replied, interested: cap(c.interested, replied), bounced: cap(c.bounced, sent), optedOut: cap(c.optedOut, sent), meeting, proposal, won, wonValueMinor: won > 0 ? Math.max(0, c.wonValueMinor) : 0 };
  return { ...row, replyRate: pct(row.replied, sent), interestedRate: pct(row.interested, sent), bounceRate: pct(row.bounced, sent) };
}

export function campaignResultsView(input: CampaignResultCounts[]): CampaignResultsView {
  const rows = input.map(tidy);
  const sum = (xs: CampaignResultRow[], k: "sent" | "replied" | "interested" | "bounced" | "optedOut" | "meeting" | "proposal" | "won" | "wonValueMinor") => xs.reduce((a, r) => a + r[k], 0);
  const groups = new Map<string, CampaignResultRow[]>();
  for (const r of rows) { const k = r.profileName ?? ""; groups.set(k, [...(groups.get(k) ?? []), r]); }
  const byProfile: ProfileResultRow[] = rows.length > 1 ? Array.from(groups.entries()).map(([k, xs]) => {
    const sent = sum(xs, "sent");
    return { profileName: k || null, campaigns: xs.length, sent, replied: sum(xs, "replied"), interested: sum(xs, "interested"), bounced: sum(xs, "bounced"), meeting: sum(xs, "meeting"), proposal: sum(xs, "proposal"), won: sum(xs, "won"), wonValueMinor: sum(xs, "wonValueMinor"), replyRate: pct(sum(xs, "replied"), sent), interestedRate: pct(sum(xs, "interested"), sent) };
  }).sort((a, b) => b.sent - a.sent || (a.profileName ?? "~").localeCompare(b.profileName ?? "~")) : [];
  const sent = sum(rows, "sent");
  const totals = { campaigns: rows.length, sent, replied: sum(rows, "replied"), interested: sum(rows, "interested"), bounced: sum(rows, "bounced"), optedOut: sum(rows, "optedOut"), meeting: sum(rows, "meeting"), proposal: sum(rows, "proposal"), won: sum(rows, "won"), wonValueMinor: sum(rows, "wonValueMinor"), replyRate: pct(sum(rows, "replied"), sent), interestedRate: pct(sum(rows, "interested"), sent), bounceRate: pct(sum(rows, "bounced"), sent) };
  const notes: string[] = [];
  if (rows.length) notes.push("Meetings, proposals and wins are leads that reached that stage after a campaign's message was sent to them. They followed the message; that doesn't prove the message caused them.");
  if (sent > 0 && sent < SMALL_BASE) notes.push(`Only ${sent} message${sent === 1 ? "" : "s"} sent across these campaigns: too few to read rates from.`);
  if (rows.length && sent === 0) notes.push("Nothing has been sent from these campaigns yet, so there are no rates.");
  return { rows, byProfile, totals, notes };
}

export interface ResultsView { days: number; currency: string; discovery: DiscoveryView; /** null = campaigns aren't set up on this server. */ campaigns: CampaignResultsView | null }
