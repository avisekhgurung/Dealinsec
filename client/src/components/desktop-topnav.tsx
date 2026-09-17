/**
 * Desktop top navigation — a raised, lit bar across the top of the workspace.
 *
 * Replaced the left sidebar (Sep 2026, founder's call): the five workspace
 * sections sit in the bar as tabs, and the account controls sit on the right —
 * plan chip, notifications, settings, the avatar (→ profile) and a Sign out
 * button that is one click, never tucked in a menu (an earlier explicit ask).
 *
 * Height lives in --dis-topnav-h, shared with .app-shell's top padding and the
 * offset every page's own sticky title bar takes (see index.css). Hidden below
 * lg, where the bottom tab bar does this job.
 */
import { useEffect, useReducer } from "react";
import { useLocation, Link } from "wouter";
import {
  Home,
  Briefcase,
  FileCheck,
  Receipt,
  FileText,
  Settings,
  LogOut,
  Sparkles,
  Crown,
  Users,
  Zap,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { DealinsecLogo } from "@/components/dealinsec-logo";
import { NotificationBell } from "@/components/notification-bell";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  hasActivePro,
  hasActiveDealBoost,
  hasLapsedTrial,
  getTrialDaysLeft,
} from "@shared/schema";
import { canSeeModule } from "@shared/permissions";
import { usePlanPrices, formatRupees, usePlanCheckoutAvailable } from "@/hooks/use-plan-prices";

interface NavItem {
  path: string;
  label: string;
  icon: typeof Home;
  /** Module key — hidden for custom roles with no permission in it. */
  module?: "deals" | "quotations" | "agreements" | "invoices";
}

const NAV: NavItem[] = [
  { path: "/dashboard", label: "Dashboard", icon: Home },
  { path: "/deals", label: "Deals", icon: Briefcase, module: "deals" },
  { path: "/quotations", label: "Quotations", icon: FileText, module: "quotations" },
  { path: "/contracts", label: "Agreements", icon: FileCheck, module: "agreements" },
  { path: "/invoices", label: "Invoices", icon: Receipt, module: "invoices" },
];

/** Plan lifecycle states, resolved strictly in this order. */
type PlanState =
  | "MEMBER"        // orgRole ≠ OWNER — plan is the owner's business, no CTA
  | "PRO"           // paid — always wins over a parallel unexpired trial
  | "TRIAL_ACTIVE"  // 4–7 days left
  | "TRIAL_ENDING"  // 1–3 days left
  | "BOOST"         // Deal Boost still running (no longer sold)
  | "TRIAL_ENDED"   // lived a real trial, let it lapse — highest-intent moment
  | "FREE";

function BarTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8} className="text-xs font-medium">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

const iconButton =
  "dis-topnav-icon relative flex items-center justify-center w-9 h-9 rounded-[10px] text-white/75 hover:text-white " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300/70";

