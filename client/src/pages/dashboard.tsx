import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BottomNav } from "@/components/bottom-nav";
import { StatusBadge } from "@/components/status-badge";
import { useMemo } from "react";
import {
  Plus, Briefcase, FileCheck, Receipt, ChevronRight, LogOut,
  TrendingUp, IndianRupee, Clock, CheckCircle2
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import type { Deal, Contract, Invoice } from "@shared/schema";

// ─── helpers ────────────────────────────────────────────────────────────────

function getMonthLabel(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

function buildDealsOverTime(deals: Deal[]) {
  const map: Record<string, number> = {};
  deals.forEach(d => {
    const key = getMonthLabel(d.startDate);
    map[key] = (map[key] ?? 0) + 1;
  });
  return Object.entries(map).slice(-6).map(([month, count]) => ({ month, count }));
}

function buildRevenueOverTime(deals: Deal[]) {
  const map: Record<string, number> = {};
  deals.forEach(d => {
    const key = getMonthLabel(d.startDate);
    map[key] = (map[key] ?? 0) + Number(d.dealAmount);
  });
  return Object.entries(map).slice(-6).map(([month, amount]) => ({ month, amount }));
}

function buildPlatformDist(deals: Deal[]) {
  const map: Record<string, number> = {};
  deals.forEach(d => {
    d.deliverables.forEach(del => {
      map[del.platform] = (map[del.platform] ?? 0) + 1;
    });
  });
  return Object.entries(map).map(([platform, count]) => ({ platform, count }));
}

function buildDeliverableCompletion(deals: Deal[]) {
  const platformMap: Record<string, { total: number; completed: number }> = {};
  deals.forEach(d => {
    let completedIds: Set<string> = new Set();
    try {
      const stored = localStorage.getItem(`deliverables-done-${d.id}`);
      if (stored) completedIds = new Set(JSON.parse(stored));
    } catch {}
    d.deliverables.forEach(del => {
      if (!platformMap[del.platform]) platformMap[del.platform] = { total: 0, completed: 0 };
      platformMap[del.platform].total += 1;
      if (completedIds.has(del.id)) platformMap[del.platform].completed += 1;
    });
  });
  return Object.entries(platformMap).map(([platform, data]) => ({
    platform,
    total: data.total,
    completed: data.completed,
  }));
}

const PLATFORM_COLORS = ["#3B82F6", "#0D9488", "#f59e0b", "#64748B", "#e11d48"];

// ─── custom tooltip ──────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label, prefix = "" }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background/95 backdrop-blur border border-white/20 rounded-lg p-3 shadow-lg text-xs">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }} className="font-medium">
          {p.name}: {prefix}{typeof p.value === "number" && prefix === "₹" ? p.value.toLocaleString("en-IN") : p.value}
        </p>
      ))}
    </div>
  );
}

// ─── stat card ───────────────────────────────────────────────────────────────
// Elegant Linear/Stripe-style: white surface + subtle colored icon tile.
// tone controls the small icon chip color only, not the whole card.

type StatTone = "emerald" | "blue" | "amber" | "slate";

const TONE_STYLES: Record<StatTone, { bg: string; text: string }> = {
  emerald: { bg: "bg-emerald-100 dark:bg-emerald-900/30", text: "text-emerald-600 dark:text-emerald-400" },
  blue:    { bg: "bg-blue-100 dark:bg-blue-900/30",       text: "text-blue-600 dark:text-blue-400" },
  amber:   { bg: "bg-amber-100 dark:bg-amber-900/30",     text: "text-amber-600 dark:text-amber-400" },
  slate:   { bg: "bg-slate-100 dark:bg-slate-800/60",     text: "text-slate-600 dark:text-slate-300" },
};

