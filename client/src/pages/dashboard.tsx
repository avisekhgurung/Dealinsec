import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BottomNav } from "@/components/bottom-nav";
import { NotificationBell } from "@/components/notification-bell";
import { StatusBadge } from "@/components/status-badge";
import { useMemo, useState, useEffect, useRef } from "react";
import {
  Plus, Briefcase, FileCheck, Receipt, ChevronRight, LogOut,
  TrendingUp, IndianRupee, Clock, CheckCircle2,
  UserCircle, MapPin, FileText, PenTool, Landmark, X as XIcon, Sparkles,
  Crown, Rocket, Users2, UserPlus2, Settings as SettingsIcon,
  Zap, FileSignature, ArrowUpRight
} from "lucide-react";
import {
  BarChart, Bar, Cell, PieChart, Pie, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import {
  hasActivePro, hasActiveDealBoost, hasActiveTrial, hasLapsedTrial, getSubscriptionType,
} from "@shared/schema";
import { TrialCountdown } from "@/components/trial-countdown";
import { memberCan } from "@shared/permissions";
import type { Deal, Contract, Invoice, BrandInvoice, Quote, User } from "@shared/schema";

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
            Invite Member
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
  const fmtDate = (d: Date | string | null | undefined) =>
    d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null;

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
              Unlimited workflow{user?.planExpiresAt ? ` · valid until ${fmtDate(user.planExpiresAt)}` : ""}
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
              {" · agreements & invoices need Pro"}
            </p>
          </div>
          <Link href="/pricing">
            <Button variant="outline" size="sm" className="flex-shrink-0">Go Pro</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  // Free plan: no credit counters in the UI (they confused users) — just the
  // plan and an upgrade path. The 4-deals-a-month limit is enforced
  // server-side and surfaces through the upgrade modal when it's reached.
  // A lapsed trial gets its own framing: the user has SEEN the full
  // workflow, so speak to what they're missing, not what's included.
  const trialEnded = hasLapsedTrial(user);
  return (
    <Card
      className={`glass-card relative overflow-hidden ${trialEnded ? "border-rose-300/40 dark:border-rose-900/40" : ""}`}
      data-testid="subscription-card"
    >
      {trialEnded && (
        <div className="absolute inset-0 bg-gradient-to-r from-rose-500/[0.05] to-transparent pointer-events-none" />
      )}
      <CardContent className="relative p-4 lg:p-3.5 flex items-center gap-3.5">
        <div className={`w-10 h-10 lg:w-8 lg:h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${trialEnded ? "bg-rose-500/10" : "bg-primary/10"}`}>
          <Sparkles className={`w-5 h-5 lg:w-4 lg:h-4 ${trialEnded ? "text-rose-500" : "text-primary"}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">
            {trialEnded ? "Your Pro trial has ended" : "Free plan"}
          </p>
          <p className="text-xs text-muted-foreground">
            {trialEnded
              ? "Your deals and documents are safe — upgrade to keep creating agreements & invoices"
              : "Upgrade for unlimited deals, signed agreements, invoices & payment tracking"}
          </p>
        </div>
        <Link href="/pricing">
          <Button size="sm" className="flex-shrink-0 text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700" data-testid="dashboard-upgrade-cta">
            <Crown className="w-3.5 h-3.5 mr-1.5 text-amber-300" />
            Upgrade
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

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

/** Last 6 calendar months, deals started + quotations issued per month —
 *  two counts, same unit, so they may share one axis (never two scales). */
function buildMonthlyActivity(deals: Deal[], quotes: { createdAt?: Date | string | null }[]) {
  const months: { key: string; month: string; deals: number; quotations: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      month: d.toLocaleDateString("en-IN", { month: "short" }),
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

function StatCard({ title, value, format, icon: Icon, tone, href, loading, sub, trendUp }: {
  title: string;
  value: number;
  /** Optional numeral formatter (e.g. ₹ + Indian grouping). Applied to the
   *  animated value each frame, so currency counts up too. */
  format?: (n: number) => string;
  icon: any;
  tone: StatTone;
  href: string;
  loading: boolean;
  sub?: string;
  trendUp?: boolean;
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
        ) : (() => {
          const text = format ? format(animated) : String(animated);
          // Long currency strings step down instead of truncating —
          // "₹15,50,000" must never render as "₹15,50,0…".
          const size =
            text.length > 11 ? "text-base sm:text-lg lg:text-xl"
            : text.length > 8 ? "text-lg sm:text-xl lg:text-2xl"
            : "text-xl sm:text-2xl lg:text-[26px]";
          return (
            <p className={`${size} font-semibold text-neutral-900 dark:text-white leading-none tracking-tight tabular-nums whitespace-nowrap`}>
              {text}
            </p>
          );
        })()}
        {!loading && sub && (
          <p className={`mt-1.5 text-[11px] lg:text-[11.5px] font-medium flex items-center gap-1 truncate ${trendUp ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-500 dark:text-neutral-400"}`}>
            {trendUp && <TrendingUp className="w-3 h-3 shrink-0" strokeWidth={2.5} />}
            {sub}
          </p>
        )}
      </div>
    </Link>
  );
}

