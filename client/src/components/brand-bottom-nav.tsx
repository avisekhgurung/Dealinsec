import { useLocation, Link } from "wouter";
import { Home, Briefcase, FileText, Receipt } from "lucide-react";

const navItems = [
  { path: "/dashboard", label: "Home", icon: Home },
  { path: "/brand/deals", label: "Deals", icon: Briefcase },
  { path: "/brand/contracts", label: "Contracts", icon: FileText },
  { path: "/brand/billing", label: "Billing", icon: Receipt },
];

export function BrandBottomNav() {
  const [location] = useLocation();

  return (
    <nav className="fixed bottom-0 inset-x-0 glass-nav h-16 z-50 safe-area-pb">
      <div className="flex items-center justify-around h-full max-w-lg mx-auto px-2">
        {navItems.map((item) => {
          const isActive = location === item.path ||
            (item.path !== "/" && location.startsWith(item.path));
          const Icon = item.icon;

          return (
            <Link key={item.path} href={item.path}>
              <button
                data-testid={`nav-${item.label.toLowerCase()}`}
                className={`flex flex-col items-center justify-center gap-1 w-16 h-full transition-colors ${
                  isActive
                    ? "text-purple-600 dark:text-purple-400"
                    : "text-muted-foreground"
                }`}
              >
                <Icon className={`w-6 h-6 ${isActive ? "stroke-[2.5]" : "stroke-[1.5]"}`} />
                <span className={`text-xs font-medium ${isActive ? "font-semibold" : ""}`}>
                  {item.label}
                </span>
                {isActive && (
                  <div className="w-1 h-1 rounded-full gradient-primary" />
                )}
              </button>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
