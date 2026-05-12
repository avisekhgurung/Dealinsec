import { useLocation, Link } from "wouter";
import {
  Home,
  Briefcase,
  FileCheck,
  Receipt,
  UserCircle,
  Settings,
  LogOut,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { DealinsecLogo } from "@/components/dealinsec-logo";

interface NavItem {
  path: string;
  label: string;
  icon: typeof Home;
  description?: string;
}

const PRIMARY_NAV: NavItem[] = [
  { path: "/dashboard", label: "Dashboard", icon: Home, description: "Overview & KPIs" },
  { path: "/deals", label: "Deals", icon: Briefcase, description: "Pipeline & quotations" },
  { path: "/contracts", label: "Agreements", icon: FileCheck, description: "Signed contracts" },
  { path: "/invoices", label: "Invoices", icon: Receipt, description: "Billing & payments" },
];

const SECONDARY_NAV: NavItem[] = [
  { path: "/profile", label: "Profile", icon: UserCircle },
  { path: "/pricing", label: "Pricing", icon: Settings },
];

export function DesktopSidebar() {
  const [location, setLocation] = useLocation();
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();

  // Hide sidebar entirely if not logged in (landing/onboarding/marketing routes)
  if (!isAuthenticated) return null;

  const credits = user?.contractCredits ?? 0;
  const firstName = user?.firstName ?? "";
  const lastName = user?.lastName ?? "";
  const displayName = [firstName, lastName].filter(Boolean).join(" ") || user?.email || "User";
  const initials = (firstName[0] ?? "") + (lastName[0] ?? "") || (user?.email?.[0]?.toUpperCase() ?? "U");

  const isActive = (path: string) =>
    location === path || (path !== "/" && location.startsWith(path));

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout", {});
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/");
    } catch {
      toast({ title: "Logout failed", description: "Please try again", variant: "destructive" });
    }
  };

  return (
    <aside
      aria-label="Primary navigation"
      className="hidden lg:flex fixed inset-y-0 left-0 z-30 w-72 flex-col bg-sidebar border-r border-sidebar-border"
    >
      {/* ── Logo ── */}
      <div className="h-16 flex items-center px-5 border-b border-sidebar-border">
        <Link href="/dashboard">
          <button className="flex items-center gap-2.5 group">
            <DealinsecLogo size="sm" />
            <div className="text-base font-bold text-sidebar-foreground tracking-tight group-hover:text-primary transition-colors">
              DealInSec
            </div>
          </button>
        </Link>
      </div>

      {/* ── Credit balance card ── */}
      <div className="px-4 pt-5">
        <Link href="/pricing">
          <button className="w-full group">
            <div className="rounded-xl border border-sidebar-border bg-gradient-to-br from-primary/[0.06] via-background to-background p-3.5 hover:border-primary/40 hover:shadow-sm transition-all">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  Contract Credits
                </span>
                <Sparkles className="w-3.5 h-3.5 text-primary" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-foreground">{credits}</span>
                <span className="text-xs text-muted-foreground">available</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-primary font-medium group-hover:text-primary/80">
                <span>Buy more</span>
                <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </div>
          </button>
        </Link>
      </div>

      {/* ── Primary nav ── */}
      <nav className="flex-1 overflow-y-auto px-3 pt-6 space-y-0.5">
        <div className="px-2 mb-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground/80">
            Workspace
          </span>
        </div>
        {PRIMARY_NAV.map((item) => {
          const active = isActive(item.path);
          const Icon = item.icon;
          return (
            <Link key={item.path} href={item.path}>
              <button
                data-testid={`sidebar-${item.label.toLowerCase()}`}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 group ${
                  active
                    ? "bg-primary/[0.08] text-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/40 hover:text-foreground"
                }`}
              >
                <div className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
                  active ? "bg-primary/15 text-primary" : "text-muted-foreground group-hover:text-foreground"
                }`}>
                  <Icon className="w-4 h-4" strokeWidth={active ? 2.5 : 2} />
                </div>
                <div className="flex-1 text-left">
                  <div className={`text-sm font-semibold leading-tight ${active ? "text-primary" : ""}`}>
                    {item.label}
                  </div>
                  {item.description && (
                    <div className="text-[10.5px] text-muted-foreground/80 leading-tight mt-0.5">
                      {item.description}
                    </div>
                  )}
                </div>
                {active && (
                  <span className="w-1 h-7 rounded-full bg-primary" aria-hidden="true" />
                )}
              </button>
            </Link>
          );
        })}

        <div className="px-2 mt-6 mb-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground/80">
            Account
          </span>
        </div>
        {SECONDARY_NAV.map((item) => {
          const active = isActive(item.path);
          const Icon = item.icon;
          return (
            <Link key={item.path} href={item.path}>
              <button
                data-testid={`sidebar-${item.label.toLowerCase()}`}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-150 ${
                  active
                    ? "bg-primary/[0.08] text-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/40 hover:text-foreground"
                }`}
              >
                <Icon className={`w-4 h-4 ${active ? "text-primary" : "text-muted-foreground"}`} strokeWidth={active ? 2.5 : 2} />
                <span className={`text-sm font-medium ${active ? "text-primary font-semibold" : ""}`}>
                  {item.label}
                </span>
              </button>
            </Link>
          );
        })}
      </nav>

      {/* ── User card + logout ── */}
      <div className="p-3 border-t border-sidebar-border">
        <div className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-sidebar-accent/40 transition-colors group">
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-br from-primary to-primary/70 text-white font-bold text-sm shrink-0">
            {initials.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-foreground truncate">{displayName}</div>
            <div className="text-[11px] text-muted-foreground truncate">{user?.email ?? ""}</div>
          </div>
          <button
            onClick={handleLogout}
            className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100"
            title="Sign out"
            aria-label="Sign out"
            data-testid="sidebar-logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
