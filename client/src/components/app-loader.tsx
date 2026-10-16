import { useEffect, useState } from "react";
import { DealinsecMark, DealinsecWordmark, BRAND_SLOGAN } from "@/components/dealinsec-logo";
import { ChartColumnIncreasing, CreditCard, FileText, Handshake, ReceiptText, Search, Signature, Users, type LucideIcon } from "lucide-react";

/**
 * The app loader: the D at the centre of an orbit (two slow counter-rotating rings with travelling lights, five
 * floating cards for what DealInSec handles), the wordmark and slogan, then the journey
 * Prospect → Deal → Quote → Agreement → Invoice → Get Paid filling in step by step, over drifting emerald waves.
 *
 * Pure CSS animation (it runs while the app's code is still loading, and needs no animation frame loop), with one
 * timer for the active step. Everything decorative is hidden from screen readers; the status is announced once.
 * Under "reduce motion" nothing moves: the journey shows complete and the waves, orbit and cards hold still.
 * Sized so the journey fits a 375px phone.
 */
const JOURNEY: { icon: LucideIcon; label: string }[] = [
  { icon: Search, label: "Prospect" },
  { icon: Users, label: "Deal" },
  { icon: FileText, label: "Quote" },
  { icon: Signature, label: "Agreement" },
  { icon: ReceiptText, label: "Invoice" },
  { icon: CreditCard, label: "Get Paid" },
];

/** The floating cards: an icon, where it sits on the orbit (degrees, 0 = right, clockwise), when it appears. */
const ORBIT_CARDS: { icon: LucideIcon; angle: number; delay: number }[] = [
  { icon: Users, angle: -128, delay: 0.25 },
  { icon: ChartColumnIncreasing, angle: -52, delay: 0.4 },
  { icon: Handshake, angle: -6, delay: 0.55 },
  { icon: CreditCard, angle: 56, delay: 0.7 },
  { icon: FileText, angle: 188, delay: 0.85 },
];

const STEP_MS = 850;

/** The step lighting up now: 0…count-1, or `count` for one beat with every step complete before going round again. */
function useActiveStep(count: number): number {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setActive(count); // still: the whole journey shown complete
      return;
    }
    const t = setInterval(() => setActive((a) => (a + 1) % (count + 1)), STEP_MS);
    return () => clearInterval(t);
  }, [count]);
  return active;
}

