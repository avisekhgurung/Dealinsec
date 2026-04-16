import { useLocation, Link } from "wouter";
import { Home, Briefcase, FileText, Receipt, Coins } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const navItems = [
  { path: "/", label: "Home", icon: Home },
  { path: "/deals", label: "Deals", icon: Briefcase },
  { path: "/pricing", label: "Credits", icon: Coins, isCredit: true },
  { path: "/contracts", label: "Contracts", icon: FileText },
  { path: "/billing", label: "Billing", icon: Receipt },
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
            (item.path !== "/" && item.path !== "/pricing" && location.startsWith(item.path));
          const isCreditActive = item.isCredit && location === "/pricing";
          const active = isActive || isCreditActive;
          const Icon = item.icon;

          /* ── Credit tab — special styling ── */
          if (item.isCredit) {
            return (
              <Link key={item.path} href={item.path}>
                <button
                  data-testid="nav-credits"
                  className="relative flex flex-col items-center justify-center gap-0.5 w-14 h-14 rounded-2xl transition-all duration-200"
                >
                  {/* Coin circle */}
                  <div
                    className="relative flex items-center justify-center w-9 h-9 rounded-full shadow-sm"
                    style={{
                      background: credits > 0
                        ? "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)"
                        : "linear-gradient(135deg, #fda4af 0%, #fb7185 100%)",
                      boxShadow: credits > 0
                        ? "0 2px 8px rgba(245,158,11,0.4)"
                        : "0 2px 8px rgba(251,113,133,0.3)",
                    }}
                  >
                    <span className="text-white text-sm font-black tabular-nums">
                      {credits}
                    </span>
                  </div>
                  <span className={`text-[9px] font-bold transition-colors ${
                    active
                      ? "text-amber-600"
                      : credits > 0 ? "text-amber-600/70" : "text-rose-500/70"
                  }`}>
                    Credits
                  </span>
                </button>
              </Link>
            );
          }

          /* ── Standard nav item ── */
          return (
            <Link key={item.path} href={item.path}>
              <button
                data-testid={`nav-${item.label.toLowerCase()}`}
                className="relative flex flex-col items-center justify-center gap-0.5 w-14 h-14 rounded-2xl transition-all duration-200"
                style={{
                  color: active ? "hsl(262 80% 55%)" : "hsl(240 5% 55%)",
                }}
              >
                {active && (
                  <span
                    className="absolute inset-x-1 top-1 bottom-1 rounded-xl"
                    style={{ background: "linear-gradient(135deg, hsl(262 83% 58% / 0.12) 0%, hsl(280 70% 65% / 0.08) 100%)" }}
                  />
                )}
                <Icon
                  className="relative w-5 h-5 transition-all duration-200"
                  style={{ strokeWidth: active ? 2.5 : 1.75 }}
                />
                <span className={`relative text-[10px] transition-all duration-200 ${active ? "font-bold" : "font-medium"}`}>
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
