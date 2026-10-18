/**
 * Desktop top navigation — a raised, lit bar across the top of the workspace.
 *
 * Replaced the left sidebar (Sep 2026, founder's call): the product's five
 * areas — Home · AI Outbound · Pipeline (Leads, Deals) · Documents
 * (Quotations, Agreements) · Money (Invoices) — sit in the bar as one-click
 * tabs, grouped by thin dividers (items, groups and active rules come from
 * @shared/nav-model, shared with the mobile bar). The account controls sit on
 * the right — plan chip, notifications, settings, the avatar (→ profile) and a
 * Sign out button that is one click, never tucked in a menu (an earlier
 * explicit ask).
 *
 * Height lives in --dis-topnav-h, shared with .app-shell's top padding and the
 * offset every page's own sticky title bar takes (see index.css). Hidden below
 * lg, where the bottom tab bar does this job.
 */
import { motion } from "framer-motion";
import { tSpring } from "@/lib/motion";
import { ModeSwitcher } from "@/components/mode-switch";
import { Fragment, useEffect, useReducer } from "react";
import { useLocation, Link } from "wouter";
import { Settings, LogOut, Sparkles, Crown, Users, Zap } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { DealinsecMark, DealinsecWordmark } from "@/components/dealinsec-logo";
import { NotificationBell } from "@/components/notification-bell";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  hasActivePro,
  hasActiveDealBoost,
  getTrialDaysLeft,
} from "@shared/schema";
import { desktopNavSections, navItem } from "@/lib/nav";
import { usePlanPrices, formatRupees, usePlanCheckoutAvailable } from "@/hooks/use-plan-prices";

/** Plan lifecycle states, resolved strictly in this order. */
type PlanState =
  | "MEMBER"        // orgRole ≠ OWNER — plan is the owner's business, no CTA
  | "PRO"           // paid — always wins over a parallel unexpired trial
  | "TRIAL_ACTIVE"  // 4–7 days left
  | "TRIAL_ENDING"  // 1–3 days left
  | "BOOST"         // Deal Boost still running (no longer sold)
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
    : "FREE"; // a lapsed trial reads as the Free plan: the trial is no longer offered

  // Route ownership (/deals/:id/quote → Quotations, /brand-invoices → Invoices)
  // lives in @shared/nav-model.
  const settingsActive = navItem("settings").isActive(location);
  const profileActive = navItem("profile").isActive(location);

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
        className={`dis-topnav-chip inline-flex items-center gap-1.5 h-8 px-2.5 xl:px-3 rounded-full text-[12px] font-semibold whitespace-nowrap ${tone}`}
      >
        {icon}
        {/* The bar stops growing at 1600px, so the long wording appears only once it has reached full width. Below xl
            (1024–1279px) the chip is its icon (the tooltip and aria-label keep the words): the eight tabs need the room. */}
        <span className="hidden min-[1600px]:inline">{text}</span>
        <span className="hidden xl:inline min-[1600px]:hidden tabular-nums">{short}</span>
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
              <span className="hidden min-[1600px]:inline">
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
              <DealinsecMark size={26} />
            </span>
            <DealinsecWordmark size={18} tone="dark" className="hidden xl:inline" />
          </Link>
          <span aria-hidden="true" className="self-center h-8 w-px mr-1 bg-gradient-to-b from-white/0 via-white/20 to-white/0" />

          {/* ── Workspace tabs ── */}
          {/* min-w-0 + overflow-x-auto: if the tabs ever outgrow the bar (a narrow window, a longer label), they scroll
              under their own edge instead of sliding beneath the account controls. */}
          <nav aria-label="Workspace" className="flex items-stretch min-w-0 pl-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {desktopNavSections(user as any).map((section, i) => (
              <Fragment key={section.group}>
                {/* Group divider: costs 5px, so the bar is no wider than the old flat one. */}
                {i > 0 && <span aria-hidden="true" className="self-center h-6 w-px mx-0.5 bg-white/15" />}
                <div role="group" aria-label={section.label} className="flex items-stretch">
                  {section.items.map((item) => {
                    const active = item.isActive(location);
                    return (
                      <Link
                        key={item.key}
                        href={item.href}
                        data-testid={`topnav-${item.key}`}
                        aria-current={active ? "page" : undefined}
                        className="dis-topnav-tab relative flex shrink-0 items-center gap-2 px-2 xl:px-2.5 min-[1536px]:px-4 text-[14px] font-semibold whitespace-nowrap outline-none focus-visible:bg-white/10"
                      >
                        {/* Short labels ("Outbound", "Quotes") until the bar has room for the long ones: with eight tabs, the
                            wordmark and the account controls, that is about 1536px (measured; 1280px overflowed). */}
                        <span className="min-[1536px]:hidden">{item.shortLabel}</span>
                        <span className="hidden min-[1536px]:inline">{item.label}</span>
                        {active && <motion.span layoutId="topnav-underline" className="dis-topnav-underline" transition={tSpring} aria-hidden="true" />}
                      </Link>
                    );
                  })}
                </div>
              </Fragment>
            ))}
          </nav>

          {/* ── Account ── */}
          <div className="ml-auto flex shrink-0 items-center gap-1.5 xl:gap-2 pl-3">
            {/* Icons, with their names as tooltip and accessible label. The bar is capped at 1600px, so a wider
                screen never buys room for the switcher's words next to seven full tab labels and the plan chip. */}
            <ModeSwitcher tone="dark" labelsFrom="never" />
            {planChip()}

            <span aria-hidden="true" className="mx-1 h-6 w-px bg-white/15" />

            <NotificationBell className="dis-topnav-icon !w-9 !h-9 !rounded-[10px] text-white/75 hover:!text-white hover:!bg-transparent" />

            <BarTip label="Settings">
              <Link
                href="/settings"
                aria-label="Settings"
                data-testid="topnav-settings"
                aria-current={settingsActive ? "page" : undefined}
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
                aria-current={profileActive ? "page" : undefined}
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
