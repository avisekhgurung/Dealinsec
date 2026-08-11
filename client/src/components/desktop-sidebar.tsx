/**
 * Desktop sidebar — brand-emerald surface + collapsible icon rail.
 *
 * Collapse state is stamped on <html data-sidebar="collapsed"> by the inline
 * bootstrap in index.html BEFORE first paint; this component reads the DOM
 * (never localStorage directly) so hydration can't flash. The width lives in
 * --dis-sidebar-w, shared with .app-shell's padding so rail and content tween
 * together. Keyboard shortcut: `[` (not Cmd/Ctrl+B — the app has
 * contenteditable surfaces that need bracket keys free of modifier baggage).
 */
import { useCallback, useEffect, useReducer, useState } from "react";
import { useLocation, Link } from "wouter";
import {
  Home,
  Briefcase,
  FileCheck,
  Receipt,
  FileText,
  UserCircle,
  Settings,
  LogOut,
  Sparkles,
  ChevronRight,
  Crown,
  CreditCard,
  PanelLeftClose,
  PanelLeftOpen,
  Users,
  Zap,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { DealinsecLogo } from "@/components/dealinsec-logo";
import { NotificationBell } from "@/components/notification-bell";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  hasActivePro,
  hasActiveDealBoost,
  hasActiveTrial,
  hasLapsedTrial,
  getTrialDaysLeft,
  TRIAL_DAYS,
} from "@shared/schema";
import { canSeeModule } from "@shared/permissions";

interface NavItem {
  path: string;
  label: string;
  icon: typeof Home;
  description?: string;
  /** Module key — hidden for custom roles with no permission in it. */
  module?: "deals" | "quotations" | "agreements" | "invoices";
}

const PRIMARY_NAV: NavItem[] = [
  { path: "/dashboard", label: "Dashboard", icon: Home, description: "Overview & KPIs" },
  { path: "/deals", label: "Deals", icon: Briefcase, description: "Pipeline & clients", module: "deals" },
  { path: "/quotations", label: "Quotations", icon: FileText, description: "Issued quotes", module: "quotations" },
  { path: "/contracts", label: "Agreements", icon: FileCheck, description: "Signed contracts", module: "agreements" },
  { path: "/invoices", label: "Invoices", icon: Receipt, description: "Billing & payments", module: "invoices" },
];

const SECONDARY_NAV: NavItem[] = [
  { path: "/settings", label: "Settings", icon: Settings },
  { path: "/profile", label: "Profile", icon: UserCircle },
  { path: "/pricing", label: "Pricing", icon: CreditCard },
];

/** Plan-card lifecycle states, resolved strictly in this order. */
type PlanState =
  | "MEMBER"        // orgRole ≠ OWNER — plan is the owner's business, no CTA
  | "PRO"           // paid — always wins over a parallel unexpired trial
  | "TRIAL_ACTIVE"  // 4–7 days left
  | "TRIAL_ENDING"  // 1–3 days left
  | "BOOST"         // ₹99 Deal Boost active
  | "TRIAL_ENDED"   // lived a real trial, let it lapse — highest-intent moment
  | "FREE";

/** Tooltip that exists ONLY in the collapsed rail — in the expanded state the
 *  visible label would be duplicated. */
function RailTip({
  show, label, children,
}: { show: boolean; label: string; children: React.ReactNode }) {
  if (!show) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} className="text-xs font-medium">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/** 7-segment day pips — discrete days read better than a continuous bar. */
function TrialPips({ daysLeft, tone }: { daysLeft: number; tone: "emerald" | "amber" }) {
  return (
    <div className="mt-2 flex gap-1" aria-hidden="true">
      {Array.from({ length: TRIAL_DAYS }, (_, i) => (
        <span
          key={i}
          className={`h-1 flex-1 rounded-full ${
            i < daysLeft
              ? tone === "emerald" ? "bg-emerald-500" : "bg-amber-500"
              : "bg-sidebar-border"
          }`}
        />
      ))}
    </div>
  );
}

