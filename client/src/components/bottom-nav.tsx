import { useLocation, Link } from "wouter";
import { Home, Briefcase, FileCheck, Receipt, FileText, UserCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const navItems = [
  { path: "/dashboard", label: "Home", icon: Home },
  { path: "/deals", label: "Deals", icon: Briefcase },
  { path: "/contracts", label: "Agreements", icon: FileCheck },
  { path: "/invoices", label: "Invoices", icon: Receipt },
  { path: "/profile", label: "Profile", icon: UserCircle },
];

export function BottomNav() {
  const [location] = useLocation();
  const { user } = useAuth();

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 safe-area-pb lg:hidden" style={{
      background: "rgba(255,255,255,0.82)",
      backdropFilter: "blur(28px)",
      WebkitBackdropFilter: "blur(28px)",
      borderTop: "1px solid rgba(255,255,255,0.35)",
      boxShadow: "0 -4px 24px rgba(0,0,0,0.06)",
    }}>
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
        {navItems.map((item) => {
          const isActive = location === item.path ||
            (item.path !== "/" && location.startsWith(item.path));
          const Icon = item.icon;

          return (
            <Link key={item.path} href={item.path}>
              <button
                data-testid={`nav-${item.label.toLowerCase()}`}
                className="relative flex flex-col items-center justify-center gap-0.5 w-14 h-14 rounded-2xl transition-all duration-200"
                style={{
                  color: isActive ? "hsl(160 84% 30%)" : "hsl(215 16% 47%)",
                }}
              >
                {isActive && (
                  <span
                    className="absolute inset-x-1 top-1 bottom-1 rounded-xl"
                    style={{ background: "linear-gradient(135deg, hsl(160 84% 30% / 0.12) 0%, hsl(174 77% 36% / 0.08) 100%)" }}
                  />
                )}
                <div className="relative">
                  <Icon
                    className="relative w-5 h-5 transition-all duration-200"
                    style={{ strokeWidth: isActive ? 2.5 : 1.75 }}
                  />
                </div>
                <span className={`relative text-[10px] transition-all duration-200 ${isActive ? "font-bold" : "font-medium"}`}>
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
