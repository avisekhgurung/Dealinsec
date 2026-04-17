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
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
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

function buildStatusDist(deals: Deal[]) {
  const map: Record<string, number> = {};
  deals.forEach(d => { map[d.status] = (map[d.status] ?? 0) + 1; });
  return Object.entries(map).map(([name, value]) => ({ name, value }));
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

const STATUS_COLORS: Record<string, string> = {
  Pending: "#f59e0b",
  Active: "#8b5cf6",
  Completed: "#10b981",
  Cancelled: "#ef4444",
};
const PLATFORM_COLORS = ["#8b5cf6", "#ec4899", "#ef4444", "#3b82f6", "#10b981"];

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

function StatCard({ title, value, icon: Icon, colorClass, href, loading }: {
  title: string; value: number | string; icon: any;
  colorClass: string; href: string; loading: boolean;
}) {
  return (
    <Link href={href}>
      <div className={`${colorClass} rounded-2xl p-3 sm:p-4 shadow-lg hover-elevate cursor-pointer overflow-hidden`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-white/20 shrink-0">
              <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] sm:text-xs font-medium text-white/80 truncate">{title}</p>
              {loading ? (
                <Skeleton className="h-6 w-10 mt-0.5 bg-white/20" />
              ) : (
                <p className="text-lg sm:text-xl font-bold text-white truncate leading-tight">{value}</p>
              )}
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-white/60 shrink-0" />
        </div>
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

  // Stat counts
  const activeDeals = deals.filter(d => d.status === "Pending" || d.status === "Active").length;
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
  const statusDist = buildStatusDist(deals);
  const platformDist = buildPlatformDist(deals);
  const deliverableCompletion = useMemo(() => buildDeliverableCompletion(deals), [deals]);
  const totalDeliverables = deliverableCompletion.reduce((s, d) => s + d.total, 0);
  const completedDeliverables = deliverableCompletion.reduce((s, d) => s + d.completed, 0);

  const recentDeals = deals.slice(0, 3);

  const handleLogout = () => { window.location.href = "/api/logout"; };

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="glass-header sticky top-0 z-40">
        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <div>
            <p className="text-xs text-muted-foreground">Welcome back,</p>
            <h1 className="text-lg font-bold">{displayName}</h1>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleLogout}
            data-testid="button-logout"
            className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
          >
            <LogOut className="w-5 h-5" />
          </Button>
        </div>
      </header>

      <main className="px-4 py-5 space-y-6 animate-fade-in">

        {/* ── Stat cards ── */}
        <section className="grid grid-cols-2 gap-3">
          <StatCard title="Active Deals" value={activeDeals} icon={Briefcase}
            colorClass="gradient-card-purple" href="/deals" loading={isLoading} />
          <StatCard title="Agreements" value={signedContracts} icon={FileCheck}
            colorClass="gradient-card-indigo" href="/contracts" loading={isLoading} />
          <StatCard title="Paid Invoices" value={paidInvoices} icon={Receipt}
            colorClass="gradient-card-emerald" href="/invoices" loading={isLoading} />
          <StatCard
            title="Pipeline Value"
            value={isLoading ? "…" : `₹${(totalRevenue + pendingRevenue).toLocaleString("en-IN")}`}
            icon={IndianRupee}
            colorClass="gradient-card-rose"
            href="/deals"
            loading={false}
          />
        </section>

        {/* ── Revenue summary strip ── */}
        {!isLoading && (totalRevenue > 0 || pendingRevenue > 0) && (
          <div className="grid grid-cols-2 gap-3">
            <div className="glass-card rounded-xl p-3 border-0 overflow-hidden">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-emerald-500 shrink-0" />
                <span className="text-xs text-muted-foreground">Earned</span>
              </div>
              <p className={`font-bold text-emerald-600 dark:text-emerald-400 truncate leading-tight ${totalRevenue.toLocaleString("en-IN").length > 7 ? "text-base" : "text-xl"}`}>
                ₹{totalRevenue.toLocaleString("en-IN")}
              </p>
            </div>
            <div className="glass-card rounded-xl p-3 border-0 overflow-hidden">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="text-xs text-muted-foreground">Pending</span>
              </div>
              <p className={`font-bold text-amber-600 dark:text-amber-400 truncate leading-tight ${pendingRevenue.toLocaleString("en-IN").length > 7 ? "text-base" : "text-xl"}`}>
                ₹{pendingRevenue.toLocaleString("en-IN")}
              </p>
            </div>
          </div>
        )}

        {/* ── Charts (only shown when there's data) ── */}
        {deals.length > 0 && (
          <>
            {/* Deals over time */}
            {dealsOverTime.length > 1 && (
              <Card className="glass-card border-0">
                <CardHeader className="pb-2 px-4 pt-4">
                  <CardTitle className="text-sm font-semibold">Deals Over Time</CardTitle>
                </CardHeader>
                <CardContent className="px-2 pb-4">
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={dealsOverTime} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorDeals" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area type="monotone" dataKey="count" name="Deals" stroke="#8b5cf6" strokeWidth={2} fill="url(#colorDeals)" dot={{ r: 3, fill: "#8b5cf6" }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Revenue over time */}
            {revenueOverTime.length > 1 && (
              <Card className="glass-card border-0">
                <CardHeader className="pb-2 px-4 pt-4">
                  <CardTitle className="text-sm font-semibold">Revenue Trend (₹)</CardTitle>
                </CardHeader>
                <CardContent className="px-2 pb-4">
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={revenueOverTime} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false}
                        tickFormatter={v => v >= 1000 ? `${Math.round(v / 1000)}k` : v} />
                      <Tooltip content={<CustomTooltip prefix="₹" />} />
                      <Area type="monotone" dataKey="amount" name="Revenue" stroke="#10b981" strokeWidth={2} fill="url(#colorRevenue)" dot={{ r: 3, fill: "#10b981" }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-2 gap-3">
              {/* Deal status pie */}
              {statusDist.length > 0 && (
                <Card className="glass-card border-0">
                  <CardHeader className="pb-1 px-3 pt-3">
                    <CardTitle className="text-xs font-semibold">Deal Status</CardTitle>
                  </CardHeader>
                  <CardContent className="px-1 pb-3">
                    <ResponsiveContainer width="100%" height={130}>
                      <PieChart>
                        <Pie data={statusDist} cx="50%" cy="50%" innerRadius={30} outerRadius={50}
                          dataKey="value" nameKey="name" paddingAngle={3}>
                          {statusDist.map((entry, i) => (
                            <Cell key={i} fill={STATUS_COLORS[entry.name] ?? PLATFORM_COLORS[i % PLATFORM_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            return (
                              <div className="bg-background/95 border border-white/20 rounded-lg p-2 text-xs shadow-lg">
                                <p style={{ color: payload[0].payload.fill }} className="font-semibold">{payload[0].name}</p>
                                <p>{payload[0].value} deal{payload[0].value !== 1 ? "s" : ""}</p>
                              </div>
                            );
                          }}
                        />
                        <Legend iconSize={8} iconType="circle"
                          formatter={(value) => <span className="text-[10px] text-muted-foreground">{value}</span>} />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* Platform bar chart */}
              {platformDist.length > 0 && (
                <Card className="glass-card border-0">
                  <CardHeader className="pb-1 px-3 pt-3">
                    <CardTitle className="text-xs font-semibold">Platforms</CardTitle>
                  </CardHeader>
                  <CardContent className="px-1 pb-3">
                    <ResponsiveContainer width="100%" height={130}>
                      <BarChart data={platformDist} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="platform" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                          axisLine={false} tickLine={false}
                          tickFormatter={v => v.slice(0, 2)} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                          axisLine={false} tickLine={false} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="count" name="Deliverables" radius={[4, 4, 0, 0]}>
                          {platformDist.map((_, i) => (
                            <Cell key={i} fill={PLATFORM_COLORS[i % PLATFORM_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}
            </div>
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
                    background: "linear-gradient(90deg, #8b5cf6, #10b981)",
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
