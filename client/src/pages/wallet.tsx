/**
 * Credits & usage: what the plan includes and how much of it is used, the credits you bought, what happened to them,
 * and how to buy more. Everything shown is the server's own count (GET /api/credits/wallet); nothing is computed from
 * a number the browser holds.
 *
 * The plan's allowance is a ROLLING window, not a calendar month: each search or draft frees up on its own, a window
 * after it was used. So there is no single "reset date": each allowance says when its earliest counted use passes the
 * window, which is the honest "next one frees up".
 */
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Info, Wallet as WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadError } from "@/components/load-error";
import { TopUpPacks } from "@/components/credits/top-up";
import { WALLET_URL } from "@/lib/credit-keys";
import { creditNoun, dayLabel, expiryNote, featureStatus, LEDGER_LABEL, type Allowance, type CreditKind, type CreditsView, type WarnView } from "@/lib/credits";
import { formatRupees } from "@/hooks/use-plan-prices";
import { cn } from "@/lib/utils";

interface Wallet {
  asOf: string;
  windowDays: number;
  plan: { tier: string; label: string; searches: Allowance | null; drafts: Allowance | null; windowDays: number } | null;
  credits: CreditsView;
  lots: { id: number; kind: CreditKind; units: number; remaining: number; source: string; expiresAt: string | null; createdAt: string; expired: boolean }[];
  ledger: { id: number; kind: CreditKind; delta: number; reason: string; note: string | null; createdAt: string }[];
  purchases: { orderId: string; kind: CreditKind; units: number; priceRupees: number; status: string; createdAt: string | null; completedAt: string | null }[];
  warn: WarnView;
}

const STATUS_LABEL: Record<string, string> = { completed: "Paid", pending: "Not completed", failed: "Failed", refunded: "Refunded", needs_review: "Under review" };
const SOURCE_LABEL: Record<string, string> = { purchase: "Bought", admin_grant: "Added by DealInSec" };

