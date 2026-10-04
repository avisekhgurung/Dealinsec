import { useLocation, Link } from "wouter";
import { LayoutDashboard, Target, Briefcase, FileCheck, Receipt, FileText, UserCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { canSeeModule } from "@shared/permissions";

const navItems = [
  { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { path: "/leads", label: "Leads", icon: Target, module: "deals" as const },
  { path: "/deals", label: "Deals", icon: Briefcase, module: "deals" as const },
  { path: "/quotations", label: "Quotes", icon: FileText, module: "quotations" as const },
  { path: "/contracts", label: "Agreements", icon: FileCheck, module: "agreements" as const },
  { path: "/invoices", label: "Invoices", icon: Receipt, module: "invoices" as const },
  { path: "/profile", label: "Profile", icon: UserCircle },
];

/**
 * Mobile tab bar — the same lit ink-green surface as the desktop top bar, so
 * the phone app and the desktop app read as one product. Items share the
 * width equally (flex-1, min-w-0) so seven tabs fit a 320px phone (text steps down with the width: 10px from 430px, 9px from 360px, 8.5px from 340px, 8px below) without
 * overflowing; styles live in index.css (.dis-bottomnav*).
 */
export function BottomNav() {
  const [location] = useLocation();
  const { user } = useAuth();

  const isActive = (path: string) => {
    if (/^\/deals\/[^/]+\/quote/.test(location)) return path === "/quotations";
    if (location.startsWith("/brand-invoices")) return path === "/invoices";
    return location === path || location.startsWith(path + "/");
  };

  return (
    <nav aria-label="Primary" className="dis-bottomnav fixed bottom-0 inset-x-0 z-50 safe-area-pb lg:hidden">
      <div className="flex items-stretch h-16 max-w-lg mx-auto px-1.5">
        {navItems
          .filter((item) => !item.module || canSeeModule(user as any, item.module))
          .map((item) => {
            const active = isActive(item.path);
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                href={item.path}
                data-testid={`nav-${item.label.toLowerCase()}`}
                aria-current={active ? "page" : undefined}
                className="dis-bottomnav-item relative flex-1 min-w-0 flex flex-col items-center justify-center gap-1 outline-none"
              >
                <span className="dis-bottomnav-icon relative flex items-center justify-center w-11 h-7 rounded-full">
                  <Icon className="w-[19px] h-[19px]" strokeWidth={active ? 2.4 : 1.8} />
                </span>
                <span className={`max-w-full truncate text-[8px] leading-none tracking-tighter min-[340px]:text-[8.5px] min-[360px]:text-[9px] min-[430px]:px-0.5 min-[430px]:text-[10px] min-[430px]:tracking-tight ${active ? "font-bold" : "font-medium"}`}>
                  {item.label}
                </span>
              </Link>
            );
          })}
      </div>
    </nav>
  );
}