export function DesktopTopNav() {
  const [location, setLocation] = useLocation();
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();

  // Hourly tick so a trial countdown left open overnight stays honest —
  // deliberately NOT a refetchInterval on useAuth.
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const id = setInterval(tick, 3_600_000);
    return () => clearInterval(id);
  }, []);

  // Above the auth guard so hook order is stable; idle when signed out.
  const { proMonthlyPrice } = usePlanPrices({ enabled: isAuthenticated });
  // No rupee price where no plan can be bought yet (see
  // usePlanCheckoutAvailable). Always true for Indian accounts.
  const checkoutAvailable = usePlanCheckoutAvailable();

  if (!isAuthenticated) return null;

  const trialDaysLeft = getTrialDaysLeft(user);
  const firstName = user?.firstName ?? "";
  const lastName = user?.lastName ?? "";
  const displayName = [firstName, lastName].filter(Boolean).join(" ") || user?.email || "User";
  const initials = ((firstName[0] ?? "") + (lastName[0] ?? "") || (user?.email?.[0] ?? "U")).slice(0, 2).toUpperCase();

  // Org members see the owner's entitlements (additive field on /api/auth/user).
  const entitlements = (user as any)?.entitlements as { pro?: boolean; trial?: boolean } | undefined;

  const planState: PlanState =
    user && user.orgRole !== "OWNER" ? "MEMBER"
    : hasActivePro(user) ? "PRO"
    : trialDaysLeft >= 4 ? "TRIAL_ACTIVE"
    : trialDaysLeft >= 1 ? "TRIAL_ENDING"
    : hasActiveDealBoost(user) ? "BOOST"
    : hasLapsedTrial(user) ? "TRIAL_ENDED"
    : "FREE";

  const isActive = (path: string) => {
    // Quotation documents live at /deals/:id/quote but BELONG to Quotations.
    if (/^\/deals\/[^/]+\/quote/.test(location)) return path === "/quotations";
    // Invoice documents and the composer live under /brand-invoices.
    if (location.startsWith("/brand-invoices")) return path === "/invoices";
    return location === path || location.startsWith(path + "/");
  };

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout", {});
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      // Every other cached answer belonged to the account that just left. This
      // logout stays in the tab (no reload), so without this a different
      // account signing in within minutes read the previous one's /api/org —
      // and useMoney() treats a cached org as `ready`, converting and printing
      // in the wrong currency. The auth query is kept: it now says "signed
      // out", which is what routes the tab.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "/api/auth/user" });
      setLocation("/");
    } catch {
      toast({ title: "Logout failed", description: "Please try again", variant: "destructive" });
    }
  };

  // ── Plan chip: the sidebar's plan card, condensed to one line ──
  const chip = (tone: string, icon: React.ReactNode, text: React.ReactNode, short: React.ReactNode, label: string) => (
    <BarTip label={label}>
      <Link
        href="/pricing"
        data-testid="topnav-plan-chip"
        aria-label={label}
        className={`dis-topnav-chip inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] font-semibold whitespace-nowrap ${tone}`}
      >
        {icon}
        <span className="hidden xl:inline">{text}</span>
        <span className="xl:hidden tabular-nums">{short}</span>
      </Link>
    </BarTip>
  );

  const planChip = () => {
    switch (planState) {
      case "MEMBER":
        return (
          <BarTip label="Plan managed by your organization owner">
            <span
              data-testid="topnav-plan-chip"
              className="dis-topnav-chip inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] font-semibold text-white/75 whitespace-nowrap"
            >
              <Users className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">
                {entitlements?.pro ? "Team · Pro" : entitlements?.trial ? "Team · Pro trial" : "Team · Free"}
              </span>
            </span>
          </BarTip>
        );
      case "PRO":
        return chip("text-amber-100", <Crown className="w-3.5 h-3.5 text-amber-300" />, "DealInSec Pro", "Pro", "DealInSec Pro — manage plan");
      case "TRIAL_ACTIVE":
        return chip(
          "text-emerald-100",
          <Sparkles className="w-3.5 h-3.5 text-emerald-300" />,
          <>Pro trial · <span className="tabular-nums">{trialDaysLeft}</span> days left</>,
          `${trialDaysLeft}d`,
          `Pro trial — ${trialDaysLeft} days left, everything unlocked`,
        );
      case "TRIAL_ENDING":
        return chip(
          "dis-topnav-chip-warn text-amber-50",
          <Sparkles className="w-3.5 h-3.5 text-amber-300" />,
          trialDaysLeft === 1 ? "Pro trial · last day" : <>Pro trial · <span className="tabular-nums">{trialDaysLeft}</span> days left</>,
          `${trialDaysLeft}d`,
          trialDaysLeft === 1 ? "Pro trial — last day. Keep Pro" : `Pro trial — ${trialDaysLeft} days left. Keep Pro`,
        );
      case "BOOST":
        return chip("text-orange-100", <Zap className="w-3.5 h-3.5 text-orange-300" />, "Deal Boost", "Boost", "Deal Boost active — upgrade to Pro");
      case "TRIAL_ENDED":
        // The single highest-intent moment in the lifecycle — the only filled CTA.
        return (
          <BarTip label="Your trial has ended. Your deals and documents are safe.">
            <Link
              href="/pricing"
              data-testid="topnav-plan-chip"
              className="gradient-btn inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-[12px] font-semibold text-white whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {checkoutAvailable ? <>Upgrade<span className="hidden xl:inline">&nbsp;— {formatRupees(proMonthlyPrice)}/mo</span></> : <>See Pro plans</>}
            </Link>
          </BarTip>
        );
      case "FREE":
        return chip("text-white/85", <Sparkles className="w-3.5 h-3.5 text-emerald-300" />, "Free plan · Upgrade", "Upgrade", "Free plan — upgrade to Pro");
    }
  };

  return (
    <header
      aria-label="Primary navigation"
      className="dis-topnav hidden lg:block fixed top-0 inset-x-0 z-[45] h-[var(--dis-topnav-h)] text-white"
    >
      {/* App-level TooltipProvider uses Radix's 700ms default — too slow here. */}
      <TooltipProvider delayDuration={150} skipDelayDuration={400} disableHoverableContent>
        <div className="h-full max-w-[1600px] mx-auto flex items-stretch px-4 xl:px-6">
          {/* ── Brand ── */}
          <Link
            href="/dashboard"
            aria-label="DealInSec — dashboard"
            className="flex shrink-0 items-center gap-2.5 pr-4 xl:pr-6 outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60 focus-visible:rounded-md"
          >
            <span className="dis-topnav-logo rounded-[11px]">
              <DealinsecLogo size="sm" withText={false} />
            </span>
            <span className="hidden xl:inline text-[17px] font-bold tracking-tight leading-none">
              Deal<span className="text-emerald-300">insec</span>
            </span>
          </Link>
          <span aria-hidden="true" className="self-center h-8 w-px mr-1 bg-gradient-to-b from-white/0 via-white/20 to-white/0" />

          {/* ── Workspace tabs ── */}
          <nav aria-label="Workspace" className="flex items-stretch min-w-0 pl-1">
            {NAV.filter((i) => !i.module || canSeeModule(user as any, i.module)).map((item) => {
              const active = isActive(item.path);
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  data-testid={`topnav-${item.label.toLowerCase()}`}
                  aria-current={active ? "page" : undefined}
                  className="dis-topnav-tab relative flex items-center gap-2 px-3 xl:px-4 text-[14px] font-semibold whitespace-nowrap outline-none focus-visible:bg-white/10"
                >
                  <Icon className="w-[17px] h-[17px]" strokeWidth={active ? 2.3 : 1.9} />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* ── Account ── */}
          <div className="ml-auto flex shrink-0 items-center gap-1.5 xl:gap-2 pl-3">
            {planChip()}

            <span aria-hidden="true" className="mx-1 h-6 w-px bg-white/15" />

            <NotificationBell className="dis-topnav-icon !w-9 !h-9 !rounded-[10px] text-white/75 hover:!text-white hover:!bg-transparent" />

            <BarTip label="Settings">
              <Link
                href="/settings"
                aria-label="Settings"
                data-testid="topnav-settings"
                aria-current={isActive("/settings") ? "page" : undefined}
                className={iconButton}
              >
                <Settings className="w-[18px] h-[18px]" />
              </Link>
            </BarTip>

            <span aria-hidden="true" className="mx-1 h-6 w-px bg-white/15" />

            <BarTip label={`Your profile · ${user?.email ?? ""}`}>
              <Link
                href="/profile"
                data-testid="topnav-profile"
                aria-current={isActive("/profile") ? "page" : undefined}
                className="dis-topnav-user flex items-center gap-2.5 h-10 pl-1 pr-1 min-[1400px]:pr-3 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60"
              >
                <span className="dis-topnav-avatar flex items-center justify-center w-8 h-8 rounded-full text-[12px] font-bold text-white">
                  {initials}
                </span>
                <span className="hidden min-[1400px]:block max-w-[140px] truncate text-[13.5px] font-semibold text-white/95">
                  {displayName}
                </span>
              </Link>
            </BarTip>

            <button
              onClick={handleLogout}
              data-testid="topnav-logout"
              aria-label="Sign out"
              title="Sign out"
              className="dis-topnav-signout flex items-center gap-1.5 h-9 px-2.5 min-[1400px]:px-3 rounded-[10px] text-[13px] font-semibold whitespace-nowrap text-rose-200 hover:text-white"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden min-[1400px]:inline">Sign out</span>
            </button>
          </div>
        </div>
      </TooltipProvider>
    </header>
  );
}