// ─── money tile ──────────────────────────────────────────────────────────────
// Earned/Pending strip: tinted surface + icon chip + counted-up amount, so the
// two money numbers read as money at a glance instead of plain glass boxes.

const MONEY_TINTS = {
  emerald: {
    card: "border border-emerald-200/60 dark:border-emerald-900/40 bg-gradient-to-br from-emerald-500/[0.08] via-teal-500/[0.04] to-transparent",
    chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    amount: "text-emerald-600 dark:text-emerald-400",
  },
  amber: {
    card: "border border-amber-200/60 dark:border-amber-900/40 bg-gradient-to-br from-amber-500/[0.08] via-orange-500/[0.04] to-transparent",
    chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    amount: "text-amber-600 dark:text-amber-400",
  },
} as const;

function MoneyTile({ label, amount, icon: Icon, tint }: {
  label: string;
  amount: number;
  icon: any;
  tint: keyof typeof MONEY_TINTS;
}) {
  const t = MONEY_TINTS[tint];
  const animated = useCountUp(amount);
  const long = amount.toLocaleString("en-IN").length > 7;
  return (
    <div className={`rounded-xl p-3 lg:p-5 overflow-hidden ${t.card}`}>
      <div className="flex items-center gap-2 mb-1.5 lg:mb-2.5">
        <span className={`flex items-center justify-center w-6 h-6 lg:w-7 lg:h-7 rounded-md shrink-0 ${t.chip}`}>
          <Icon className="w-3.5 h-3.5 lg:w-4 lg:h-4" strokeWidth={2.2} />
        </span>
        <span className="text-xs lg:text-sm text-muted-foreground uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <p className={`font-bold truncate leading-tight tabular-nums ${t.amount} ${long ? "text-base lg:text-2xl" : "text-xl lg:text-3xl"}`}>
        ₹{animated.toLocaleString("en-IN")}
      </p>
    </div>
  );
}