export function AppLoader() {
  const active = useActiveStep(JOURNEY.length);
  return (
    <div className="dis-loader fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-background" role="status" aria-live="polite">
      <span className="sr-only">Setting up your workspace</span>

      {/* Light: soft emerald washes in the corners, and two layers of waves drifting along the bottom. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-[15%] -top-[20%] h-[60vmax] w-[60vmax] rounded-full bg-emerald-300/20 blur-3xl dark:bg-emerald-500/10" />
        <div className="absolute -right-[20%] top-[5%] h-[50vmax] w-[50vmax] rounded-full bg-teal-200/25 blur-3xl dark:bg-teal-500/10" />
        <div className="absolute inset-x-0 bottom-0 h-[38vh] min-h-[180px]">
          <svg className="dis-wave dis-wave-a absolute bottom-0 h-full w-[200%]" viewBox="0 0 2880 320" preserveAspectRatio="none">
            <path d="M0 210C240 150 480 120 720 160S1200 270 1440 220 1920 120 2160 160 2640 270 2880 220V320H0Z" fill="url(#dis-wave-1)" />
            <defs><linearGradient id="dis-wave-1" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#34D399" stopOpacity=".16" /><stop offset="1" stopColor="#10B981" stopOpacity=".05" /></linearGradient></defs>
          </svg>
          <svg className="dis-wave dis-wave-b absolute bottom-0 h-[78%] w-[200%]" viewBox="0 0 2880 320" preserveAspectRatio="none">
            <path d="M0 240C300 290 520 170 760 190S1180 300 1440 250 1960 170 2200 190 2620 300 2880 250V320H0Z" fill="url(#dis-wave-2)" />
            <defs><linearGradient id="dis-wave-2" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#2DD4BF" stopOpacity=".14" /><stop offset="1" stopColor="#14B8A6" stopOpacity=".04" /></linearGradient></defs>
          </svg>
        </div>
      </div>

      <div className="relative z-10 flex w-full max-w-3xl flex-col items-center px-4">
        {/* The orbit, centred on the brand. */}
        <div className="dis-orbit relative flex items-center justify-center">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <div className="dis-ring dis-ring-outer absolute inset-0 rounded-full border border-emerald-500/15 dark:border-emerald-400/15">
              <span className="dis-light left-1/2 top-0 h-2 w-2 bg-emerald-500" />
              <span className="dis-light left-[3%] top-[62%] h-1.5 w-1.5 bg-emerald-300" />
              <span className="dis-light left-[90%] top-[78%] h-1.5 w-1.5 bg-teal-300" />
            </div>
            <div className="dis-ring dis-ring-inner absolute inset-[13%] rounded-full border border-emerald-500/10 dark:border-emerald-400/10">
              <span className="dis-light left-[96%] top-[38%] h-1.5 w-1.5 bg-emerald-400" />
              <span className="dis-light left-[8%] top-[20%] h-1 w-1 bg-teal-400" />
            </div>
            {ORBIT_CARDS.map(({ icon: Icon, angle, delay }) => (
              <span key={angle} className="dis-card-slot absolute left-1/2 top-1/2" style={{ transform: `rotate(${angle}deg) translateX(var(--dis-orbit-r)) rotate(${-angle}deg)` }}>
                <span className="dis-card flex items-center justify-center rounded-xl bg-white/95 shadow-[0_10px_24px_-10px_rgba(6,95,70,0.35)] ring-1 ring-black/[0.04] dark:bg-white/10 dark:ring-white/10" style={{ animationDelay: `${delay}s, ${delay + 0.6}s` }}>
                  <Icon className="text-emerald-600 dark:text-emerald-300" strokeWidth={2.2} />
                </span>
              </span>
            ))}
          </div>

          <div className="relative flex flex-col items-center text-center">
            <div className="dis-mark-wrap relative">
              <span aria-hidden="true" className="dis-glow absolute inset-[-30%] rounded-full" />
              <span aria-hidden="true" className="dis-ripple absolute inset-[-8%] rounded-full border border-emerald-400/40" />
              <DealinsecMark size={112} className="dis-mark relative" />
            </div>
            <div className="dis-rise mt-3" style={{ animationDelay: ".2s" }}>
              <DealinsecWordmark size={46} className="dis-wordmark-hero" />
            </div>
            <p className="dis-rise dis-slogan-hero mt-2 font-medium text-[#3A4550] dark:text-[#A3B3BD]" style={{ animationDelay: ".35s" }}>{BRAND_SLOGAN}</p>
          </div>
        </div>

        {/* The journey: each step fills in turn; the connector before it fills as the flow arrives. */}
        <ol aria-hidden="true" className="dis-rise mt-8 flex items-start justify-center sm:mt-10" style={{ animationDelay: ".5s" }}>
          {JOURNEY.map(({ icon: Icon, label }, i) => {
            const state = i < active ? "done" : i === active ? "active" : "todo";
            return (
              <li key={label} className="flex items-start">
                {i > 0 && (
                  <span className="dis-connector relative mt-[17px] h-[3px] overflow-hidden rounded-full bg-emerald-900/10 dark:bg-white/10 sm:mt-[21px]">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-[width] duration-500 ease-out" style={{ width: i <= active ? "100%" : "0%" }} />
                  </span>
                )}
                <span className="dis-step flex flex-col items-center gap-1.5" data-state={state}>
                  <span className="dis-step-icon relative flex items-center justify-center rounded-xl transition-all duration-500 ease-out">
                    {state === "active" && <span className="dis-step-pulse absolute inset-0 rounded-xl" />}
                    <Icon className="relative" strokeWidth={2.1} />
                  </span>
                  <span className="dis-step-label whitespace-nowrap transition-colors duration-500">{label}</span>
                </span>
              </li>
            );
          })}
        </ol>

        <div aria-hidden="true" className="dis-rise mt-7 flex items-center gap-2" style={{ animationDelay: ".6s" }}>
          {[0, 1, 2].map((i) => <span key={i} className="dis-dot h-2 w-2 rounded-full bg-emerald-500" style={{ animationDelay: `${i * 0.2}s` }} />)}
        </div>
        <p aria-hidden="true" className="dis-rise mt-4 text-sm text-muted-foreground" style={{ animationDelay: ".7s" }}>Setting up your workspace…</p>
      </div>

      <style>{`
        .dis-loader { --dis-orbit: 380px; --dis-orbit-r: 190px; --dis-card: 52px; --dis-card-icon: 22px; }
        @media (max-width: 640px) { .dis-loader { --dis-orbit: 300px; --dis-orbit-r: 150px; --dis-card: 40px; --dis-card-icon: 18px; } }
        @media (max-width: 380px) { .dis-loader { --dis-orbit: 272px; --dis-orbit-r: 136px; } }
        .dis-orbit { width: var(--dis-orbit); height: var(--dis-orbit); }
        @media (max-width: 640px) {
          .dis-mark { width: 86px; height: 86px; }
          .dis-wordmark-hero { font-size: 34px !important; }
        }
        .dis-slogan-hero { font-size: clamp(13px, 1.6vw, 17px); letter-spacing: .01em; }

        .dis-ring-outer { animation: dis-spin 46s linear infinite; }
        .dis-ring-inner { animation: dis-spin 34s linear infinite reverse; }
        .dis-light { position: absolute; border-radius: 9999px; transform: translate(-50%, -50%); box-shadow: 0 0 10px 2px rgba(16,185,129,.35); }

        .dis-card-slot { width: 0; height: 0; }
        .dis-card { position: absolute; left: calc(var(--dis-card) / -2); top: calc(var(--dis-card) / -2); width: var(--dis-card); height: var(--dis-card);
          opacity: 0; animation: dis-pop .6s cubic-bezier(.2,.9,.3,1.3) forwards, dis-float 5.5s ease-in-out infinite; }
        .dis-card svg { width: var(--dis-card-icon); height: var(--dis-card-icon); }

        .dis-mark-wrap { animation: dis-enter .8s cubic-bezier(.2,.8,.2,1) both; }
        .dis-mark { animation: dis-breathe 3.6s ease-in-out 0.8s infinite; filter: drop-shadow(0 14px 22px rgba(6,95,70,.28)); }
        .dis-glow { background: radial-gradient(circle, rgba(52,211,153,.32) 0%, rgba(16,185,129,.12) 38%, transparent 70%); animation: dis-glow 3.6s ease-in-out infinite; }
        .dis-ripple { opacity: 0; animation: dis-ripple 3.6s ease-out 1s infinite; }
        .dis-rise { animation: dis-rise .7s cubic-bezier(.2,.8,.2,1) both; }

        .dis-connector { width: 34px; }
        @media (max-width: 640px) { .dis-connector { width: 9px; } }
        .dis-step { width: 84px; }
        @media (max-width: 640px) { .dis-step { width: 50px; } }
        .dis-step-icon { width: 44px; height: 44px; background: #fff; color: #10A584; box-shadow: 0 6px 16px -10px rgba(6,95,70,.35); outline: 1px solid rgba(16,185,129,.12); }
        @media (max-width: 640px) { .dis-step-icon { width: 36px; height: 36px; } }
        .dis-step-icon svg { width: 20px; height: 20px; }
        @media (max-width: 640px) { .dis-step-icon svg { width: 17px; height: 17px; } }
        .dark .dis-step-icon { background: rgba(255,255,255,.06); outline-color: rgba(255,255,255,.08); color: #34D399; }
        .dis-step-label { font-size: 13px; font-weight: 500; color: hsl(var(--foreground) / .82); }
        @media (max-width: 640px) { .dis-step-label { font-size: 10px; } }
        .dis-step[data-state="todo"] .dis-step-icon { opacity: .72; }
        .dis-step[data-state="done"] .dis-step-icon { background: #ECFDF5; color: #059669; outline-color: rgba(16,185,129,.28); }
        .dark .dis-step[data-state="done"] .dis-step-icon { background: rgba(16,185,129,.16); color: #6EE7B7; }
        .dis-step[data-state="active"] .dis-step-icon { background: linear-gradient(160deg, #34D399 0%, #10B981 45%, #0C8E7B 100%); color: #fff; transform: translateY(-2px) scale(1.08);
          box-shadow: 0 12px 24px -8px rgba(5,150,105,.6); outline-color: transparent; }
        .dis-step[data-state="active"] .dis-step-label { color: #059669; font-weight: 600; }
        .dark .dis-step[data-state="active"] .dis-step-label { color: #34D399; }
        .dis-step-pulse { box-shadow: 0 0 0 0 rgba(16,185,129,.45); animation: dis-step-pulse 1.2s ease-out infinite; }

        .dis-dot { opacity: .3; animation: dis-dot 1.2s ease-in-out infinite; }
        .dis-wave-a { animation: dis-drift 22s linear infinite; }
        .dis-wave-b { animation: dis-drift 30s linear infinite reverse; }
        .dark .dis-wave { opacity: .6; }

        @keyframes dis-spin { to { transform: rotate(360deg); } }
        @keyframes dis-pop { from { opacity: 0; transform: scale(.6) translateY(6px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes dis-float { 0%, 100% { translate: 0 0; } 50% { translate: 0 -7px; } }
        @keyframes dis-enter { from { opacity: 0; transform: scale(.82) translateY(10px); } to { opacity: 1; transform: none; } }
        @keyframes dis-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.035); } }
        @keyframes dis-glow { 0%, 100% { opacity: .65; transform: scale(.94); } 50% { opacity: 1; transform: scale(1.06); } }
        @keyframes dis-ripple { 0% { opacity: .55; transform: scale(.92); } 70%, 100% { opacity: 0; transform: scale(1.5); } }
        @keyframes dis-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        @keyframes dis-step-pulse { 0% { box-shadow: 0 0 0 0 rgba(16,185,129,.45); } 100% { box-shadow: 0 0 0 12px rgba(16,185,129,0); } }
        @keyframes dis-dot { 0%, 100% { opacity: .3; transform: scale(.85); } 40% { opacity: 1; transform: scale(1.15); } }
        @keyframes dis-drift { from { transform: translateX(0); } to { transform: translateX(-50%); } }

        @media (prefers-reduced-motion: reduce) {
          .dis-loader *, .dis-loader *::before, .dis-loader *::after { animation: none !important; transition: none !important; }
          .dis-card, .dis-rise, .dis-mark-wrap { opacity: 1 !important; }
          .dis-ripple { display: none; }
        }
      `}</style>
    </div>
  );
}