export function DesktopSidebar() {
  const [location, setLocation] = useLocation();
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();

  // Read the attribute the index.html bootstrap wrote — the DOM is the source
  // of truth, so first render matches the pre-paint state exactly.
  const [collapsed, setCollapsed] = useState(
    () => typeof document !== "undefined"
      && document.documentElement.getAttribute("data-sidebar") === "collapsed",
  );

  const toggle = useCallback(() => {
    const next = document.documentElement.getAttribute("data-sidebar") !== "collapsed";
    if (next) document.documentElement.setAttribute("data-sidebar", "collapsed");
    else document.documentElement.removeAttribute("data-sidebar");
    try { localStorage.setItem("dis_sidebar_collapsed", next ? "1" : "0"); } catch {}
    setCollapsed(next);
  }, []);
  // NOTE: no unmount cleanup on purpose — removing the attribute would snap
  // the shell 288→72px when navigating through a full-bleed route and back.

  // `[` toggles the rail. Guarded against every text-entry surface and
  // anything portal-layered; inert below lg where the sidebar is hidden.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (window.innerWidth < 1024) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (t.isContentEditable) return;
        if (t.closest('[contenteditable="true"],[role="combobox"],[role="dialog"],[role="menu"],[role="listbox"]')) return;
      }
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  // Hourly tick so a trial countdown left open overnight stays honest —
  // deliberately NOT a refetchInterval on useAuth.
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const id = setInterval(tick, 3_600_000);
    return () => clearInterval(id);
  }, []);

  // Hide sidebar entirely if not logged in (landing/onboarding/marketing routes)
  if (!isAuthenticated) return null;

  const proActive = hasActivePro(user);
  const boostActive = hasActiveDealBoost(user);
  const trialDaysLeft = getTrialDaysLeft(user);
  const firstName = user?.firstName ?? "";
  const lastName = user?.lastName ?? "";
  const displayName = [firstName, lastName].filter(Boolean).join(" ") || user?.email || "User";
  const initials = (firstName[0] ?? "") + (lastName[0] ?? "") || (user?.email?.[0]?.toUpperCase() ?? "U");

  // Org members see the owner's entitlements (additive field on /api/auth/user).
  const entitlements = (user as any)?.entitlements as
    | { pro?: boolean; trial?: boolean; trialDaysLeft?: number }
    | undefined;

  const planState: PlanState =
    user && user.orgRole !== "OWNER" ? "MEMBER"
    : proActive ? "PRO"
    : trialDaysLeft >= 4 ? "TRIAL_ACTIVE"
    : trialDaysLeft >= 1 ? "TRIAL_ENDING"
    : boostActive ? "BOOST"
    : hasLapsedTrial(user) ? "TRIAL_ENDED"
    : "FREE";

  const isActive = (path: string) => {
    // Quotation documents live at /deals/:id/quote but BELONG to the
    // Quotations section — highlight that, not Deals.
    if (/^\/deals\/[^/]+\/quote/.test(location)) return path === "/quotations";
    return location === path || (path !== "/" && location.startsWith(path));
  };

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout", {});
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/");
    } catch {
      toast({ title: "Logout failed", description: "Please try again", variant: "destructive" });
    }
  };

  // Shared row treatment. transition-colors ONLY — transition-all would fight
  // the rail's width tween. hover-elevate is off-limits here (its ::after at
  // z-index:999 would cover the active-edge marker).
  const rowClass = (active: boolean) =>
    `relative w-full flex items-center gap-3 px-2.5 rounded-[10px] transition-colors duration-150 group ` +
    `focus-visible:!rounded-[10px] focus-visible:outline-[hsl(var(--sidebar-ring))] ` +
    (active
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/55 hover:text-sidebar-foreground");

  const labelClass =
    `min-w-0 flex-1 text-left whitespace-nowrap transition-[opacity,transform] duration-150 ` +
    (collapsed ? "opacity-0 -translate-x-1" : "opacity-100 translate-x-0 delay-[90ms]");

  const edgeMarker = (
    <span
      aria-hidden="true"
      className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-gradient-to-b from-emerald-400 to-teal-500"
    />
  );

  const toggleButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls="dis-nav-workspace"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          data-testid="sidebar-toggle"
          className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/55 transition-colors duration-150 focus-visible:!rounded-[10px] focus-visible:outline-[hsl(var(--sidebar-ring))]"
        >
          {collapsed
            ? <PanelLeftOpen className="w-4 h-4" strokeWidth={2} />
            : <PanelLeftClose className="w-4 h-4" strokeWidth={2} />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} className="flex items-center gap-2 text-xs font-medium">
        {collapsed ? "Expand sidebar" : "Collapse sidebar"}
        <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted font-mono text-[10px] leading-none">[</kbd>
      </TooltipContent>
    </Tooltip>
  );

  // ── Plan card (7 lifecycle states) ──
  const planCard = () => {
    if (collapsed) {
      // 40×40 tile. Trial states carry the NUMERAL — the number is the payload.
      const tile = (inner: React.ReactNode, cls: string, label: string, link = true) => (
        <RailTip show label={label}>
          {link ? (
            <Link
              href="/pricing"
              data-testid="sidebar-plan-card"
              aria-label={label}
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors duration-150 focus-visible:!rounded-xl focus-visible:outline-[hsl(var(--sidebar-ring))] ${cls}`}
            >
              {inner}
            </Link>
          ) : (
            <div data-testid="sidebar-plan-card" aria-label={label} className={`w-10 h-10 rounded-xl flex items-center justify-center ${cls}`}>
              {inner}
            </div>
          )}
        </RailTip>
      );
      switch (planState) {
        case "MEMBER":
          return tile(<Users className="w-4 h-4" strokeWidth={2} />, "border border-sidebar-border text-muted-foreground", "Plan managed by your organization owner", false);
        case "PRO":
          return tile(<Crown className="w-4 h-4 text-amber-400" strokeWidth={2.25} />, "bg-sidebar-primary text-sidebar-primary-foreground", "DealInSec Pro — manage plan");
        case "TRIAL_ACTIVE":
          return tile(<span className="text-sm font-bold tabular-nums">{trialDaysLeft}</span>, "border border-emerald-300/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", `Pro trial — ${trialDaysLeft} days left`);
        case "TRIAL_ENDING":
          return tile(<span className="text-sm font-bold tabular-nums">{trialDaysLeft}</span>, "border border-amber-300/60 bg-amber-500/10 text-amber-700 dark:text-amber-400", trialDaysLeft === 1 ? "Pro trial — last day" : `Pro trial — ${trialDaysLeft} days left`);
        case "BOOST":
          return tile(<Zap className="w-4 h-4" strokeWidth={2.25} />, "border border-orange-300/60 bg-orange-500/10 text-orange-600 dark:text-orange-400", "Deal Boost active — manage plan");
        case "TRIAL_ENDED":
          return tile(<Sparkles className="w-4 h-4" strokeWidth={2.25} />, "border border-rose-300/60 bg-rose-500/10 text-rose-600 dark:text-rose-400", "Trial ended — upgrade to Pro");
        case "FREE":
          return tile(<Sparkles className="w-4 h-4" strokeWidth={2} />, "border border-sidebar-border text-emerald-700 dark:text-emerald-400 hover:bg-sidebar-accent/55", "Free plan — upgrade to Pro");
      }
    }

    const cardBase =
      "block w-full rounded-xl p-3.5 transition-colors duration-150 focus-visible:!rounded-xl focus-visible:outline-[hsl(var(--sidebar-ring))]";
    const header = (label: string, labelCls: string, icon: React.ReactNode) => (
      <div className="flex items-center justify-between mb-2">
        <span className={`text-[10px] font-bold uppercase tracking-[0.08em] ${labelCls}`}>{label}</span>
        {icon}
      </div>
    );
    const manageRow = (text: string, cls: string) => (
      <div className={`mt-2 flex items-center justify-between text-[11px] font-medium ${cls}`}>
        <span>{text}</span>
        <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
      </div>
    );

    switch (planState) {
      case "MEMBER":
        // A SALES/ACCOUNTS/ADMIN member can't act on billing — no CTA, no link.
        return (
          <div data-testid="sidebar-plan-card" className="w-full rounded-xl border border-sidebar-border bg-sidebar-accent/30 p-3.5">
            {header("Team plan", "text-muted-foreground", <Users className="w-3.5 h-3.5 text-muted-foreground" />)}
            <span className="text-lg font-bold text-foreground">
              {entitlements?.pro ? "DealInSec Pro" : entitlements?.trial ? "Pro trial" : "Free"}
            </span>
            <div className="mt-1.5 text-[11px] text-muted-foreground leading-snug">
              Managed by your organization owner
            </div>
          </div>
        );
      case "PRO":
        return (
          <Link href="/pricing" data-testid="sidebar-plan-card" className={`${cardBase} group border border-emerald-300/60 dark:border-emerald-800/60 bg-gradient-to-br from-emerald-500/[0.08] via-background to-background hover:border-emerald-400/70`}>
            {header("DealInSec Pro", "text-emerald-700 dark:text-emerald-400", <Crown className="w-3.5 h-3.5 text-amber-400" />)}
            <span className="text-2xl font-bold text-foreground">Unlimited</span>
            {manageRow("Manage plan", "text-emerald-700 dark:text-emerald-400")}
          </Link>
        );
      case "TRIAL_ACTIVE":
        return (
          <Link href="/pricing" data-testid="sidebar-plan-card" className={`${cardBase} group border border-emerald-300/60 dark:border-emerald-800/60 bg-gradient-to-br from-emerald-500/[0.07] via-background to-background hover:border-emerald-400/70`}>
            {header("Pro trial", "text-emerald-700 dark:text-emerald-400", <Sparkles className="w-3.5 h-3.5 text-emerald-500" />)}
            <span className="text-lg font-bold text-foreground tabular-nums">{trialDaysLeft} days left</span>
            <TrialPips daysLeft={trialDaysLeft} tone="emerald" />
            {manageRow("Everything unlocked", "text-emerald-700 dark:text-emerald-400")}
          </Link>
        );
      case "TRIAL_ENDING":
        return (
          <Link href="/pricing" data-testid="sidebar-plan-card" className={`${cardBase} group border border-amber-300/70 dark:border-amber-800/60 bg-gradient-to-br from-amber-500/[0.08] via-background to-background hover:border-amber-400/70`}>
            {header("Pro trial", "text-amber-700 dark:text-amber-400", <Sparkles className="w-3.5 h-3.5 text-amber-500" />)}
            <span className="text-lg font-bold text-foreground tabular-nums">
              {trialDaysLeft === 1 ? "Last day" : `${trialDaysLeft} days left`}
            </span>
            <TrialPips daysLeft={trialDaysLeft} tone="amber" />
            {manageRow("Keep Pro — see plans", "text-amber-700 dark:text-amber-400")}
          </Link>
        );
      case "BOOST":
        return (
          <Link href="/pricing" data-testid="sidebar-plan-card" className={`${cardBase} group border border-orange-300/60 dark:border-orange-800/60 bg-gradient-to-br from-orange-500/[0.07] via-background to-background hover:border-orange-400/70`}>
            {header("Deal Boost", "text-orange-700 dark:text-orange-400", <Zap className="w-3.5 h-3.5 text-orange-500" />)}
            <span className="text-lg font-bold text-foreground">Unlimited deals</span>
            {manageRow("Upgrade to Pro", "text-orange-700 dark:text-orange-400")}
          </Link>
        );
      case "TRIAL_ENDED":
        // The single highest-intent moment in the lifecycle — the only state
        // with a filled CTA.
        return (
          <Link href="/pricing" data-testid="sidebar-plan-card" className={`${cardBase} group border border-rose-300/60 dark:border-rose-900/60 bg-gradient-to-br from-rose-500/[0.06] via-background to-background hover:border-rose-400/70`}>
            {header("Trial ended", "text-rose-600 dark:text-rose-400", <Sparkles className="w-3.5 h-3.5 text-rose-500" />)}
            <div className="text-[12px] text-muted-foreground leading-snug mb-2.5">
              Your 7-day trial has ended. Your deals and documents are safe.
            </div>
            <span className="gradient-btn block w-full text-center text-[12px] font-semibold text-white rounded-lg py-2">
              Upgrade to Pro — ₹999/mo
            </span>
          </Link>
        );
      case "FREE":
        return (
          <Link href="/pricing" data-testid="sidebar-plan-card" className={`${cardBase} group border border-sidebar-border bg-gradient-to-br from-primary/[0.06] via-background to-background hover:border-primary/40`}>
            {header("Your plan", "text-muted-foreground", <Sparkles className="w-3.5 h-3.5 text-primary" />)}
            <span className="text-lg font-bold text-foreground">Free</span>
            {manageRow("Upgrade to Pro", "text-primary")}
          </Link>
        );
    }
  };

  const renderNavItem = (item: NavItem, primary: boolean) => {
    const active = isActive(item.path);
    const Icon = item.icon;
    return (
      <li key={item.path}>
        <RailTip show={collapsed} label={item.label}>
          <Link
            href={item.path}
            data-testid={`sidebar-${item.label.toLowerCase()}`}
            aria-current={active ? "page" : undefined}
            className={`${rowClass(active)} ${primary ? "py-2" : "py-1.5"}`}
          >
            {active && edgeMarker}
            <span
              className={`flex items-center justify-center w-7 h-7 rounded-md shrink-0 transition-colors duration-150 ${
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-muted-foreground group-hover:text-sidebar-foreground"
              }`}
            >
              <Icon className="w-4 h-4" strokeWidth={active ? 2.25 : 1.85} />
            </span>
            <span className={labelClass}>
              <span className={`block text-sm leading-tight ${active ? "font-semibold" : "font-medium"}`}>
                {item.label}
              </span>
              {primary && item.description && (
                <span className="block text-[10.5px] text-muted-foreground/80 leading-tight mt-0.5">
                  {item.description}
                </span>
              )}
            </span>
          </Link>
        </RailTip>
      </li>
    );
  };

  return (
    <aside
      aria-label="Primary navigation"
      data-collapsed={collapsed ? "true" : "false"}
      className="hidden lg:flex fixed inset-y-0 left-0 z-30 flex-col dis-sidebar w-[var(--dis-sidebar-w)] transition-[width] duration-[220ms] ease-[cubic-bezier(0.4,0,0.2,1)] overflow-x-hidden"
    >
      {/* App-level TooltipProvider uses Radix's 700ms default — far too slow
          when the tooltip IS the label. */}
      <TooltipProvider delayDuration={120} skipDelayDuration={400} disableHoverableContent>
        {/* ── Logo + notifications + collapse toggle ── */}
        {collapsed ? (
          <div className="flex flex-col items-center gap-1 pt-4 pb-2 border-b border-sidebar-border">
            <Link
              href="/dashboard"
              aria-label="Dashboard"
              className="flex items-center justify-center h-9 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-md"
            >
              <DealinsecLogo size="sm" withText={false} />
            </Link>
            <div className="flex items-center justify-center h-10">{toggleButton}</div>
            <NotificationBell />
          </div>
        ) : (
          <div className="h-16 flex items-center justify-between gap-2 pl-5 pr-3 border-b border-sidebar-border">
            <Link
              href="/dashboard"
              className="outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-md"
            >
              <DealinsecLogo size="sm" />
            </Link>
            <div className="flex items-center gap-0.5">
              <NotificationBell />
              {toggleButton}
            </div>
          </div>
        )}

        {/* ── Plan card ── */}
        <div className={collapsed ? "pt-4 flex justify-center" : "px-4 pt-5"}>
          {planCard()}
        </div>

        {/* ── Nav ── */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 pt-6">
          <nav aria-label="Workspace" id="dis-nav-workspace">
            {!collapsed && (
              <div className="px-2 mb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground/80">
                  Workspace
                </span>
              </div>
            )}
            <ul className="space-y-0.5">
              {PRIMARY_NAV.filter((i) => !i.module || canSeeModule(user as any, i.module)).map((item) => renderNavItem(item, true))}
            </ul>
          </nav>

          <nav aria-label="Account">
            {collapsed ? (
              <hr aria-hidden="true" className="mx-4 my-3 border-0 h-px bg-sidebar-border/70" />
            ) : (
              <div className="px-2 mt-6 mb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground/80">
                  Account
                </span>
              </div>
            )}
            <ul className="space-y-0.5">
              {SECONDARY_NAV.map((item) => renderNavItem(item, false))}
            </ul>
          </nav>
        </div>

        {/* ── User card → popover (keyboard-reachable logout lives here) ── */}
        <div className={`border-t border-sidebar-border ${collapsed ? "py-3 flex justify-center" : "p-3"}`}>
          <Popover>
            <PopoverTrigger asChild>
              <button
                data-testid="sidebar-user-card"
                aria-label={`Account: ${displayName}`}
                className={`flex items-center gap-3 rounded-[10px] hover:bg-sidebar-accent/55 transition-colors duration-150 focus-visible:!rounded-[10px] focus-visible:outline-[hsl(var(--sidebar-ring))] ${
                  collapsed ? "p-1.5" : "w-full p-2.5 text-left"
                }`}
              >
                <span className="flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-br from-primary to-primary/70 text-white font-bold text-sm shrink-0">
                  {initials.slice(0, 2).toUpperCase()}
                </span>
                {!collapsed && (
                  <span className={labelClass}>
                    <span className="block text-sm font-semibold text-foreground truncate">{displayName}</span>
                    <span className="block text-[11px] text-muted-foreground truncate">{user?.email ?? ""}</span>
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent side="right" align="end" sideOffset={12} className="w-56 p-1.5">
              <div className="px-2.5 py-2">
                <p className="text-sm font-semibold truncate">{displayName}</p>
                <p className="text-[11px] text-muted-foreground truncate">{user?.email ?? ""}</p>
              </div>
              <div className="h-px bg-border my-1" aria-hidden="true" />
              <button
                onClick={handleLogout}
                data-testid="sidebar-logout"
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm font-medium text-rose-600 hover:bg-rose-500/10 transition-colors"
              >
                <LogOut className="w-4 h-4" /> Sign out
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </TooltipProvider>
    </aside>
  );
}