// ─── Money Radar ─────────────────────────────────────────────────────────────
// "How much money am I leaving on the table?" — three deterministic buckets
// from the insights engine; every number clickable, none invented.
function MoneyRadarCard() {
  const { data } = useQuery<{
    radar: {
      overdue: { total: number; count: number };
      dueThisWeek: { total: number; count: number };
      readyToInvoice: { total: number; count: number };
      collectible: number;
    };
  }>({ queryKey: ["/api/copilot/briefing"], staleTime: 60_000 });
  const radar = data?.radar;
  if (!radar || radar.collectible <= 0) return null;
  const inrFmt = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  const buckets = [
    { label: "Overdue", total: radar.overdue.total, count: radar.overdue.count, href: "/invoices", dot: "bg-rose-500", cls: "text-rose-600 dark:text-rose-400" },
    { label: "Due this week", total: radar.dueThisWeek.total, count: radar.dueThisWeek.count, href: "/invoices", dot: "bg-amber-500", cls: "text-amber-600 dark:text-amber-400" },
    { label: "Ready to invoice", total: radar.readyToInvoice.total, count: radar.readyToInvoice.count, href: "/contracts", dot: "bg-emerald-500", cls: "text-emerald-600 dark:text-emerald-400" },
  ].filter((b) => b.total > 0);
  return (
    <Card className="glass-card border-emerald-300/40 dark:border-emerald-800/40 relative overflow-hidden" data-testid="money-radar">
      <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/[0.05] to-transparent pointer-events-none" />
      <CardContent className="relative p-4 lg:p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Money Radar</p>
            <p className="text-xl lg:text-2xl font-bold tabular-nums">
              {inrFmt(radar.collectible)} <span className="text-sm font-medium text-muted-foreground">potentially collectible</span>
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {buckets.map((b) => (
            <Link key={b.label} href={b.href}>
              <button type="button" className="w-full text-left rounded-xl border border-border/60 p-3 hover:border-primary/40 hover:shadow-sm transition-all">
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium">
                  <span className={`w-1.5 h-1.5 rounded-full ${b.dot}`} /> {b.label} · {b.count}
                </p>
                <p className={`font-bold text-lg tabular-nums mt-0.5 ${b.cls}`}>{inrFmt(b.total)}</p>
              </button>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth();
  const displayName = user?.firstName && user?.lastName
    ? `${user.firstName} ${user.lastName}`
    : user?.email?.split("@")[0] || "Influencer";
  // Time-of-day greeting + today's date — the header should orient, not
  // just repeat the name that's already in the sidebar footer.
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstNameOnly = user?.firstName || displayName.split(" ")[0];
  const todayLabel = new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long",
  });

  const { data: deals = [], isLoading: dealsLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
  });

  const { data: contracts = [], isLoading: contractsLoading } = useQuery<Contract[]>({
    queryKey: ["/api/contracts"],
  });

  const { data: invoices = [], isLoading: invoicesLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
  });

  const { data: brandInvoices = [] } = useQuery<BrandInvoice[]>({
    queryKey: ["/api/brand-invoices"],
  });

  const { data: quotes = [] } = useQuery<(Quote & { deal: Deal | null })[]>({
    queryKey: ["/api/quotes"],
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

  // Stat-card sub-metrics (trend lines under each number)
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const dealsThisMonth = deals.filter(d => {
    const dt = new Date(d.startDate);
    return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
  }).length;
  const activeDealsCount = deals.filter(d => d.status === "Active").length;
  const quotesThisMonth = quotes.filter(q => {
    const d = q.createdAt ? new Date(q.createdAt) : null;
    return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const paidThisWeek = invoices.filter(i => i.status === "Paid" && new Date(i.invoiceDate) >= weekAgo).length;
  const allSigned = contracts.length > 0 && signedContracts === contracts.length;

  // Chart data
  const platformDist = buildPlatformDist(deals);
  const deliverableCompletion = useMemo(() => buildDeliverableCompletion(deals), [deals]);
  const totalDeliverables = deliverableCompletion.reduce((s, d) => s + d.total, 0);
  const completedDeliverables = deliverableCompletion.reduce((s, d) => s + d.completed, 0);

  const recentDeals = deals.slice(0, 3);

  // ── Profile-completion nudge ─────────────────────────────────────────────
  // Compute which profile fields are still missing so we can prompt the user
  // to finish their setup before they get blocked at contract/invoice time.
  const profileChecklist = useMemo(() => [
    // Deep links land straight in EDIT mode on the right section — never on
    // the read-only page with an Edit button to hunt for.
    { key: "billingAddress",     label: "Billing address",  icon: MapPin,      done: Boolean(user?.billingAddress),     href: "/profile?edit=1&section=business",  hint: "Appears on every invoice" },
    { key: "panNumber",          label: "PAN number",       icon: FileText,    done: Boolean(user?.panNumber),          href: "/profile?edit=1&section=business",  hint: "Required for contracts & GST" },
    { key: "digitalSignature",   label: "Digital signature",icon: PenTool,     done: Boolean(user?.digitalSignature),   href: "/profile?edit=1&section=signature", hint: "Auto-applied on agreements" },
    { key: "bank",               label: "Bank details",     icon: Landmark,    done: Boolean(user?.accountNumber && user?.ifscCode && user?.accountHolderName), href: "/profile?edit=1&section=bank", hint: "So brands can pay you" },
  ], [user?.billingAddress, user?.panNumber, user?.digitalSignature, user?.accountNumber, user?.ifscCode, user?.accountHolderName]);

  const profileDone = profileChecklist.filter(i => i.done).length;
  const profileTotal = profileChecklist.length;
  const profilePct = Math.round((profileDone / profileTotal) * 100);
  const profileIncomplete = profileChecklist.filter(i => !i.done);

  // Dismiss state — reappears after 24 hours or if user completes a step
  const DISMISS_KEY = "profileNudgeDismissedAt";
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  useEffect(() => {
    const ts = localStorage.getItem(DISMISS_KEY);
    if (ts && Date.now() - parseInt(ts, 10) < 24 * 60 * 60 * 1000) {
      setNudgeDismissed(true);
    }
  }, []);
  const dismissNudge = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setNudgeDismissed(true);
  };

  const showProfileNudge = profileDone < profileTotal && !nudgeDismissed;

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    window.location.href = "/";
  };

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
          </div>
          <div className="flex items-center gap-2 lg:gap-3">
            <Link href="/deals/new" className="hidden lg:block">
              <Button size="sm" className="gradient-btn text-white font-semibold" data-testid="header-new-deal">
                <Plus className="w-4 h-4 mr-1.5" />
                New Deal
              </Button>
            </Link>
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
              data-testid="button-logout"
              className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 lg:hidden"
            >
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="px-4 py-5 space-y-6 animate-fade-in lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-6 lg:space-y-5 xl:px-10">

        {/* ── Profile completion nudge — top priority before any action ── */}
        {showProfileNudge && (
          <Card className="border-amber-200/70 dark:border-amber-900/40 bg-gradient-to-br from-amber-50 via-orange-50/40 to-white dark:from-amber-950/30 dark:via-orange-950/20 dark:to-transparent relative overflow-hidden">
            <CardContent className="p-4 lg:p-6">
              <div className="flex items-start justify-between gap-3 mb-3 lg:mb-4">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="flex-shrink-0 w-9 h-9 lg:w-11 lg:h-11 rounded-xl bg-amber-500/15 flex items-center justify-center">
                    <UserCircle className="w-4 h-4 lg:w-5 lg:h-5 text-amber-700 dark:text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="text-sm lg:text-base font-bold text-foreground">
                        Finish your profile{" "}
                        <span className="text-amber-700 dark:text-amber-400 tabular-nums">
                          ({profileDone}/{profileTotal})
                        </span>
                      </h3>
                      <span className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-800 dark:text-amber-300">
                        <Sparkles className="w-2.5 h-2.5" />
                        Quick win
                      </span>
                    </div>
                    <p className="text-xs lg:text-sm text-muted-foreground leading-snug">
                      Add these so your first deal, contract & invoice go through without interruption.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={dismissNudge}
                  className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground/70 hover:text-foreground hover:bg-foreground/5 transition-colors"
                  aria-label="Dismiss for now"
                  data-testid="dismiss-profile-nudge"
                >
                  <XIcon className="w-4 h-4" />
                </button>
              </div>

              {/* Progress bar */}
              <div className="w-full h-1.5 lg:h-2 rounded-full bg-amber-200/50 dark:bg-amber-900/40 overflow-hidden mb-3 lg:mb-4">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-700"
                  style={{ width: `${profilePct}%` }}
                />
              </div>

              {/* Checklist — 2x2 on mobile, 4-col on lg */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3">
                {profileChecklist.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link key={item.key} href={item.href}>
                      <button
                        type="button"
                        className={`w-full text-left rounded-xl border p-2.5 lg:p-3 transition-all ${
                          item.done
                            ? "border-emerald-300/60 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                            : "border-amber-300/60 bg-white/70 dark:border-amber-900/40 dark:bg-amber-950/10 hover:border-amber-400 hover:shadow-sm cursor-pointer"
                        }`}
                        data-testid={`profile-item-${item.key}`}
                      >
                        <div className="flex items-center gap-2 mb-1 lg:mb-1.5">
                          <div className={`w-6 h-6 lg:w-7 lg:h-7 rounded-md flex items-center justify-center ${
                            item.done
                              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                              : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                          }`}>
                            {item.done ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                          </div>
                          <span className="text-[11px] lg:text-xs font-semibold text-foreground truncate">
                            {item.label}
                          </span>
                        </div>
                        <p className={`text-[10px] lg:text-[11px] leading-snug pl-8 lg:pl-9 line-clamp-2 ${
                          item.done ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"
                        }`}>
                          {item.done ? "✓ All set" : item.hint}
                        </p>
                      </button>
                    </Link>
                  );
                })}
              </div>

              {/* Primary CTA — go directly to first incomplete item */}
              {profileIncomplete.length > 0 && (
                <Link href={profileIncomplete[0].href}>
                  <Button
                    size="sm"
                    className="mt-3 lg:mt-4 w-full sm:w-auto gradient-btn text-white"
                    data-testid="complete-profile-cta"
                  >
                    Complete {profileIncomplete[0].label.toLowerCase()}
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Plan ── */}
        <SubscriptionCard user={user} />
        <TeamSeatsCard />

        {/* ── Quick Actions — the six most common jumps, one tap away ── */}
        <section className="grid grid-cols-3 lg:grid-cols-6 gap-2 lg:gap-3" aria-label="Quick actions">
          {([
            { label: "New Deal", icon: Plus, href: "/deals/new", chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", primary: true, perm: "deals.create" },
            { label: "Quotation", icon: FileText, href: "/deals", chip: "bg-teal-500/15 text-teal-600 dark:text-teal-400", perm: "quotations.create" },
            { label: "Agreement", icon: FileSignature, href: "/deals", chip: "bg-blue-500/15 text-blue-600 dark:text-blue-400", perm: "agreements.create" },
            { label: "Invoice", icon: Receipt, href: "/contracts", chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400", perm: "invoices.create" },
            { label: "Invite", icon: UserPlus2, href: "/settings", chip: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400", perm: "team.invite" },
            { label: "Plan", icon: Crown, href: "/pricing", chip: "bg-slate-500/15 text-slate-600 dark:text-slate-300", perm: null },
          ] as const)
            .filter((a) => !a.perm || memberCan(user as any, a.perm as any))
            .map((a) => (
            <Link key={a.label} href={a.href}>
              <button
                type="button"
                className={`w-full flex flex-col items-center gap-1.5 rounded-2xl lg:rounded-xl border p-3 lg:p-3.5 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md ${
                  (a as any).primary
                    ? "border-emerald-300/60 dark:border-emerald-800/60 bg-gradient-to-b from-emerald-500/[0.08] to-transparent hover:border-emerald-400/70"
                    : "border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 hover:border-primary/40"
                }`}
                data-testid={`qa-${a.label.toLowerCase().replace(" ", "-")}`}
              >
                <span className={`flex items-center justify-center w-9 h-9 lg:w-8 lg:h-8 rounded-xl ${a.chip}`}>
                  <a.icon className="w-4 h-4" strokeWidth={2.2} />
                </span>
                <span className="text-[11px] lg:text-xs font-semibold text-foreground">{a.label}</span>
              </button>
            </Link>
          ))}
        </section>

        <MoneyRadarCard />

        {/* ── Stat cards — the funnel, in order: deal → quote → agreement →
            invoice → money ── */}
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-3 lg:gap-4">
          <StatCard title="Deals" value={totalDeals} icon={Briefcase}
            tone="amber" href="/deals" loading={isLoading}
            sub={dealsThisMonth > 0 ? `${dealsThisMonth} this month` : totalDeals > 0 ? "in your pipeline" : "none yet"}
            trendUp={dealsThisMonth > 0} />
          <StatCard title="Quotations" value={quotes.length} icon={FileText}
            tone="slate" href="/quotations" loading={isLoading}
            sub={quotesThisMonth > 0 ? `${quotesThisMonth} this month` : quotes.length > 0 ? "issued so far" : "none yet"}
            trendUp={quotesThisMonth > 0} />
          <StatCard title="Agreements" value={signedContracts} icon={FileCheck}
            tone="blue" href="/contracts" loading={isLoading}
            sub={allSigned ? "All signed" : signedContracts > 0 ? `${signedContracts} signed` : "none yet"} />
          <StatCard title="Paid Invoices" value={paidInvoices} icon={Receipt}
            tone="emerald" href="/invoices" loading={isLoading}
            sub={paidThisWeek > 0 ? `${paidThisWeek} this week` : paidInvoices > 0 ? "all settled" : "none yet"}
            trendUp={paidThisWeek > 0} />
          <StatCard
            title="Pipeline Value"
            value={totalRevenue + pendingRevenue}
            format={(n) => `₹${n.toLocaleString("en-IN")}`}
            icon={IndianRupee}
            tone="slate"
            href="/deals"
            loading={isLoading}
            sub={`${activeDealsCount} active deal${activeDealsCount !== 1 ? "s" : ""}`}
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

        {/* ── Revenue summary strip — money reads as money: tinted tiles ── */}
        {!isLoading && (totalRevenue > 0 || pendingRevenue > 0) && (
          <div className="grid grid-cols-2 gap-3 lg:gap-5">
            <MoneyTile
              label="Earned"
              amount={totalRevenue}
              icon={TrendingUp}
              tint="emerald"
            />
            <MoneyTile
              label="Pending"
              amount={pendingRevenue}
              icon={Clock}
              tint="amber"
            />
          </div>
        )}

        {/* ── Analytics: trend + activity + conversion. Palette
            #059669/#F59E0B validated (CVD + normal-vision pass); counts
            share one axis, money gets its own chart — never dual axes. ── */}
        {!isLoading && (() => {
          const revenue = buildRevenueOverTime(deals);
          const activity = buildMonthlyActivity(deals, quotes);
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
                    <CardTitle className="text-sm lg:text-base font-semibold">Revenue Trend</CardTitle>
                    <p className="text-[11px] lg:text-xs text-muted-foreground mt-0.5">Deal value by start month · last 6 months</p>
                  </CardHeader>
                  <CardContent className="px-2 pb-4 lg:px-4 lg:pb-6">
                    {!revenue.some((r) => r.amount > 0) ? (
                      <ChartEmpty
                        icon={TrendingUp}
                        title="No revenue yet"
                        hint="Your deal values chart here month by month once you create your first deal."
                        cta={
                          <Link href="/deals/new">
                            <Button size="sm" className="gradient-btn text-white h-8 text-xs font-semibold">
                              <Plus className="w-3.5 h-3.5 mr-1" /> New Deal
                            </Button>
                          </Link>
                        }
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
                            tickFormatter={(v: number) => (v >= 100000 ? `${(v / 100000).toFixed(v % 100000 ? 1 : 0)}L` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                          <Tooltip content={<CustomTooltip prefix="₹" />} />
                          <Area type="monotone" dataKey="amount" name="Revenue" stroke="#059669" strokeWidth={2}
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
                      <CardTitle className="text-sm lg:text-base font-semibold">Monthly Activity</CardTitle>
                      <span className="flex items-center gap-3 text-[10px] font-medium text-muted-foreground">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[#059669]" /> Deals</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[#F59E0B]" /> Quotes</span>
                      </span>
                    </div>
                    <p className="text-[11px] lg:text-xs text-muted-foreground mt-0.5">Created per month · last 6 months</p>
                  </CardHeader>
                  <CardContent className="px-2 pb-4 lg:px-4 lg:pb-6">
                    {!activity.some((m) => m.deals + m.quotations > 0) ? (
                      <ChartEmpty
                        icon={Briefcase}
                        title="Nothing this half-year"
                        hint="Deals you create and quotations you generate are counted here by month."
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
                      <h3 className="text-sm lg:text-base font-semibold text-foreground">Pipeline Conversion</h3>
                      <p className="text-[11px] lg:text-xs text-muted-foreground mt-0.5">How deals progress through the workflow</p>
                    </div>
                    <ArrowUpRight className="w-4 h-4 text-muted-foreground/50 hidden lg:block" />
                  </div>
                  {totalDeals === 0 ? (
                    <ChartEmpty
                      compact
                      icon={FileCheck}
                      title="Your pipeline starts with a deal"
                      hint="Deal → Quotation → Agreement → Invoice → Paid. Conversion between stages shows here."
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

        {/* ── Charts (only shown when there's data) ── */}
        {deals.length > 0 && (
          <>

            {/* Bottom row — Platform bar (wide) + Invoice Money pie (compact) */}
            {(platformDist.length > 0 || brandInvoices.length > 0) && (() => {
              const paidValue = brandInvoices
                .filter(bi => bi.status === "Paid")
                .reduce((s, bi) => s + Number(bi.dealAmount || 0), 0);
              const unpaidValue = brandInvoices
                .filter(bi => bi.status !== "Paid")
                .reduce((s, bi) => s + Number(bi.dealAmount || 0), 0);
              const totalInvoiceValue = paidValue + unpaidValue;
              const paidCount = brandInvoices.filter(bi => bi.status === "Paid").length;
              const unpaidCount = brandInvoices.length - paidCount;
              const moneyPie = totalInvoiceValue > 0
                ? [
                    { name: "Received", value: paidValue, fill: "#10B981", count: paidCount },
                    { name: "Pending",  value: unpaidValue, fill: "#F59E0B", count: unpaidCount },
                  ].filter(s => s.value > 0)
                : [];
              return (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 lg:gap-5">
                  {/* Platform bar — wider (2/3 on desktop) */}
                  {platformDist.length > 0 && (
                    <Card className="glass-card border-0 lg:col-span-2">
                      <CardHeader className="pb-1 px-4 pt-4 lg:px-6 lg:pt-6">
                        <CardTitle className="text-sm lg:text-base font-semibold">Deliverables by Category</CardTitle>
                        <p className="text-[11px] lg:text-xs text-muted-foreground mt-0.5">Deliverables across platforms / categories</p>
                      </CardHeader>
                      <CardContent className="px-2 pb-4 lg:px-4 lg:pb-6">
                        <div className="h-[180px] sm:h-[200px] lg:h-[220px] xl:h-[240px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={platformDist} margin={{ top: 10, right: 15, left: -10, bottom: 0 }}>
                              {/* theme-aware grid — a white grid is invisible on the light theme */}
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.6)" vertical={false} />
                              <XAxis dataKey="platform" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                                axisLine={false} tickLine={false} />
                              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                                axisLine={false} tickLine={false} />
                              <Tooltip content={<CustomTooltip />} />
                              <Bar dataKey="count" name="Deliverables" radius={[6, 6, 0, 0]} maxBarSize={64}>
                                {platformDist.map((entry, i) => (
                                  <Cell key={i} fill={colorForPlatform(entry.platform, i)} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Invoice Money status pie — narrow (1/3 on desktop) */}
                  {moneyPie.length > 0 && (
                    <Card className="glass-card border-0">
                      <CardHeader className="pb-1 px-4 pt-4 lg:px-6 lg:pt-6">
                        <CardTitle className="text-sm lg:text-base font-semibold">Invoice Status</CardTitle>
                        <p className="text-[11px] lg:text-xs text-muted-foreground mt-0.5">
                          Invoices by amount · {brandInvoices.length} total
                        </p>
                      </CardHeader>
                      <CardContent className="px-2 pb-4 lg:px-4 lg:pb-6">
                        <div className="relative h-[180px] sm:h-[200px] lg:h-[210px] xl:h-[230px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={moneyPie}
                                cx="50%"
                                cy="50%"
                                innerRadius="56%"
                                outerRadius="86%"
                                dataKey="value"
                                nameKey="name"
                                paddingAngle={2}
                                stroke="none"
                              >
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
                                      <p className="font-bold text-foreground">₹{Number(d.value).toLocaleString("en-IN")}</p>
                                      <p className="text-muted-foreground">{d.count} invoice{d.count !== 1 ? "s" : ""}</p>
                                    </div>
                                  );
                                }}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                          {/* Center label — total amount */}
                          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                            <span className="text-[10px] lg:text-xs uppercase tracking-wider font-semibold text-muted-foreground">
                              Total billed
                            </span>
                            <span className="text-lg lg:text-2xl font-bold text-foreground leading-tight">
                              ₹{(totalInvoiceValue / 100000).toFixed(1) === (totalInvoiceValue / 100000).toFixed(0)
                                ? totalInvoiceValue.toLocaleString("en-IN")
                                : `${(totalInvoiceValue / 100000).toFixed(1)}L`}
                            </span>
                          </div>
                        </div>
                        {/* Legend strip below */}
                        <div className="flex items-center justify-between gap-3 mt-3 px-1 lg:px-2 text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground truncate">Received</p>
                              <p className="text-[10px] text-muted-foreground">
                                ₹{paidValue.toLocaleString("en-IN")}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground truncate">Pending</p>
                              <p className="text-[10px] text-muted-foreground">
                                ₹{unpaidValue.toLocaleString("en-IN")}
                              </p>
                            </div>
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
                        style={{ backgroundColor: colorForPlatform(item.platform, i) }}
                      />
                      <span className="text-xs font-medium w-20 truncate">{item.platform}</span>
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: colorForPlatform(item.platform, i),
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

        {/* ── Recent Deals — one divided list, not three stacked cards ── */}
        {recentDeals.length > 0 && (
          <Card className="glass-card border-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-4 pb-2 lg:px-5 lg:pt-5">
              <div>
                <h2 className="text-sm lg:text-base font-semibold text-foreground">Recent Deals</h2>
                <p className="text-[11px] lg:text-xs text-muted-foreground mt-0.5">Your latest pipeline activity</p>
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
                        ₹{Number(deal.dealAmount).toLocaleString("en-IN")}
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
