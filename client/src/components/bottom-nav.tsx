import { useLocation, Link } from "wouter";
import { Home, Briefcase, FileCheck, Receipt, UserCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const navItems = [
  { path: "/", label: "Home", icon: Home },
  { path: "/deals", label: "Deals", icon: Briefcase },
  { path: "/contracts", label: "Agreements", icon: FileCheck },
  { path: "/invoices", label: "Invoices", icon: Receipt },
  { path: "/profile", label: "Profile", icon: UserCircle, showCredits: true },
];

export function BottomNav() {
  const [location] = useLocation();
  const { user } = useAuth();
  const credits = user?.contractCredits ?? 0;

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 safe-area-pb" style={{
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
                  {/* Credit badge on Profile tab */}
                  {(item as any).showCredits && (
                    <span
                      className="absolute -top-1.5 -right-2.5 min-w-[16px] h-[16px] flex items-center justify-center rounded-full text-[9px] font-black text-white leading-none px-[3px]"
                      style={{
                        background: credits > 0
                          ? "linear-gradient(135deg, #fbbf24, #f59e0b)"
                          : "linear-gradient(135deg, #fb7185, #ef4444)",
                        boxShadow: credits > 0
                          ? "0 1px 4px rgba(245,158,11,0.5)"
                          : "0 1px 4px rgba(239,68,68,0.4)",
                      }}
                    >
                      {credits}
                    </span>
                  )}
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
