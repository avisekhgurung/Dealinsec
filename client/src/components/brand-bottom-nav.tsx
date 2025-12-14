import { useLocation, Link } from "wouter";
import { Home, Briefcase, FileText } from "lucide-react";

const navItems = [
  { path: "/", label: "Home", icon: Home },
  { path: "/brand/deals", label: "Deals", icon: Briefcase },
  { path: "/brand/contracts", label: "Contracts", icon: FileText },
];

export function BrandBottomNav() {
  const [location] = useLocation();

  return (
    <nav className="fixed bottom-0 inset-x-0 bg-background border-t border-border h-16 z-50 safe-area-pb">
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
                    ? "text-primary" 
                    : "text-muted-foreground"
                }`}
              >
                <Icon className={`w-6 h-6 ${isActive ? "stroke-[2.5]" : "stroke-[1.5]"}`} />
                <span className={`text-xs font-medium ${isActive ? "font-semibold" : ""}`}>
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
