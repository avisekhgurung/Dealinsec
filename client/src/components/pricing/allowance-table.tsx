/**
 * The one table that answers "what exactly do I get, and what spends it?" on the public pricing section and on
 * Plan & billing. Every number is read from the plan definitions the server enforces (shared/outbound-plans.ts,
 * shared/ai-league.ts, shared/permissions.ts, shared/icp.ts), never typed here, so the table cannot drift from
 * billing. server/landing-copy.test.ts reads this file with the landing's own copy guards.
 */
import { Check } from "lucide-react";
import { OUTBOUND_ALLOWANCE_DEFAULTS, OUTBOUND_WINDOW_DAYS } from "@shared/outbound-plans";
import { LEAGUE_ALLOWANCE_DEFAULTS } from "@shared/ai-league";
import { PRO_INCLUDED_SEATS } from "@shared/permissions";
import { MAX_QUANTITY as LIST_MAX_COMPANIES } from "@shared/icp";
import { DEAL_SUITE_LABEL } from "@shared/nav-model";

const OB = OUTBOUND_ALLOWANCE_DEFAULTS;
const LG = LEAGUE_ALLOWANCE_DEFAULTS;

const ROWS: { what: string; note?: string; free: string; pro: string }[] = [
  {
    what: "Deep searches",
    note: `Up to ${OB.free.maxCompanies} companies each, researched in full`,
    free: `${OB.free.monthlySearches}`,
    pro: `${OB.pro.monthlySearches}`,
  },
  {
    what: "Bulk lists",
    note: `Up to ${LIST_MAX_COMPANIES} real, checked companies each — nothing researched yet`,
    free: `${OB.free.monthlyLists}`,
    pro: `${OB.pro.monthlyLists}`,
  },
  {
    what: "Social Intent scans",
    note: "Public posts where someone asks for your kind of work",
    free: `${OB.free.monthlySocialScans}`,
    pro: `${OB.pro.monthlySocialScans}`,
  },
  {
    what: "Companies researched in depth",
    note: "Across all your searches — a bulk list spends none until you research one",
    free: `${OB.free.monthlyProspects}`,
    pro: `${OB.pro.monthlyProspects}`,
  },
  {
    what: "AI outreach drafts",
    note: "Email, WhatsApp, LinkedIn, Instagram, X and Messenger",
    free: `${OB.free.monthlyDrafts}`,
    pro: `${OB.pro.monthlyDrafts}`,
  },
  {
    what: "AI coworker tasks",
    note: "Nibo, Mika and Zee, running in the background",
    free: `${LG.free.monthlyRuns}`,
    pro: `${LG.pro.monthlyRuns}`,
  },
  {
    what: "Team members",
    note: "A standing count, not a monthly one",
    free: "1",
    pro: `${PRO_INCLUDED_SEATS}`,
  },
  {
    what: DEAL_SUITE_LABEL,
    note: "Deals, quotations, agreements signed online, invoices, payment tracking",
    free: "Free, no cap",
    pro: "Free, no cap",
  },
];

/** The full Free-vs-Pro allowance table, one row per metered thing plus the unmetered Deal Suite. */
export function PlanAllowanceTable({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/50 sm:p-6 ${className}`}
      data-testid="pricing-allowances"
    >
      <p className="text-sm font-bold">Your plan, exactly</p>
      <p className="mt-0.5 text-xs text-neutral-500">
        Every number below is what the server enforces. Allowances count over a rolling {OUTBOUND_WINDOW_DAYS} days:
        each use frees up {OUTBOUND_WINDOW_DAYS} days after it happened, not on the 1st of the month.
      </p>
      <div className="mt-4">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left dark:border-neutral-800">
              <th scope="col" className="py-2 pr-3 text-xs font-bold uppercase tracking-wider text-neutral-500">
                Every {OUTBOUND_WINDOW_DAYS} days
              </th>
              <th scope="col" className="w-14 py-2 pr-3 text-xs font-bold uppercase tracking-wider text-neutral-500 sm:w-24">
                Free
              </th>
              <th scope="col" className="w-20 py-2 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 sm:w-28">
                Pro
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.what} className="border-b border-neutral-100 align-top last:border-0 dark:border-neutral-800/60">
                <td className="py-2.5 pr-3">
                  <span className="font-medium text-neutral-800 dark:text-neutral-200">{r.what}</span>
                  {r.note && <span className="block text-xs text-neutral-500">{r.note}</span>}
                </td>
                <td className="py-2.5 pr-3 font-semibold tabular-nums text-neutral-700 dark:text-neutral-300">{r.free}</td>
                <td className="py-2.5 font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{r.pro}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-neutral-500">
        A booster pack adds one-time deep searches (each bringing its own companies) or AI drafts on top of these;
        bulk lists, Social Intent scans and coworker tasks are plan-only. Nothing here is unlimited, and what you
        already found stays in your workspace.
      </p>
    </div>
  );
}

const SPENDS: { action: string; cost: string }[] = [
  {
    action: "Run a deep search",
    cost: "1 deep search — only if it actually searched; one stopped at the profile step costs nothing",
  },
  {
    action: "Build a bulk list",
    cost: "1 bulk list — the companies on it cost nothing more until you research one",
  },
  {
    action: "Research one company in depth",
    cost: "1 researched company — however it arrived: a search, a bulk list, or added by you",
  },
  {
    action: "Scan for public posts",
    cost: "1 Social Intent scan — reading, saving or ignoring the posts costs nothing",
  },
  {
    action: "Let AI write a message",
    cost: "1 AI draft, when it is written and saved — a failed draft costs nothing",
  },
  {
    action: "Edit, improve, copy or send a draft — or write your own",
    cost: "Nothing. Only a new AI-written draft is counted",
  },
  {
    action: "Give a coworker a task",
    cost: "1 coworker task, plus what the task itself runs — Nibo's research also uses a deep search",
  },
  {
    action: `Leads, follow-ups, replies, exports, the do-not-contact list and the whole ${DEAL_SUITE_LABEL}`,
    cost: "Never metered, on any plan",
  },
];

/** What spends an allowance and what never does — so nobody discovers a deduction after the fact. */
export function CreditSpendExplainer({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/50 sm:p-6 ${className}`}
      data-testid="pricing-what-spends"
    >
      <p className="text-sm font-bold">What uses an allowance — and what never does</p>
      <ul className="mt-3 grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
        {SPENDS.map((s) => (
          <li key={s.action} className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
            <span className="text-neutral-600 dark:text-neutral-400">
              <span className="font-semibold text-neutral-800 dark:text-neutral-200">{s.action}:</span> {s.cost}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
