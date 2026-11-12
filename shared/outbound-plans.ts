/**
 * Client Radar research allowances per plan: the one definition the server enforces (server/outbound/limits.ts reads
 * these as defaults, each overridable by an environment variable) and every pricing surface quotes.
 *
 * One credit = one Client Radar search: a search that actually ran on the web (a search that stopped before searching
 * doesn't count; shared/outbound-usage.ts runCountsTowardLimit). Each search looks for up to `maxCompanies` companies,
 * checks their websites and researches the best ones. Allowances run over a rolling 30 days, on top of the daily limit
 * every workspace has.
 *
 * Sizing (measured on production runs, Oct 2026): a completed search cost $0.073 on average and $0.235 at the 90th
 * percentile (search provider + model calls). At Pro's ₹299 (about $3.60), 10 searches a month is about $0.73 on
 * average and about $2.35 at the 90th percentile; the earlier 25 (sized for ₹499) could cost more than the plan earns.
 * The trial gets Pro's allowance; free is a small, real taste.
 *
 * List sweeps are sized differently because they cost differently: a sweep makes NO model calls, so its whole cost is
 * web-search credits (inside the provider's free monthly allowance, which OUTBOUND_GLOBAL_DAILY_SEARCHES is set to stay
 * within) and page fetches. 30 a month on Pro is generous on purpose — the limit that actually binds is the platform's
 * own daily search cap, shared by every workspace, not the plan.
 */
/** "unlimited": a workspace listed in UNLIMITED_ORG_IDS (server/unlimited.ts), never a plan anyone buys. */
export type OutboundTier = "free" | "trial" | "pro" | "unlimited";

/**
 * What a search is for, and so how far it goes and which allowance it spends.
 *   deep  the full pipeline: search, verify, enrich, research, score. Model calls. Spends `monthlySearches`.
 *   list  a bulk sweep that stops after verification: real, reachable companies and nothing more. No model calls
 *         at all after the profile. Spends `monthlyLists`, and holds none of the researched-prospects allowance —
 *         each company is researched later, one at a time, and only then is a researched prospect spent.
 */
export type RunMode = "deep" | "list";
export const RUN_MODES: readonly RunMode[] = ["deep", "list"];
export const isRunMode = (v: unknown): v is RunMode => typeof v === "string" && (RUN_MODES as readonly string[]).includes(v);

export interface OutboundAllowance {
  /** Searches per rolling 30 days: the deep kind, which researches each company it keeps. */
  monthlySearches: number;
  /**
   * Bulk list sweeps per rolling 30 days: a search that stops after checking each company's own website — many
   * companies, no model calls, nothing researched. Its own pool, because it costs a fraction of a deep search:
   * free web-search credits and page fetches only. Each company in the list can be researched later, one at a
   * time, and only then does it cost a researched prospect.
   */
  monthlyLists: number;
  /**
   * Social Intent scans per rolling 30 days: one look across the connected demand sources for people asking for the
   * person's services. Rules only, no model. Free sources cost nothing; the web-discussion source spends web-search
   * credits, which the platform's daily search cap and the workspace's spend ceiling ration on their own.
   */
  monthlySocialScans: number;
  /** The most companies one search may look for, and so the most it researches in depth. */
  maxCompanies: number;
  /** Researched prospects per rolling 30 days: companies a search researched in depth (careers, news, team pages). */
  monthlyProspects: number;
  /** AI-written first messages per rolling 30 days (template follow-ups are not counted). */
  monthlyDrafts: number;
  /** Messages sent through a connected Gmail account per rolling 30 days, across the workspace. */
  monthlySends: number;
}

/**
 * Four separate allowances, each counted over the same rolling 30 days:
 *   searches   one search that ran on the web (one that stopped before searching isn't counted)
 *   prospects  a company a search researched in depth; a running search holds its requested number until it ends,
 *              then only what it really researched counts (a search that found fewer is charged fewer)
 *   drafts     an AI first message that was saved (a draft the checks rejected costs nothing)
 *   sends      a message handed to Gmail (sending or sent; a send that certainly failed frees its slot)
 * Pro's 20 searches of up to 10 companies make the 200-prospect allowance; a search often finds fewer than 10 that fit.
 * Searches (founder's call, 12 Nov 2026): Pro 20 a month (was 10), at ₹299: about $1.46 at the average measured cost,
 * held under the workspace spend ceiling below whatever the mix.
 * Drafts (founder's call, 12 Nov 2026): Free 5, Pro 100. A draft costs about $0.002, so Pro's 100 is about $0.20 of the
 * $1.50 spend ceiling; "Improve" rewrites and messages you write yourself never count.
 */
export const OUTBOUND_ALLOWANCE_DEFAULTS: Readonly<Record<OutboundTier, OutboundAllowance>> = {
  free: { monthlySearches: 3, monthlyLists: 3, monthlySocialScans: 3, maxCompanies: 10, monthlyProspects: 30, monthlyDrafts: 5, monthlySends: 3 },
  trial: { monthlySearches: 20, monthlyLists: 30, monthlySocialScans: 30, maxCompanies: 10, monthlyProspects: 200, monthlyDrafts: 100, monthlySends: 10 },
  pro: { monthlySearches: 20, monthlyLists: 30, monthlySocialScans: 30, maxCompanies: 10, monthlyProspects: 200, monthlyDrafts: 100, monthlySends: 10 },
  // Per search it looks for as many companies as Pro (one search stays one search); there is just no monthly count.
  unlimited: { monthlySearches: 1_000_000, monthlyLists: 1_000_000, monthlySocialScans: 1_000_000, maxCompanies: 10, monthlyProspects: 1_000_000, monthlyDrafts: 1_000_000, monthlySends: 1_000_000 },
};

/**
 * A workspace's AI and provider spend ceiling over the same rolling 30 days, in US dollars (WORKSPACE_MONTHLY_SPEND_USD).
 * Raised from $1.50 to $2.50 on 12 Nov 2026 with Pro's 20 searches, when coworker chats started counting toward it.
 * A safeguard against runaway cost, sized against Pro's ₹299 (about $3.60): at the measured $0.05–0.12 per 10-company
 * search plus about $0.002 per draft, Pro's allowances fit well inside it. Every metered model call and web search
 * reserves against it before it is made.
 */
export const WORKSPACE_MONTHLY_SPEND_USD_DEFAULT = 2.5;

export const OUTBOUND_WINDOW_DAYS = 30;

export const TIER_LABEL: Record<OutboundTier, string> = { free: "Free plan", trial: "Pro trial", pro: "Pro", unlimited: "Unlimited" };
