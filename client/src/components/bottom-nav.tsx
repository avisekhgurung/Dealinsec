import { useLocation, Link } from "wouter";
import { Home, Briefcase, FileText, Receipt, Coins } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const navItems = [
  { path: "/", label: "Home", icon: Home },
  { path: "/deals", label: "Deals", icon: Briefcase },
  { path: "/contracts", label: "Contracts", icon: FileText },
  { path: "/billing", label: "Billing", icon: Receipt },
];

export function BottomNav() {
  const [location] = useLocation();
  const { user } = useAuth();
  const credits = user?.contractCredits ?? 0;

  return (
    <>
      {/* Credit pill — fixed top-right like a game HUD */}
      <Link href="/pricing">
        <div
          className="fixed top-3 right-3 z-[60] flex items-center gap-1 px-2.5 py-1 rounded-full cursor-pointer select-none pill-press"
          style={{
            background: credits > 0
              ? "linear-gradient(135deg, #fffbeb 0%, #fef3c7 50%, #fde68a 100%)"
              : "linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%)",
            border: credits > 0 ? "1.5px solid #f59e0b" : "1.5px solid #fb7185",
            boxShadow: credits > 0
              ? "0 2px 10px rgba(245,158,11,0.3), 0 1px 2px rgba(0,0,0,0.08)"
              : "0 2px 10px rgba(251,113,133,0.2), 0 1px 2px rgba(0,0,0,0.06)",
          }}
        >
          <Coins className={`w-3.5 h-3.5 ${credits > 0 ? "text-amber-600" : "text-rose-500"}`} />
          <span className={`text-xs font-black tabular-nums ${credits > 0 ? "text-amber-800" : "text-rose-600"}`}>
            {credits}
          </span>
        </div>
      </Link>

      {/* Bottom nav bar */}
      <nav className="fixed bottom-0 inset-x-0 z-50 safe-area-pb" style={{
        background: "rgba(255,255,255,0.82)",
        backdropFilter: "blur(28px)",
        WebkitBackdropFilter: "blur(28px)",
        borderTop: "1px solid rgba(255,255,255,0.35)",
        boxShadow: "0 -4px 24px rgba(0,0,0,0.06)",
      }}>
        <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-4">
          {navItems.map((item) => {
            const isActive = location === item.path ||
              (item.path !== "/" && location.startsWith(item.path));
            const Icon = item.icon;

            return (
              <Link key={item.path} href={item.path}>
                <button
                  data-testid={`nav-${item.label.toLowerCase()}`}
                  className="relative flex flex-col items-center justify-center gap-0.5 w-16 h-14 rounded-2xl transition-all duration-200"
                  style={{
                    transform: isActive ? "scale(1.05)" : "scale(1)",
                    color: isActive ? "hsl(262 80% 55%)" : "hsl(240 5% 55%)",
                  }}
                >
                  {/* Active background pill */}
                  {isActive && (
                    <span
                      className="absolute inset-x-1 top-1 bottom-1 rounded-xl"
                      style={{ background: "linear-gradient(135deg, hsl(262 83% 58% / 0.12) 0%, hsl(280 70% 65% / 0.08) 100%)" }}
                    />
                  )}
                  <Icon
                    className="relative w-5 h-5 transition-all duration-200"
                    style={{ strokeWidth: isActive ? 2.5 : 1.75 }}
                  />
                  <span className={`relative text-[10px] transition-all duration-200 ${isActive ? "font-bold" : "font-medium"}`}>
                    {item.label}
                  </span>
                </button>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
