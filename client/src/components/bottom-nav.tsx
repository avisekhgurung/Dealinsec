import { useLocation, Link } from "wouter";
import { Home, Briefcase, FileCheck, Receipt, FileText, UserCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { canSeeModule } from "@shared/permissions";

const navItems = [
  { path: "/dashboard", label: "Home", icon: Home },
  { path: "/deals", label: "Deals", icon: Briefcase, module: "deals" as const },
  { path: "/quotations", label: "Quotes", icon: FileText, module: "quotations" as const },
  { path: "/contracts", label: "Agreements", icon: FileCheck, module: "agreements" as const },
  { path: "/invoices", label: "Invoices", icon: Receipt, module: "invoices" as const },
  { path: "/profile", label: "Profile", icon: UserCircle },
];

export function BottomNav() {
  const [location] = useLocation();
  const { user } = useAuth();

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-50 safe-area-pb lg:hidden border-t border-white/35 dark:border-white/10 bg-white/80 dark:bg-zinc-950/85 shadow-[0_-4px_24px_rgba(0,0,0,0.06)] dark:shadow-[0_-4px_24px_rgba(0,0,0,0.45)]"
      style={{ backdropFilter: "blur(28px)", WebkitBackdropFilter: "blur(28px)" }}
    >
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-1">
        {navItems
          .filter((item) => !(item as any).module || canSeeModule(user as any, (item as any).module))
          .map((item) => {
          const onQuoteDoc = /^\/deals\/[^/]+\/quote/.test(location);
          const isActive = onQuoteDoc
            ? item.path === "/quotations"
            : location === item.path ||
              (item.path !== "/" && location.startsWith(item.path));
          const Icon = item.icon;

          return (
            <Link key={item.path} href={item.path}>
              <button
                data-testid={`nav-${item.label.toLowerCase()}`}
                className={`relative flex flex-col items-center justify-center gap-0.5 w-[58px] h-14 rounded-2xl transition-all duration-200 ${
                  isActive
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-slate-500 dark:text-zinc-400"
                }`}

              >
                {isActive && (
                  <span
                    className="absolute inset-x-1 top-1 bottom-1 rounded-xl"
                    style={{ background: "linear-gradient(135deg, hsl(160 84% 40% / 0.14) 0%, hsl(174 77% 40% / 0.10) 100%)" }}
                  />
                )}
                <div className="relative">
                  <Icon
                    className="relative w-5 h-5 transition-all duration-200"
                    style={{ strokeWidth: isActive ? 2.5 : 1.75 }}
                  />
                </div>
                <span className={`relative text-[9px] leading-tight tracking-tight max-w-full truncate transition-all duration-200 ${isActive ? "font-bold" : "font-medium"}`}>
                  {item.label}
                </span>
              </button>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