/**
 * Lightweight loader for route transitions.
 * A thin gradient progress bar at the top of the viewport —
 * non-blocking, unobtrusive, used by apps like Linear & Notion.
 */
export function RouteLoader() {
  // Shown while a screen's code loads. It appears only after 150 ms, so a fast load never flashes a bar, it tells
  // screen readers what is happening, and it holds still for people who prefer reduced motion.
  return (
    <>
      <div className="dis-route-loader fixed top-0 left-0 right-0 z-[9999] h-0.5 overflow-hidden pointer-events-none" role="status" aria-label="Loading">
        <div
          className="h-full w-full origin-left animate-route-progress"
          style={{
            background: "linear-gradient(90deg, #059669 0%, #0D9488 50%, #10b981 100%)",
            boxShadow: "0 0 10px rgba(5, 150, 105, 0.6)",
          }}
        />
      </div>
      <style>{`
        @keyframes route-progress {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(0%); }
          100% { transform: translateX(100%); }
        }
        @keyframes route-loader-in { from { opacity: 0; } to { opacity: 1; } }
        .dis-route-loader { opacity: 0; animation: route-loader-in 0.12s ease-out 0.15s forwards; }
        .animate-route-progress {
          animation: route-progress 1.1s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .dis-route-loader { animation: none; opacity: 1; }
          .animate-route-progress { animation: none; transform: scaleX(0.4); }
        }
      `}</style>
    </>
  );
}

/**
 * Smaller inline variant for use within cards/sections,
 * when the full-screen loader would be overkill.
 */
export function InlineLoader({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8">
      <div className="relative w-10 h-10">
        <div className="absolute inset-0 animate-spin-slow-inline">
          <svg viewBox="0 0 40 40" fill="none" className="w-full h-full">
            <circle
              cx="20"
              cy="20"
              r="17"
              stroke="url(#inline-gradient)"
              strokeWidth="2.5"
              strokeDasharray="4 6"
              strokeLinecap="round"
            />
            <defs>
              <linearGradient id="inline-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#059669" />
                <stop offset="100%" stopColor="#0D9488" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <div className="absolute inset-2 flex items-center justify-center">
          <div
            className="w-4 h-4 rounded-md"
            style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)" }}
          />
        </div>
      </div>
      {label && <p className="text-xs text-muted-foreground">{label}</p>}
      <style>{`
        @keyframes spin-slow-inline { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin-slow-inline { animation: spin-slow-inline 2s linear infinite; }
      `}</style>
    </div>
  );
}
