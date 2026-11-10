/**
 * Client Radar's Results view, the two halves beside the research-to-revenue funnel (GET /api/outbound/results,
 * shared/outreach-results.ts): what your searches found and how reachable it is, and what each campaign sent and got
 * back. Plus what your plan has used in the last 30 days, from the same numbers the limits are enforced with.
 *
 * Counts from your own records. A percentage shows "–" while there is nothing to take it of, and the notes say when
 * a number is too small to read anything from.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RESULTS_WINDOWS, type CampaignResultRow, type ProfileResultRow, type ResultsView } from "@shared/outreach-results";

interface Allowance { used: number; limit: number; remaining: number }
interface UsageResponse { usage: { plan?: { tier: string; label: string; windowDays: number; searches: Allowance | null; lists: Allowance | null; prospects: Allowance | null; drafts: Allowance | null; sends: Allowance | null; spendPercent: number | null } } }

const rate = (v: number | null) => (v === null ? "–" : `${v}%`);
const money = (minor: number, currency: string) => formatMoney(minor, currency, currency === "INR" ? "en-IN" : "en-US");

function Windows({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  return (
    <div className="flex gap-1" role="group" aria-label="Window">
      {RESULTS_WINDOWS.map((d) => (
        <button key={d} onClick={() => onChange(d)} aria-pressed={days === d} data-testid={`results-days-${d}`}
          className={cn("rounded-full border px-2.5 py-1 text-xs", days === d ? "border-emerald-600 bg-emerald-600 text-white" : "border-border hover:bg-muted")}>
          {d === 365 ? "1 year" : `${d} days`}
        </button>
      ))}
    </div>
  );
}
const Notes = ({ notes }: { notes: string[] }) => (notes.length ? <ul className="ml-4 list-disc text-[11px] text-muted-foreground">{notes.map((n) => <li key={n}>{n}</li>)}</ul> : null);

/** What the plan has used: the same counts the server enforces, never dollars. */
export function PlanUsage() {
  const q = useQuery<UsageResponse>({ queryKey: ["/api/outbound/usage"], retry: false });
  const plan = q.data?.usage.plan;
  if (!plan) return null;
  const unlimited = plan.tier === "unlimited";
  const rows: [string, Allowance | null][] = [["Searches", plan.searches], ["Bulk lists", plan.lists], ["Companies researched", plan.prospects], ["AI drafts", plan.drafts], ["Sends", plan.sends]];
  return (
    <Card className="glass-card" data-testid="plan-usage">
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="text-sm font-semibold">Your plan, last {plan.windowDays} days</p>
          <p className="text-xs text-muted-foreground">{plan.label}{unlimited ? " · no monthly limits on this workspace" : " · each one frees up again as it passes 30 days"}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {rows.map(([label, a]) => (
            <div key={label} className="rounded-xl border px-3 py-2" data-testid="plan-usage-item">
              <p className="text-lg font-bold tabular-nums leading-tight">{a ? a.used : "–"}{a && !unlimited && <span className="text-xs font-normal text-muted-foreground"> of {a.limit}</span>}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
              {a && !unlimited && <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", a.remaining === 0 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${a.limit ? Math.min(100, (a.used / a.limit) * 100) : 0}%` }} /></span>}
            </div>
          ))}
          {plan.spendPercent !== null && !unlimited && (
            <div className="rounded-xl border px-3 py-2" data-testid="plan-usage-budget" title="Your workspace's share of its AI and research budget for the last 30 days">
              <p className="text-lg font-bold tabular-nums leading-tight">{plan.spendPercent}%</p>
              <p className="text-xs text-muted-foreground">AI budget used</p>
              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", plan.spendPercent >= 100 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${Math.min(100, plan.spendPercent)}%` }} /></span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CampaignTable({ rows, currency }: { rows: (CampaignResultRow | (ProfileResultRow & { name: string }))[]; currency: string }) {
  const showValue = rows.some((r) => r.wonValueMinor > 0);
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[34rem] text-sm">
        <thead>
          <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="py-1.5 pr-3 font-medium">{"campaigns" in rows[0] ? "Client profile" : "Campaign"}</th>
            <th className="px-2 py-1.5 text-right font-medium">Sent</th><th className="px-2 py-1.5 text-right font-medium">Replied</th><th className="px-2 py-1.5 text-right font-medium">Interested</th>
            <th className="px-2 py-1.5 text-right font-medium">Bounced</th><th className="px-2 py-1.5 text-right font-medium">Meeting</th><th className="px-2 py-1.5 text-right font-medium">Proposal</th><th className="px-2 py-1.5 text-right font-medium">Won</th>
            {showValue && <th className="py-1.5 pl-2 text-right font-medium">Won value</th>}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={"id" in r ? `c${r.id}` : `p${r.name}`} data-testid="results-campaign-row">
              <td className="max-w-[14rem] py-1.5 pr-3">
                <span className="block truncate font-medium">{r.name}</span>
                {"id" in r ? <span className="block truncate text-[11px] text-muted-foreground">{[r.profileName ? `for ${r.profileName}` : null, `${r.members} lead${r.members === 1 ? "" : "s"}`, r.archived ? "archived" : null].filter(Boolean).join(" · ")}</span>
                  : <span className="block text-[11px] text-muted-foreground">{r.campaigns} campaign{r.campaigns === 1 ? "" : "s"}</span>}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.sent}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.replied} <span className="text-[11px] text-muted-foreground">{rate(r.replyRate)}</span></td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.interested} <span className="text-[11px] text-muted-foreground">{rate(r.interestedRate)}</span></td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.bounced}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.meeting}</td><td className="px-2 py-1.5 text-right tabular-nums">{r.proposal}</td><td className="px-2 py-1.5 text-right tabular-nums">{r.won}</td>
              {showValue && <td className="py-1.5 pl-2 text-right tabular-nums">{r.wonValueMinor ? money(r.wonValueMinor, currency) : "–"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResultsOverview() {
  const [days, setDays] = useState<number>(90);
  const q = useQuery<{ results: ResultsView }>({ queryKey: [`/api/outbound/results?days=${days}`], retry: false });
  const r = q.data?.results;
  const top = r?.discovery.stages[0].count ?? 0;
  return (
    <>
      <Card className="glass-card" data-testid="results-discovery">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">What your searches found</p>
              <p className="text-xs text-muted-foreground">Companies first found in the last {days} days, how many held up, and how many you can reach.</p>
            </div>
            <Windows days={days} onChange={setDays} />
          </div>
          {q.isLoading ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
            : q.isError || !r ? <p className="text-sm text-muted-foreground" data-testid="results-error">The results couldn't be loaded right now.</p>
            : top === 0 ? <p className="text-sm text-muted-foreground" data-testid="results-empty">No company found in this window yet. Run a search or build a list; what it finds shows up here.</p>
            : (
              <>
                <ol className="space-y-1.5" data-testid="results-discovery-stages">
                  {r.discovery.stages.map((s) => (
                    <li key={s.key} className="grid grid-cols-[10rem_1fr_auto] items-center gap-2 text-sm sm:grid-cols-[13rem_1fr_auto]" data-testid={`results-${s.key}`}>
                      <span className="truncate">{s.label}</span>
                      <span className="h-2.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(s.count ? 3 : 0, (s.count / top) * 100)}%` }} /></span>
                      <span className="w-20 text-right tabular-nums"><span className="font-semibold">{s.count}</span>{s.fromPrevious !== null && <span className="ml-1 text-[11px] text-muted-foreground">{s.fromPrevious}%</span>}</span>
                    </li>
                  ))}
                </ol>
                <p className="text-xs text-muted-foreground">Researched in depth: <span className="font-medium text-foreground">{r.discovery.researched}</span> · Added to Leads: <span className="font-medium text-foreground">{r.discovery.leads}</span></p>
                <div className="space-y-1.5" data-testid="results-coverage">
                  <p className="text-xs font-semibold">Who you can reach <span className="font-normal text-muted-foreground">· of the {r.discovery.coverageBase} with a real website</span></p>
                  <ul className="grid gap-2 sm:grid-cols-3">
                    {r.discovery.coverage.map((c) => (
                      <li key={c.key} className="rounded-xl border px-3 py-2" data-testid={`results-coverage-${c.key}`}>
                        <p className="text-lg font-bold tabular-nums leading-tight">{c.count} <span className="text-xs font-normal text-muted-foreground">{rate(c.share)}</span></p>
                        <p className="text-xs text-muted-foreground">{c.label}</p>
                      </li>
                    ))}
                  </ul>
                </div>
                <Notes notes={r.discovery.notes} />
              </>
            )}
        </CardContent>
      </Card>

      {r && r.campaigns && (
        <Card className="glass-card" data-testid="results-campaigns">
          <CardContent className="space-y-4 p-4">
            <div>
              <p className="text-sm font-semibold">Campaigns</p>
              <p className="text-xs text-muted-foreground">Campaigns started in the last {days} days: what was sent and what came back. Rates are a share of what was sent.</p>
            </div>
            {r.campaigns.rows.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="results-campaigns-empty">No campaign started in this window.</p> : (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="results-campaign-totals">
                  {([["Sent", r.campaigns.totals.sent, null], ["Replied", r.campaigns.totals.replied, r.campaigns.totals.replyRate], ["Read as interested", r.campaigns.totals.interested, r.campaigns.totals.interestedRate], ["Bounced", r.campaigns.totals.bounced, r.campaigns.totals.bounceRate]] as const).map(([label, value, share]) => (
                    <div key={label} className="rounded-xl border px-3 py-2">
                      <p className="text-lg font-bold tabular-nums leading-tight">{value}{label !== "Sent" && <span className="ml-1 text-xs font-normal text-muted-foreground">{rate(share)}</span>}</p>
                      <p className="text-xs text-muted-foreground">{label}</p>
                    </div>
                  ))}
                </div>
                <CampaignTable rows={r.campaigns.rows} currency={r.currency} />
                {r.campaigns.byProfile.length > 1 && (
                  <div className="space-y-1.5" data-testid="results-by-profile">
                    <p className="text-xs font-semibold">By client profile</p>
                    <CampaignTable rows={r.campaigns.byProfile.map((p) => ({ ...p, name: p.profileName ?? "No profile" }))} currency={r.currency} />
                  </div>
                )}
                <Notes notes={r.campaigns.notes} />
              </>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