function AllowanceCard({ kind, label, a, credits, warn, windowDays }: { kind: CreditKind; label: string; a: Allowance | null | undefined; credits: CreditsView; warn: WarnView; windowDays: number }) {
  const status = featureStatus(a, credits[kind], warn);
  const unavailable = !a || !status;
  return (
    <Card className="glass-card" data-testid={`wallet-allowance-${kind}`}>
      <CardContent className="space-y-2 p-4">
        <p className="text-sm font-semibold">{label} included in your plan</p>
        {unavailable ? <p className="text-sm text-muted-foreground">Couldn&apos;t be counted just now.</p> : (
          <>
            <p className="text-2xl font-bold tabular-nums leading-tight">{a!.remaining}<span className="text-sm font-normal text-muted-foreground"> of {a!.limit} left</span></p>
            <span className="block h-2 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", status!.state === "warn" ? "bg-amber-500" : status!.state === "ok" ? "bg-emerald-500" : status!.state === "credits" ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${status!.percent}%` }} /></span>
            <p className="text-xs text-muted-foreground" data-testid={`wallet-reset-${kind}`}>
              {a!.nextFreesAt
                ? <>The next one frees up on {dayLabel(a!.nextFreesAt)}, {windowDays} days after your earliest counted use.</>
                : a!.used > 0 ? <>Each use frees up {windowDays} days after it was used.</> : <>Nothing used yet.</>}
            </p>
            {status!.state === "warn" && <p className="text-xs font-medium text-amber-700 dark:text-amber-400" role="status">You&apos;ve used {status!.percent}% of this allowance.</p>}
            {status!.state === "credits" && <p className="text-xs font-medium text-muted-foreground" role="status">Used up: purchased credits pay for the next one.</p>}
            {status!.state === "out" && <p className="text-xs font-medium text-amber-700 dark:text-amber-400" role="status">Used up. Only this is paused: buy extra below, or wait for the next one to free up.</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function WalletPage() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<{ wallet: Wallet }>({ queryKey: [WALLET_URL], retry: false, staleTime: 15_000 });
  const w = data?.wallet;
  const unlimited = w?.plan?.tier === "unlimited";

  return (
    <div className="min-h-screen bg-background pb-20 lg:pb-12">
      <header className="glass-header sticky top-0 z-40 flex items-center gap-3 px-4 py-3 lg:mx-auto lg:max-w-[1600px] lg:px-8 lg:py-5">
        <Link href="/settings?tab=subscription"><Button variant="ghost" size="icon" data-testid="button-back"><ArrowLeft className="h-5 w-5" /></Button></Link>
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold leading-tight lg:text-2xl"><WalletIcon className="h-5 w-5 text-primary" aria-hidden />Credits &amp; usage</h1>
          <p className="text-xs text-muted-foreground">{w?.plan ? w.plan.label : "Your workspace"}</p>
        </div>
      </header>

      <main className="space-y-5 p-4 lg:mx-auto lg:max-w-[1100px] lg:px-8 lg:py-6">
        {isLoading && <div className="space-y-3" data-testid="wallet-loading"><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>}
        {isError && <Card className="glass-card"><LoadError what="your credits" onRetry={() => void refetch()} retrying={isFetching} /></Card>}

        {w && (
          <>
            <section className="space-y-2" aria-label="How credits work">
              <p className="flex items-start gap-2 text-sm text-muted-foreground" data-testid="wallet-explainer">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  One completed Client Radar search uses 1 search credit; one AI draft that was written and saved uses 1 draft credit. Your plan&apos;s own allowance is used first, then credits you bought.
                  Editing, copying, viewing and sending drafts, and everything saved in your workspace, are free. A search that stops before searching, or a draft that fails, uses nothing.
                  Your plan&apos;s allowance is counted over a rolling {w.windowDays} days, so each use frees up on its own date instead of on the 1st.
                </span>
              </p>
            </section>

            {unlimited ? (
              <Card className="glass-card"><CardContent className="p-4 text-sm" data-testid="wallet-unlimited">This workspace has no monthly limits on searches or AI drafts, so it never spends credits. The booster packs below are what every other workspace sees; buying one here only tests the checkout.</CardContent></Card>
            ) : (
                <section className="grid gap-3 md:grid-cols-2" aria-label="Plan allowance">
                  <AllowanceCard kind="search" label="Client Radar searches" a={w.plan?.searches} credits={w.credits} warn={w.warn} windowDays={w.windowDays} />
                  <AllowanceCard kind="draft" label="AI drafts" a={w.plan?.drafts} credits={w.credits} warn={w.warn} windowDays={w.windowDays} />
                </section>
            )}
              <>
                <section id="boosters" className="scroll-mt-24 space-y-3" aria-label="Booster packs and purchased credits">
                  <div>
                    <h2 className="text-base font-semibold">Booster packs</h2>
                    <p className="text-xs text-muted-foreground">Ran out before the month did? Add searches or drafts without changing your plan. Credits you bought show here too.</p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {(["search", "draft"] as CreditKind[]).map((k) => (
                      <Card key={k} className="glass-card" data-testid={`wallet-credits-${k}`}>
                        <CardContent className="space-y-3 p-4">
                          <div>
                            <p className="text-sm font-semibold">{k === "search" ? "Search credits" : "AI draft credits"}</p>
                            <p className="text-2xl font-bold tabular-nums leading-tight" data-testid={`wallet-balance-${k}`}>{w.credits[k].balance}<span className="text-sm font-normal text-muted-foreground"> {creditNoun(k, w.credits[k].balance)} left</span></p>
                            <p className="text-xs text-muted-foreground">
                              {w.credits[k].balance === 0 ? "None right now." : <>Used after your plan&apos;s {k === "search" ? "searches" : "drafts"}; each use costs {w.credits[k].cost}.{expiryNote(w.credits[k].nextExpiry)}</>}
                            </p>
                          </div>
                          <TopUpPacks kind={k} />
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </section>

                {w.lots.length > 0 && (
                  <section className="space-y-2" aria-label="Credit lots">
                    <h2 className="text-base font-semibold">Where your credits came from</h2>
                    <div className="-mx-4 overflow-x-auto px-4">
                      <table className="w-full min-w-[34rem] text-sm" data-testid="wallet-lots">
                        <thead><tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground"><th className="py-1.5 pr-3 font-medium">Credits</th><th className="px-2 py-1.5 font-medium">Source</th><th className="px-2 py-1.5 text-right font-medium">Left</th><th className="px-2 py-1.5 font-medium">Added</th><th className="px-2 py-1.5 font-medium">Expires</th></tr></thead>
                        <tbody>
                          {w.lots.map((l) => (
                            <tr key={l.id} className="border-b last:border-0">
                              <td className="py-1.5 pr-3">{l.units} {creditNoun(l.kind, l.units)}</td>
                              <td className="px-2 py-1.5">{SOURCE_LABEL[l.source] ?? l.source}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{l.expired ? 0 : l.remaining}</td>
                              <td className="px-2 py-1.5">{dayLabel(l.createdAt)}</td>
                              <td className="px-2 py-1.5">{l.expiresAt ? (l.expired ? <span className="text-amber-700 dark:text-amber-400">Expired {dayLabel(l.expiresAt)}</span> : dayLabel(l.expiresAt)) : "Never"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {w.purchases.length > 0 && (
                  <section className="space-y-2" aria-label="Purchase history">
                    <h2 className="text-base font-semibold">Purchases</h2>
                    <div className="-mx-4 overflow-x-auto px-4">
                      <table className="w-full min-w-[30rem] text-sm" data-testid="wallet-purchases">
                        <thead><tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground"><th className="py-1.5 pr-3 font-medium">Date</th><th className="px-2 py-1.5 font-medium">Pack</th><th className="px-2 py-1.5 text-right font-medium">Amount</th><th className="px-2 py-1.5 font-medium">Status</th></tr></thead>
                        <tbody>
                          {w.purchases.map((p) => (
                            <tr key={p.orderId} className="border-b last:border-0">
                              <td className="py-1.5 pr-3">{p.createdAt ? dayLabel(p.createdAt) : "–"}</td>
                              <td className="px-2 py-1.5">{p.units} {creditNoun(p.kind, p.units)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{formatRupees(p.priceRupees)}</td>
                              <td className="px-2 py-1.5">{STATUS_LABEL[p.status] ?? p.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                <section className="space-y-2" aria-label="Credit history">
                  <h2 className="text-base font-semibold">Credit history</h2>
                  {w.ledger.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="wallet-ledger-empty">No credits bought or used yet.</p> : (
                    <div className="-mx-4 overflow-x-auto px-4">
                      <table className="w-full min-w-[30rem] text-sm" data-testid="wallet-ledger">
                        <thead><tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground"><th className="py-1.5 pr-3 font-medium">Date</th><th className="px-2 py-1.5 font-medium">What happened</th><th className="px-2 py-1.5 font-medium">Credits</th><th className="px-2 py-1.5 text-right font-medium">Change</th></tr></thead>
                        <tbody>
                          {w.ledger.map((r) => (
                            <tr key={r.id} className="border-b last:border-0">
                              <td className="py-1.5 pr-3">{dayLabel(r.createdAt)}</td>
                              <td className="px-2 py-1.5">{LEDGER_LABEL[r.reason] ?? r.reason}{r.note ? <span className="text-muted-foreground"> · {r.note}</span> : null}</td>
                              <td className="px-2 py-1.5">{r.kind === "search" ? "Search" : "AI draft"}</td>
                              <td className={cn("px-2 py-1.5 text-right tabular-nums font-medium", r.delta < 0 ? "text-muted-foreground" : "text-emerald-700 dark:text-emerald-400")}>{r.delta > 0 ? `+${r.delta}` : r.delta}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
          </>
        )}
      </main>
    </div>
  );
}