function StatCard({ title, value, icon: Icon, tone, href, loading }: {
  title: string;
  value: number | string;
  icon: any;
  tone: StatTone;
  href: string;
  loading: boolean;
}) {
  const t = TONE_STYLES[tone];
  return (
    <Link href={href}>
      <div
        className="group rounded-2xl p-3 sm:p-4 lg:p-5 cursor-pointer overflow-hidden bg-white dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 hover:border-primary/40 dark:hover:border-primary/40 hover:shadow-lg hover:shadow-primary/[0.04] transition-all duration-200"
      >
        <div className="flex items-start justify-between gap-2 mb-2 sm:mb-3 lg:mb-4">
          <div className={`flex items-center justify-center w-9 h-9 lg:w-11 lg:h-11 rounded-xl shrink-0 ${t.bg} group-hover:scale-105 transition-transform`}>
            <Icon className={`w-4 h-4 lg:w-5 lg:h-5 ${t.text}`} strokeWidth={2.2} />
          </div>
          <ChevronRight className="w-4 h-4 lg:w-5 lg:h-5 text-neutral-400 dark:text-neutral-600 shrink-0 mt-1 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
        </div>
        <p className="text-[11px] lg:text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400 truncate mb-0.5 lg:mb-1">
          {title}
        </p>
        {loading ? (
          <Skeleton className="h-7 lg:h-10 w-16 lg:w-24" />
        ) : (
          <p className="text-xl sm:text-2xl lg:text-3xl xl:text-4xl font-bold text-neutral-900 dark:text-white truncate leading-tight tracking-tight">
            {value}
          </p>
        )}
      </div>
    </Link>
  );
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth();
  const displayName = user?.firstName && user?.lastName
    ? `${user.firstName} ${user.lastName}`
    : user?.email?.split("@")[0] || "Influencer";

  const { data: deals = [], isLoading: dealsLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
  });

  const { data: contracts = [], isLoading: contractsLoading } = useQuery<Contract[]>({
    queryKey: ["/api/contracts"],
  });

  const { data: invoices = [], isLoading: invoicesLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
  });

  const isLoading = dealsLoading || contractsLoading || invoicesLoading;

  // Stat counts — show total deals across all statuses (Pending + Active + Completed)
  const totalDeals = deals.length;
  const signedContracts = contracts.filter(c => c.status === "Signed" || c.status === "Active").length;
  const paidInvoices = invoices.filter(i => i.status === "Paid").length;
  const totalRevenue = deals
    .filter(d => d.status === "Completed" || d.status === "Active")
    .reduce((s, d) => s + Number(d.dealAmount), 0);
  const pendingRevenue = deals
    .filter(d => d.status === "Pending")
    .reduce((s, d) => s + Number(d.dealAmount), 0);

  // Chart data
  const dealsOverTime = buildDealsOverTime(deals);
  const revenueOverTime = buildRevenueOverTime(deals);
  const platformDist = buildPlatformDist(deals);
  const deliverableCompletion = useMemo(() => buildDeliverableCompletion(deals), [deals]);
  const totalDeliverables = deliverableCompletion.reduce((s, d) => s + d.total, 0);
  const completedDeliverables = deliverableCompletion.reduce((s, d) => s + d.completed, 0);

  const recentDeals = deals.slice(0, 3);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    window.location.href = "/";
  };

  return (
    <div className="min-h-screen bg-background pb-24 lg:pb-12">
      {/* Header — compact on mobile, generous on desktop SaaS-style */}
      <header className="glass-header sticky top-0 z-40 lg:border-b lg:border-neutral-200/60 dark:lg:border-neutral-800/60">
        <div className="flex items-center justify-between gap-4 px-4 py-4 lg:max-w-7xl lg:mx-auto lg:px-8 lg:py-6 xl:px-12">
          <div>
            <p className="text-xs lg:text-sm text-muted-foreground">Welcome back,</p>
            <h1 className="text-lg lg:text-2xl font-bold tracking-tight">{displayName}</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden lg:inline-flex items-center gap-2 rounded-full bg-emerald-50 dark:bg-emerald-950/30 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/40">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              All systems operational
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              data-testid="button-logout"
              className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 lg:hidden"
            >
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="px-4 py-5 space-y-6 animate-fade-in lg:max-w-7xl lg:mx-auto lg:px-8 lg:py-8 lg:space-y-8 xl:px-12">

        {/* ── Stat cards ── */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-5">
          <StatCard title="Deals" value={totalDeals} icon={Briefcase}
            tone="amber" href="/deals" loading={isLoading} />
          <StatCard title="Agreements" value={signedContracts} icon={FileCheck}
            tone="blue" href="/contracts" loading={isLoading} />
          <StatCard title="Paid Invoices" value={paidInvoices} icon={Receipt}
            tone="emerald" href="/invoices" loading={isLoading} />
          <StatCard
            title="Pipeline Value"
            value={isLoading ? "…" : `₹${(totalRevenue + pendingRevenue).toLocaleString("en-IN")}`}
            icon={IndianRupee}
            tone="slate"
            href="/deals"
            loading={false}
          />
        </section>

        {/* ── Deal Status breakdown — segmented bar + responsive counts ── */}
        {!isLoading && totalDeals > 0 && (() => {
          const pending = deals.filter(d => d.status === "Pending").length;
          const active = deals.filter(d => d.status === "Active").length;
          const completed = deals.filter(d => d.status === "Completed").length;
          const segments = [
            { label: "Pending",   count: pending,   color: "bg-amber-500",   dot: "bg-amber-500" },
            { label: "Active",    count: active,    color: "bg-blue-500",    dot: "bg-blue-500" },
            { label: "Completed", count: completed, color: "bg-emerald-500", dot: "bg-emerald-500" },
          ];
          return (
            <Card className="glass-card border-0">
              <CardContent className="p-4 lg:p-6">
                <div className="flex items-center justify-between mb-3 lg:mb-4 flex-wrap gap-2">
                  <div>
                    <h3 className="text-sm lg:text-base font-semibold text-foreground">Deal Status</h3>
                    <p className="text-[11px] lg:text-xs text-muted-foreground mt-0.5">
                      Distribution of {totalDeals} deal{totalDeals !== 1 ? "s" : ""} by status
                    </p>
                  </div>
                  <Link href="/deals">
                    <Button variant="ghost" size="sm" className="text-xs lg:text-sm h-7 lg:h-8 text-primary hover:text-primary">
                      View all <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                    </Button>
                  </Link>
                </div>

                {/* Segmented progress bar (always full width, scales naturally) */}
                <div className="flex w-full h-2.5 lg:h-3 rounded-full overflow-hidden bg-muted">
                  {segments.map((s) =>
                    s.count > 0 ? (
                      <div
                        key={s.label}
                        className={`${s.color} transition-all duration-500`}
                        style={{ width: `${(s.count / totalDeals) * 100}%` }}
                        title={`${s.label}: ${s.count}`}
                      />
                    ) : null,
                  )}
                </div>

                {/* Count chips — responsive: 3 cols always, but layout adapts */}
                <div className="grid grid-cols-3 gap-2 lg:gap-4 mt-4 lg:mt-5">
                  {segments.map((s) => {
                    const pct = totalDeals > 0 ? Math.round((s.count / totalDeals) * 100) : 0;
                    return (
                      <div key={s.label} className="min-w-0">
                        <div className="flex items-center gap-1.5 lg:gap-2 mb-1">
                          <span className={`w-2 h-2 lg:w-2.5 lg:h-2.5 rounded-full ${s.dot} shrink-0`} />
                          <span className="text-[10px] lg:text-xs uppercase tracking-wider font-semibold text-muted-foreground truncate">
                            {s.label}
                          </span>
                        </div>
                        <div className="flex items-baseline gap-1.5 lg:gap-2">
                          <span className="text-lg lg:text-2xl xl:text-3xl font-bold text-foreground leading-none">
                            {s.count}
                          </span>
                          <span className="text-[10px] lg:text-xs text-muted-foreground">{pct}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* ── Revenue summary strip ── */}
        {!isLoading && (totalRevenue > 0 || pendingRevenue > 0) && (
          <div className="grid grid-cols-2 gap-3 lg:gap-5">
            <div className="glass-card rounded-xl p-3 lg:p-5 border-0 overflow-hidden">
              <div className="flex items-center gap-2 mb-1 lg:mb-2">
                <TrendingUp className="w-4 h-4 lg:w-5 lg:h-5 text-emerald-500 shrink-0" />
                <span className="text-xs lg:text-sm text-muted-foreground uppercase tracking-wider lg:tracking-wide font-medium">Earned</span>
              </div>
              <p className={`font-bold text-emerald-600 dark:text-emerald-400 truncate leading-tight ${totalRevenue.toLocaleString("en-IN").length > 7 ? "text-base lg:text-2xl" : "text-xl lg:text-3xl"}`}>
                ₹{totalRevenue.toLocaleString("en-IN")}
              </p>
            </div>
            <div className="glass-card rounded-xl p-3 lg:p-5 border-0 overflow-hidden">
              <div className="flex items-center gap-2 mb-1 lg:mb-2">
                <Clock className="w-4 h-4 lg:w-5 lg:h-5 text-amber-500 shrink-0" />
                <span className="text-xs lg:text-sm text-muted-foreground uppercase tracking-wider lg:tracking-wide font-medium">Pending</span>
              </div>
              <p className={`font-bold text-amber-600 dark:text-amber-400 truncate leading-tight ${pendingRevenue.toLocaleString("en-IN").length > 7 ? "text-base lg:text-2xl" : "text-xl lg:text-3xl"}`}>
                ₹{pendingRevenue.toLocaleString("en-IN")}
              </p>
            </div>
          </div>
        )}

        {/* ── Charts (only shown when there's data) ── */}
        {deals.length > 0 && (
          <>
            {/* Trend charts — side-by-side on desktop */}
            <div className="grid lg:grid-cols-2 gap-3 lg:gap-5">
              {/* Deals over time */}
              {dealsOverTime.length > 1 && (
                <Card className="glass-card border-0">
                  <CardHeader className="pb-2 px-4 pt-4 lg:px-6 lg:pt-6">
                    <CardTitle className="text-sm lg:text-base font-semibold">Deals Over Time</CardTitle>
                    <p className="text-[11px] lg:text-xs text-muted-foreground mt-0.5">Monthly count of new deals</p>
                  </CardHeader>
                  <CardContent className="px-2 lg:px-4 pb-4 lg:pb-6">
                    <div className="h-[180px] sm:h-[200px] lg:h-[320px] xl:h-[380px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={dealsOverTime} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorDeals" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                          <Tooltip content={<CustomTooltip />} />
                          <Area type="monotone" dataKey="count" name="Deals" stroke="#3B82F6" strokeWidth={2.5} fill="url(#colorDeals)" dot={{ r: 3, fill: "#3B82F6" }} activeDot={{ r: 5 }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Revenue over time */}
              {revenueOverTime.length > 1 && (
                <Card className="glass-card border-0">
                  <CardHeader className="pb-2 px-4 pt-4 lg:px-6 lg:pt-6">
                    <CardTitle className="text-sm lg:text-base font-semibold">Revenue Trend (₹)</CardTitle>
                    <p className="text-[11px] lg:text-xs text-muted-foreground mt-0.5">Monthly platform-fee revenue</p>
                  </CardHeader>
                  <CardContent className="px-2 lg:px-4 pb-4 lg:pb-6">
                    <div className="h-[180px] sm:h-[200px] lg:h-[320px] xl:h-[380px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={revenueOverTime} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false}
                            tickFormatter={v => v >= 1000 ? `${Math.round(v / 1000)}k` : v} />
                          <Tooltip content={<CustomTooltip prefix="₹" />} />
                          <Area type="monotone" dataKey="amount" name="Revenue" stroke="#10b981" strokeWidth={2.5} fill="url(#colorRevenue)" dot={{ r: 3, fill: "#10b981" }} activeDot={{ r: 5 }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Platform/category distribution — full width.
                (Deal Status pie removed — duplicated the segmented breakdown
                widget above the trend charts.) */}
            {platformDist.length > 0 && (
              <Card className="glass-card border-0">
                <CardHeader className="pb-1 px-4 pt-4 lg:px-6 lg:pt-6">
                  <CardTitle className="text-sm lg:text-base font-semibold">Platform Distribution</CardTitle>
                  <p className="text-[11px] lg:text-xs text-muted-foreground mt-0.5">Deliverables across platforms / categories</p>
                </CardHeader>
                <CardContent className="px-2 pb-4 lg:px-4 lg:pb-6">
                  <div className="h-[180px] sm:h-[200px] lg:h-[300px] xl:h-[360px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={platformDist} margin={{ top: 10, right: 15, left: -10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="platform" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                          axisLine={false} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                          axisLine={false} tickLine={false} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="count" name="Deliverables" radius={[6, 6, 0, 0]} maxBarSize={64}>
                          {platformDist.map((_, i) => (
                            <Cell key={i} fill={PLATFORM_COLORS[i % PLATFORM_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* ── Deliverable Completion Widget ── */}
        {totalDeliverables > 0 && (
          <Card className="glass-card border-0">
            <CardHeader className="pb-2 px-4 pt-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  Deliverable Progress
                </CardTitle>
                <span className="text-xs font-medium text-muted-foreground">
                  {completedDeliverables}/{totalDeliverables} done
                </span>
              </div>
              {/* Overall progress bar */}
              <div className="w-full h-2 bg-muted rounded-full mt-2 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${totalDeliverables > 0 ? (completedDeliverables / totalDeliverables) * 100 : 0}%`,
                    background: "linear-gradient(90deg, #059669, #10b981)",
                  }}
                />
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-2">
              <div className="space-y-3">
                {deliverableCompletion.map((item, i) => {
                  const pct = item.total > 0 ? Math.round((item.completed / item.total) * 100) : 0;
                  return (
                    <div key={item.platform} className="flex items-center gap-3">
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: PLATFORM_COLORS[i % PLATFORM_COLORS.length] }}
                      />
                      <span className="text-xs font-medium w-20 truncate">{item.platform}</span>
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: PLATFORM_COLORS[i % PLATFORM_COLORS.length],
                          }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground w-12 text-right">
                        {item.completed}/{item.total}
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Recent Deals ── */}
        {recentDeals.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recent Deals</h2>
              <Link href="/deals">
                <Button variant="ghost" size="sm" className="text-primary text-xs h-7">View All</Button>
              </Link>
            </div>
            <div className="flex flex-col gap-4">
              {recentDeals.map((deal) => (
                <Link key={deal.id} href={`/deals/${deal.id}`}>
                  <Card className="glass-card border hover-elevate active-elevate-2 cursor-pointer rounded-xl shadow-sm">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate text-sm" data-testid={`text-deal-title-${deal.id}`}>
                            {deal.dealTitle}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">{deal.brandName}</p>
                        </div>
                        <StatusBadge status={deal.status} size="compact" />
                      </div>
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/10">
                        <span className="text-base font-bold text-primary">
                          ₹{Number(deal.dealAmount).toLocaleString("en-IN")}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {deal.deliverables.length} deliverable{deal.deliverables.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── Empty state ── */}
        {deals.length === 0 && !isLoading && (
          <Card className="glass-card border-0">
            <CardContent className="py-12 text-center">
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 mx-auto mb-4">
                <Briefcase className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="font-semibold mb-1">No deals yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Create your first brand deal to get started
              </p>
              <Link href="/deals/new">
                <Button className="gradient-btn" data-testid="button-create-first-deal">
                  <Plus className="w-4 h-4 mr-2" />
                  Create Deal
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
