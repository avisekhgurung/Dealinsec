import { trackEvent } from "@/lib/analytics";
import { LeadsStrip } from "@/components/leads/leads-strip";
import { TodayPanel } from "@/components/dashboard/today-panel";
import { GettingStarted } from "@/components/getting-started";
import { LoadError } from "@/components/load-error";
import { useAuth } from "@/hooks/useAuth";
import { DEAL_SUITE_HIDDEN } from "@shared/flags";
import { DEAL_SUITE_LABEL } from "@shared/nav-model";
import { SalesFunnel } from "@/components/outbound/sales-funnel";
import { useAudience } from "@/hooks/use-audience";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { resolveWorkMode, WORK_MODE_HINTS, WORK_MODE_LABELS, WORK_MODES, type WorkMode } from "@shared/work-mode";
import { setWorkMode, useWorkMode } from "@/hooks/use-work-mode";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BottomNav } from "@/components/bottom-nav";
import { NotificationBell } from "@/components/notification-bell";
import { StatusBadge } from "@/components/status-badge";
import { useMemo, useState, useEffect, useRef } from "react";
import {
  Plus, Briefcase, FileCheck, Receipt, ChevronRight, LogOut,
  TrendingUp, IndianRupee, Banknote,
  FileText, Sparkles,
  Crown, Rocket, Users2, UserPlus2, Settings as SettingsIcon,
  Zap, FileSignature, ArrowUpRight, Radar, UsersRound
} from "lucide-react";
import { USAGE_URL } from "@/lib/credit-keys";
import {
  BarChart, Bar, Cell, PieChart, Pie, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import {
  hasActivePro, hasActiveDealBoost, hasActiveTrial, getSubscriptionType, minorUnitFactor,
} from "@shared/schema";
import { TrialCountdown } from "@/components/trial-countdown";
import { canSeeModule, memberCan } from "@shared/permissions";
import { useLocale, useMoney, type MoneyFormat } from "@/hooks/use-locale";
import type { Deal, Contract, BrandInvoice, Quote, User } from "@shared/schema";
import { listUrl as leadListUrl, type LeadList } from "@/lib/leads";
import { isFirstRun } from "@/lib/first-run";
import { invoiceStats, paidInvoicesSubline } from "@shared/invoice-stats";

// ─── Desktop tiles ───────────────────────────────────────────────────────────
// On a laptop the Home page is a six-column bento (see <main>): these two small tiles fill the right rail beside
// Today. The phone keeps its single column, so they only render from lg.

/** The three things to do from Home, in the order the product runs: find, ask the team, paper the win. */
function QuickActionsTile({ canSeeOutbound, canCreateDeal, newDealCta }: { canSeeOutbound: boolean; canCreateDeal: boolean; newDealCta: string }) {
  const actions = [
    canSeeOutbound ? { href: "/outbound", Icon: Radar, title: "Find clients", text: "Describe who you want; Client Radar researches them", testId: "tile-find-clients" } : null,
    { href: "/ai-league", Icon: UsersRound, title: "Ask your AI Team", text: "Nibo finds, Mika drafts, Zee briefs", testId: "tile-ai-team" },
    canCreateDeal && !DEAL_SUITE_HIDDEN ? { href: "/deals/new", Icon: Plus, title: newDealCta, text: "Quotation, agreement, invoice: free", testId: "tile-new-deal" } : null,
  ].filter((a): a is NonNullable<typeof a> => !!a);
  return (
    <Card className="relative h-full overflow-hidden border-0 bg-gradient-to-br from-emerald-700 via-emerald-700 to-teal-800 text-white shadow-lg shadow-emerald-900/20" data-testid="quick-actions">
      <span aria-hidden className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-white/10 blur-2xl" />
      <CardContent className="relative flex h-full flex-col p-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-100/80">Start here</p>
        <ul className="mt-2 flex flex-1 flex-col gap-1.5">
          {actions.map(({ href, Icon, title, text, testId }) => (
            <li key={href}>
              <Link href={href} className="group flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2.5 transition hover:bg-white/15" data-testid={testId}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15"><Icon className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="block truncate text-[11px] text-emerald-100/75">{text}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-emerald-100/70 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

interface TileAllowance { used: number; limit: number; remaining: number }
/** Searches and AI drafts left in the rolling window, read from the server's own count, with the way to top up. */
function AllowanceTile() {
  const q = useQuery<{ ok: boolean; usage: { plan: { tier: string; label: string; windowDays: number; searches: TileAllowance | null; drafts: TileAllowance | null } } }>({ queryKey: [USAGE_URL], retry: false, staleTime: 30_000 });
  const plan = q.data?.usage?.plan;
  if (!plan) return null;
  const unlimited = plan.tier === "unlimited";
  const rows: { label: string; a: TileAllowance | null; href: string }[] = [
    { label: "Client Radar searches", a: plan.searches, href: "/outbound" },
    { label: "AI outreach drafts", a: plan.drafts, href: "/leads" },
  ];
  const short = rows.some((r) => r.a && r.a.remaining === 0);
  return (
    <Card className="glass-card h-full" data-testid="allowance-tile">
      <CardContent className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{plan.label}</p>
            <p className="text-[11px] text-muted-foreground">{unlimited ? "No monthly limits on this workspace" : `Last ${plan.windowDays} days · each use frees up on its own date`}</p>
          </div>
          <Link href="/wallet#boosters" className="text-[11px] font-semibold text-primary hover:underline" data-testid="tile-boosters">{short ? "Buy a booster" : "Boosters"}</Link>
        </div>
        {!unlimited && (
          <ul className="space-y-2.5">
            {rows.map(({ label, a, href }) => {
              const pct = a && a.limit > 0 ? Math.min(100, Math.round((a.used / a.limit) * 100)) : 0;
              return (
                <li key={label}>
                  <Link href={href} className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-semibold tabular-nums">{a ? <>{a.remaining}<span className="font-normal text-muted-foreground"> of {a.limit} left</span></> : "–"}</span>
                  </Link>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", a && a.remaining === 0 ? "bg-amber-500" : pct >= 80 ? "bg-amber-400" : "bg-emerald-500")} style={{ width: `${pct}%` }} /></span>
                </li>
              );
            })}
          </ul>
        )}
        {short && <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">Used up for now. Only this pauses; a booster pack covers the next ones right away.</p>}
      </CardContent>
    </Card>
  );
}

// ─── Team seats strip ────────────────────────────────────────────────────────
function TeamSeatsCard() {
  const { data: org } = useQuery<{
    name: string; seatLimit: number; seatsUsed: number; pendingInvites: number; ownerPlan: string;
  }>({ queryKey: ["/api/org"] });
  if (!org || org.seatLimit <= 1) return null; // solo free orgs skip the strip
  return (
    <Card className="glass-card" data-testid="team-seats-card">
      <CardContent className="p-4 lg:p-3.5 flex items-center gap-3.5">
        <div className="w-10 h-10 lg:w-8 lg:h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Users2 className="w-5 h-5 lg:w-4 lg:h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">
            Team · <span className="text-primary">{org.seatsUsed} / {org.seatLimit}</span> seats
            {org.pendingInvites > 0 && (
              <span className="text-muted-foreground font-medium"> · {org.pendingInvites} invited</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground truncate">{org.name}</p>
        </div>
        <Link href="/settings">
          <Button variant="outline" size="sm" className="flex-shrink-0" data-testid="dashboard-invite-member">
            <UserPlus2 className="w-3.5 h-3.5 mr-1.5" />
            Invite member
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

// ─── Subscription / Deal Credits card ───────────────────────────────────────
// Free  → plan + upgrade CTA (no credit counters, ever).
// Trial → animated countdown card (before Boost: a trialing account with a
//         leftover boost should read as the trial).
// Boost → unlimited deals/quotations until the boost expiry.
// Pro   → plan tier + renewal date. Checked FIRST — paid always wins.
function SubscriptionCard({ user }: { user: (Partial<User> & { email?: string | null }) | null | undefined }) {
  const proActive = hasActivePro(user);
  const boostActive = hasActiveDealBoost(user);
  const trialActive = hasActiveTrial(user);
  // The viewer's own locale: a renewal date is about them, not about the org.
  const { locale } = useLocale();
  const fmtDate = (d: Date | string | null | undefined) =>
    d ? new Date(d).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) : null;

  if (proActive) {
    const tier = getSubscriptionType(user) === "PRO_MONTHLY" ? "Monthly" : "Annual";
    return (
      <Card className="glass-card border-emerald-300/40 dark:border-emerald-800/40 relative overflow-hidden" data-testid="subscription-card">
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/[0.07] to-teal-500/[0.05] pointer-events-none" />
        <CardContent className="relative p-4 lg:p-3.5 flex items-center gap-3.5">
          <div className="w-10 h-10 lg:w-8 lg:h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0 shadow-sm shadow-emerald-500/25">
            <Crown className="w-5 h-5 lg:w-4 lg:h-4 text-amber-300" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">DealInSec Pro · {tier}</p>
            <p className="text-xs text-muted-foreground">
              Unlimited deals, agreements &amp; invoices{user?.planExpiresAt ? ` · valid until ${fmtDate(user.planExpiresAt)}` : ""}
            </p>
          </div>
          <Link href="/pricing">
            <Button variant="outline" size="sm" className="flex-shrink-0">Manage</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (trialActive && user?.trialEndsAt) {
    return <TrialCountdown trialEndsAt={user.trialEndsAt} />;
  }

  if (boostActive) {
    return (
      <Card className="glass-card border-emerald-300/40 dark:border-emerald-800/40 relative overflow-hidden" data-testid="subscription-card">
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/[0.07] to-teal-500/[0.05] pointer-events-none" />
        <CardContent className="relative p-4 lg:p-3.5 flex items-center gap-3.5">
          <div className="w-10 h-10 lg:w-8 lg:h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0 shadow-sm shadow-emerald-500/25">
            <Rocket className="w-5 h-5 lg:w-4 lg:h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">Deal Boost active</p>
            <p className="text-xs text-muted-foreground">
              Unlimited deals &amp; quotations
              {user?.dealBoostExpiresAt ? ` · until ${fmtDate(user.dealBoostExpiresAt)}` : ""}
                          </p>
          </div>
          <Link href="/pricing">
            <Button variant="outline" size="sm" className="flex-shrink-0">Upgrade to Pro</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  // Free plan: no credit counters in the UI (they confused users) — just the
  // plan and an upgrade path. The 4-deals-a-month limit is enforced
  // server-side and surfaces through the upgrade modal when it's reached.
  return (
    <Card
      className="glass-card relative overflow-hidden"
      data-testid="subscription-card"
    >
      <CardContent className="relative p-4 lg:p-3.5 flex items-center gap-3.5">
        <div className="w-10 h-10 lg:w-8 lg:h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary/10">
          <Sparkles className="w-5 h-5 lg:w-4 lg:h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">
            Free plan
          </p>
          <p className="text-xs text-muted-foreground">
            {DEAL_SUITE_HIDDEN
              ? "Upgrade to Pro for more AI client searches, outreach drafts and coworker tasks, and up to 5 team members"
              : "Upgrade to Pro for more Client Radar searches, more AI outreach drafts and team members"}
          </p>
        </div>
        <Link href="/pricing" onClick={() => trackEvent("upgrade_clicked", { source: "dashboard" })}>
          <Button size="sm" className="flex-shrink-0 text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700" data-testid="dashboard-upgrade-cta">
            <Crown className="w-3.5 h-3.5 mr-1.5 text-amber-300" />
            Upgrade
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

/**
 * Client Search | Deal Suite, as a radio group: the selected mode is always visible and arrow keys move between
 * them. Switching only changes which numbers are drawn — every page stays reachable in either mode.
 */
function WorkModeTabs({ mode, onSelect }: { mode: WorkMode; onSelect: (m: WorkMode) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (i: number) => {
    const next = (i + WORK_MODES.length) % WORK_MODES.length;
    refs.current[next]?.focus();
    onSelect(WORK_MODES[next]);
  };
  return (
    <div role="radiogroup" aria-label="What to show" className="inline-flex items-center gap-0.5 rounded-xl border border-neutral-200 bg-neutral-50 p-0.5 dark:border-neutral-800 dark:bg-neutral-900/60">
      {WORK_MODES.map((m, i) => {
        const on = m === mode;
        return (
          <button
            key={m}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            title={WORK_MODE_HINTS[m]}
            tabIndex={on ? 0 : -1}
            onClick={() => onSelect(m)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(i + 1); }
              if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(i - 1); }
            }}
            data-testid={`dashboard-mode-tab-${m}`}
            className={cn(
              "rounded-[10px] px-3 py-1.5 text-xs font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60",
              on ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-white" : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200",
            )}
          >
            {WORK_MODE_LABELS[m]}
          </button>
        );
      })}
    </div>
  );
}

// ─── helpers ───────────────────────────────────────────────────────────────

/** Ease-out count-up for KPI numerals — makes the dashboard feel alive on
 *  load without any chart-library weight. Snaps instantly for
 *  prefers-reduced-motion users and re-animates from the previous value on
 *  data changes, never from 0. */
function useCountUp(target: number, duration = 700): number {
  const [value, setValue] = useState(target);
  const prevRef = useRef<number | null>(null);
  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const from = prevRef.current ?? 0;
    if (reduced || from === target) {
      prevRef.current = target;
      setValue(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else prevRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

/** Deterministic avatar tone for a client name — same client, same color. */
const AVATAR_TONES = [
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  "bg-teal-500/15 text-teal-700 dark:text-teal-400",
  "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
];
function avatarTone(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(h) % AVATAR_TONES.length];
}

function getMonthLabel(dateStr: string, locale: string) {
  return new Date(dateStr).toLocaleDateString(locale, { month: "short", year: "2-digit" });
}

function buildDealsOverTime(deals: Deal[], locale: string) {
  const map: Record<string, number> = {};
  deals.forEach(d => {
    const key = getMonthLabel(d.startDate, locale);
    map[key] = (map[key] ?? 0) + 1;
  });
  return Object.entries(map).slice(-6).map(([month, count]) => ({ month, count }));
}

/** Last 6 calendar months, deals started + quotations issued per month —
 *  two counts, same unit, so they may share one axis (never two scales). */
function buildMonthlyActivity(deals: Deal[], quotes: { createdAt?: Date | string | null }[], locale: string) {
  const months: { key: string; month: string; deals: number; quotations: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      month: d.toLocaleDateString(locale, { month: "short" }),
      deals: 0,
      quotations: 0,
    });
  }
  const idx = new Map(months.map((m, i) => [m.key, i]));
  for (const deal of deals) {
    const d = new Date(deal.startDate);
    const i = idx.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (i !== undefined) months[i].deals++;
  }
  for (const q of quotes) {
    if (!q.createdAt) continue;
    const d = new Date(q.createdAt);
    const i = idx.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (i !== undefined) months[i].quotations++;
  }
  return months;
}

/** Series values are MINOR units — summed as integers, formatted once at the
 *  axis and the tooltip. Summing majors would drift by a fraction a month. */
function buildRevenueOverTime(deals: Deal[], locale: string) {
  const map: Record<string, number> = {};
  deals.forEach(d => {
    const key = getMonthLabel(d.startDate, locale);
    map[key] = (map[key] ?? 0) + Number(d.dealAmountMinor);
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

// Fallback palette for unmapped categories (Freelance/Consulting/Custom)
const PLATFORM_COLORS = ["#0E8C5A", "#10B981", "#0D9488", "#06B6D4", "#1D4ED8", "#7C3AED", "#F59E0B", "#EC4899", "#64748B"];

// Brand-accurate colors per platform / category — covers creator platforms
// and common service / freelance / consulting categories from the taxonomy.
const BRAND_COLORS: Record<string, string> = {
  // Creator — global platforms
  "Instagram":           "#E1306C",
  "YouTube":             "#FF0000",
  "Twitter (X)":         "#0F1419",
  "Twitter":             "#0F1419",
  "X":                   "#0F1419",
  "Facebook":            "#1877F2",
  "LinkedIn":            "#0A66C2",
  "Threads":             "#0F1419",
  "Pinterest":           "#E60023",
  "Snapchat":            "#FFFC00",
  "TikTok":              "#010101",
  // Creator — India-first platforms
  "ShareChat":           "#FF5C00",
  "Moj":                 "#FF1654",
  "Josh":                "#FF3DAA",
  "Roposo":              "#FF4081",
  "Chingari":            "#F7444E",
  "Koo":                 "#F7B500",
  // Audio / Podcast
  "Spotify":             "#1DB954",
  "JioSaavn":            "#2BC5B4",
  "Apple Podcasts":      "#A855F7",
  "Amazon Music":        "#25D1DA",
  "KuKu FM":             "#FF6B35",
  "Pocket FM":           "#FB923C",
  // Streaming
  "Twitch":              "#9146FF",
  "YouTube Live":        "#FF0000",
  "Instagram Live":      "#E1306C",
  "Discord Stage":       "#5865F2",
  // Newsletter
  "Substack":            "#FF6719",
  "Beehiiv":             "#FFB200",
  "Revue":               "#FF6900",
  "Medium":              "#000000",
  // Messaging
  "Telegram channel":    "#26A5E4",
  "WhatsApp Channel":    "#25D366",
  "Discord server":      "#5865F2",
  // Freelance / Consulting / Service Vendor — category-tone tints
  "Design":              "#EC4899",
  "Development":         "#1D4ED8",
  "Writing":             "#7C3AED",
  "Marketing":           "#F59E0B",
  "Video & Audio":       "#06B6D4",
  "Photography":         "#0E8C5A",
  "Wedding":             "#E11D48",
  "Events & Corporate":  "#F97316",
  "Beauty & Personal care": "#EC4899",
  "Fitness & Sports":    "#10B981",
  "Tutoring & Coaching": "#1D4ED8",
  "Wellness & Therapy":  "#0E8C5A",
};

function colorForPlatform(name: string, fallbackIndex: number): string {
  return BRAND_COLORS[name] ?? PLATFORM_COLORS[fallbackIndex % PLATFORM_COLORS.length];
}

// ─── custom tooltip ──────────────────────────────────────────────────────────

/* Compact labels. INR keeps the EXACT lakh logic the dashboard has always
 * shipped — character for character, including its quirks ("65k" with a
 * lowercase k, "150L" not "1.5Cr", a donut centre that always carries one
 * decimal: "₹0.7L", "₹125.0L"). Intl's en-IN compact ladder is a different
 * one ("65K", "1.5Cr", "₹65K"), and every Indian user would see their
 * dashboard change for no reason of theirs. Every other currency has no such
 * history, so it gets the locale's own ladder: "150K" in the US, "1,5 Mio." in
 * Germany. Compact notation is the one money shape shared/money.ts does not
 * offer, which is the only reason these are local. All take MINOR units. */

const isInr = (fmt: MoneyFormat) => fmt.currency === "INR";

/** Chart axis ticks: a bare number, since the chart is titled as money. */
function compactAmount(minor: number, fmt: MoneyFormat): string {
  const v = fmt.major(minor);
  if (isInr(fmt)) {
    // The shipped tick formatter, verbatim, on the same rupee figure.
    return v >= 100000 ? `${(v / 100000).toFixed(v % 100000 ? 1 : 0)}L` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v);
  }
  return new Intl.NumberFormat(fmt.locale, { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

/** The same WITH the currency, for a headline that stands alone, where a bare
 *  "1.5L" would not say it is money. For non-INR the locale places the glyph;
 *  `minimumFractionDigits: 0` stops Intl padding "$500" out to "$500.0". */
function compactMoney(minor: number, fmt: MoneyFormat): string {
  const v = fmt.major(minor);
  if (isInr(fmt)) {
    // The shipped donut-centre expression, verbatim. Its first branch is
    // effectively unreachable (toFixed(1) always has a point, toFixed(0)
    // never does), so this always prints one decimal of a lakh — and it is
    // kept that way because that is what Indian users see today. The glyph
    // is `fmt.symbol`, which comes from the same Intl call as fmt.money(),
    // so it can never disagree with the amounts beside it ("₹" in en-IN).
    return `${fmt.symbol}${(v / 100000).toFixed(1) === (v / 100000).toFixed(0)
      ? v.toLocaleString("en-IN")
      : `${(v / 100000).toFixed(1)}L`}`;
  }
  return new Intl.NumberFormat(fmt.locale, {
    style: "currency",
    currency: fmt.currency,
    notation: "compact",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(v);
}

/** A count-up frame, in whole major units until the last frame.
 *
 *  useCountUp steps through integers, which are now paise/cents, so every
 *  intermediate frame would flash a fraction — "₹12,345.67" — that no amount
 *  ever had, and the tile would change width mid-animation. Rounding frames to
 *  whole units keeps the count-up reading the way it always has; the real
 *  value, fraction and all, lands on the final frame.
 *
 *  Integer arithmetic on the currency's factor rather than `fmt.minor()`:
 *  that one is for WRITES and refuses until the org's currency has loaded,
 *  and a dashboard tile is display. */
function moneyFrame(animatedMinor: number, targetMinor: number, fmt: MoneyFormat): string {
  if (animatedMinor === targetMinor) return fmt.money(targetMinor);
  const factor = minorUnitFactor(fmt.currency);
  return fmt.money(Math.round(animatedMinor / factor) * factor);
}

/** The Pipeline Value tile's icon. India keeps the rupee glyph it has always
 *  shown; a generic note elsewhere, rather than a rupee on a dollar tile. */
const pipelineIcon = (fmt: MoneyFormat) => (isInr(fmt) ? IndianRupee : Banknote);

// `format` is passed only by the money charts; counts render bare. Branching
// on a "₹" prefix, as this did, made the rupee the only currency a chart knew.
function CustomTooltip({ active, payload, label, format }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background/95 backdrop-blur border border-white/20 rounded-lg p-3 shadow-lg text-xs">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }} className="font-medium">
          {p.name}: {format && typeof p.value === "number" ? format(p.value) : p.value}
        </p>
      ))}
    </div>
  );
}

// ─── chart empty state ───────────────────────────────────────────────────────
// A chart with no data never renders a bare grid — it explains itself and
// points at the action that creates the data.
function ChartEmpty({ icon: Icon, title, hint, cta, compact }: {
  icon: any;
  title: string;
  hint: string;
  cta?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`${compact ? "py-6" : "h-[200px] lg:h-[230px]"} flex flex-col items-center justify-center text-center px-6`}>
      <div className="w-11 h-11 rounded-2xl bg-muted/70 flex items-center justify-center mb-2.5">
        <Icon className="w-5 h-5 text-muted-foreground/60" />
      </div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-[260px] leading-relaxed">{hint}</p>
      {cta && <div className="mt-3">{cta}</div>}
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

function StatCard({ title, value, format, icon: Icon, tone, href, loading, sub, trendUp, unavailable }: {
  title: string;
  value: number;
  /** Optional formatter — pass `fmt.money` for a money tile, and `value` in
   *  minor units. Applied to the animated value each frame, so money counts up
   *  too. */
  format?: (n: number) => string;
  icon: any;
  tone: StatTone;
  href: string;
  loading: boolean;
  sub?: string;
  trendUp?: boolean;
  /** Set when the number can't be known (load failed, or no access): shows "—" and this reason instead of a 0. */
  unavailable?: string;
}) {
  const t = TONE_STYLES[tone];
  const animated = useCountUp(loading ? 0 : value);
  return (
    <Link href={href}>
      <div
        className="group rounded-2xl lg:rounded-xl p-3 sm:p-4 lg:p-4 cursor-pointer overflow-hidden bg-white dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 hover:border-primary/40 dark:hover:border-primary/40 hover:shadow-md hover:shadow-primary/[0.04] hover:-translate-y-px transition-all duration-200"
      >
        {/* Label row: small caps label + muted icon (KPI tiles lead with the
            number, not the chrome) */}
        <div className="flex items-center justify-between gap-2 mb-2 lg:mb-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 truncate">
            {title}
          </p>
          <div className={`flex items-center justify-center w-8 h-8 lg:w-7 lg:h-7 rounded-lg shrink-0 transition-transform duration-200 group-hover:scale-110 ${t.bg}`}>
            <Icon className={`w-4 h-4 lg:w-3.5 lg:h-3.5 ${t.text}`} strokeWidth={2.2} />
          </div>
        </div>
        {loading ? (
          <Skeleton className="h-7 lg:h-8 w-16 lg:w-24" />
        ) : unavailable ? (
          <p className="text-xl sm:text-2xl lg:text-3xl font-semibold text-neutral-400 leading-none" aria-label={`${title}: unavailable`}>—</p>
        ) : (() => {
          const text = format ? format(animated) : String(animated);
          // Long currency strings step down instead of truncating —
          // "₹15,50,000" and "$1,250,000.00" must never render clipped.
          const size =
            text.length > 11 ? "text-base sm:text-lg lg:text-xl"
            : text.length > 8 ? "text-lg sm:text-xl lg:text-2xl"
            : "text-xl sm:text-2xl lg:text-3xl";
          return (
            <p className={`${size} font-semibold text-neutral-900 dark:text-white leading-none tracking-tight tabular-nums whitespace-nowrap`}>
              {text}
            </p>
          );
        })()}
        {!loading && unavailable && (
          <p className="mt-1.5 text-[11px] lg:text-[11.5px] font-medium text-amber-700 dark:text-amber-400 truncate">{unavailable}</p>
        )}
        {!loading && !unavailable && sub && (
          <p className={`mt-1.5 text-[11px] lg:text-[11.5px] font-medium flex items-center gap-1 truncate ${trendUp ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-500 dark:text-neutral-400"}`}>
            {trendUp && <TrendingUp className="w-3 h-3 shrink-0" strokeWidth={2.5} />}
            {sub}
          </p>
        )}
      </div>
    </Link>
  );
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth();
  const audience = useAudience();
  const fmt = useMoney();
  const canCreateDeal = memberCan(user as any, "deals.create");
  // Client Radar sits under the deals module in the nav (shared/nav-model.ts), so the same check decides its shortcut.
  const canSeeOutbound = canSeeModule(user as any, "finding");
  const displayName = user?.firstName && user?.lastName
    ? `${user.firstName} ${user.lastName}`
    : user?.email?.split("@")[0] || "there";
  // Time-of-day greeting + today's date — the header should orient, not
  // just repeat the name that's already in the sidebar footer.
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstNameOnly = user?.firstName || displayName.split(" ")[0];
  const todayLabel = new Date().toLocaleDateString(fmt.locale, {
    weekday: "long", day: "numeric", month: "long",
  });

  const {
    data: deals = [], isLoading: dealsLoading, isError: dealsError, refetch: refetchDeals, isFetching: dealsFetching,
  } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
  });

  const { data: contracts = [], isLoading: contractsLoading } = useQuery<Contract[]>({
    queryKey: ["/api/contracts"],
  });

  // The invoices DealInSec issues. (The legacy /api/invoices table is never written any more, so it is not read.)
  const { data: brandInvoices = [], isLoading: invoicesLoading, isError: invoicesFailed, error: invoicesError } = useQuery<BrandInvoice[]>({
    queryKey: ["/api/brand-invoices"],
  });

  const { data: quotes = [] } = useQuery<(Quote & { deal: Deal | null })[]>({
    queryKey: ["/api/quotes"],
  });

  // Lead counts, to decide first-run: finding clients is the product, so having leads means this account has
  // started even with no deals. The same query key as LeadsStrip's, so the strip's own read is reused, not repeated.
  const leadCounts = useQuery<LeadList>({ queryKey: [leadListUrl({})], enabled: canSeeModule(user as any, "finding"), retry: false });

  const isLoading = dealsLoading || contractsLoading || invoicesLoading;

  // Stat counts — show total deals across all statuses (Pending + Active + Completed)
  const totalDeals = deals.length;
  const signedContracts = contracts.filter(c => c.status === "Signed" || c.status === "Active").length;
  // Invoices recorded as paid (never "issued" = paid); see shared/invoice-stats.ts.
  const invStats = invoiceStats(brandInvoices);
  // A role without invoice access gets 403; anything else is a load failure. Either way the number is unknown, not 0.
  const invoicesUnavailable = invoicesFailed ? (String((invoicesError as Error | null)?.message ?? "").startsWith("403") ? "No access" : "Couldn't load") : undefined;
  // Minor units throughout; formatted only where they reach the screen.
  const totalRevenueMinor = deals
    .filter(d => d.status === "Completed" || d.status === "Active")
    .reduce((s, d) => s + Number(d.dealAmountMinor), 0);
  const pendingRevenueMinor = deals
    .filter(d => d.status === "Pending")
    .reduce((s, d) => s + Number(d.dealAmountMinor), 0);

  // Stat-card sub-metrics (trend lines under each number)
  const now = new Date();
  const dealsThisMonth = deals.filter(d => {
    const dt = new Date(d.startDate);
    return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
  }).length;
  const activeDealsCount = deals.filter(d => d.status === "Active").length;
  const quotesThisMonth = quotes.filter(q => {
    const d = q.createdAt ? new Date(q.createdAt) : null;
    return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const allSigned = contracts.length > 0 && signedContracts === contracts.length;

  // Chart data
  const platformDist = buildPlatformDist(deals);

  const recentDeals = deals.slice(0, 3);

  // The profile checklist (billing address, PAN, signature, bank) is the paperwork's: it lives on the Profile page,
  // never on Home (13 Nov 2026, founder: Home must not read as if the Deal Suite were the point).
  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    window.location.href = "/";
  };

  // ── The dashboard's pieces, arranged by who is looking ───────────────────────────────
  // An account with deals reads analytics first: the numbers, then what needs attention, then the
  // charts, with account and setup last. An account with no deals yet is still setting up, so its
  // order stays as it was: setup first.
  // A failed deals read is not "no deals yet": the empty list would put zeros
  // and the first-run empty state where the real numbers should be. With the deal suite hidden,
  // leads decide instead of deals (client/src/lib/first-run.ts says why).
  // Where the person is wins over what they last chose; Leads, the bridge, never moves them (shared/work-mode.ts).
  // Both hooks are called unconditionally — reading the remembered mode inside the ternary below would make it a
  // conditional hook, which breaks the moment DEAL_SUITE_HIDDEN is ever flipped at runtime.
  const [location] = useLocation();
  const rememberedMode = useWorkMode();
  const workMode: WorkMode = DEAL_SUITE_HIDDEN ? "find" : resolveWorkMode(location, rememberedMode);

  const firstRun = isFirstRun({
    leadTotal: leadCounts.isSuccess ? leadCounts.data.total : null,
    dealsKnown: !dealsLoading && !dealsError,
    dealCount: deals.length,
  });
  const accountEl = (
    <>
      <SubscriptionCard user={user} />
      <TeamSeatsCard />
    </>
  );
  const quickActionsEl = <QuickActionsTile canSeeOutbound={canSeeOutbound} canCreateDeal={canCreateDeal} newDealCta={audience.newDealCta} />;
  // "What needs me today?" — overdue money, due follow-ups, unsigned agreements, work ready to invoice, approved
  // messages to send, quotations waiting. It replaces the Money Radar, follow-ups and protection cards that stood here.
  const todayEl = <TodayPanel />;
  const statsEl = (
    <>
{/* ── Stat cards — the funnel, in order: deal → quote → agreement →
            invoice → money ── */}
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-3 lg:gap-4">
          <StatCard title="Deals" value={totalDeals} icon={Briefcase}
            tone="amber" href="/deals" loading={isLoading}
            sub={dealsThisMonth > 0 ? `${dealsThisMonth} this month` : totalDeals > 0 ? "in your pipeline" : "None yet"}
            trendUp={dealsThisMonth > 0} />
          <StatCard title="Quotations" value={quotes.length} icon={FileText}
            tone="slate" href="/quotations" loading={isLoading}
            sub={quotesThisMonth > 0 ? `${quotesThisMonth} this month` : quotes.length > 0 ? "created so far" : "None yet"}
            trendUp={quotesThisMonth > 0} />
          <StatCard title="Agreements" value={signedContracts} icon={FileCheck}
            tone="blue" href="/contracts" loading={isLoading}
            sub={allSigned ? "All signed" : signedContracts > 0 ? `${signedContracts} signed` : contracts.length > 0 ? "None signed yet" : "None yet"} />
          <StatCard title="Paid invoices" value={invStats.paid} icon={Receipt}
            tone="emerald" href="/invoices" loading={isLoading} unavailable={invoicesUnavailable}
            sub={paidInvoicesSubline(invStats)}
            trendUp={invStats.overdue === 0 && invStats.paidThisWeek > 0} />
          <div className="col-span-2 lg:col-span-1">
          <StatCard
            title="Pipeline value"
            value={totalRevenueMinor + pendingRevenueMinor}
            format={(n) => moneyFrame(n, totalRevenueMinor + pendingRevenueMinor, fmt)}
            icon={pipelineIcon(fmt)}
            tone="slate"
            href="/deals"
            loading={isLoading}
            sub={totalRevenueMinor > 0
              ? `${compactMoney(totalRevenueMinor, fmt)} confirmed${pendingRevenueMinor > 0 ? ` · ${compactMoney(pendingRevenueMinor, fmt)} pending` : ""}`
              : pendingRevenueMinor > 0
                ? `${compactMoney(pendingRevenueMinor, fmt)} pending`
                : `${activeDealsCount} active deal${activeDealsCount !== 1 ? "s" : ""}`}
          />
          </div>
        </section>

        
    </>
  );
  const dealStatusEl = (
    <>
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
                    <h3 className="text-sm lg:text-base font-semibold text-foreground">Deal status</h3>
                    <p className="text-[11px] lg:text-xs text-muted-foreground mt-0.5">
                      Your {totalDeals} deal{totalDeals !== 1 ? "s" : ""} by status
                    </p>
                  </div>
                  <Link href="/deals">
                    <Button variant="ghost" size="sm" className="text-xs lg:text-sm h-7 lg:h-8 text-primary hover:text-primary">
                      View all <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                    </Button>
                  </Link>
                </div>

                {/* Segmented progress bar — hairline gaps + per-segment
                    rounding read cleaner than one fused bar */}
                <div className="flex w-full h-2.5 lg:h-3 gap-[3px]">
                  {segments.map((s) =>
                    s.count > 0 ? (
                      <div
                        key={s.label}
                        className={`${s.color} rounded-full transition-all duration-500`}
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

        
    </>
  );
  const analyticsEl = (
    <>
{/* ── Analytics: trend + activity + conversion. Palette
            #059669/#F59E0B validated (CVD + normal-vision pass); counts
            share one axis, money gets its own chart — never dual axes. ── */}
        {!isLoading && (() => {
          const revenue = buildRevenueOverTime(deals, fmt.locale);
          const activity = buildMonthlyActivity(deals, quotes, fmt.locale);
          const quotedDeals = new Set(quotes.map((q) => q.dealId)).size;
          const invoicedDeals = new Set(brandInvoices.map((i) => i.dealId)).size;
          const paidDeals = new Set(brandInvoices.filter((i) => i.status === "Paid").map((i) => i.dealId)).size;
          const funnel = [
            { label: "Deals", value: totalDeals },
            { label: "Quoted", value: quotedDeals },
            { label: "Agreements", value: contracts.length },
            { label: "Invoiced", value: invoicedDeals },
            { label: "Paid", value: paidDeals },
          ];
          return (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 lg:gap-5">
                {/* Revenue trend — single series, the title names it */}
                <Card className="glass-card border-0 lg:col-span-2">
                  <CardHeader className="pb-1 px-4 pt-4 lg:px-6 lg:pt-6">
                    <CardTitle className="text-sm lg:text-base font-semibold">Deal value by month</CardTitle>
                    <p className="text-[11px] lg:text-xs text-muted-foreground mt-0.5">Total deal value by start month · last 6 months</p>
                  </CardHeader>
                  <CardContent className="px-2 pb-4 lg:px-4 lg:pb-6">
                    {!revenue.some((r) => r.amount > 0) ? (
                      <ChartEmpty
                        icon={TrendingUp}
                        title="No deal value yet"
                        hint="Create your first deal to see its value here, month by month."
                        cta={canCreateDeal ? (
                          <Link href="/deals/new">
                            <Button size="sm" className="gradient-btn text-white h-8 text-xs font-semibold">
                              <Plus className="w-3.5 h-3.5 mr-1" /> Create deal
                            </Button>
                          </Link>
                        ) : undefined}
                      />
                    ) : (
                    <div className="h-[200px] lg:h-[230px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={revenue} margin={{ top: 10, right: 15, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="dis-rev-fill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#059669" stopOpacity={0.28} />
                              <stop offset="100%" stopColor="#059669" stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.6)" vertical={false} />
                          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false}
                            tickFormatter={(v: number) => compactAmount(v, fmt)} />
                          <Tooltip content={<CustomTooltip format={fmt.money} />} />
                          <Area type="monotone" dataKey="amount" name="Deal value" stroke="#059669" strokeWidth={2}
                            fill="url(#dis-rev-fill)" dot={{ r: 3, fill: "#059669", strokeWidth: 2, stroke: "hsl(var(--background))" }}
                            activeDot={{ r: 5 }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    )}
                  </CardContent>
                </Card>

                {/* Monthly activity — two count series, one axis, legend chips */}
                <Card className="glass-card border-0">
                  <CardHeader className="pb-1 px-4 pt-4 lg:px-6 lg:pt-6">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-sm lg:text-base font-semibold">Monthly activity</CardTitle>
                      <span className="flex items-center gap-3 text-[10px] font-medium text-muted-foreground">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[#059669]" /> Deals</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[#F59E0B]" /> Quotations</span>
                      </span>
                    </div>
                    <p className="text-[11px] lg:text-xs text-muted-foreground mt-0.5">Deals and quotations created · last 6 months</p>
                  </CardHeader>
                  <CardContent className="px-2 pb-4 lg:px-4 lg:pb-6">
                    {!activity.some((m) => m.deals + m.quotations > 0) ? (
                      <ChartEmpty
                        icon={Briefcase}
                        title="No activity in the last 6 months"
                        hint="Create a deal or a quotation and it will be counted here by month."
                      />
                    ) : (
                    <div className="h-[200px] lg:h-[230px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={activity} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barGap={2}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.6)" vertical={false} />
                          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                          <Tooltip content={<CustomTooltip />} />
                          <Bar dataKey="deals" name="Deals" fill="#059669" radius={[4, 4, 0, 0]} maxBarSize={18} />
                          <Bar dataKey="quotations" name="Quotations" fill="#F59E0B" radius={[4, 4, 0, 0]} maxBarSize={18} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Pipeline conversion — one hue, width encodes share, direct labels */}
              <Card className="glass-card border-0">
                <CardContent className="p-4 lg:p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm lg:text-base font-semibold text-foreground">Pipeline conversion</h3>
                      <p className="text-[11px] lg:text-xs text-muted-foreground mt-0.5">How many of your deals reach each stage</p>
                    </div>
                    <ArrowUpRight className="w-4 h-4 text-muted-foreground/50 hidden lg:block" />
                  </div>
                  {totalDeals === 0 ? (
                    <ChartEmpty
                      compact
                      icon={FileCheck}
                      title="Your pipeline starts with a deal"
                      hint="Deal → Quotation → Agreement → Invoice → Paid. Create a deal to see how many reach each stage."
                    />
                  ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 lg:gap-4">
                    {funnel.map((f, i) => {
                      const pct = totalDeals > 0 ? Math.round((f.value / totalDeals) * 100) : 0;
                      const stepPct = i > 0 && funnel[i - 1].value > 0 ? Math.round((f.value / funnel[i - 1].value) * 100) : null;
                      return (
                        <div key={f.label} className="min-w-0">
                          <div className="flex items-baseline justify-between gap-2 mb-1">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate">{f.label}</span>
                            {stepPct !== null && (
                              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{stepPct}%</span>
                            )}
                          </div>
                          <p className="text-xl lg:text-2xl font-bold tabular-nums leading-none mb-2">{f.value}</p>
                          <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-500" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  )}
                </CardContent>
              </Card>
            </>
          );
        })()}

        
    </>
  );
  const chartsEl = (
    <>
{/* ── Charts (only shown when there's data) ── */}
        {deals.length > 0 && (
          <>

            {/* Bottom row — Platform bar (wide) + Invoice Money pie (compact) */}
            {(platformDist.length > 0 || brandInvoices.length > 0) && (() => {
              const paidValueMinor = brandInvoices
                .filter(bi => bi.status === "Paid")
                .reduce((s, bi) => s + Number(bi.dealAmountMinor || 0), 0);
              const unpaidValueMinor = brandInvoices
                .filter(bi => bi.status !== "Paid")
                .reduce((s, bi) => s + Number(bi.dealAmountMinor || 0), 0);
              const totalInvoiceValueMinor = paidValueMinor + unpaidValueMinor;
              const paidCount = brandInvoices.filter(bi => bi.status === "Paid").length;
              const unpaidCount = brandInvoices.length - paidCount;
              const moneyPie = totalInvoiceValueMinor > 0
                ? [
                    { name: "Paid", value: paidValueMinor, fill: "#10B981", count: paidCount },
                    { name: "Pending",  value: unpaidValueMinor, fill: "#F59E0B", count: unpaidCount },
                  ].filter(s => s.value > 0)
                : [];
              return (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-5">
                  {/* Deliverables by Category — donut + legend (matches Invoice donut) */}
                  {platformDist.length > 0 && (() => {
                    const dTotal = platformDist.reduce((s, e) => s + e.count, 0);
                    return (
                    <Card className="glass-card border-0">
                      <CardHeader className="pb-1 px-4 pt-4 lg:px-6 lg:pt-6">
                        <CardTitle className="text-sm lg:text-base font-semibold">Deliverables by category</CardTitle>
                        <p className="text-[11px] lg:text-xs text-muted-foreground mt-0.5">How your deliverables split across categories</p>
                      </CardHeader>
                      <CardContent className="px-4 pb-5 lg:px-6 lg:pb-6">
                        <div className="flex flex-col xl:flex-row items-center gap-4 xl:gap-6">
                          <div className="relative w-[168px] h-[168px] xl:w-[150px] xl:h-[150px] 2xl:w-[180px] 2xl:h-[180px] shrink-0">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie data={platformDist} cx="50%" cy="50%" innerRadius="60%" outerRadius="88%"
                                  dataKey="count" nameKey="platform" paddingAngle={2} stroke="none">
                                  {platformDist.map((entry, i) => (
                                    <Cell key={i} fill={colorForPlatform(entry.platform, i)} />
                                  ))}
                                </Pie>
                                <Tooltip content={<CustomTooltip />} />
                              </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                              <span className="text-[10px] lg:text-xs uppercase tracking-wider font-semibold text-muted-foreground">Total</span>
                              <span className="text-2xl lg:text-3xl font-bold text-foreground leading-tight">{dTotal}</span>
                            </div>
                          </div>
                          {/* min-w-0 (not w-full) — a 100%-wide flex child beside
                              the fixed-width donut overflows the card and clips
                              the % column. */}
                          <div className="w-full xl:flex-1 min-w-0 self-stretch flex flex-col justify-center gap-1.5">
                            {/* Colour + name only — counts live in the donut's
                                hover tooltip and its centre total. */}
                            {platformDist.map((entry, i) => (
                              <div key={i} className="flex items-baseline gap-2 text-xs lg:text-sm">
                                <span className="w-2 h-2 rounded-full shrink-0 translate-y-[-1px]" style={{ backgroundColor: colorForPlatform(entry.platform, i) }} />
                                <span className="min-w-0 truncate text-foreground" title={entry.platform}>{entry.platform}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    );
                  })()}

                  {/* Invoice Status — donut + legend */}
                  {moneyPie.length > 0 && (
                    <Card className="glass-card border-0">
                      <CardHeader className="pb-1 px-4 pt-4 lg:px-6 lg:pt-6">
                        <CardTitle className="text-sm lg:text-base font-semibold">Invoice status</CardTitle>
                        <p className="text-[11px] lg:text-xs text-muted-foreground mt-0.5">
                          By amount · {brandInvoices.length} invoice{brandInvoices.length !== 1 ? "s" : ""}
                        </p>
                      </CardHeader>
                      <CardContent className="px-4 pb-5 lg:px-6 lg:pb-6">
                        <div className="flex flex-col xl:flex-row items-center gap-4 xl:gap-6">
                          <div className="relative w-[168px] h-[168px] xl:w-[150px] xl:h-[150px] 2xl:w-[180px] 2xl:h-[180px] shrink-0">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie data={moneyPie} cx="50%" cy="50%" innerRadius="60%" outerRadius="88%"
                                  dataKey="value" nameKey="name" paddingAngle={2} stroke="none">
                                  {moneyPie.map((entry, i) => (
                                    <Cell key={i} fill={entry.fill} />
                                  ))}
                                </Pie>
                                <Tooltip
                                  content={({ active, payload }) => {
                                    if (!active || !payload?.length) return null;
                                    const d = payload[0].payload as any;
                                    return (
                                      <div className="bg-background/95 border border-border/60 rounded-lg p-2.5 text-xs shadow-lg">
                                        <p style={{ color: d.fill }} className="font-semibold mb-0.5">{d.name}</p>
                                        <p className="font-bold text-foreground">{fmt.money(d.value)}</p>
                                        <p className="text-muted-foreground">{d.count} invoice{d.count !== 1 ? "s" : ""}</p>
                                      </div>
                                    );
                                  }}
                                />
                              </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                              <span className="text-[10px] lg:text-xs uppercase tracking-wider font-semibold text-muted-foreground">Total billed</span>
                              <span className="text-lg lg:text-2xl font-bold text-foreground leading-tight">
                                {compactMoney(totalInvoiceValueMinor, fmt)}
                              </span>
                            </div>
                          </div>
                          {/* Stacked rows: an amount and a label can't share one
                              line in a ~180px legend without truncating the name. */}
                          <div className="w-full xl:flex-1 min-w-0 self-stretch flex flex-col justify-center gap-3">
                            {moneyPie.map((entry, i) => (
                              <div key={i} className="min-w-0">
                                <div className="flex items-baseline gap-2 text-xs lg:text-sm">
                                  <span className="w-2 h-2 rounded-full shrink-0 translate-y-[-1px]" style={{ backgroundColor: entry.fill }} />
                                  <span className="flex-1 min-w-0 truncate text-foreground">{entry.name}</span>
                                  <span className="text-muted-foreground/80 tabular-nums shrink-0">{Math.round((entry.value / totalInvoiceValueMinor) * 100)}%</span>
                                </div>
                                <div className="pl-4 font-semibold text-foreground tabular-nums text-sm lg:text-md leading-tight">
                                  {fmt.money(entry.value)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              );
            })()}
          </>
        )}

        
    </>
  );
  const recentEl = (
    <>
{/* ── Recent Deals — one divided list, not three stacked cards ── */}
        {recentDeals.length > 0 && (
          <Card className="glass-card border-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-4 pb-2 lg:px-5 lg:pt-5">
              <div>
                <h2 className="text-sm lg:text-base font-semibold text-foreground">Recent deals</h2>
                <p className="text-[11px] lg:text-xs text-muted-foreground mt-0.5">Your latest deals</p>
              </div>
              <Link href="/deals">
                <Button variant="ghost" size="sm" className="text-primary text-xs lg:text-sm h-7 lg:h-8 hover:text-primary">
                  View all <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                </Button>
              </Link>
            </div>
            <div className="divide-y divide-border/50 mt-1">
              {recentDeals.map((deal) => (
                <Link key={deal.id} href={`/deals/${deal.id}`}>
                  <div className="group flex items-center gap-3 lg:gap-3.5 px-4 py-3 lg:px-5 lg:py-3.5 cursor-pointer hover:bg-muted/40 transition-colors">
                    <span
                      className={`flex items-center justify-center w-9 h-9 lg:w-10 lg:h-10 rounded-xl font-bold text-sm shrink-0 ${avatarTone(deal.brandName)}`}
                      aria-hidden="true"
                    >
                      {deal.brandName.trim().slice(0, 1).toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate text-sm" data-testid={`text-deal-title-${deal.id}`}>
                        {deal.dealTitle}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {deal.brandName} · {deal.deliverables.length} deliverable{deal.deliverables.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5 lg:gap-3.5 shrink-0">
                      <span className="text-sm lg:text-base font-bold text-foreground tabular-nums">
                        {fmt.money(deal.dealAmountMinor)}
                      </span>
                      <StatusBadge status={deal.status} size="compact" />
                      <ChevronRight className="hidden lg:block w-4 h-4 text-muted-foreground/50 group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </Card>
        )}

        
    </>
  );
  const emptyEl = (
    <>
{/* ── Empty state ── */}
        {deals.length === 0 && !isLoading && (
          <Card className="glass-card border-0">
            <CardContent className="py-12 text-center">
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 mx-auto mb-4">
                <Briefcase className="w-8 h-8 text-muted-foreground" />
              </div>
              {/* An account with nothing yet is pointed at the product, which is finding clients — never at the
                  Deal Suite, which is the free part for work already won. Its button stays, second. */}
              <h3 className="font-semibold mb-1">No clients yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Describe who you want to work with, and your AI team finds companies that fit, with the evidence.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {/* Finding the client comes first; the Deal Suite button is the quieter second. */}
                {canSeeOutbound && (
                  <Link href="/outbound">
                    <Button className="gradient-btn text-white" data-testid="button-empty-find-clients">
                      <Radar className="w-4 h-4 mr-2" />
                      Find your first client
                    </Button>
                  </Link>
                )}
                {canCreateDeal && !DEAL_SUITE_HIDDEN && (
                  <Link href="/deals/new">
                    <Button variant={canSeeOutbound ? "outline" : "default"} className={canSeeOutbound ? "font-semibold" : "gradient-btn text-white"} data-testid="button-create-first-deal">
                      <Plus className="w-4 h-4 mr-2" />
                      {audience.newDealCta}
                    </Button>
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>
        )}
    </>
  );

  return (
    <div className="min-h-screen bg-background pb-24 lg:pb-12">
      {/* Header — compact on mobile, generous on desktop SaaS-style */}
      <header className="glass-header sticky top-0 z-40 lg:border-b lg:border-neutral-200/60 dark:lg:border-neutral-800/60">
        <div className="flex items-center justify-between gap-4 px-4 py-4 lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-5 xl:px-10">
          <div>
            <p className="text-xs text-muted-foreground">{todayLabel}</p>
            <h1 className="text-lg lg:text-2xl font-bold tracking-tight">
              {greeting}, {firstNameOnly}
            </h1>
            <p className="hidden sm:block text-sm text-muted-foreground">Here's what needs your attention today.</p>
          </div>
          <div className="flex items-center gap-2 lg:gap-3">
            {/* Finding clients is the primary action; the Deal Suite button is the quieter second.
                Desktop only: mobile already has Client Radar in the bottom bar. */}
            {canCreateDeal && !DEAL_SUITE_HIDDEN && (
              <Link href="/deals/new" className="hidden lg:block">
                <Button size="sm" variant="outline" className="font-semibold" data-testid="header-new-deal">
                  <Plus className="w-4 h-4 mr-1.5" />
                  {audience.newDealCta}
                </Button>
              </Link>
            )}
            {canSeeOutbound && (
              <Link href="/outbound" className="hidden lg:block">
                <Button size="sm" className="gradient-btn text-white font-semibold" data-testid="header-find-prospects">
                  <Radar className="w-4 h-4 mr-1.5" />
                  Find clients
                </Button>
              </Link>
            )}
            {/* Desktop keeps the bell + settings in the sidebar; mobile
                needs them here (settings isn't in the bottom nav). */}
            <NotificationBell className="lg:hidden" />
            <Link href="/settings" className="lg:hidden">
              <Button variant="ghost" size="icon" aria-label="Settings" data-testid="header-settings">
                <SettingsIcon className="w-5 h-5" />
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              aria-label="Log out"
              data-testid="button-logout"
              className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 lg:hidden"
            >
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* One column on a phone. From lg a six-column bento: every direct child names its span, a wrapper whose
          widget rendered nothing is `empty:hidden` so it leaves no hole, and dense flow backfills the rail. */}
      <main className="px-4 py-5 space-y-6 animate-fade-in lg:max-w-[1600px] lg:mx-auto lg:grid lg:grid-cols-6 lg:grid-flow-dense lg:gap-5 lg:space-y-0 lg:px-8 lg:py-6 xl:px-10" data-testid="dashboard-bento">
        {dealsError ? (
          // Everything that counts or charts deals is left out until they load.
          <>
            <Card className="glass-card lg:col-span-6">
              <LoadError what="your deals" compact onRetry={() => void refetchDeals()} retrying={dealsFetching} />
            </Card>
            <div className="empty:hidden lg:col-span-6"><GettingStarted /></div>
            {/* Today reads its own sources (invoices, agreements, follow-ups…), so it still answers without deals. */}
            <div className="empty:hidden lg:col-span-4 lg:row-span-2">{todayEl}</div>
            <div className="hidden lg:col-span-2 lg:block">{quickActionsEl}</div>
            <div className="empty:hidden lg:col-span-2 space-y-4">{accountEl}</div>
          </>
        ) : firstRun ? (
          <>
            <div className="empty:hidden lg:col-span-6"><GettingStarted /></div>
            {/* A brand-new account sees Today only when something real needs it — never an unearned "All clear". */}
            <div className="empty:hidden lg:col-span-4 lg:row-span-2"><TodayPanel hideWhenEmpty /></div>
            <div className="hidden lg:col-span-2 lg:block">{quickActionsEl}</div>
            <div className="hidden empty:hidden lg:col-span-2 lg:block"><AllowanceTile /></div>
            {/* First run means nothing on either side yet, so every deal chart would be empty. The account sees what
                to do instead; the numbers appear below once there is something to count. */}
            <div className="empty:hidden lg:col-span-4">{emptyEl}</div>
            <div className="empty:hidden lg:col-span-2 space-y-4">{accountEl}</div>
          </>
        ) : (
          <>
            <div className="empty:hidden lg:col-span-6"><GettingStarted /></div>
            <div className="empty:hidden lg:col-span-4 lg:row-span-2">{todayEl}</div>
            <div className="hidden lg:col-span-2 lg:block">{quickActionsEl}</div>
            <div className="hidden empty:hidden lg:col-span-2 lg:block"><AllowanceTile /></div>
            {/* TWO MODES, NEVER MIXED (13 Nov 2026, founder). One mode's numbers are read at a time: a deal count
                beside a reply rate describes a funnel that does not exist, because each side is usable without the
                other. Leads is the single bridge, so it is the one thing both modes show. */}
            {!isLoading && (
              <section className="space-y-4 lg:col-span-6 lg:grid lg:grid-cols-6 lg:grid-flow-dense lg:gap-5 lg:space-y-0" aria-labelledby="dashboard-mode-title" data-testid={`dashboard-mode-${workMode}`}>
                <div className="flex flex-wrap items-center justify-between gap-3 lg:col-span-6">
                  <div className="min-w-0">
                    <h2 id="dashboard-mode-title" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {WORK_MODE_LABELS[workMode]}
                      {workMode === "suite" && <span className="ml-2 normal-case tracking-normal text-emerald-700 dark:text-emerald-400">Free, included</span>}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">{WORK_MODE_HINTS[workMode]}</p>
                  </div>
                  {!DEAL_SUITE_HIDDEN && <WorkModeTabs mode={workMode} onSelect={setWorkMode} />}
                </div>

                {/* The bridge. A lead is where finding a client ends and won work begins, so it belongs to both.
                    Beside the funnel it is a tile; above the suite's numbers it stays a strip. */}
                <div className={cn("empty:hidden [&>a]:h-full", workMode === "find" ? "lg:col-span-2" : "lg:col-span-6")}><LeadsStrip /></div>

                {workMode === "find" ? (
                  <div className="lg:col-span-4 [&>*]:h-full"><SalesFunnel /></div>
                ) : totalDeals > 0 ? (
                  <>
                    <div className="empty:hidden lg:col-span-6">{statsEl}</div>
                    <div className="empty:hidden lg:col-span-6">{analyticsEl}</div>
                    <div className="empty:hidden lg:col-span-6">{chartsEl}</div>
                    <div className="empty:hidden lg:col-span-3 [&>*]:h-full">{dealStatusEl}</div>
                    <div className="empty:hidden lg:col-span-3 [&>*]:h-full">{recentEl}</div>
                  </>
                ) : (
                  /* Nothing to chart yet. Say what the suite is for rather than showing five empty cards. */
                  <Card className="glass-card lg:col-span-6">
                    <CardContent className="p-4 flex items-center gap-3.5">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-emerald-500/10">
                        <FileSignature className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">Deals, quotations, agreements and invoices</p>
                        <p className="text-xs text-muted-foreground">For work you have already won. Free on every plan, with no monthly cap.</p>
                      </div>
                      <Link href="/deals">
                        <Button size="sm" variant="outline" className="flex-shrink-0" data-testid="dashboard-dealsuite-cta">Open</Button>
                      </Link>
                    </CardContent>
                  </Card>
                )}
              </section>
            )}
            <section className="space-y-4 lg:col-span-6 lg:grid lg:grid-cols-6 lg:gap-5 lg:space-y-0" aria-label="Account and setup" data-testid="dashboard-account">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground lg:col-span-6">Account</h2>
              <div className="empty:hidden lg:col-span-3 lg:[&:has(+div:empty)]:col-span-6 [&>*]:h-full"><SubscriptionCard user={user} /></div>
              <div className="empty:hidden lg:col-span-3 [&>*]:h-full"><TeamSeatsCard /></div>
            </section>
          </>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
